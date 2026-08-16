import type { Path, Point, Settings, Toolpath } from '../core/types';
import { toMillimetres } from '../core/units';
import { transformVectorPoint } from './affine';
import { SVG_LIMITS, type AffineMatrix, type VectorDocument, type VectorPath, type VectorPoint, type VectorSegment } from './model';

export type ArcCenter = { cx: number; cy: number; rx: number; ry: number; rotation: number; startAngle: number; deltaAngle: number };
export type VectorFlattenProgress = (completed: number, total: number) => void;
export type FlattenedVector = { toolpath: Toolpath; flattenedPoints: number };

const finitePoint = (value: VectorPoint) => Number.isFinite(value.x) && Number.isFinite(value.y);
const vector = (x: number, y: number): VectorPoint => ({ x, y });
const midpoint = (a: VectorPoint, b: VectorPoint) => vector((a.x + b.x) / 2, (a.y + b.y) / 2);

function vectorAngle(ux: number, uy: number, vx: number, vy: number): number {
  const denominator = Math.hypot(ux, uy) * Math.hypot(vx, vy);
  if (!denominator) return 0;
  const cosine = Math.max(-1, Math.min(1, (ux * vx + uy * vy) / denominator));
  const angle = Math.acos(cosine);
  return ux * vy - uy * vx < 0 ? -angle : angle;
}

/** SVG endpoint-parameterized arc converted to its exact center representation. */
export function arcToCenter(segment: Extract<VectorSegment, { type: 'arc' }>): ArcCenter | null {
  if (segment.rx <= 0 || segment.ry <= 0 || !finitePoint(segment.from) || !finitePoint(segment.to)) return null;
  if (segment.from.x === segment.to.x && segment.from.y === segment.to.y) return null;
  const rotation = ((segment.rotation % 360) + 360) % 360 * Math.PI / 180;
  const cos = Math.cos(rotation); const sin = Math.sin(rotation);
  const halfX = (segment.from.x - segment.to.x) / 2;
  const halfY = (segment.from.y - segment.to.y) / 2;
  const xPrime = cos * halfX + sin * halfY;
  const yPrime = -sin * halfX + cos * halfY;
  let rx = Math.abs(segment.rx); let ry = Math.abs(segment.ry);
  const radiusScale = xPrime * xPrime / (rx * rx) + yPrime * yPrime / (ry * ry);
  if (radiusScale > 1) { const scale = Math.sqrt(radiusScale); rx *= scale; ry *= scale; }
  const numerator = Math.max(0, rx * rx * ry * ry - rx * rx * yPrime * yPrime - ry * ry * xPrime * xPrime);
  const denominator = rx * rx * yPrime * yPrime + ry * ry * xPrime * xPrime;
  const sign = segment.largeArc === segment.sweep ? -1 : 1;
  const coefficient = denominator > 0 ? sign * Math.sqrt(numerator / denominator) : 0;
  const centerPrimeX = coefficient * rx * yPrime / ry;
  const centerPrimeY = coefficient * -ry * xPrime / rx;
  const cx = cos * centerPrimeX - sin * centerPrimeY + (segment.from.x + segment.to.x) / 2;
  const cy = sin * centerPrimeX + cos * centerPrimeY + (segment.from.y + segment.to.y) / 2;
  const ux = (xPrime - centerPrimeX) / rx; const uy = (yPrime - centerPrimeY) / ry;
  const vx = (-xPrime - centerPrimeX) / rx; const vy = (-yPrime - centerPrimeY) / ry;
  const startAngle = vectorAngle(1, 0, ux, uy);
  let deltaAngle = vectorAngle(ux, uy, vx, vy);
  if (!segment.sweep && deltaAngle > 0) deltaAngle -= Math.PI * 2;
  if (segment.sweep && deltaAngle < 0) deltaAngle += Math.PI * 2;
  return { cx, cy, rx, ry, rotation, startAngle, deltaAngle };
}

export function pointOnArc(arc: ArcCenter, unit: number): VectorPoint {
  const angle = arc.startAngle + arc.deltaAngle * unit;
  const x = arc.rx * Math.cos(angle); const y = arc.ry * Math.sin(angle);
  const cos = Math.cos(arc.rotation); const sin = Math.sin(arc.rotation);
  return { x: arc.cx + cos * x - sin * y, y: arc.cy + sin * x + cos * y };
}

function distanceToLine(pointValue: VectorPoint, from: VectorPoint, to: VectorPoint): number {
  const dx = to.x - from.x; const dy = to.y - from.y;
  const length = Math.hypot(dx, dy);
  if (!length) return Math.hypot(pointValue.x - from.x, pointValue.y - from.y);
  return Math.abs(dy * pointValue.x - dx * pointValue.y + to.x * from.y - to.y * from.x) / length;
}

