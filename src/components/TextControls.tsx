import { fontSamplePolylines, strokeFonts } from '../text/fonts';
import type { TextLayoutSettings } from '../text/types';

type Props = {
  text: string;
  layout: TextLayoutSettings;
  page: number;
  pageCount: number;
  sourcePages: number;
  importWarnings: string[];
  onText: (text: string) => void;
  onLayout: (change: Partial<TextLayoutSettings>) => void;
  onPage: (page: number) => void;
};

function FontSample({ fontId }: { fontId: string }) {
  const lines = fontSamplePolylines(fontId);
  return <svg className="font-sample" viewBox="0 0 90 20" role="img" aria-label="Selected writing font sample">
    {lines.map((points, index) => <polyline key={index} points={points.map((point) => `${point.x},${point.y}`).join(' ')} />)}
  </svg>;
}

const numberValue = (value: string, fallback: number) => Number.isFinite(Number(value)) ? Number(value) : fallback;

export function TextControls({ text, layout, page, pageCount, sourcePages, importWarnings, onText, onLayout, onPage }: Props) {
  const usableWidth = Math.max(0, layout.pageWidthMm - layout.marginLeftMm - layout.marginRightMm);
  const usableHeight = Math.max(0, layout.pageHeightMm - layout.marginTopMm - layout.marginBottomMm);
  return <div className="text-controls">
    <h3>Text / document</h3>
    <label>Editable plain text<textarea aria-label="Document text" rows={10} maxLength={500_000} value={text} placeholder="Type text here, or import a DOCX / text PDF…" onChange={(event) => onText(event.target.value)} /></label>
    <small className="field-help">Documents stay local and are extracted as plain text. The selected writing font replaces document fonts; exact formatting is not preserved. Scanned PDFs require OCR. Legacy .doc files must be converted to .docx.</small>
    {sourcePages > 1 && <div className="document-pages">Imported source: {sourcePages} pages. Visible “DOCUMENT PAGE BREAK” markers preserve boundaries.</div>}
    {importWarnings.map((warning) => <div className="inline-warning" key={warning}>{warning}</div>)}
    <label>Writing font<select value={layout.fontId} onChange={(event) => onLayout({ fontId: event.target.value })}>{strokeFonts.map((font) => <option key={font.id} value={font.id}>{font.name} — single-line</option>)}</select></label>
    <FontSample fontId={layout.fontId} />
    <small className="field-help">True centerline stroke fonts: one plotted line per stored stroke. These are not outline fonts. Bundled under MIT; notice in public/fonts/LICENSE.txt.</small>
    <div className="grid">
      <label>Text size (mm)<input type="number" min="0.5" max="100" step="0.25" value={layout.fontSizeMm} onChange={(event) => onLayout({ fontSizeMm: numberValue(event.target.value, layout.fontSizeMm) })} /></label>
      <label>Line spacing (×)<input type="number" min="0.5" max="10" step="0.05" value={layout.lineSpacing} onChange={(event) => onLayout({ lineSpacing: numberValue(event.target.value, layout.lineSpacing) })} /></label>
      <label>Letter spacing (mm)<input type="number" min={-layout.fontSizeMm * .5} max="100" step="0.1" value={layout.letterSpacingMm} onChange={(event) => onLayout({ letterSpacingMm: numberValue(event.target.value, layout.letterSpacingMm) })} /></label>
      <label>Alignment<select value={layout.alignment} onChange={(event) => onLayout({ alignment: event.target.value as TextLayoutSettings['alignment'] })}><option value="left">Left</option><option value="center">Center</option><option value="right">Right</option></select></label>
      <label>Usable width (mm)<input type="number" min="1" max="2000" step="1" value={usableWidth} onChange={(event) => onLayout({ pageWidthMm: numberValue(event.target.value, usableWidth) + layout.marginLeftMm + layout.marginRightMm })} /></label>
      <label>Usable height (mm)<input type="number" min="1" max="2000" step="1" value={usableHeight} onChange={(event) => onLayout({ pageHeightMm: numberValue(event.target.value, usableHeight) + layout.marginTopMm + layout.marginBottomMm })} /></label>
      <label>Top margin (mm)<input type="number" min="0" step="1" value={layout.marginTopMm} onChange={(event) => onLayout({ marginTopMm: numberValue(event.target.value, layout.marginTopMm) })} /></label>
      <label>Right margin (mm)<input type="number" min="0" step="1" value={layout.marginRightMm} onChange={(event) => onLayout({ marginRightMm: numberValue(event.target.value, layout.marginRightMm) })} /></label>
      <label>Bottom margin (mm)<input type="number" min="0" step="1" value={layout.marginBottomMm} onChange={(event) => onLayout({ marginBottomMm: numberValue(event.target.value, layout.marginBottomMm) })} /></label>
      <label>Left margin (mm)<input type="number" min="0" step="1" value={layout.marginLeftMm} onChange={(event) => onLayout({ marginLeftMm: numberValue(event.target.value, layout.marginLeftMm) })} /></label>
    </div>
    <small className="field-help">Page: {layout.pageWidthMm.toFixed(1)} × {layout.pageHeightMm.toFixed(1)} mm including margins. Text wraps inside the usable area and explicit line breaks are preserved.</small>
    <div className={`page-picker ${pageCount > 1 ? 'has-overflow' : ''}`}><b>Output page {Math.min(page + 1, pageCount)} of {pageCount}</b>{pageCount > 1 && <span>Content continues onto separate jobs; nothing is clipped or shrunk.</span>}<div><button type="button" disabled={page <= 0} onClick={() => onPage(page - 1)}>Previous</button><button type="button" disabled={page + 1 >= pageCount} onClick={() => onPage(page + 1)}>Next</button></div></div>
  </div>;
}
