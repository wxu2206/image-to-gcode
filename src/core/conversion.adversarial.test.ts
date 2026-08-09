import { describe, expect, it } from 'vitest';
import { contour, orderPaths, raster } from './conversion';
import { simplify } from './geometry';
import { processImage } from './image';
import { defaults } from './machine';
import type { Path } from './types';

const settings = {
  ...defaults,
  outputWidth: 6,
  outputHeight: 2,
  lineSpacing: 1,
  threshold: 128,
  simplify: 0,
  toolpathDetail: 0.05,
};
const gray = (width: number, height: number, values: number[]) => ({ width, height, data: new Uint8ClampedArray(values) });
const rgba = (width: number, height: number, pixels: Array<[number, number, number, number]>) => ({
  width,
  height,
  data: new Uint8ClampedArray(pixels.flat()),
});

function signedArea(path: Path): number {
  let area = 0;
  for (let index = 1; index < path.points.length; index += 1) {
    const previous = path.points[index - 1];
    const current = path.points[index];
    area += previous.x * current.y - current.x * previous.y;
  }
  return area / 2;
}

describe('adversarial raster conversion', () => {
  it('serpentines by scanline, reversing both run order and run direction', () => {
    const image = gray(6, 2, [
      0, 0, 255, 255, 0, 0,
      0, 0, 255, 255, 0, 0,
    ]);
    const paths = raster(image, settings).paths;
    expect(paths.map((path) => path.points.map((point) => point.x))).toEqual([
      [0, 1.2],
      [4.8, 6],
      [6, 4.8],
      [1.2, 0],
    ]);
  });

  it('handles all-white, all-black, 1xN, and N x 1 images deterministically', () => {
    expect(raster(gray(4, 2, new Array(8).fill(255)), settings).paths).toEqual([]);
    expect(raster(gray(4, 2, new Array(8).fill(0)), settings).paths).toHaveLength(2);
    expect(raster(gray(1, 5, new Array(5).fill(0)), { ...settings, outputWidth: 1, outputHeight: 5 }).paths).toEqual([]);
    expect(raster(gray(5, 1, new Array(5).fill(0)), { ...settings, outputWidth: 5, outputHeight: 1 }).paths[0].points).toHaveLength(5);
  });

  it('stores point-level grayscale intensity instead of treating every image identically', () => {
    const path = raster(gray(3, 1, [255, 128, 0]), { ...settings, outputWidth: 3, outputHeight: 1 }, 'grayscale').paths[0];
    expect(path.points.map((point) => point.intensity)).toEqual([0, 127 / 255, 1]);
  });
});

describe('adversarial contour tracing', () => {
  it('keeps diagonally touching pixels as two closed contours', () => {
    const result = contour(gray(2, 2, [0, 255, 255, 0]), { ...settings, outputWidth: 2, outputHeight: 2 });
    expect(result.paths).toHaveLength(2);
    expect(result.paths.every((path) => path.points[0].x === path.points[path.points.length - 1]?.x && path.points[0].y === path.points[path.points.length - 1]?.y)).toBe(true);
  });

  it('traces both the outer boundary and opposite-winding hole of a donut', () => {
    const result = contour(gray(3, 3, [
      0, 0, 0,
      0, 255, 0,
      0, 0, 0,
    ]), { ...settings, outputWidth: 3, outputHeight: 3 });
    expect(result.paths).toHaveLength(2);
    const areas = result.paths.map(signedArea);
    expect(Math.sign(areas[0])).toBe(-Math.sign(areas[1]));
  });

  it('closes border-touching and one-pixel-line geometry without repeated interior vertices', () => {
    const result = contour(gray(4, 3, [
      0, 255, 255, 255,
      0, 0, 0, 255,
      255, 255, 255, 255,
    ]), { ...settings, outputWidth: 4, outputHeight: 3 });
    expect(result.paths).toHaveLength(1);
    const points = result.paths[0].points;
    expect(points[0]).toEqual(points[points.length - 1]);
    const interiorKeys = points.slice(0, -1).map((point) => `${point.x},${point.y}`);
    expect(new Set(interiorKeys).size).toBe(interiorKeys.length);
  });

  it('orders without losing, duplicating, or mutating closed geometry', () => {
    const paths: Path[] = [
      { id: 'z', kind: 'work', points: [{ x: 50, y: 2 }, { x: 51, y: 2 }] },
      { id: 'a', kind: 'work', points: [{ x: 2, y: 2 }, { x: 3, y: 2 }] },
      { id: 'loop', kind: 'work', points: [{ x: 10, y: 40 }, { x: 11, y: 40 }, { x: 11, y: 41 }, { x: 10, y: 40 }] },
    ];
    const originalLoop = paths[2].points.slice();
    const ordered = orderPaths(paths);
    expect(ordered.map((path) => path.id).sort()).toEqual(['a', 'loop', 'z']);
    expect(ordered.find((path) => path.id === 'loop')?.points).toEqual(originalLoop);
    expect(orderPaths(paths)).toEqual(ordered);
  });

  it('fails predictably for malformed simplification input', () => {
    expect(() => simplify([{ x: 0, y: 0 }, { x: 1, y: 1 }, { x: 2, y: 2 }], Number.NaN)).toThrow('tolerance');
    expect(() => simplify([{ x: 0, y: 0 }, { x: Infinity, y: 1 }, { x: 2, y: 2 }], 1)).toThrow('non-finite');
  });
});

