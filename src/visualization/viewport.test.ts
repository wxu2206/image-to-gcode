import { describe, expect, it } from 'vitest';
import { clampZoom, fitViewport, zoomAtCursor } from './viewport';

describe('preview viewport math', () => {
  it('keeps the cursor world coordinate fixed while zooming', () => {
    const canvas = { width: 1100, height: 700 };
    const work = { width: 300, height: 200 };
    const cursor = { x: 340, y: 210 };
    const next = zoomAtCursor({ zoom: 1, pan: { x: 0, y: 0 } }, cursor, 1.5, canvas, work);
    const base = Math.min((canvas.width - 40) / work.width, (canvas.height - 40) / work.height);
    const before = { x: (cursor.x - (canvas.width - work.width * base) / 2) / base, y: (cursor.y - (canvas.height - work.height * base) / 2) / base };
    const scale = base * next.zoom;
    const after = { x: (cursor.x - ((canvas.width - work.width * scale) / 2 + next.pan.x)) / scale, y: (cursor.y - ((canvas.height - work.height * scale) / 2 + next.pan.y)) / scale };
    expect(after.x).toBeCloseTo(before.x); expect(after.y).toBeCloseTo(before.y);
  });
  it('clamps zoom and fits bounds inside the viewport', () => {
    expect(clampZoom(-2)).toBe(.1); expect(clampZoom(200)).toBe(20);
    const canvas = { width: 1100, height: 700 };
    const work = { width: 300, height: 200 };
    const bounds = { minX: 20, maxX: 170, minY: 10, maxY: 110 };
    const view = fitViewport(bounds, canvas, work);
    expect(view.zoom).toBeGreaterThan(1); expect(Number.isFinite(view.pan.x)).toBe(true);
    const scale = Math.min((canvas.width - 40) / work.width, (canvas.height - 40) / work.height) * view.zoom;
    const originX = (canvas.width - work.width * scale) / 2 + view.pan.x;
    const originY = (canvas.height - work.height * scale) / 2 + view.pan.y;
    expect(originX + bounds.minX * scale).toBeGreaterThanOrEqual(28);
    expect(originX + bounds.maxX * scale).toBeLessThanOrEqual(canvas.width - 28 + .001);
    expect(originY + (work.height - bounds.maxY) * scale).toBeGreaterThanOrEqual(28);
    expect(originY + (work.height - bounds.minY) * scale).toBeLessThanOrEqual(canvas.height - 28 + .001);
    expect(fitViewport({ minX: 2, maxX: 2, minY: 5, maxY: 9 }, canvas, work)).toEqual({ zoom: 1, pan: { x: 0, y: 0 } });
  });
});
