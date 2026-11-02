import type { Toolpath } from '../core/types';
import { characterAdvance, glyphPaths, hasStrokeFont, STROKE_FONT_ASCENT, STROKE_FONT_HEIGHT, supportedCharacter } from './fonts';
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
  if (!hasStrokeFont(source.layout.fontId)) throw new Error('The selected writing font is unavailable.');
}

function measure(text: string, source: TextSource): number {
  let width = 0;
  for (const character of text) width += characterAdvance(character, source.layout.fontId, source.layout.fontSizeMm, source.layout.letterSpacingMm);
  return Math.max(0, width - source.layout.letterSpacingMm);
}

function breakLongWord(word: string, maximum: number, source: TextSource): Line[] {
  const chunks: Line[] = []; let current = ''; let currentWidth = 0;
  for (const character of word) {
    const characterWidth = measure(character, source);
    if (characterWidth > maximum) throw new Error('The usable writing width is too narrow for the selected text size.');
    const candidateWidth = current ? currentWidth + source.layout.letterSpacingMm + characterWidth : characterWidth;
    if (current && candidateWidth > maximum) {
      chunks.push({ text: current, width: currentWidth });
      current = character;
      currentWidth = characterWidth;
    } else {
      current += character;
      currentWidth = candidateWidth;
    }
  }
  if (current || !chunks.length) chunks.push({ text: current, width: currentWidth });
  return chunks;
}

function wrapParagraph(paragraph: string, maximum: number, source: TextSource): Line[] {
  if (!paragraph) return [{ text: '', width: 0 }];
  const tokens = paragraph.replace(/\t/g, '    ').match(/ +|[^ ]+/g) ?? [];
  const lines: Line[] = []; let current = ''; let currentWidth = 0;
  const push = () => { lines.push({ text: current, width: currentWidth }); current = ''; currentWidth = 0; };
  for (const token of tokens) {
    const tokenWidth = measure(token, source);
    const chunks = tokenWidth > maximum ? breakLongWord(token, maximum, source) : [{ text: token, width: tokenWidth }];
    for (const chunk of chunks) {
      const candidateWidth = current ? currentWidth + source.layout.letterSpacingMm + chunk.width : chunk.width;
      if (current && candidateWidth > maximum) push();
      currentWidth = current ? currentWidth + source.layout.letterSpacingMm + chunk.width : chunk.width;
      current += chunk.text;
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
  const glyphHeight = layout.fontSizeMm * STROKE_FONT_HEIGHT;
  if (glyphHeight > usableHeight) throw new Error('The usable writing height is too short for the selected text size.');
  const linesPerPage = Math.floor((usableHeight - glyphHeight) / lineAdvance) + 1;
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
    const baseline = layout.marginTopMm + layout.fontSizeMm * STROKE_FONT_ASCENT + lineIndex * lineAdvance;
    const characters = Array.from(line.text);
    for (let characterIndex = 0; characterIndex < characters.length; characterIndex += 1) {
      const character = characters[characterIndex];
      const strokes = glyphPaths(character, layout.fontId, layout.fontSizeMm, x, baseline, `p${source.page}-l${lineIndex}-c${characterIndex}`);
      if (strokes.some((stroke) => stroke.points.some((point) => point.x < layout.marginLeftMm - 1e-9
        || point.x > layout.pageWidthMm - layout.marginRightMm + 1e-9
        || point.y < layout.marginTopMm - 1e-9
        || point.y > layout.pageHeightMm - layout.marginBottomMm + 1e-9))) {
        throw new Error('Writing geometry exceeds the usable page area. Reduce text size or adjust spacing and margins.');
      }
      paths.push(...strokes);
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