function assertVectorDocument(document: VectorDocument): void {
  if (!Number.isFinite(document.width) || !Number.isFinite(document.height) || document.width <= 0 || document.height <= 0) throw new Error('SVG vector dimensions are invalid.');
  if (!Number.isInteger(document.nodeCount) || document.nodeCount < 1 || document.nodeCount > SVG_LIMITS.maxNodes
    || !Number.isInteger(document.segmentCount) || document.segmentCount < 0 || document.segmentCount > SVG_LIMITS.maxSegments
    || !Array.isArray(document.paths) || document.paths.length > SVG_LIMITS.maxNodes
    || !Array.isArray(document.warnings) || document.warnings.length > 101
    || document.warnings.some((warning) => typeof warning !== 'string' || warning.length > 1_024)) throw new Error('SVG vector model exceeds safe complexity limits.');
  let segments = 0;
  const identifiers = new Set<string>();
  for (const path of document.paths) {
    if (typeof path.id !== 'string' || path.id.length > 256 || typeof path.closed !== 'boolean'
      || !Array.isArray(path.segments) || !Array.isArray(path.transform) || path.transform.length !== 6 || !path.transform.every(Number.isFinite)
      || (path.strokeWidth !== undefined && (!Number.isFinite(path.strokeWidth) || path.strokeWidth < 0))) throw new Error('SVG vector path is malformed.');
    if (identifiers.has(path.id)) throw new Error('SVG vector path identifiers are not unique.');
    identifiers.add(path.id);
    let previous: VectorPoint | null = null;
    for (const segment of path.segments) {
      segments += 1;
      if (!segment || !['line', 'quadratic', 'cubic', 'arc'].includes(segment.type)) throw new Error('SVG vector segment type is invalid.');
      if (!finitePoint(segment.from) || !finitePoint(segment.to)) throw new Error('SVG vector segment contains non-finite coordinates.');
      if (previous && (previous.x !== segment.from.x || previous.y !== segment.from.y)) throw new Error('SVG vector path contains discontinuous segments.');
      if (segment.type === 'quadratic' && !finitePoint(segment.control)) throw new Error('SVG quadratic control point is invalid.');
      if (segment.type === 'cubic' && (!finitePoint(segment.control1) || !finitePoint(segment.control2))) throw new Error('SVG cubic control point is invalid.');
      if (segment.type === 'arc' && (![segment.rx, segment.ry, segment.rotation].every(Number.isFinite) || segment.rx <= 0 || segment.ry <= 0)) throw new Error('SVG arc parameters are invalid.');
      previous = segment.to;
    }
    if (path.closed && path.segments.length && (path.segments[0].from.x !== previous!.x || path.segments[0].from.y !== previous!.y)) throw new Error('Closed SVG vector path does not preserve closure.');
  }
  if (segments !== document.segmentCount || segments > SVG_LIMITS.maxSegments) throw new Error('SVG vector segment metadata is inconsistent.');
}

function physicalPoint(matrix: AffineMatrix, source: VectorPoint, scaleX: number, scaleY: number): VectorPoint {
  const transformed = transformVectorPoint(matrix, source);
  const physical = { x: transformed.x * scaleX, y: transformed.y * scaleY };
  if (!finitePoint(physical)) throw new Error('SVG transforms produce non-finite physical coordinates.');
  return physical;
}

