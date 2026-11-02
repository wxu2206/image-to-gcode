import { describe, expect, it } from 'vitest';
import { buildMovements } from '../core/gcode';
import { defaults, profiles } from '../core/machine';
import { fontSamplePolylines, glyphPaths, strokeFonts, supportedCharacter } from './fonts';
import { DOCUMENT_LIMITS, extractDocx, extractPdf, inflate, tokenizePdfContent, validateDocumentFile } from './import';
import { layoutText } from './layout';
import { defaultTextLayout, PAGE_BREAK, type TextSource } from './types';

const source = (text: string, change: Partial<TextSource> = {}): TextSource => ({ text, page: 0, layout: { ...defaultTextLayout }, ...change });

function storedZip(name: string, content: string): Uint8Array {
  const encoder = new TextEncoder(); const nameBytes = encoder.encode(name); const data = encoder.encode(content);
  const total = 30 + nameBytes.length + data.length + 46 + nameBytes.length + 22;
  const bytes = new Uint8Array(total); const view = new DataView(bytes.buffer); let offset = 0;
  const u16 = (value: number) => { view.setUint16(offset, value, true); offset += 2; };
  const u32 = (value: number) => { view.setUint32(offset, value, true); offset += 4; };
  u32(0x04034b50); u16(20); u16(0); u16(0); u16(0); u16(0); u32(0); u32(data.length); u32(data.length); u16(nameBytes.length); u16(0); bytes.set(nameBytes, offset); offset += nameBytes.length; bytes.set(data, offset); offset += data.length;
  const central = offset;
  u32(0x02014b50); u16(20); u16(20); u16(0); u16(0); u16(0); u16(0); u32(0); u32(data.length); u32(data.length); u16(nameBytes.length); u16(0); u16(0); u16(0); u16(0); u32(0); u32(0); bytes.set(nameBytes, offset); offset += nameBytes.length;
  u32(0x06054b50); u16(0); u16(0); u16(1); u16(1); u32(offset - central); u32(central); u16(0);
  return bytes;
}

function plainPdf(text: string): Uint8Array {
  const escaped = text.replace(/([()\\])/g, '\\$1');
  return new TextEncoder().encode(`%PDF-1.4\n1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n3 0 obj\n<< /Type /Page /Parent 2 0 R /Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>\nendobj\n4 0 obj\n<< /Length 99 >>\nstream\nBT /F1 12 Tf 10 100 Td (${escaped}) Tj ET\nendstream\nendobj\n5 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>\nendobj\n%%EOF`);
}

