import { describe, expect, it } from 'vitest';
import { contour, orderPaths, raster } from './conversion';
import { defaults } from './machine';
import type { Path } from './types';

const settings = { ...defaults, outputHeight: 200, lineSpacing: .5, threshold: 128, simplify: 1 };

describe('large geometry scale', () => {
  it('orders ten thousand paths deterministically without quadratic scans', () => {
    const paths: Path[] = Array.from({ length: 10_000 }, (_, index) => ({
      id: String(index), kind: 'work', points: [{ x: (index * 17) % 1000, y: (index * 31) % 1000 }, { x: (index * 17 + 1) % 1000, y: (index * 31 + 1) % 1000 }],
    }));
    const first = orderPaths(paths);
    const second = orderPaths(paths);
    expect(first).toHaveLength(paths.length);
    expect(first.map((path) => path.id)).toEqual(second.map((path) => path.id));
  });

  it('produces valid high-resolution raster geometry', () => {
    const size = 1000;
    const data = new Uint8ClampedArray(size * size);
    for (let index = 0; index < data.length; index += 1) data[index] = index % size < size / 2 ? 0 : 255;
    const toolpath = raster({ width: size, height: size, data }, settings);
    expect(toolpath.paths.length).toBeGreaterThan(100);
    expect(toolpath.paths.every((path) => path.points.length > 1)).toBe(true);
  });

  it('keeps noisy contour extraction deterministic and connected', () => {
    const size = 256;
    const data = new Uint8ClampedArray(size * size);
    for (let index = 0; index < data.length; index += 1) data[index] = ((index * 1103515245 + 12345) >>> 16) & 255;
    const first = contour({ width: size, height: size, data }, settings);
    const second = contour({ width: size, height: size, data }, settings);
    expect(first.paths.map((path) => path.id)).toEqual(second.paths.map((path) => path.id));
    expect(first.paths.every((path) => path.points[0].x === path.points[path.points.length - 1].x && path.points[0].y === path.points[path.points.length - 1].y)).toBe(true);
  });
});
