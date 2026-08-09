import { describe, expect, it } from 'vitest';
import { contour, orderPaths, raster } from './conversion';
import { distance, machinePoint, scaleToOutput, simplify } from './geometry';
import { generate, statistics } from './gcode';
import { defaults, profiles, validate } from './machine';
import type { Move, Path, Toolpath } from './types';

const settings = { ...defaults, outputWidth: 100, outputHeight: 50, workWidth: 200, workHeight: 100, lineSpacing: 10, threshold: 128 };
const image = (width: number, height: number, values: number[]) => ({ width, height, data: new Uint8ClampedArray(values) });
const singlePath = (points: { x: number; y: number }[]): Toolpath => ({ width: 10, height: 10, mode: 'raster', paths: [{ id: 'a', kind: 'work', points }] });

describe('geometry', () => {
  it('scales pixel coordinates to physical output dimensions', () => expect(scaleToOutput({ x: 50, y: 50 }, 100, 100, settings)).toMatchObject({ x: 50, y: 25 }));
  it('supports top-left and center origins', () => {
    expect(machinePoint({ x: 10, y: 5 }, { ...settings, origin: 'top-left' })).toMatchObject({ x: 10, y: 45 });
    expect(machinePoint({ x: 10, y: 5 }, { ...settings, origin: 'center' })).toMatchObject({ x: -40, y: -20 });
  });
  it('applies axis inversions and offsets after origin transforms', () => expect(machinePoint({ x: 10, y: 5 }, { ...settings, invertX: true, invertY: true, offsetX: 2, offsetY: 3 })).toMatchObject({ x: 92, y: 48 }));
  it('calculates 3D distances', () => expect(distance({ x: 0, y: 0, z: 0 }, { x: 3, y: 4, z: 12 })).toBe(13));
  it('simplifies collinear points while retaining a corner', () => {
    expect(simplify([{ x: 0, y: 0 }, { x: 1, y: .01 }, { x: 2, y: 0 }], .1)).toHaveLength(2);
    expect(simplify([{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 1, y: 1 }, { x: 2, y: 1 }], .1)).toHaveLength(4);
  });
});

describe('raster conversion and ordering', () => {
  it('produces horizontal runs and serpentine directions', () => {
    const toolpath = raster(image(4, 2, [0, 0, 0, 0, 0, 0, 0, 0]), { ...settings, lineSpacing: 25 });
    expect(toolpath.paths).toHaveLength(2);
    expect(toolpath.paths[0].points[0].x).toBe(0);
    expect(toolpath.paths[1].points[0].x).toBe(3);
  });
  it('does not emit isolated dark pixels or empty runs', () => expect(raster(image(5, 1, [255, 0, 255, 0, 255]), settings).paths).toHaveLength(0));
  it('orders independent paths deterministically by travel distance', () => {
    const paths: Path[] = [{ id: 'far', kind: 'work', points: [{ x: 9, y: 0 }, { x: 10, y: 0 }] }, { id: 'near', kind: 'work', points: [{ x: 1, y: 0 }, { x: 2, y: 0 }] }];
    expect(orderPaths(paths).map((path) => path.id)).toEqual(['near', 'far']);
  });
});

describe('connected contour tracing', () => {
  it('traces a solid block as one closed contour', () => {
    const toolpath = contour(image(4, 4, [255, 255, 255, 255, 255, 0, 0, 255, 255, 0, 0, 255, 255, 255, 255, 255]), { ...settings, simplify: .1 });
    expect(toolpath.paths).toHaveLength(1);
    const loop = toolpath.paths[0].points;
    expect(loop[0]).toEqual(loop[loop.length - 1]);
    expect(loop.length).toBeGreaterThanOrEqual(5);
  });
  it('keeps disconnected regions as separate closed contours', () => {
    const toolpath = contour(image(5, 3, [0, 0, 255, 0, 0, 0, 0, 255, 0, 0, 0, 0, 255, 0, 0]), { ...settings, simplify: .1 });
    expect(toolpath.paths).toHaveLength(2);
    expect(toolpath.paths.every((path) => path.points[0].x === path.points[path.points.length - 1].x && path.points[0].y === path.points[path.points.length - 1].y)).toBe(true);
  });
  it('honours the threshold when choosing contour pixels', () => expect(contour(image(2, 1, [127, 128]), settings).paths).toHaveLength(1));
});

