import { describe, expect, it } from 'vitest';
import { defaults } from '../core/machine';
import { optimizeToolpath } from '../core/optimize';
import { transformVectorPoint } from './affine';
import { arcToCenter, flattenVectorDocument, pointOnArc } from './flatten';
import type { VectorDocument, VectorPath, VectorPoint, VectorSegment } from './model';
import { parseSvgText } from './parseSvg';

const source = (body: string, width = 100, height = 100) => parseSvgText(`<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" fill="none" stroke="black">${body}</svg>`);
const settings = { ...defaults, outputWidth: 100, outputHeight: 100, toolpathDetail: 0.1 };

function distanceToSegment(point: VectorPoint, from: VectorPoint, to: VectorPoint): number {
  const dx = to.x - from.x; const dy = to.y - from.y;
  const squared = dx * dx + dy * dy;
  const unit = squared ? Math.max(0, Math.min(1, ((point.x - from.x) * dx + (point.y - from.y) * dy) / squared)) : 0;
  return Math.hypot(point.x - (from.x + unit * dx), point.y - (from.y + unit * dy));
}

describe('physical SVG curve flattening', () => {
  it('preserves exact endpoints and produces no duplicate closure point beyond one', () => {
    const document = source('<path d="M0 0 C20 80 80 80 100 0"/><circle cx="50" cy="50" r="20"/>');
    const result = flattenVectorDocument(document, settings);
    expect(result.toolpath.paths[0].points[0]).toEqual({ x: 0, y: 0 });
    expect(result.toolpath.paths[0].points[result.toolpath.paths[0].points.length - 1]).toEqual({ x: 100, y: 0 });
    const circle = result.toolpath.paths[1].points;
    expect(circle[0]).toEqual(circle[circle.length - 1]);
    expect(circle.slice(1, -1)).not.toContainEqual(circle[0]);
  });

  it('uses finer detail to create at least as many points deterministically', () => {
    const document = source('<path d="M0 50 C10 0 90 100 100 50"/><ellipse cx="50" cy="50" rx="40" ry="15"/>');
    const counts = [0.5, 0.1, 0.05, 0.025].map((toolpathDetail) => flattenVectorDocument(document, { ...settings, toolpathDetail }).flattenedPoints);
    expect(counts[1]).toBeGreaterThanOrEqual(counts[0]);
    expect(counts[2]).toBeGreaterThanOrEqual(counts[1]);
    expect(counts[3]).toBeGreaterThanOrEqual(counts[2]);
    expect(flattenVectorDocument(document, { ...settings, toolpathDetail: 0.05 })).toEqual(flattenVectorDocument(document, { ...settings, toolpathDetail: 0.05 }));
  });

  it('keeps sampled quadratic geometry within the physical tolerance', () => {
    const document = source('<path d="M0 0 Q50 100 100 0"/>');
    const tolerance = 0.1;
    const points = flattenVectorDocument(document, { ...settings, toolpathDetail: tolerance }).toolpath.paths[0].points;
    let maximum = 0;
    for (let sample = 0; sample <= 1_000; sample += 1) {
      const t = sample / 1_000;
      const curve = { x: 100 * t, y: 200 * (1 - t) * t };
      let nearest = Infinity;
      for (let index = 1; index < points.length; index += 1) nearest = Math.min(nearest, distanceToSegment(curve, points[index - 1], points[index]));
      maximum = Math.max(maximum, nearest);
    }
    expect(maximum).toBeLessThanOrEqual(tolerance);
  });

  it('physical output scale changes curve density while line geometry remains exact', () => {
    const document = source('<path d="M0 0 Q50 100 100 0"/>');
    const small = flattenVectorDocument(document, { ...settings, outputWidth: 20, outputHeight: 20 }).flattenedPoints;
    const large = flattenVectorDocument(document, { ...settings, outputWidth: 200, outputHeight: 200 }).flattenedPoints;
    expect(large).toBeGreaterThan(small);
    expect(flattenVectorDocument(source('<line x1="2" y1="3" x2="80" y2="90"/>'), settings).toolpath.paths[0].points).toEqual([{ x: 2, y: 3 }, { x: 80, y: 90 }]);
  });

  it('applies translation and rotation before physical error measurement', () => {
    const plain = source('<path d="M10 10 Q50 90 90 10"/>');
    const moved = source('<path transform="translate(100 20) rotate(90)" d="M10 10 Q50 90 90 10"/>', 250, 250);
    const a = flattenVectorDocument(plain, settings).toolpath.paths[0].points;
    const b = flattenVectorDocument(moved, { ...settings, outputWidth: 250, outputHeight: 250 }).toolpath.paths[0].points;
    expect(b.length).toBe(a.length);
    const matrix = moved.paths[0].transform;
    expect(b[0].x).toBeCloseTo(transformVectorPoint(matrix, a[0]).x);
    expect(b[0].y).toBeCloseTo(transformVectorPoint(matrix, a[0]).y);
  });

  it('converts SVG arcs accurately and respects sweep direction', () => {
    const segment: Extract<VectorSegment, { type: 'arc' }> = { type: 'arc', from: { x: 0, y: 0 }, to: { x: 10, y: 0 }, rx: 5, ry: 3, rotation: 0, largeArc: false, sweep: true };
    const arc = arcToCenter(segment)!;
    expect(pointOnArc(arc, 0)).toMatchObject({ x: expect.closeTo(0, 8), y: expect.closeTo(0, 8) });
    expect(pointOnArc(arc, 1)).toMatchObject({ x: expect.closeTo(10, 8), y: expect.closeTo(0, 8) });
    expect(Math.abs(arc.deltaAngle)).toBeCloseTo(Math.PI);
  });

  it('rejects malformed worker-side vector models defensively', () => {
    const path: VectorPath = { id: 'bad', closed: false, transform: [1, 0, 0, 1, 0, 0], segments: [{ type: 'line', from: { x: 0, y: 0 }, to: { x: Number.NaN, y: 1 } }] };
    const malformed: VectorDocument = { width: 10, height: 10, paths: [path], warnings: [], nodeCount: 1, segmentCount: 1 };
    expect(() => flattenVectorDocument(malformed, settings)).toThrow(/non-finite/i);
    expect(() => flattenVectorDocument({ ...malformed, paths: [], segmentCount: 1 }, settings)).toThrow(/metadata|usable|inconsistent/i);
    expect(() => flattenVectorDocument({ ...malformed, paths: [{ ...path, segments: [{ type: 'unknown' } as never] }] }, settings)).toThrow(/segment type/i);
  });

  it('feeds flattened paths into deterministic optimization without opening closed loops', () => {
    const flattened = flattenVectorDocument(source('<polygon points="20,20 30,20 25,30"/><path d="M80 80L90 90"/>'), settings).toolpath;
    const result = optimizeToolpath(flattened, settings).toolpath;
    const loop = result.paths.find((path) => path.id === flattened.paths[0].id)!;
    expect(loop.points[0]).toEqual(loop.points[loop.points.length - 1]);
    expect(optimizeToolpath(flattened, settings).toolpath).toEqual(result);
  });
});
