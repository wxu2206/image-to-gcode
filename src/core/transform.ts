import type { Point, Settings } from './types';
import { machinePoint } from './geometry';

/**
 * Placement is intentionally represented by Settings.outputWidth/outputHeight,
 * Settings.offsetX/offsetY, and Settings.rotationDeg.  This view type documents
 * that single persistent model without creating a second source of truth.
 */
export type ImageTransform = { x: number; y: number; width: number; height: number; rotationDeg: number };
export type Bounds = { minX: number; maxX: number; minY: number; maxY: number };

export const normalizeRotation = (degrees: number) => {
  if (!Number.isFinite(degrees)) return 0;
  const normalized = ((degrees + 180) % 360 + 360) % 360 - 180;
  return normalized === -180 ? 180 : normalized;
};

function rotationComponents(degrees: number) {
  const radians = normalizeRotation(degrees) * Math.PI / 180;
  const snap = (value: number) => Math.abs(value) < 1e-15 ? 0 : value;
  return { cosine: snap(Math.cos(radians)), sine: snap(Math.sin(radians)) };
}

export const imageTransform = (settings: Pick<Settings, 'offsetX' | 'offsetY' | 'outputWidth' | 'outputHeight' | 'rotationDeg'>): ImageTransform => ({
  x: settings.offsetX, y: settings.offsetY, width: settings.outputWidth, height: settings.outputHeight, rotationDeg: normalizeRotation(settings.rotationDeg),
});

export function rotateAroundImageCenter(point: Point, settings: Pick<Settings, 'outputWidth' | 'outputHeight' | 'rotationDeg'>): Point {
  const rotation = normalizeRotation(settings.rotationDeg);
  if (rotation === 0) return { ...point };
  const centerX = settings.outputWidth / 2;
  const centerY = settings.outputHeight / 2;
  const dx = point.x - centerX;
  const dy = point.y - centerY;
  const { cosine, sine } = rotationComponents(rotation);
  return { ...point, x: centerX + dx * cosine - dy * sine, y: centerY + dx * sine + dy * cosine };
}

export function rotatedDimensions(width: number, height: number, rotationDeg: number) {
  const components = rotationComponents(rotationDeg);
  const cosine = Math.abs(components.cosine);
  const sine = Math.abs(components.sine);
  return { width: width * cosine + height * sine, height: width * sine + height * cosine };
}

export function transformedBounds(settings: Settings): Bounds {
  const corners = [
    { x: 0, y: 0 }, { x: settings.outputWidth, y: 0 },
    { x: settings.outputWidth, y: settings.outputHeight }, { x: 0, y: settings.outputHeight },
  ];
  let minX = Infinity; let maxX = -Infinity; let minY = Infinity; let maxY = -Infinity;
  for (const corner of corners) {
    const mapped = machinePoint(corner, settings);
    minX = Math.min(minX, mapped.x); maxX = Math.max(maxX, mapped.x);
    minY = Math.min(minY, mapped.y); maxY = Math.max(maxY, mapped.y);
  }
  return { minX, maxX, minY, maxY };
}

export function centerTransform(settings: Settings): Pick<Settings, 'offsetX' | 'offsetY'> {
  const bounds = transformedBounds(settings);
  return { offsetX: settings.offsetX + settings.workWidth / 2 - (bounds.minX + bounds.maxX) / 2, offsetY: settings.offsetY + settings.workHeight / 2 - (bounds.minY + bounds.maxY) / 2 };
}

export function fitTransformToWorkArea(settings: Settings, aspectRatio: number, margin = .015): Pick<Settings, 'outputWidth' | 'outputHeight' | 'offsetX' | 'offsetY'> {
  const ratio = Number.isFinite(aspectRatio) && aspectRatio > 0 ? aspectRatio : settings.outputWidth / settings.outputHeight;
  const components = rotationComponents(settings.rotationDeg);
  const cosine = Math.abs(components.cosine);
  const sine = Math.abs(components.sine);
  const availableWidth = settings.workWidth * (1 - margin * 2);
  const availableHeight = settings.workHeight * (1 - margin * 2);
  const height = Math.min(availableWidth / (ratio * cosine + sine), availableHeight / (ratio * sine + cosine));
  const resized = { ...settings, outputWidth: height * ratio, outputHeight: height };
  return { outputWidth: resized.outputWidth, outputHeight: resized.outputHeight, ...centerTransform(resized) };
}
