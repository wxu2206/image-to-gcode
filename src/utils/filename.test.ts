import { describe, expect, it } from 'vitest';
import { gcodeFilename } from './filename';

describe('G-code download filenames', () => {
  it('removes path syntax, controls, and unsafe filename punctuation', () => {
    expect(gcodeFilename('../../weird<script>\u0000.png', 'contour')).toBe('weird-script-contour.gcode');
    expect(gcodeFilename('  .  ', 'raster')).toBe('image-raster.gcode');
    expect(gcodeFilename('safe\u202Eedocg.png', 'raster')).toBe('safeedocg-raster.gcode');
  });
  it('limits the source portion while retaining a .gcode extension', () => {
    expect(gcodeFilename('a'.repeat(180) + '.jpg', 'grayscale')).toHaveLength(96 + '-grayscale.gcode'.length);
  });
  it('keeps document page suffixes after removing the source extension', () => {
    expect(gcodeFilename('report.docx-page-1', 'text')).toBe('report-page-1-text.gcode');
    expect(gcodeFilename('report.pdf-page-2', 'text')).toBe('report-page-2-text.gcode');
    expect(gcodeFilename('typed-text.txt-page-10', 'text')).toBe('typed-text-page-10-text.gcode');
    expect(gcodeFilename('a'.repeat(180) + '.pdf-page-1', 'text')).not.toBe(gcodeFilename('a'.repeat(180) + '.pdf-page-2', 'text'));
  });
});