function flattenPath(path: VectorPath, scaleX: number, scaleY: number, tolerance: number, addPoint: (value: VectorPoint) => void): Point[] {
  if (!path.segments.length) return [];
  const output: Point[] = [];
  const append = (value: VectorPoint) => {
    const transformed = transformVectorPoint(path.transform, value);
    if (!finitePoint(transformed)) throw new Error('SVG transforms produce non-finite coordinates.');
    const previous = output[output.length - 1];
    if (!previous || previous.x !== transformed.x || previous.y !== transformed.y) {
      addPoint(transformed);
      output.push(transformed);
    }
  };
  append(path.segments[0].from);
  for (const segment of path.segments) {
    if (segment.type === 'line') { append(segment.to); continue; }
    if (segment.type === 'quadratic') {
      type Quadratic = { p0: VectorPoint; p1: VectorPoint; p2: VectorPoint; depth: number };
      const stack: Quadratic[] = [{ p0: segment.from, p1: segment.control, p2: segment.to, depth: 0 }];
      while (stack.length) {
        const curve = stack.pop()!;
        const p0 = physicalPoint(path.transform, curve.p0, scaleX, scaleY);
        const p1 = physicalPoint(path.transform, curve.p1, scaleX, scaleY);
        const p2 = physicalPoint(path.transform, curve.p2, scaleX, scaleY);
        if (distanceToLine(p1, p0, p2) <= tolerance || curve.depth >= 24) append(curve.p2);
        else {
          const a = midpoint(curve.p0, curve.p1); const b = midpoint(curve.p1, curve.p2); const center = midpoint(a, b);
          stack.push({ p0: center, p1: b, p2: curve.p2, depth: curve.depth + 1 }, { p0: curve.p0, p1: a, p2: center, depth: curve.depth + 1 });
        }
      }
      continue;
    }
    if (segment.type === 'cubic') {
      type Cubic = { p0: VectorPoint; p1: VectorPoint; p2: VectorPoint; p3: VectorPoint; depth: number };
      const stack: Cubic[] = [{ p0: segment.from, p1: segment.control1, p2: segment.control2, p3: segment.to, depth: 0 }];
      while (stack.length) {
        const curve = stack.pop()!;
        const p0 = physicalPoint(path.transform, curve.p0, scaleX, scaleY);
        const p1 = physicalPoint(path.transform, curve.p1, scaleX, scaleY);
        const p2 = physicalPoint(path.transform, curve.p2, scaleX, scaleY);
        const p3 = physicalPoint(path.transform, curve.p3, scaleX, scaleY);
        if (Math.max(distanceToLine(p1, p0, p3), distanceToLine(p2, p0, p3)) <= tolerance || curve.depth >= 24) append(curve.p3);
        else {
          const a = midpoint(curve.p0, curve.p1); const b = midpoint(curve.p1, curve.p2); const c = midpoint(curve.p2, curve.p3);
          const d = midpoint(a, b); const e = midpoint(b, c); const center = midpoint(d, e);
          stack.push({ p0: center, p1: e, p2: c, p3: curve.p3, depth: curve.depth + 1 }, { p0: curve.p0, p1: a, p2: d, p3: center, depth: curve.depth + 1 });
        }
      }
      continue;
    }
    const arc = arcToCenter(segment);
    if (!arc) { append(segment.to); continue; }
    type ArcRange = { from: number; to: number; fromPoint: VectorPoint; toPoint: VectorPoint; depth: number };
    const ranges: ArcRange[] = [{ from: 0, to: 1, fromPoint: segment.from, toPoint: segment.to, depth: 0 }];
    while (ranges.length) {
      const range = ranges.pop()!;
      const middle = (range.from + range.to) / 2;
      const middlePoint = pointOnArc(arc, middle);
      const physicalFrom = physicalPoint(path.transform, range.fromPoint, scaleX, scaleY);
      const physicalTo = physicalPoint(path.transform, range.toPoint, scaleX, scaleY);
      const physicalMiddle = physicalPoint(path.transform, middlePoint, scaleX, scaleY);
      if (distanceToLine(physicalMiddle, physicalFrom, physicalTo) <= tolerance || range.depth >= 24) append(range.toPoint);
      else {
        ranges.push(
          { from: middle, to: range.to, fromPoint: middlePoint, toPoint: range.toPoint, depth: range.depth + 1 },
          { from: range.from, to: middle, fromPoint: range.fromPoint, toPoint: middlePoint, depth: range.depth + 1 },
        );
      }
    }
  }
  if (path.closed && output.length > 2) {
    const first = output[0]; const last = output[output.length - 1];
    if (first.x !== last.x || first.y !== last.y) { addPoint(first); output.push(first); }
  }
  return output;
}

/** Converts vector curves to the existing source-space Toolpath using physical millimetre error tolerance. */
export function flattenVectorDocument(document: VectorDocument, settings: Pick<Settings, 'outputWidth' | 'outputHeight' | 'toolpathDetail' | 'units'>, onProgress?: VectorFlattenProgress): FlattenedVector {
  assertVectorDocument(document);
  const widthMm = toMillimetres(settings.outputWidth, settings.units);
  const heightMm = toMillimetres(settings.outputHeight, settings.units);
  const tolerance = Math.max(0.001, settings.toolpathDetail);
  if (![widthMm, heightMm, tolerance].every(Number.isFinite) || widthMm <= 0 || heightMm <= 0) throw new Error('SVG physical output dimensions and detail must be finite and positive.');
  const scaleX = widthMm / document.width; const scaleY = heightMm / document.height;
  let flattenedPoints = 0;
  const addPoint = () => {
    flattenedPoints += 1;
    if (flattenedPoints > SVG_LIMITS.maxFlattenedPoints) throw new Error('SVG flattening would exceed 1,000,000 points. Increase Toolpath Detail or simplify the SVG.');
  };
  const paths: Path[] = [];
  for (let index = 0; index < document.paths.length; index += 1) {
    const source = document.paths[index];
    const points = flattenPath(source, scaleX, scaleY, tolerance, addPoint);
    if (points.length > 1) paths.push({ id: source.id, points, kind: 'work' });
    if (index % 128 === 0) onProgress?.(index, document.paths.length);
  }
  onProgress?.(document.paths.length, document.paths.length);
  if (!paths.length) throw new Error('SVG flattening produced no usable vector paths.');
  return { toolpath: { paths, width: document.width, height: document.height, mode: 'vector' }, flattenedPoints };
}
