import { describe, expect, it } from 'vitest';
import { centerTransform, fitTransformToWorkArea, normalizeRotation, rotateAroundImageCenter, rotatedDimensions, transformedBounds } from './transform';
import { defaults } from './machine';

describe('image placement transform', () => {
  const settings = { ...defaults, workWidth: 300, workHeight: 200, outputWidth: 120, outputHeight: 60, offsetX: 0, offsetY: 0 };
  it('rotates around the physical image center', () => {
    const rotated = rotateAroundImageCenter({ x: 0, y: 0 }, { ...settings, rotationDeg: 90 });
    expect(rotated.x).toBeCloseTo(90); expect(rotated.y).toBeCloseTo(-30);
    const dimensions = rotatedDimensions(120, 60, 90);
    expect(dimensions.width).toBeCloseTo(60); expect(dimensions.height).toBeCloseTo(120);
    expect(normalizeRotation(270)).toBe(-90);
  });
  it('centers and fits rotated geometry inside the work area', () => {
    const centered = { ...settings, rotationDeg: 30, ...centerTransform({ ...settings, rotationDeg: 30 }) };
    const bounds = transformedBounds(centered);
    expect((bounds.minX + bounds.maxX) / 2).toBeCloseTo(150);
    expect((bounds.minY + bounds.maxY) / 2).toBeCloseTo(100);
    const fitted = { ...settings, rotationDeg: 90, ...fitTransformToWorkArea({ ...settings, rotationDeg: 90 }, 2) };
    const fitBounds = transformedBounds(fitted);
    expect(fitBounds.minX).toBeGreaterThanOrEqual(0);
    expect(fitBounds.maxX).toBeLessThanOrEqual(300);
    expect(fitBounds.minY).toBeGreaterThanOrEqual(0);
    expect(fitBounds.maxY).toBeLessThanOrEqual(200);
  });
  it('fits extreme aspect ratios across arbitrary positive and negative rotations', () => {
    for (const aspectRatio of [0.05, 0.2, 1, 5, 20]) {
      for (const rotationDeg of [-179, -91, -33, 17, 89, 143]) {
        const source = { ...settings, rotationDeg };
        const fitted = { ...source, ...fitTransformToWorkArea(source, aspectRatio) };
        const bounds = transformedBounds(fitted);
        expect(bounds.minX).toBeGreaterThanOrEqual(-1e-10);
        expect(bounds.minY).toBeGreaterThanOrEqual(-1e-10);
        expect(bounds.maxX).toBeLessThanOrEqual(source.workWidth + 1e-10);
        expect(bounds.maxY).toBeLessThanOrEqual(source.workHeight + 1e-10);
      }
    }
  });
});
