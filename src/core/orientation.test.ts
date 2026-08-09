import { describe, expect, it } from 'vitest';
import { raster } from './conversion';
import { buildMovements } from './gcode';
import { defaults, profiles } from './machine';

describe('source image orientation', () => {
  it('keeps asymmetric source rows in their visual top-to-bottom order', () => {
    // Dark runs identify the source top-left/top-right and bottom-left/bottom-right
    // without relying on symmetric image content.
    const image = { width: 4, height: 2, data: new Uint8ClampedArray([0, 0, 255, 255, 255, 255, 0, 0]) };
    const settings = { ...defaults, outputWidth: 40, outputHeight: 20, lineSpacing: 10, threshold: 128 };
    const toolpath = raster(image, settings);
    const moves = buildMovements(toolpath, settings, profiles[1]).moves.filter((move) => move.working);
    expect(moves[0].from).toMatchObject({ x: 0, y: 20 }); // source top-left
    expect(moves[0].to).toMatchObject({ x: 13.333, y: 20 }); // source top-right run
    expect(moves[1].from).toMatchObject({ x: 40, y: 0 }); // source bottom-right
    expect(moves[1].to).toMatchObject({ x: 26.667, y: 0 }); // source bottom-left run
  });
});
