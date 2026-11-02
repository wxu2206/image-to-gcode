import { PAGE_BREAK, type ExtractedDocument } from './types';

export type DocumentKind = 'docx' | 'pdf';
export const DOCUMENT_LIMITS = {
  maxFileBytes: 25 * 1024 * 1024,
  maxXmlBytes: 12 * 1024 * 1024,
  maxPdfObjects: 50_000,
  maxPdfPages: 500,
  maxExtractedCharacters: 500_000,
  maxInflatedStreamBytes: 24 * 1024 * 1024,
  maxAggregateInflatedBytes: 48 * 1024 * 1024,
  maxPdfTokens: 2_000_000,
  maxPdfContentReferences: 10_000,
  maxPdfCmapOperations: 250_000,
  maxPdfFontReferences: 10_000,
} as const;

const decoder = new TextDecoder();
const latinDecoder = new TextDecoder('windows-1252');
const little16 = (data: Uint8Array, offset: number) => data[offset] | data[offset + 1] << 8;
const little32 = (data: Uint8Array, offset: number) => (data[offset] | data[offset + 1] << 8 | data[offset + 2] << 16 | data[offset + 3] << 24) >>> 0;

export function documentFileKind(file: Pick<File, 'name' | 'type'>): DocumentKind | null {
  const extension = file.name.split('.').pop()?.toLowerCase();
  const mime = file.type.toLowerCase();
  const generic = !mime || mime === 'application/octet-stream';
  if (extension === 'doc') throw new Error('Legacy .doc files are not supported. Convert the document to .docx, then import it again.');
  if (extension === 'docx') return generic || mime === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' ? 'docx' : null;
  if (extension === 'pdf') return generic || mime === 'application/pdf' ? 'pdf' : null;
  if (!file.name.includes('.')) {
    if (mime === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document') return 'docx';
    if (mime === 'application/pdf') return 'pdf';
  }
  return null;
}

export function validateDocumentFile(file: Pick<File, 'name' | 'type' | 'size'>): DocumentKind {
  const kind = documentFileKind(file);
  if (!kind) throw new Error('Choose a .docx or text-based .pdf document. Scanned PDFs require OCR first.');
  if (file.size === 0) throw new Error('The selected document is empty.');
  if (file.size > DOCUMENT_LIMITS.maxFileBytes) throw new Error('Choose a document smaller than 25 MB. Split larger documents before importing.');
  return kind;
}

export async function inflate(data: Uint8Array, format: 'deflate' | 'deflate-raw', maximum: number): Promise<Uint8Array> {
  if (typeof DecompressionStream === 'undefined') throw new Error('This browser cannot decompress this document locally. Use a current browser or paste the text directly.');
  try {
    const compressed = new Uint8Array(data.byteLength);
    compressed.set(data);
    const stream = new Response(compressed.buffer).body!.pipeThrough(new DecompressionStream(format));
    const reader = stream.getReader();
    const chunks: Uint8Array[] = [];
    let byteLength = 0;
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      byteLength += value.byteLength;
      if (byteLength > maximum) {
        void reader.cancel().catch(() => {});
        throw new Error('The document expands beyond the safe processing limit.');
      }
      chunks.push(value);
    }
    const result = new Uint8Array(byteLength);
    let offset = 0;
    for (const chunk of chunks) { result.set(chunk, offset); offset += chunk.byteLength; }
    return result;
  } catch (error) {
    if (error instanceof Error && error.message.includes('safe processing limit')) throw error;
    throw new Error('The document contains corrupt or unsupported compressed data.');
  }
}

function findEndOfCentralDirectory(bytes: Uint8Array): number {
  const minimum = Math.max(0, bytes.length - 65_557);
  for (let offset = bytes.length - 22; offset >= minimum; offset -= 1) if (little32(bytes, offset) === 0x06054b50) return offset;
  return -1;
}