describe('transparent and filtered image processing', () => {
  it('composites transparent pixels against white and keeps fully transparent pixels inert when inverted', () => {
    const input = rgba(3, 1, [
      [0, 0, 0, 0],
      [0, 0, 0, 128],
      [0, 0, 0, 255],
    ]);
    const normal = processImage(input, { brightness: 0, contrast: 0, invert: false, filter: 'grayscale', threshold: 128 });
    const inverted = processImage(input, { brightness: 0, contrast: 0, invert: true, filter: 'grayscale', threshold: 128 });
    expect([...normal.data]).toEqual([255, 127, 0]);
    expect(inverted.data[0]).toBe(255);
    expect(inverted.data[2]).toBe(255);
  });

  it('renders uniform edge-filter regions white and actual gradients dark', () => {
    const uniform = rgba(3, 3, new Array(9).fill([20, 20, 20, 255]) as Array<[number, number, number, number]>);
    expect([...processImage(uniform, { brightness: 0, contrast: 0, invert: false, filter: 'edge', threshold: 128 }).data]).toEqual(new Array(9).fill(255));
    const gradient = rgba(3, 3, [
      [0, 0, 0, 255], [0, 0, 0, 255], [255, 255, 255, 255],
      [0, 0, 0, 255], [0, 0, 0, 255], [255, 255, 255, 255],
      [0, 0, 0, 255], [0, 0, 0, 255], [255, 255, 255, 255],
    ]);
    expect(processImage(gradient, { brightness: 0, contrast: 0, invert: false, filter: 'edge', threshold: 128 }).data[4]).toBe(0);
  });

  it('does not diffuse right-edge dither error into a non-neighbour two rows below', () => {
    const values = [255, 100, 255, 255, 125, 255];
    const input = rgba(2, 3, values.map((value) => [value, value, value, 255]));
    const output = processImage(input, { brightness: 0, contrast: 0, invert: false, filter: 'dither', threshold: 128 });
    expect(output.data[4]).toBe(0);
  });

  it('does not diffuse dither error into fully transparent pixels', () => {
    const input = rgba(3, 1, [[100, 100, 100, 255], [0, 0, 0, 0], [100, 100, 100, 255]]);
    const output = processImage(input, { brightness: 0, contrast: 0, invert: false, filter: 'dither', threshold: 128 });
    expect(output.data[1]).toBe(255);
  });

  it('rejects mismatched image buffers and unknown filters', () => {
    expect(() => processImage({ width: 2, height: 2, data: new Uint8ClampedArray(4) }, { brightness: 0, contrast: 0, invert: false, filter: 'grayscale', threshold: 128 })).toThrow('does not match');
    expect(() => processImage(rgba(1, 1, [[0, 0, 0, 255]]), { brightness: 0, contrast: 0, invert: false, filter: 'unknown', threshold: 128 })).toThrow('Unknown');
  });
});
