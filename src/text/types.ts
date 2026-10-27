export const PAGE_BREAK = '\n\n--- DOCUMENT PAGE BREAK ---\n\n';

export type TextAlignment = 'left' | 'center' | 'right';

export type TextLayoutSettings = {
  fontId: string;
  fontSizeMm: number;
  lineSpacing: number;
  letterSpacingMm: number;
  alignment: TextAlignment;
  pageWidthMm: number;
  pageHeightMm: number;
  marginTopMm: number;
  marginRightMm: number;
  marginBottomMm: number;
  marginLeftMm: number;
};

export type TextSource = {
  text: string;
  page: number;
  layout: TextLayoutSettings;
};

export type TextPageInfo = {
  page: number;
  pageCount: number;
  lineCount: number;
  flowed: boolean;
  unsupportedCharacters: string[];
  warnings: string[];
};

export type ExtractedDocument = {
  text: string;
  sourcePages: number;
  warnings: string[];
};

export const defaultTextLayout: TextLayoutSettings = {
  fontId: 'plotter-simplex',
  fontSizeMm: 5,
  lineSpacing: 1.45,
  letterSpacingMm: 0.35,
  alignment: 'left',
  pageWidthMm: 210,
  pageHeightMm: 297,
  marginTopMm: 15,
  marginRightMm: 15,
  marginBottomMm: 15,
  marginLeftMm: 15,
};