describe('machine validation and profiles', () => {
  it('includes safe generic profiles without implicit tool-on commands', () => {
    expect(profiles.map((profile) => profile.kind)).toEqual(['cnc', 'pen', 'laser']);
    expect(profiles.every((profile) => profile.toolOn === '')).toBe(true);
  });
  it('rejects malformed, unsafe, and out-of-bounds configurations', () => {
    const warnings = validate({ ...settings, feed: -1, outputWidth: 300, passes: 1.5, lineSpacing: 0, precision: 9, safeZ: -1, workZ: 3, maxDepth: Number.NaN });
    expect(warnings.length).toBeGreaterThanOrEqual(7);
  });
});

describe('G-code generation', () => {
  it('emits units, configured commands, feed rates, and safe Z', () => {
    const profile = { ...profiles[0], header: 'G17', footer: 'M2', toolOn: 'M3', toolOff: 'M5' };
    const result = generate(singlePath([{ x: 0, y: 0 }, { x: 10, y: 10 }]), settings, profile);
    expect(result.code).toContain('G21'); expect(result.code).toContain('G17'); expect(result.code).toContain('M3'); expect(result.code).toContain('M5'); expect(result.code).toContain('G0 Z5'); expect(result.code).toContain('F600');
  });
  it('maps offsets, origin, and inversion identically in moves and G-code', () => {
    const result = generate(singlePath([{ x: 0, y: 0 }, { x: 10, y: 10 }]), { ...settings, offsetX: 2, offsetY: 3, invertX: true }, profiles[1]);
    expect(result.moves.find((move) => !move.working)?.to).toMatchObject({ x: 102, y: 3 });
    expect(result.moves.find((move) => move.working)?.to).toMatchObject({ x: 2, y: 53 });
    expect(result.code).toContain('X102 Y3');
  });
  it('restarts every CNC pass at the path start and limits depth', () => {
    const result = generate(singlePath([{ x: 0, y: 0 }, { x: 10, y: 10 }]), { ...settings, passes: 3, workZ: -1, maxDepth: -2 }, { ...profiles[0], passDepth: 1 });
    const plunges = result.moves.filter((move) => move.working && move.from.z === settings.safeZ);
    expect(plunges).toHaveLength(3);
    expect(plunges.map((move) => move.to.z)).toEqual([-1, -2, -2]);
    expect(plunges.every((move) => move.to.x === 0 && move.to.y === 0)).toBe(true);
  });
  it('warns when transformed toolpath coordinates exceed machine bounds', () => {
    const result = generate(singlePath([{ x: 0, y: 0 }, { x: 10, y: 10 }]), { ...settings, workWidth: 50 }, profiles[1]);
    expect(result.warnings.some((warning) => warning.includes('outside work area'))).toBe(true);
  });
  it('does not add CNC Z motion for pen and laser profiles', () => {
    const pen = generate(singlePath([{ x: 0, y: 0 }, { x: 10, y: 10 }]), settings, profiles[1]);
    const laser = generate(singlePath([{ x: 0, y: 0 }, { x: 10, y: 10 }]), settings, profiles[2]);
    expect(pen.code).not.toMatch(/\bZ/); expect(laser.code).not.toMatch(/\bZ/);
  });
  it('calculates movement statistics from generated moves', () => {
    const result = generate(singlePath([{ x: 1, y: 1 }, { x: 10, y: 10 }]), settings, profiles[1]);
    const summary = statistics(result.moves);
    expect(summary.working).toBe(1); expect(summary.travels).toBe(1); expect(summary.total).toBeGreaterThan(summary.work); expect(summary.bounds?.maxX).toBe(100);
  });
  it('uses one-pass statistics for very large movement collections', () => {
    const count = 150_000;
    const moves: Move[] = [];
    for (let index = 0; index < count; index += 1) {
      moves.push({ command: index % 2 ? 'G1' : 'G0', from: { x: index, y: -index, z: index % 3 ? undefined : -1 }, to: { x: index + 1, y: -index - 1, z: index % 3 ? undefined : 0 }, working: Boolean(index % 2), feed: 60 });
    }
    const summary = statistics(moves);
    expect(summary.movementCount).toBe(count);
    expect(summary.working).toBe(count / 2);
    expect(summary.travels).toBe(count / 2);
    expect(summary.bounds).toMatchObject({ minX: 0, maxX: count, minY: -count, maxY: 0, minZ: -1, maxZ: 0 });
    expect(summary.total).toBeCloseTo(count / 3 * Math.sqrt(3) + count / 3 * 2 * Math.sqrt(2));
  });
  it('skips non-finite movement coordinates when calculating bounds', () => {
    const summary = statistics([{ command: 'G0', from: { x: Number.NaN, y: 0 }, to: { x: Infinity, y: 1 }, working: false, feed: 100 }]);
    expect(summary.bounds).toBeNull();
    expect(summary.total).toBe(0);
  });
});
