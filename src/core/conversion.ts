import type { GrayImage } from './image';
import type { ConversionMode, Path, Point, Settings, Toolpath } from './types';
import { distance, simplify } from './geometry';

const point = (x: number, y: number): Point => ({ x, y });
const pointKey = (value: Point) => `${value.x},${value.y}`;
export type ConversionSettings = Pick<Settings, 'lineSpacing' | 'outputHeight' | 'threshold' | 'serpentine' | 'simplify'>;

/**
 * Deterministic spatial sweep for independent paths. The previous nearest-neighbor
 * scan was O(n²) and dominated noisy contour jobs. Row buckets retain locality in
 * O(n log n), and open paths may still reverse to reduce the immediately preceding travel.
 */
export function orderPaths(paths: Path[]): Path[] {
  const rowSize = 32;
  const ordered = [...paths].sort((a, b) => {
    const aStart = a.points[0];
    const bStart = b.points[0];
    const aRow = Math.floor(aStart.y / rowSize);
    const bRow = Math.floor(bStart.y / rowSize);
    if (aRow !== bRow) return aRow - bRow;
    const direction = aRow % 2 ? -1 : 1;
    return direction * (aStart.x - bStart.x) || a.id.localeCompare(b.id);
  });
  let cursor = point(0, 0);
  return ordered.map((path) => {
    const first = path.points[0];
    const last = path.points[path.points.length - 1];
    const closed = first.x === last.x && first.y === last.y;
    if (!closed && distance(cursor, last) < distance(cursor, first)) {
      const points = [...path.points].reverse();
      cursor = points[points.length - 1];
      return { ...path, points };
    }
    cursor = last;
    return path;
  });
}

export function raster(image: GrayImage, settings: ConversionSettings, mode: ConversionMode = 'raster'): Toolpath {
  const paths: Path[] = [];
  const step = Math.max(1, Math.round(settings.lineSpacing / settings.outputHeight * image.height));
  let id = 0;
  for (let y = 0; y < image.height; y += step) {
    let run: Point[] = [];
    for (let x = 0; x < image.width; x += 1) {
      const intensity = image.data[y * image.width + x];
      if (intensity < settings.threshold || mode === 'grayscale') run.push(point(x, y));
      else if (run.length > 1) {
        paths.push({ id: `r${id++}`, points: run, kind: 'work', intensity: 255 - intensity });
        run = [];
      } else run = [];
    }
    if (run.length > 1) paths.push({ id: `r${id++}`, points: run, kind: 'work', intensity: 255 - image.data[y * image.width] });
  }
  const ordered = settings.serpentine
    ? paths.map((path, index) => index % 2 ? { ...path, points: [...path.points].reverse() } : path)
    : paths;
  return { paths: ordered, width: image.width, height: image.height, mode };
}

type Edge = { from: Point; to: Point };

/**
 * Traces binary-pixel boundaries as connected loops. Pixels contribute only their
 * exposed cell edges; joining matching edge endpoints produces actual contour geometry.
 */
export function contour(image: GrayImage, settings: ConversionSettings): Toolpath {
  const isDark = (x: number, y: number) => x >= 0 && y >= 0 && x < image.width && y < image.height
    && image.data[y * image.width + x] < settings.threshold;
  const outgoing = new Map<string, Edge[]>();
  const addEdge = (from: Point, to: Point) => {
    const edge = { from, to };
    const edges = outgoing.get(pointKey(from)) ?? [];
    edges.push(edge);
    outgoing.set(pointKey(from), edges);
  };

  for (let y = 0; y < image.height; y += 1) {
    for (let x = 0; x < image.width; x += 1) {
      if (!isDark(x, y)) continue;
      if (!isDark(x, y - 1)) addEdge(point(x, y), point(x + 1, y));
      if (!isDark(x + 1, y)) addEdge(point(x + 1, y), point(x + 1, y + 1));
      if (!isDark(x, y + 1)) addEdge(point(x + 1, y + 1), point(x, y + 1));
      if (!isDark(x - 1, y)) addEdge(point(x, y + 1), point(x, y));
    }
  }

  const takeNext = (from: Point): Edge | undefined => {
    const edges = outgoing.get(pointKey(from));
    if (!edges?.length) return undefined;
    edges.sort((a, b) => a.to.y - b.to.y || a.to.x - b.to.x);
    const edge = edges.shift();
    if (!edges.length) outgoing.delete(pointKey(from));
    return edge;
  };
  const paths: Path[] = [];
  let id = 0;
  while (outgoing.size) {
    const startKey = outgoing.keys().next().value;
    if (startKey === undefined) break;
    const [startX, startY] = startKey.split(',').map(Number);
    const first = takeNext(point(startX, startY));
    if (!first) continue;
    const loop = [first.from, first.to];
    while (pointKey(loop[loop.length - 1]) !== pointKey(loop[0])) {
      const next = takeNext(loop[loop.length - 1]);
      if (!next) break;
      loop.push(next.to);
    }
    if (loop.length > 3 && pointKey(loop[0]) === pointKey(loop[loop.length - 1])) {
      const openLoop = loop.slice(0, -1);
      const reduced = simplify(openLoop, Math.max(0.1, settings.simplify));
      const simplifiedPoints = reduced.length >= 3 ? reduced : openLoop;
      const closed = [...simplifiedPoints, simplifiedPoints[0]];
      if (closed.length > 3) paths.push({ id: `c${id++}`, points: closed, kind: 'work' });
    }
  }
  return { paths: orderPaths(paths), width: image.width, height: image.height, mode: 'contour' };
}

export const convert = (image: GrayImage, settings: ConversionSettings, mode: ConversionMode) =>
  mode === 'contour' ? contour(image, settings) : raster(image, settings, mode);