export async function extractDocx(bytes: Uint8Array): Promise<ExtractedDocument> {
  if (bytes.length < 4 || little32(bytes, 0) !== 0x04034b50) throw new Error('This .docx is corrupt or is not an Office Open XML document.');
  const eocd = findEndOfCentralDirectory(bytes);
  if (eocd < 0) throw new Error('This .docx is corrupt: its ZIP directory is missing.');
  const entries = little16(bytes, eocd + 10);
  if (entries > 10_000) throw new Error('This .docx is excessively complex and contains too many ZIP entries.');
  let offset = little32(bytes, eocd + 16);
  let xml: Uint8Array | null = null;
  for (let index = 0; index < entries; index += 1) {
    if (offset + 46 > bytes.length || little32(bytes, offset) !== 0x02014b50) throw new Error('This .docx has a corrupt ZIP directory.');
    const flags = little16(bytes, offset + 8); const method = little16(bytes, offset + 10);
    const compressedSize = little32(bytes, offset + 20); const uncompressedSize = little32(bytes, offset + 24);
    const nameLength = little16(bytes, offset + 28); const extraLength = little16(bytes, offset + 30); const commentLength = little16(bytes, offset + 32);
    const localOffset = little32(bytes, offset + 42);
    const name = decoder.decode(bytes.slice(offset + 46, offset + 46 + nameLength));
    if (name === 'word/document.xml') {
      if (flags & 1) throw new Error('Password-protected .docx files cannot be imported. Remove encryption and try again.');
      if (uncompressedSize > DOCUMENT_LIMITS.maxXmlBytes) throw new Error('This .docx document body is too large to process safely.');
      if (localOffset + 30 > bytes.length || little32(bytes, localOffset) !== 0x04034b50) throw new Error('This .docx has a corrupt document entry.');
      const localNameLength = little16(bytes, localOffset + 26); const localExtraLength = little16(bytes, localOffset + 28);
      const start = localOffset + 30 + localNameLength + localExtraLength;
      if (start + compressedSize > bytes.length) throw new Error('This .docx document entry is truncated.');
      const compressed = bytes.slice(start, start + compressedSize);
      if (method === 0) {
        if (compressed.byteLength > DOCUMENT_LIMITS.maxXmlBytes) throw new Error('The document expands beyond the safe processing limit.');
        xml = compressed;
      }
      else if (method === 8) xml = await inflate(compressed, 'deflate-raw', DOCUMENT_LIMITS.maxXmlBytes);
      else throw new Error(`This .docx uses unsupported ZIP compression method ${method}.`);
      break;
    }
    offset += 46 + nameLength + extraLength + commentLength;
  }
  if (!xml) throw new Error('This .docx has no main document body. It may be corrupt or use an unsupported format.');
  const source = decoder.decode(xml);
  if (/<!DOCTYPE/i.test(source)) throw new Error('This .docx contains a disallowed document type declaration.');
  const entity = (value: string) => value.replace(/&#x([0-9a-f]+);/gi, (_, code: string) => String.fromCodePoint(parseInt(code, 16)))
    .replace(/&#(\d+);/g, (_, code: string) => String.fromCodePoint(Number(code)))
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, '&');
  const paragraphs: string[] = [];
  let sourcePages = 1;
  const paragraphPattern = /<(?:[\w.-]+:)?p\b[^>]*>([\s\S]*?)<\/(?:[\w.-]+:)?p>/gi;
  for (const paragraph of source.matchAll(paragraphPattern)) {
    let value = ''; const body = paragraph[1];
    const tokens = /<(?:[\w.-]+:)?t\b[^>]*>([\s\S]*?)<\/(?:[\w.-]+:)?t>|<(?:[\w.-]+:)?(tab|br|cr|lastRenderedPageBreak)\b([^>]*)\/?\s*>/gi;
    for (const token of body.matchAll(tokens)) {
      if (token[1] !== undefined) value += entity(token[1].replace(/<[^>]*>/g, ''));
      else if (token[2] === 'tab') value += '\t';
      else if (token[2] === 'lastRenderedPageBreak' || (token[2] === 'br' && /(?:\w+:)?type\s*=\s*["']page["']/i.test(token[3] ?? ''))) { value += PAGE_BREAK; sourcePages += 1; }
      else value += '\n';
      if (sourcePages > DOCUMENT_LIMITS.maxPdfPages) throw new Error('This document has more than 500 source pages. Split it before importing.');
    }
    paragraphs.push(value);
  }
  // Whitespace carries indentation, blank lines, and the complete PAGE_BREAK
  // delimiter. Preserve it rather than turning edge markers into plotted text.
  const text = paragraphs.join('\n');
  if (!text.trim()) throw new Error('No text was found in this .docx. It may contain only images, drawings, or unsupported embedded objects.');
  if (text.length > DOCUMENT_LIMITS.maxExtractedCharacters) throw new Error('The extracted document exceeds 500,000 characters. Split it before importing.');
  return { text, sourcePages, warnings: ['Imported as plain text. The selected writing font replaces document fonts; exact document formatting is not preserved.'] };
}

type PdfObject = { body: string; stream?: Uint8Array };
type PdfDecodeContext = { cache: WeakMap<PdfObject, string>; inflatedBytes: number; cmapOperations: number; fontReferences: number };

function scanPdfObjects(bytes: Uint8Array): Map<number, PdfObject> {
  const source = latinDecoder.decode(bytes);
  const objects = new Map<number, PdfObject>();
  const pattern = /(?:^|[\r\n])\s*(\d+)\s+(\d+)\s+obj\b/g;
  let previous: RegExpExecArray | null = null;
  let count = 0;
  const store = (match: RegExpExecArray, limit: number) => {
    const id = Number(match[1]);
    const start = match.index! + match[0].length;
    const endObject = source.lastIndexOf('endobj', limit);
    const end = endObject >= start ? endObject : limit;
    const body = source.slice(start, end);
    const streamMatch = /stream(?:\r\n|\n|\r)/.exec(body);
    if (!streamMatch) objects.set(id, { body });
    else {
      const globalStart = start + streamMatch.index + streamMatch[0].length;
      const streamEnd = source.lastIndexOf('endstream', end);
      const globalEnd = streamEnd >= globalStart ? streamEnd - (source[streamEnd - 1] === '\n' ? (source[streamEnd - 2] === '\r' ? 2 : 1) : source[streamEnd - 1] === '\r' ? 1 : 0) : globalStart;
      objects.set(id, { body: body.slice(0, streamMatch.index), stream: bytes.slice(globalStart, Math.max(globalStart, globalEnd)) });
    }
  };
  for (let match = pattern.exec(source); match; match = pattern.exec(source)) {
    count += 1;
    if (count > DOCUMENT_LIMITS.maxPdfObjects) throw new Error('This PDF is excessively complex and contains too many objects.');
    if (previous) store(previous, match.index);
    previous = match;
  }
  if (!previous) throw new Error('This PDF is corrupt or uses an unsupported object structure.');
  store(previous, source.length);
  return objects;
}

async function decodedPdfStream(object: PdfObject, context: PdfDecodeContext): Promise<string> {
  if (!object.stream) return '';
  const cached = context.cache.get(object);
  if (cached !== undefined) return cached;
  let bytes = object.stream;
  if (/\/FlateDecode\b/.test(object.body)) bytes = await inflate(bytes, 'deflate', DOCUMENT_LIMITS.maxInflatedStreamBytes);
  else if (/\/Filter\b/.test(object.body)) throw new Error('A PDF text stream uses an unsupported compression filter.');
  if (bytes.length > DOCUMENT_LIMITS.maxInflatedStreamBytes) throw new Error('A PDF content stream is too large to process safely.');
  context.inflatedBytes += bytes.byteLength;
  if (context.inflatedBytes > DOCUMENT_LIMITS.maxAggregateInflatedBytes) throw new Error('PDF streams expand beyond the aggregate safe processing limit.');
  const decoded = latinDecoder.decode(bytes);
  context.cache.set(object, decoded);
  return decoded;
}

function refs(source: string, maximum: number = DOCUMENT_LIMITS.maxPdfObjects): number[] {
  const result: number[] = [];
  const pattern = /(\d+)\s+\d+\s+R/g;
  for (let match = pattern.exec(source); match; match = pattern.exec(source)) {
    if (result.length >= maximum) throw new Error('A PDF reference list exceeds the safe processing limit.');
    result.push(Number(match[1]));
  }
  return result;
}

function pageOrder(objects: Map<number, PdfObject>): number[] {
  const catalog = [...objects.entries()].find(([, object]) => /\/Type\s*\/Catalog\b/.test(object.body));
  const root = catalog?.[1].body.match(/\/Pages\s+(\d+)\s+\d+\s+R/)?.[1];
  const result: number[] = []; const visited = new Set<number>();
  const visit = (id: number) => {
    if (visited.has(id)) return; visited.add(id);
    const object = objects.get(id); if (!object) return;
    if (/\/Type\s*\/Page\b/.test(object.body) && !/\/Type\s*\/Pages\b/.test(object.body)) { result.push(id); return; }
    const kids = object.body.match(/\/Kids\s*\[([\s\S]*?)\]/)?.[1];
    if (kids) for (const child of refs(kids)) visit(child);
  };
  if (root) visit(Number(root));
  if (!result.length) for (const [id, object] of objects) if (/\/Type\s*\/Page\b/.test(object.body) && !/\/Type\s*\/Pages\b/.test(object.body)) result.push(id);
  return result;
}

function unicodeFromHex(hex: string): string {
  const clean = hex.replace(/\s/g, '');
  if (clean.length % 4 === 0) {
    let result = '';
    for (let index = 0; index < clean.length; index += 4) result += String.fromCharCode(parseInt(clean.slice(index, index + 4), 16));
    return result;
  }
  return String.fromCharCode(parseInt(clean, 16));
}

async function fontMaps(page: PdfObject, objects: Map<number, PdfObject>, context: PdfDecodeContext): Promise<Map<string, Map<number, string>>> {
  let resources = page.body;
  let inherited = page; const seenParents = new Set<number>();
  for (let depth = 0; depth < 32; depth += 1) {
    const parentId = Number(inherited.body.match(/\/Parent\s+(\d+)\s+\d+\s+R/)?.[1]);
    if (!parentId || seenParents.has(parentId)) break;
    seenParents.add(parentId); const parent = objects.get(parentId); if (!parent) break;
    resources += parent.body; inherited = parent;
  }
  const resourceRef = page.body.match(/\/Resources\s+(\d+)\s+\d+\s+R/)?.[1];
  const inheritedResourceRef = resources.match(/\/Resources\s+(\d+)\s+\d+\s+R/)?.[1];
  if (resourceRef || inheritedResourceRef) resources += objects.get(Number(resourceRef ?? inheritedResourceRef))?.body ?? '';
  const fontBlock = resources.match(/\/Font\s*<<([\s\S]*?)>>/)?.[1] ?? resources;
  const result = new Map<string, Map<number, string>>();
  for (const match of fontBlock.matchAll(/\/([\w.+-]+)\s+(\d+)\s+\d+\s+R/g)) {
    context.fontReferences += 1;
    if (context.fontReferences > DOCUMENT_LIMITS.maxPdfFontReferences) throw new Error('PDF font references exceed the safe processing limit.');
    const font = objects.get(Number(match[2])); const map = new Map<number, string>();
    const unicodeRef = font?.body.match(/\/ToUnicode\s+(\d+)\s+\d+\s+R/)?.[1];
    if (unicodeRef) {
      const cmapObject = objects.get(Number(unicodeRef));
      const cmap = cmapObject ? await decodedPdfStream(cmapObject, context) : '';
      // Keep bfchar pairs separate from bfrange triples. A global triple regex
      // otherwise misreads adjacent bfchar entries as descending ranges.
      for (const section of cmap.matchAll(/begin(bfchar|bfrange)\b([\s\S]*?)end\1\b/g)) {
        if (section[1] === 'bfchar') {
          for (const pair of section[2].matchAll(/<([0-9A-Fa-f]+)>\s*<([0-9A-Fa-f]+)>/g)) {
            context.cmapOperations += 1;
            if (context.cmapOperations > DOCUMENT_LIMITS.maxPdfCmapOperations) throw new Error('PDF Unicode maps exceed the safe processing limit.');
            if (pair[2].length > DOCUMENT_LIMITS.maxExtractedCharacters * 4) throw new Error('A PDF Unicode mapping exceeds the safe processing limit.');
            map.set(parseInt(pair[1], 16), unicodeFromHex(pair[2]));
          }
        } else {
          for (const range of section[2].matchAll(/<([0-9A-Fa-f]+)>\s*<([0-9A-Fa-f]+)>\s*<([0-9A-Fa-f]+)>/g)) {
            const from = parseInt(range[1], 16); const to = parseInt(range[2], 16); const base = parseInt(range[3], 16);
            if (![from, to, base].every(Number.isSafeInteger) || from < 0 || to < from || to > 0xffffffff || base > 0xffff) {
              throw new Error('A PDF Unicode map contains an invalid range.');
            }
            if (to - from > 2_048) throw new Error('A PDF Unicode range exceeds the safe processing limit.');
            context.cmapOperations += to - from + 1;
            if (context.cmapOperations > DOCUMENT_LIMITS.maxPdfCmapOperations) throw new Error('PDF Unicode maps exceed the safe processing limit.');
            for (let code = from; code <= to; code += 1) map.set(code, String.fromCharCode(base + code - from));
          }
        }
      }
    }
    result.set(match[1], map);
  }
  return result;
}

type PdfToken = { kind: 'string'; bytes: number[] } | { kind: 'name' | 'word'; value: string } | { kind: 'array-start' | 'array-end' };
export function tokenizePdfContent(source: string, maximumTokens: number = DOCUMENT_LIMITS.maxPdfTokens): PdfToken[] {
  const tokens: PdfToken[] = [];
  let index = 0;
  while (index < source.length && tokens.length < maximumTokens) {
    const character = source[index];
    if (/\s/.test(character)) { index += 1; continue; }
    if (character === '%') { while (index < source.length && source[index] !== '\n' && source[index] !== '\r') index += 1; continue; }
    if (character === '[' || character === ']') { tokens.push({ kind: character === '[' ? 'array-start' : 'array-end' }); index += 1; continue; }
    if (character === '(') {
      const bytes: number[] = []; let depth = 1; index += 1;
      while (index < source.length && depth) {
        const next = source.charCodeAt(index++);
        if (next === 0x5c) {
          if (index >= source.length) break;
          const escaped = source.charCodeAt(index++);
          const simple: Record<number, number> = { 110: 10, 114: 13, 116: 9, 98: 8, 102: 12, 40: 40, 41: 41, 92: 92 };
          if (simple[escaped] !== undefined) bytes.push(simple[escaped]);
          else if (escaped >= 48 && escaped <= 55) { let octal = String.fromCharCode(escaped); for (let count = 0; count < 2 && /[0-7]/.test(source[index] ?? ''); count += 1) octal += source[index++]; bytes.push(parseInt(octal, 8)); }
          else if (escaped !== 10 && escaped !== 13) bytes.push(escaped);
        } else if (next === 0x28) { depth += 1; bytes.push(next); }
        else if (next === 0x29) { depth -= 1; if (depth) bytes.push(next); }
        else bytes.push(next & 255);
      }
      tokens.push({ kind: 'string', bytes }); continue;
    }
    if (character === '<' && source[index + 1] !== '<') {
      const end = source.indexOf('>', index + 1); if (end < 0) break;
      let hex = source.slice(index + 1, end).replace(/\s/g, ''); if (hex.length % 2) hex += '0';
      const bytes: number[] = []; for (let cursor = 0; cursor < hex.length; cursor += 2) bytes.push(parseInt(hex.slice(cursor, cursor + 2), 16));
      tokens.push({ kind: 'string', bytes }); index = end + 1; continue;
    }
    let end = index + 1; while (end < source.length && !/\s/.test(source[end]) && !'[]()<>'.includes(source[end])) end += 1;
    const value = source.slice(index, end); tokens.push({ kind: character === '/' ? 'name' : 'word', value }); index = end;
  }
  if (index < source.length) throw new Error('A PDF content stream exceeds the safe token limit.');
  return tokens;
}

function decodePdfBytes(bytes: number[], map: Map<number, string> | undefined, maximum: number): string {
  if (map?.size) {
    let result = '';
    const twoByte = [...map.keys()].some((key) => key > 255);
    for (let index = 0; index < bytes.length; index += twoByte ? 2 : 1) {
      const code = twoByte ? (bytes[index] << 8) | (bytes[index + 1] ?? 0) : bytes[index];
      const value = map.get(code) ?? '\uFFFD';
      if (result.length + value.length > maximum) throw new Error('The extracted PDF text exceeds 500,000 characters. Split it before importing.');
      result += value;
    }
    return result;
  }
  if (bytes[0] === 0xfe && bytes[1] === 0xff) {
    if (Math.floor((bytes.length - 2) / 2) > maximum) throw new Error('The extracted PDF text exceeds 500,000 characters. Split it before importing.');
    let result = ''; for (let index = 2; index + 1 < bytes.length; index += 2) result += String.fromCharCode(bytes[index] << 8 | bytes[index + 1]); return result;
  }
  if (bytes.length > maximum) throw new Error('The extracted PDF text exceeds 500,000 characters. Split it before importing.');
  return latinDecoder.decode(new Uint8Array(bytes));
}

function extractContentText(content: string, maps: Map<string, Map<number, string>>, budget: { remaining: number }): string {
  const tokens = tokenizePdfContent(content, budget.remaining); const stack: PdfToken[] = [];
  budget.remaining -= tokens.length;
  let text = ''; let font = ''; let inText = false; let array: PdfToken[] | null = null;
  const newline = () => { if (text && !text.endsWith('\n')) text += '\n'; };
  const append = (token: PdfToken | undefined) => { if (token?.kind === 'string') text += decodePdfBytes(token.bytes, maps.get(font), DOCUMENT_LIMITS.maxExtractedCharacters - text.length); };
  for (const token of tokens) {
    if (token.kind === 'array-start') { array = []; continue; }
    if (token.kind === 'array-end') { stack.push(...(array ?? []), { kind: 'word', value: '__array__' }); array = null; continue; }
    if (array) { array.push(token); continue; }
    if (token.kind !== 'word' || !['BT','ET','Tf','Tj','TJ',"'",'"','T*','Td','TD'].includes(token.value)) { stack.push(token); if (stack.length > 500) stack.splice(0, stack.length - 100); continue; }
    const operator = token.value;
    if (operator === 'BT') { inText = true; stack.length = 0; continue; }
    if (operator === 'ET') { if (inText) newline(); inText = false; stack.length = 0; continue; }
    if (!inText) { stack.length = 0; continue; }
    if (operator === 'Tf') { const name = [...stack].reverse().find((item) => item.kind === 'name'); if (name?.kind === 'name') font = name.value.slice(1); }
    else if (operator === 'Tj') append([...stack].reverse().find((item) => item.kind === 'string'));
    else if (operator === 'TJ') { for (const item of stack) append(item); }
    else if (operator === "'" || operator === '"') { newline(); append([...stack].reverse().find((item) => item.kind === 'string')); }
    else if (operator === 'T*' || operator === 'TD') newline();
    else if (operator === 'Td') { let vertical = 0; for (const item of stack) if (item.kind === 'word' && Number.isFinite(Number(item.value))) vertical = Number(item.value); if (Math.abs(vertical) > 0.01) newline(); }
    stack.length = 0;
  }
  return text.replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
}

export async function extractPdf(bytes: Uint8Array): Promise<ExtractedDocument> {
  const header = latinDecoder.decode(bytes.slice(0, 1024));
  if (!header.includes('%PDF-')) throw new Error('This file is not a valid PDF.');
  const objects = scanPdfObjects(bytes);
  const decodeContext: PdfDecodeContext = { cache: new WeakMap(), inflatedBytes: 0, cmapOperations: 0, fontReferences: 0 };
  const trailer = latinDecoder.decode(bytes).match(/trailer\s*<<([\s\S]*?)>>/g)?.join('\n') ?? '';
  if (/\/Encrypt\b/.test(trailer) || [...objects.values()].some((object) => /\/Encrypt\b/.test(object.body))) throw new Error('Encrypted or password-protected PDFs cannot be imported. Remove encryption and try again.');
  // PDF 1.5+ commonly packs page, resource, and font dictionaries into object
  // streams. Expand those bounded dictionaries; stream objects themselves are
  // never permitted inside ObjStm containers by the PDF specification.
  for (const object of [...objects.values()]) {
    if (!/\/Type\s*\/ObjStm\b/.test(object.body)) continue;
    const count = Number(object.body.match(/\/N\s+(\d+)/)?.[1]);
    const first = Number(object.body.match(/\/First\s+(\d+)/)?.[1]);
    if (!Number.isInteger(count) || count < 0 || count > 10_000 || !Number.isInteger(first) || first < 0) throw new Error('A PDF object stream is malformed or excessively complex.');
    const content = await decodedPdfStream(object, decodeContext);
    const header = content.slice(0, first).trim().split(/\s+/).map(Number);
    if (header.length < count * 2 || header.some((value) => !Number.isInteger(value) || value < 0)) throw new Error('A PDF object stream has a corrupt index.');
    for (let index = 0; index < count; index += 1) {
      const id = header[index * 2]; const start = first + header[index * 2 + 1];
      const end = index + 1 < count ? first + header[(index + 1) * 2 + 1] : content.length;
      if (start > end || end > content.length) throw new Error('A PDF object stream has corrupt object offsets.');
      if (!objects.has(id)) objects.set(id, { body: content.slice(start, end) });
    }
    if (objects.size > DOCUMENT_LIMITS.maxPdfObjects) throw new Error('This PDF is excessively complex and contains too many objects.');
  }
  const pages = pageOrder(objects);
  if (!pages.length) throw new Error('No pages were found in this PDF. It may be corrupt.');
  if (pages.length > DOCUMENT_LIMITS.maxPdfPages) throw new Error('This PDF has more than 500 pages. Split it before importing.');
  const extracted: string[] = []; const empty: number[] = []; const tokenBudget = { remaining: DOCUMENT_LIMITS.maxPdfTokens };
  let extractedCharacters = 0;
  for (let pageIndex = 0; pageIndex < pages.length; pageIndex += 1) {
    const page = objects.get(pages[pageIndex])!; const maps = await fontMaps(page, objects, decodeContext);
    const contentParts: string[] = []; let contentLength = 0;
    const contentMatch = page.body.match(/\/Contents\s*(\[[^\]]*\]|\d+\s+\d+\s+R)/)?.[1];
    for (const reference of refs(contentMatch ?? '', DOCUMENT_LIMITS.maxPdfContentReferences)) {
      const object = objects.get(reference);
      if (!object) continue;
      const decoded = await decodedPdfStream(object, decodeContext);
      contentLength += decoded.length + 1;
      if (contentLength > DOCUMENT_LIMITS.maxAggregateInflatedBytes) throw new Error('PDF page content expands beyond the aggregate safe processing limit.');
      contentParts.push(decoded, '\n');
    }
    const content = contentParts.join('');
    const value = extractContentText(content, maps, tokenBudget);
    if (!value) empty.push(pageIndex + 1);
    extracted.push(value);
    extractedCharacters += value.length;
    if (extractedCharacters > DOCUMENT_LIMITS.maxExtractedCharacters) throw new Error('The extracted PDF text exceeds 500,000 characters. Split it before importing.');
  }
  if (empty.length === pages.length) throw new Error('No selectable text was found. Scanned PDFs require OCR before import.');
  const warnings = ['Imported as plain text. The selected writing font replaces document fonts; exact PDF formatting is not preserved.'];
  if (empty.length) warnings.push(`No selectable text was found on PDF page${empty.length === 1 ? '' : 's'} ${empty.join(', ')}. Scanned pages require OCR.`);
  const text = extracted.join(PAGE_BREAK);
  if (text.length > DOCUMENT_LIMITS.maxExtractedCharacters) throw new Error('The extracted PDF text exceeds 500,000 characters. Split it before importing.');
  return { text, sourcePages: pages.length, warnings };
}

export async function extractDocument(kind: DocumentKind, buffer: ArrayBuffer): Promise<ExtractedDocument> {
  const bytes = new Uint8Array(buffer);
  if (bytes.byteLength > DOCUMENT_LIMITS.maxFileBytes) throw new Error('Choose a document smaller than 25 MB.');
  return kind === 'docx' ? extractDocx(bytes) : extractPdf(bytes);
}
