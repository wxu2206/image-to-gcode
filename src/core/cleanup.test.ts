import { describe, expect, it } from 'vitest';
import { cleanupTinyArtifacts } from './image';

const image = (width: number, height: number, dark: Array<[number, number]>) => {
  const data = new Uint8ClampedArray(width * height).fill(255);
  for (const [x, y] of dark) data[y * width + x] = 0;
  return { width, height, data };
};
const settings = { outputWidth: 10, outputHeight: 10, units: 'mm' as const, toolpathDetail: 1, threshold: 128, filter: 'threshold', noiseCleanup: 'light' as const };

describe('physical noise cleanup', () => {
  it('removes isolated specks but preserves a connected line and meaningful loop', () => {
    const loop: Array<[number, number]> = [];
    for (let index = 0; index < 10; index += 1) loop.push([50 + index, 50], [50 + index, 59], [50, 50 + index], [59, 50 + index]);
    const noisy = image(100, 100, [[1, 1], ...Array.from({ length: 10 }, (_, index) => [10 + index, 10] as [number, number]), ...loop]);
    const result = cleanupTinyArtifacts(noisy, settings);
    expect(result.removedComponents).toBe(1);
    expect(result.image.data[1 * 100 + 1]).toBe(255);
    expect(result.image.data[10 * 100 + 15]).toBe(0);
    expect(result.image.data[51 * 100 + 50]).toBe(0);
  });

  it('is deterministic, respects off, and leaves dither-derived dots untouched', () => {
    const noisy = image(100, 100, [[1, 1], [8, 8]]);
    expect(cleanupTinyArtifacts(noisy, { ...settings, noiseCleanup: 'off' }).image.data).toBe(noisy.data);
    expect(cleanupTinyArtifacts(noisy, { ...settings, filter: 'dither' }).image.data).toBe(noisy.data);
    expect(cleanupTinyArtifacts(noisy, settings)).toEqual(cleanupTinyArtifacts(noisy, settings));
  });

  it('uses physical dimensions rather than only source pixel count', () => {
    const dot = image(100, 100, [[1, 1]]);
    expect(cleanupTinyArtifacts(dot, { ...settings, outputWidth: 100, outputHeight: 100 }).removedComponents).toBe(0);
    expect(cleanupTinyArtifacts(dot, settings).removedComponents).toBe(1);
  });
});
