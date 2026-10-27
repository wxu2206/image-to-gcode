import { describe, expect, it } from 'vitest';
import { buildMovements } from '../core/gcode';
import { defaults, profiles } from '../core/machine';
import { fontSamplePolylines, glyphPaths, strokeFonts, supportedCharacter } from './fonts';
import { extractDocx, extractPdf, validateDocumentFile } from './import';
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

  it('gives useful errors for legacy, oversized, corrupt, and encrypted documents', async () => {
    expect(() => validateDocumentFile({ name: 'legacy.doc', type: 'application/msword', size: 100 })).toThrow(/convert.*docx/i);
    expect(() => validateDocumentFile({ name: 'large.pdf', type: 'application/pdf', size: 26 * 1024 * 1024 })).toThrow(/smaller than 25 MB/i);
    await expect(extractDocx(new TextEncoder().encode('not a zip'))).rejects.toThrow(/corrupt/i);
    const encrypted = new TextEncoder().encode('%PDF-1.4\n1 0 obj\n<< /Encrypt 2 0 R >>\nendobj\n%%EOF');
    await expect(extractPdf(encrypted)).rejects.toThrow(/Encrypted or password-protected/i);
  });
});

describe('stroke-font layout', () => {
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

  it('retains pen-up travel between disconnected writing strokes', () => {
    const result = layoutText(source('AB'));
    const settings = { ...defaults, outputWidth: defaultTextLayout.pageWidthMm, outputHeight: defaultTextLayout.pageHeightMm, workWidth: 400, workHeight: 400, passes: 1 };
    const moves = buildMovements(result.toolpath, settings, profiles[1]);
    expect(moves.moves.filter((move) => !move.working && !move.zOnly).length).toBeGreaterThan(1);
    expect(moves.moves.filter((move) => move.working).length).toBeGreaterThan(1);
  });
});
