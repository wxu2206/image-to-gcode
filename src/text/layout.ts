import type { Toolpath } from '../core/types';
import { characterAdvance, getStrokeFont, glyphPaths, supportedCharacter } from './fonts';
import { PAGE_BREAK, type TextPageInfo, type TextSource } from './types';

export const TEXT_LIMITS = { maxCharacters: 500_000, maxPages: 500, maxPaths: 250_000, maxLines: 50_000 } as const;

type Line = { text: string; width: number };
type LayoutResult = { toolpath: Toolpath; info: TextPageInfo };

const finitePositive = (value: number) => Number.isFinite(value) && value > 0;

export function validateTextSource(source: TextSource): void {
  if (typeof source.text !== 'string' || source.text.length > TEXT_LIMITS.maxCharacters) throw new Error('Text must contain at most 500,000 characters. Split larger documents into separate jobs.');
  if (!Number.isInteger(source.page) || source.page < 0 || source.page >= TEXT_LIMITS.maxPages) throw new Error('The selected output page is invalid.');
  const values = Object.values(source.layout).filter((value): value is number => typeof value === 'number');
  if (!values.every(Number.isFinite)) throw new Error('Text layout values must be finite numbers.');
  if (!finitePositive(source.layout.fontSizeMm) || source.layout.fontSizeMm > 100) throw new Error('Text size must be between 0 and 100 mm.');
  if (!finitePositive(source.layout.lineSpacing) || source.layout.lineSpacing > 10) throw new Error('Line spacing must be greater than 0 and no more than 10×.');
  if (source.layout.letterSpacingMm < -source.layout.fontSizeMm * 0.5 || source.layout.letterSpacingMm > 100) throw new Error('Letter spacing is outside the supported range.');
  if (!finitePositive(source.layout.pageWidthMm) || !finitePositive(source.layout.pageHeightMm) || source.layout.pageWidthMm > 2_000 || source.layout.pageHeightMm > 2_000) throw new Error('Writing width and height must be between 0 and 2,000 mm.');
  const { marginTopMm, marginRightMm, marginBottomMm, marginLeftMm, pageWidthMm, pageHeightMm } = source.layout;
  if ([marginTopMm, marginRightMm, marginBottomMm, marginLeftMm].some((value) => value < 0)) throw new Error('Margins cannot be negative.');
  if (marginLeftMm + marginRightMm >= pageWidthMm || marginTopMm + marginBottomMm >= pageHeightMm) throw new Error('Margins leave no usable writing area.');
  if (!getStrokeFont(source.layout.fontId)) throw new Error('The selected writing font is unavailable.');
}

function measure(text: string, source: TextSource): number {
  let width = 0;
  for (const character of text) width += characterAdvance(character, source.layout.fontId, source.layout.fontSizeMm, source.layout.letterSpacingMm);
  return Math.max(0, width - source.layout.letterSpacingMm);
}

function breakLongWord(word: string, maximum: number, source: TextSource): string[] {
  const chunks: string[] = []; let current = '';
  for (const character of word) {
    const candidate = current + character;
    if (current && measure(candidate, source) > maximum) { chunks.push(current); current = character; }
    else current = candidate;
  }
  if (current || !chunks.length) chunks.push(current);
  return chunks;
}

function wrapParagraph(paragraph: string, maximum: number, source: TextSource): Line[] {
  if (!paragraph) return [{ text: '', width: 0 }];
  const words = paragraph.replace(/\t/g, '    ').split(/ +/);
  const lines: Line[] = []; let current = '';
  const push = () => { lines.push({ text: current, width: measure(current, source) }); current = ''; };
  for (const word of words) {
    const chunks = measure(word, source) > maximum ? breakLongWord(word, maximum, source) : [word];
    for (const chunk of chunks) {
      const candidate = current ? `${current} ${chunk}` : chunk;
      if (current && measure(candidate, source) > maximum) push();
      if (!current && measure(chunk, source) > maximum) lines.push({ text: chunk, width: measure(chunk, source) });
      else current = current ? `${current} ${chunk}` : chunk;
    }
  }
  if (current || !lines.length) push();
  return lines;
}

