import { describe, expect, it } from 'vitest';
import { gcodeFilename } from './filename';

describe('G-code download filenames', () => {
  it('removes path syntax, controls, and unsafe filename punctuation', () => {
    expect(gcodeFilename('../../weird<script>\u0000.png', 'contour')).toBe('weird-script-contour.gcode');
    expect(gcodeFilename('  .  ', 'raster')).toBe('image-raster.gcode');
  });
  it('limits the source portion while retaining a .gcode extension', () => {
    expect(gcodeFilename('a'.repeat(180) + '.jpg', 'grayscale')).toHaveLength(96 + '-grayscale.gcode'.length);
  });
});