describe('local document extraction', () => {
  it('rejects excessive PDF objects and repeated content references before assembling them', async () => {
    const objects = new TextEncoder().encode(`%PDF-1.4\n${'1 0 obj\n<<>>\nendobj\n'.repeat(DOCUMENT_LIMITS.maxPdfObjects + 1)}`);
    await expect(extractPdf(objects)).rejects.toThrow(/too many objects/i);
    const pdf = new TextDecoder().decode(plainPdf('A')).replace('/Contents 4 0 R', `/Contents [${'4 0 R '.repeat(DOCUMENT_LIMITS.maxPdfContentReferences + 1)}]`);
    await expect(extractPdf(new TextEncoder().encode(pdf))).rejects.toThrow(/reference list.*safe processing limit/i);
  });

  it('bounds assembled page content even when the same decoded stream is cached', async () => {
    const pdf = new TextDecoder().decode(plainPdf('A'.repeat(1_000_000))).replace('/Contents 4 0 R', `/Contents [${'4 0 R '.repeat(51)}]`);
    await expect(extractPdf(new TextEncoder().encode(pdf))).rejects.toThrow(/page content.*safe processing limit/i);
  });

  it('bounds repeated overlapping Unicode-map range work', async () => {
    const ranges = '<0000> <0800> <0041>\n'.repeat(130);
    const pdf = new TextDecoder().decode(plainPdf('A')).replace('/BaseFont /Helvetica', '/BaseFont /Helvetica /ToUnicode 6 0 R')
      + `\n6 0 obj\n<<>>\nstream\n130 beginbfrange\n${ranges}\nendbfrange\nendstream\nendobj\n`;
    await expect(extractPdf(new TextEncoder().encode(pdf))).rejects.toThrow(/Unicode maps.*safe processing limit/i);
  });

  it('bounds font aliases even when they have no Unicode maps', async () => {
    const aliases = Array.from({ length: DOCUMENT_LIMITS.maxPdfFontReferences + 1 }, (_, index) => `/F${index} 5 0 R`).join(' ');
    const pdf = new TextDecoder().decode(plainPdf('A')).replace('/F1 5 0 R', aliases);
    await expect(extractPdf(new TextEncoder().encode(pdf))).rejects.toThrow(/font references.*safe processing limit/i);
  });

  it.each(['<FFFF> <0000> <0041>', `<${'F'.repeat(300)}> <0000> <0041>`])('rejects invalid Unicode ranges without reducing the work budget: %s', async (range) => {
    const pdf = new TextDecoder().decode(plainPdf('A')).replace('/BaseFont /Helvetica', '/BaseFont /Helvetica /ToUnicode 6 0 R')
      + `\n6 0 obj\n<<>>\nstream\n1 beginbfrange\n${range}\nendbfrange\nendstream\nendobj\n`;
    await expect(extractPdf(new TextEncoder().encode(pdf))).rejects.toThrow(/invalid range/i);
  });

  it.each([
    ['<w:br w:type="page"/><w:t>A</w:t>', `${PAGE_BREAK}A`],
    ['<w:t>A</w:t><w:br w:type="page"/>', `A${PAGE_BREAK}`],
    ['<w:br w:type="page"/>', PAGE_BREAK],
  ])('preserves DOCX edge page breaks for %s', async (body, expected) => {
    const xml = `<w:document xmlns:w="x"><w:body><w:p><w:r>${body}</w:r></w:p></w:body></w:document>`;
    const result = await extractDocx(storedZip('word/document.xml', xml));
    expect(result.text).toBe(expected);
    expect(layoutText(source(result.text)).info.pageCount).toBe(2);
  });

  it('preserves indentation and explicit blank lines around DOCX page boundaries', async () => {
    const xml = '<w:document xmlns:w="x"><w:body><w:p><w:r><w:t>A</w:t><w:br w:type="page"/><w:t xml:space="preserve">    B</w:t><w:br/><w:br/><w:br/><w:t>C</w:t></w:r></w:p></w:body></w:document>';
    const result = await extractDocx(storedZip('word/document.xml', xml));
    expect(result.text).toBe(`A${PAGE_BREAK}    B\n\n\nC`);
    expect(layoutText(source(result.text, { page: 1 })).info.lineCount).toBe(4);
  });

  it('stops decompression as soon as the expanded byte budget is exceeded', async () => {
    const source = new TextEncoder().encode('A'.repeat(4_096));
    const compressed = new Uint8Array(await new Response(new Response(source).body!.pipeThrough(new CompressionStream('deflate'))).arrayBuffer());
    await expect(inflate(compressed, 'deflate', 128)).rejects.toThrow(/safe processing limit/i);
  });

  it('checks actual stored DOCX bytes when the ZIP directory understates their expanded size', async () => {
    const bytes = storedZip('word/document.xml', ' '.repeat(DOCUMENT_LIMITS.maxXmlBytes + 1));
    const view = new DataView(bytes.buffer);
    const central = view.getUint32(bytes.length - 6, true);
    view.setUint32(central + 24, 0, true);
    await expect(extractDocx(bytes)).rejects.toThrow(/safe processing limit/i);
  });

  it('rejects PDF content that exceeds the token budget instead of truncating it', () => {
    expect(() => tokenizePdfContent('BT /F1 12 Tf (A) Tj ET', 3)).toThrow(/token limit/i);
  });

  it('extracts DOCX paragraphs, tabs, entities, and explicit page boundaries as plain text', async () => {
    const xml = `<?xml version="1.0"?><w:document xmlns:w="x"><w:body><w:p><w:r><w:t>Hello &amp; goodbye</w:t></w:r></w:p><w:p><w:r><w:t>Second</w:t><w:tab/><w:t>column</w:t><w:br w:type="page"/><w:t>Next page</w:t></w:r></w:p></w:body></w:document>`;
    const result = await extractDocx(storedZip('word/document.xml', xml));
    expect(result.text).toContain('Hello & goodbye\nSecond\tcolumn');
    expect(result.text).toContain(PAGE_BREAK.trim());
    expect(result.sourcePages).toBe(2);
    expect(result.warnings[0]).toContain('plain text');
  });

  it('extracts text from a basic text PDF and rejects scanned/empty PDFs explicitly', async () => {
    const result = await extractPdf(plainPdf('Selectable text'));
    expect(result.text).toBe('Selectable text');
    await expect(extractPdf(plainPdf(''))).rejects.toThrow(/Scanned PDFs require OCR/i);
  });

  it('keeps adjacent bfchar mappings separate from bfrange records', async () => {
    const pdf = new TextDecoder().decode(plainPdf('AB')).replace('/BaseFont /Helvetica', '/BaseFont /Helvetica /ToUnicode 6 0 R')
      + '\n6 0 obj\n<<>>\nstream\n2 beginbfchar\n<41> <0058>\n<42> <0059>\nendbfchar\nendstream\nendobj\n';
    expect((await extractPdf(new TextEncoder().encode(pdf))).text).toBe('XY');
  });

  it('rejects Unicode-map output expansion at the character budget', async () => {
    const pdf = new TextDecoder().decode(plainPdf('A'.repeat(1_001))).replace('/BaseFont /Helvetica', '/BaseFont /Helvetica /ToUnicode 6 0 R')
      + `\n6 0 obj\n<<>>\nstream\n1 beginbfchar\n<41> <${'0042'.repeat(500)}>\nendbfchar\nendstream\nendobj\n`;
    await expect(extractPdf(new TextEncoder().encode(pdf))).rejects.toThrow(/500,000 characters/i);
  });

  it('gives useful errors for legacy, oversized, corrupt, and encrypted documents', async () => {
    expect(() => validateDocumentFile({ name: 'legacy.doc', type: 'application/msword', size: 100 })).toThrow(/convert.*docx/i);
    expect(() => validateDocumentFile({ name: 'large.pdf', type: 'application/pdf', size: 26 * 1024 * 1024 })).toThrow(/smaller than 25 MB/i);
    await expect(extractDocx(new TextEncoder().encode('not a zip'))).rejects.toThrow(/corrupt/i);
    const encrypted = new TextEncoder().encode('%PDF-1.4\n1 0 obj\n<< /Encrypt 2 0 R >>\nendobj\n%%EOF');
    await expect(extractPdf(encrypted)).rejects.toThrow(/Encrypted or password-protected/i);
  });

  it('rejects extracted document text that cannot enter the layout pipeline', async () => {
    const text = 'A'.repeat(500_001);
    const xml = `<w:document xmlns:w="x"><w:body><w:p><w:r><w:t>${text}</w:t></w:r></w:p></w:body></w:document>`;
    await expect(extractDocx(storedZip('word/document.xml', xml))).rejects.toThrow(/500,000 characters/i);
  });
});

