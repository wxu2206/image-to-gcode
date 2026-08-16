import { describe, expect, it } from 'vitest';
import goldenSvg from './fixtures/golden.svg?raw';
import goldenGcode from './fixtures/golden.expected.gcode?raw';
import { buildMovements, generate, statistics } from '../core/gcode';
import { defaults, profiles } from '../core/machine';
import { optimizeToolpath } from '../core/optimize';
import { packMoves, packedMoveBytes, timedPreviewFromPacked } from '../workers/packedMoves';
import { flattenVectorDocument } from './flatten';
import { parseSvgText } from './parseSvg';

const goldenSettings = { ...defaults, outputWidth: 20, outputHeight: 20, workWidth: 30, workHeight: 30, toolpathDetail: 0.5, passes: 1, feed: 600, travel: 1_200, precision: 2, noiseCleanup: 'off' as const };
const pen = { ...profiles[1], header: 'G90', footer: 'M2', toolOn: 'PEN DOWN', toolOff: 'PEN UP', feed: 600, travel: 1_200 };

describe('native SVG canonical pipeline', () => {
  it('reuses optimization, movements, statistics, packing, preview, and G-code', () => {
    const document = parseSvgText(goldenSvg);
    const flattened = flattenVectorDocument(document, goldenSettings);
    const optimized = optimizeToolpath(flattened.toolpath, goldenSettings).toolpath;
    const built = buildMovements(optimized, goldenSettings, pen);
    const stats = statistics(built.moves);
    const packed = packMoves(built.moves);
    const preview = timedPreviewFromPacked(packed, 'full');
    const generated = generate(optimized, goldenSettings, pen);
    expect(optimized.mode).toBe('vector');
    expect(stats.movementCount).toBe(built.moves.length);
    // Canonical statistics include the initial travel from machine origin.
    expect(stats.bounds).toMatchObject({ minX: 0, maxX: 12, minY: 0, maxY: 18 });
    expect(packedMoveBytes(packed)).toBeGreaterThan(0);
    expect(preview.moves.length).toBe(built.moves.length);
    expect(generated.code).toContain('; mode: vector');
    expect(generated.code).toBe(goldenGcode);
    expect(generated.moves).toEqual(built.moves);
  });

  it('produces byte-for-byte deterministic canonical output', () => {
    const run = () => {
      const toolpath = optimizeToolpath(flattenVectorDocument(parseSvgText(goldenSvg), goldenSettings).toolpath, goldenSettings).toolpath;
      return generate(toolpath, goldenSettings, pen).code;
    };
    expect(run()).toBe(run());
  });
});