export function layoutText(source: TextSource): LayoutResult {
  validateTextSource(source);
  const layout = source.layout;
  const usableWidth = layout.pageWidthMm - layout.marginLeftMm - layout.marginRightMm;
  const usableHeight = layout.pageHeightMm - layout.marginTopMm - layout.marginBottomMm;
  const lineAdvance = layout.fontSizeMm * layout.lineSpacing;
  // Font data includes small descenders (comma, semicolon, Q). Include them in
  // pagination so even a zero bottom margin never clips the last writing line.
  const glyphHeight = layout.fontSizeMm * (16 / 14);
  const linesPerPage = Math.max(1, Math.floor((usableHeight - glyphHeight) / lineAdvance) + 1);
  const logicalPages = source.text.replace(/\r\n?/g, '\n').split(PAGE_BREAK);
  const pages: Line[][] = [];
  for (const logicalPage of logicalPages) {
    const lines = logicalPage.split('\n').flatMap((paragraph) => wrapParagraph(paragraph, usableWidth, source));
    if (lines.length > TEXT_LIMITS.maxLines) throw new Error('Text layout exceeds 50,000 wrapped lines. Split this document into smaller jobs.');
    if (!lines.length) lines.push({ text: '', width: 0 });
    for (let start = 0; start < lines.length; start += linesPerPage) {
      pages.push(lines.slice(start, start + linesPerPage));
      if (pages.length > TEXT_LIMITS.maxPages) throw new Error('Text layout exceeds 500 output pages. Split this document into smaller jobs.');
    }
  }
  const pageCount = Math.max(1, pages.length);
  if (source.page >= pageCount) throw new Error(`Output page ${source.page + 1} no longer exists; this layout has ${pageCount} page${pageCount === 1 ? '' : 's'}.`);
  const selected = pages[source.page] ?? [];
  const allUnsupported = [...new Set(Array.from(source.text).filter((character) => !/\s/.test(character) && !supportedCharacter(character)))];
  const unsupported = allUnsupported.slice(0, 200);
  const paths = [];
  for (let lineIndex = 0; lineIndex < selected.length; lineIndex += 1) {
    const line = selected[lineIndex];
    let x = layout.marginLeftMm;
    if (layout.alignment === 'center') x += (usableWidth - line.width) / 2;
    if (layout.alignment === 'right') x += usableWidth - line.width;
    const baseline = layout.marginTopMm + layout.fontSizeMm + lineIndex * lineAdvance;
    for (let characterIndex = 0; characterIndex < line.text.length; characterIndex += 1) {
      const character = line.text[characterIndex];
      paths.push(...glyphPaths(character, layout.fontId, layout.fontSizeMm, x, baseline, `p${source.page}-l${lineIndex}-c${characterIndex}`));
      if (paths.length > TEXT_LIMITS.maxPaths) throw new Error('Writing geometry exceeds 250,000 strokes. Split the document or increase text size.');
      x += characterAdvance(character, layout.fontId, layout.fontSizeMm, layout.letterSpacingMm);
    }
  }
  const flowed = pageCount > logicalPages.length;
  const warnings: string[] = [];
  if (pageCount > 1) warnings.push(`Text flows to ${pageCount} separate output pages. Select and export each page individually.`);
  if (flowed) warnings.push('Content overflow was moved onto additional output pages; it was not clipped or shrunk.');
  if (allUnsupported.length) warnings.push(`Unsupported characters (${allUnsupported.length.toLocaleString()} unique) were replaced by visible spacing: ${unsupported.slice(0, 20).map((value) => JSON.stringify(value)).join(', ')}${allUnsupported.length > 20 ? '…' : ''}`);
  if (!paths.length) warnings.push('This output page contains no characters supported by the selected writing font.');
  return {
    toolpath: { paths, width: layout.pageWidthMm, height: layout.pageHeightMm, mode: 'text' },
    info: { page: source.page, pageCount, lineCount: selected.length, flowed, unsupportedCharacters: unsupported, warnings },
  };
}