describe('stroke-font layout', () => {
  it('lays out a maximum-length unbroken word with bounded work', () => {
    const result = layoutText(source('漢'.repeat(500_000), { layout: { ...defaultTextLayout, pageWidthMm: 2_000, pageHeightMm: 2_000, fontSizeMm: 0.1 } }));
    expect(result.toolpath.paths).toHaveLength(0);
    expect(result.info.unsupportedCharacters).toEqual(['漢']);
  }, 5_000);

  it('preserves repeated spaces and expands tabs to four spaces', () => {
    const startOfB = (text: string) => layoutText(source(text)).toolpath.paths.find((path) => path.id.includes(`-c${Array.from(text.replace(/\t/g, '    ')).length - 1}-`))!.points[0].x;
    expect(startOfB('A    B')).toBeGreaterThan(startOfB('A B'));
    expect(startOfB('A\tB')).toBeCloseTo(startOfB('A    B'));
  });

  it('rejects text sizes that do not fit the usable page instead of plotting outside it', () => {
    const tiny = { ...defaultTextLayout, pageWidthMm: 2, pageHeightMm: 2, marginLeftMm: 0, marginRightMm: 0, marginTopMm: 0, marginBottomMm: 0, fontSizeMm: 100 };
    expect(() => layoutText(source('$', { layout: tiny }))).toThrow(/height.*too short/i);
    expect(() => layoutText(source('$', { layout: { ...tiny, pageHeightMm: 200 } }))).toThrow(/width.*too narrow/i);
  });

  it('bundles distinct single-line fonts and creates direct vector strokes', () => {
    expect(strokeFonts).toHaveLength(3);
    expect(new Set(strokeFonts.map((font) => font.category))).toEqual(new Set(['single-line']));
    const widths = strokeFonts.map((font) => Math.max(...fontSamplePolylines(font.id).flat().map((point) => point.x)));
    expect(new Set(widths.map((value) => value.toFixed(2))).size).toBe(3);
    expect(glyphPaths('A', 'plotter-simplex', 10, 0, 10, 'a').length).toBeGreaterThan(1);
  });

  it('wraps words, preserves explicit lines, and separates forced document pages', () => {
    const layout = { ...defaultTextLayout, pageWidthMm: 35, pageHeightMm: 30, marginLeftMm: 2, marginRightMm: 2, marginTopMm: 2, marginBottomMm: 2, fontSizeMm: 5 };
    const wrapped = layoutText(source(`ONE TWO THREE\nFOUR${PAGE_BREAK}FIVE`, { layout }));
    expect(wrapped.info.pageCount).toBeGreaterThanOrEqual(2);
    expect(wrapped.info.lineCount).toBeGreaterThan(1);
    const second = layoutText(source(`ONE${PAGE_BREAK}FIVE`, { page: 1, layout }));
    expect(second.toolpath.paths.every((path) => path.id.startsWith('p1-'))).toBe(true);
  });

  it('moves vertical overflow to additional pages without clipping or shrinking', () => {
    const layout = { ...defaultTextLayout, pageWidthMm: 80, pageHeightMm: 18, marginTopMm: 2, marginBottomMm: 2, marginLeftMm: 2, marginRightMm: 2, fontSizeMm: 5, lineSpacing: 1.2 };
    const result = layoutText(source('A\nB\nC\nD', { layout }));
    expect(result.info.pageCount).toBeGreaterThan(1);
    expect(result.info.flowed).toBe(true);
    expect(result.info.warnings.join(' ')).toMatch(/not clipped or shrunk/i);
  });

  it('reports unsupported characters rather than silently treating them as supported', () => {
    expect(supportedCharacter('🙂')).toBe(false);
    const result = layoutText(source('A🙂B'));
    expect(result.info.unsupportedCharacters).toEqual(['🙂']);
    expect(result.info.warnings.join(' ')).toContain('Unsupported characters');
  });

  it('advances an unsupported astral character exactly once', () => {
    const result = layoutText(source('A🙂B'));
    const bPaths = result.toolpath.paths.filter((path) => path.id.includes('-c2-'));
    expect(bPaths.length).toBeGreaterThan(0);
  });

  it('keeps full bundled glyph bounds inside a zero-margin page', () => {
    const layout = { ...defaultTextLayout, pageWidthMm: 30, pageHeightMm: 20, marginTopMm: 0, marginRightMm: 0, marginBottomMm: 0, marginLeftMm: 0, fontSizeMm: 10 };
    const result = layoutText(source('$', { layout }));
    const points = result.toolpath.paths.flatMap((path) => path.points);
    expect(points.every((point) => point.x >= 0 && point.x <= layout.pageWidthMm && point.y >= 0 && point.y <= layout.pageHeightMm)).toBe(true);
  });

  it('rejects unknown font identifiers instead of silently changing output', () => {
    expect(() => layoutText(source('ABC', { layout: { ...defaultTextLayout, fontId: 'missing-font' } }))).toThrow(/font is unavailable/i);
  });

  it('retains pen-up travel between disconnected writing strokes', () => {
    const result = layoutText(source('AB'));
    const settings = { ...defaults, outputWidth: defaultTextLayout.pageWidthMm, outputHeight: defaultTextLayout.pageHeightMm, workWidth: 400, workHeight: 400, passes: 1 };
    const moves = buildMovements(result.toolpath, settings, profiles[1]);
    expect(moves.moves.filter((move) => !move.working && !move.zOnly).length).toBeGreaterThan(1);
    expect(moves.moves.filter((move) => move.working).length).toBeGreaterThan(1);
  });
});
