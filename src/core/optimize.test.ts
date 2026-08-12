import { describe, expect, it } from 'vitest';
import { defaults } from './machine';
import { optimizeToolpath, travelDistance } from './optimize';
import type { Path, Toolpath } from './types';

const path = (id: string, points: Array<[number, number]>): Path => ({ id, kind: 'work', points: points.map(([x, y]) => ({ x, y })) });
const job = (paths: Path[], mode: Toolpath['mode'] = 'raster'): Toolpath => ({ width: 100, height: 100, mode, paths });

describe('bounded toolpath optimization', () => {
  it('reverses open paths and deterministically reduces poorly ordered travel', () => {
    const source = job([path('c', [[90, 0], [80, 0]]), path('a', [[10, 0], [20, 0]]), path('b', [[30, 0], [40, 0]])]);
    const result = optimizeToolpath(source, defaults);
    expect(result.afterTravel).toBeLessThan(result.beforeTravel);
    expect(result.toolpath.paths.map((item) => item.id)).toEqual(['a', 'b', 'c']);
    expect(optimizeToolpath(source, defaults).toolpath.paths).toEqual(result.toolpath.paths);
  });

  it('joins only conservative, compatible raster gaps and preserves contours', () => {
    const close = job([path('a', [[0, 0], [10, 0]]), path('b', [[10.1, 0], [20, 0]])]);
    const result = optimizeToolpath(close, { ...defaults, outputWidth: 100, outputHeight: 100, toolpathDetail: .3 });
    expect(result.joins).toBe(1); expect(result.toolpath.paths).toHaveLength(1);
    const contour = optimizeToolpath(job([path('loop', [[0, 0], [10, 0], [10, 10], [0, 0]])], 'contour'), defaults);
    expect(contour.joins).toBe(0); expect(contour.toolpath.paths[0].points).toHaveLength(4);
  });

  it('uses the scalable fallback without NaN travel for huge path sets', () => {
    const paths = Array.from({ length: 1_300 }, (_, index) => path(String(index), [[index % 100, Math.floor(index / 100)], [index % 100 + .1, Math.floor(index / 100)]]));
    const result = optimizeToolpath(job(paths), defaults);
    expect(result.strategy).toBe('spatial'); expect(Number.isFinite(result.afterTravel)).toBe(true); expect(result.afterTravel).toBeGreaterThanOrEqual(0);
    expect(travelDistance(result.toolpath.paths)).toBe(result.afterTravel);
  });
});
