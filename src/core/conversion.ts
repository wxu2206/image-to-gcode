import type { GrayImage } from './image';
import type { ConversionMode, Path, Point, Settings, Toolpath } from './types';
import { distance, simplify } from './geometry';
import { detailInOutputUnits } from './detail';

const point = (x: number, y: number): Point => ({ x, y });
export type ConversionSettings = Pick<Settings, 'lineSpacing' | 'outputWidth' | 'outputHeight' | 'threshold' | 'serpentine' | 'simplify' | 'toolpathDetail' | 'units'>;
export type ConversionStage = 'extract' | 'order';
export type ConversionProgress = (stage: ConversionStage, completed: number, total: number) => void;

/**
 * Deterministic spatial sweep for independent paths. The previous nearest-neighbor
 * scan was O(n²) and dominated noisy contour jobs. Row buckets retain locality in
 * O(n log n), and open paths may still reverse to reduce the immediately preceding travel.
 */
export function orderPaths(paths: Path[], onProgress?: ConversionProgress): Path[] {
  const rowSize = 32;
  onProgress?.('order', 0, paths.length);
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
  const result: Path[] = new Array(ordered.length);
  for (let index = 0; index < ordered.length; index += 1) {
    const path = ordered[index];
    const first = path.points[0];
    const last = path.points[path.points.length - 1];
    const closed = first.x === last.x && first.y === last.y;
    if (!closed && distance(cursor, last) < distance(cursor, first)) {
      const points = [...path.points].reverse();
      cursor = points[points.length - 1];
      result[index] = { ...path, points };
    } else {
      cursor = last;
      result[index] = path;
    }
    if (index % 1024 === 0) onProgress?.('order', index, ordered.length);
  }
  onProgress?.('order', ordered.length, ordered.length);
  return result;
}

export function raster(image: GrayImage, settings: ConversionSettings, mode: ConversionMode = 'raster', onProgress?: ConversionProgress): Toolpath {
  const paths: Path[] = [];
  const step = Math.max(1, Math.round(settings.lineSpacing / settings.outputHeight * image.height));
  let id = 0;
  for (let y = 0, line = 0; y < image.height; y += step, line += 1) {
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
    if (line % 16 === 0) onProgress?.('extract', y, image.height);
  }
  onProgress?.('extract', image.height, image.height);
  onProgress?.('order', 0, paths.length);
  const ordered = settings.serpentine
    ? paths.map((path, index) => {
      if (index % 1024 === 0) onProgress?.('order', index, paths.length);
      return index % 2 ? { ...path, points: [...path.points].reverse() } : path;
    })
    : paths;
  onProgress?.('order', paths.length, paths.length);
  return { paths: ordered, width: image.width, height: image.height, mode };
}

/**
 * Traces binary-pixel boundaries as connected loops. Pixels contribute only their
 * exposed cell edges; joining matching edge endpoints produces actual contour geometry.
 * Integer vertex keys avoid hundreds of thousands of short-lived Point objects and
 * string keys on dense images. At junctions we choose the same top-to-bottom,
 * left-to-right edge ordering as the original implementation.
 */
export function contour(image: GrayImage, settings: ConversionSettings, onProgress?: ConversionProgress): Toolpath {
  const stride = image.width + 1;
  const outgoing = new Map<number, number[]>();
  let edgeCount = 0;
  const vertex = (x: number, y: number) => y * stride + x;
  const addEdge = (from: number, to: number) => {
    const edges = outgoing.get(from);
    if (edges) edges.push(to);
    else outgoing.set(from, [to]);
    edgeCount += 1;
  };

  for (let y = 0; y < image.height; y += 1) {
    for (let x = 0; x < image.width; x += 1) {
      const index = y * image.width + x;
      if (image.data[index] >= settings.threshold) continue;
      if (y === 0 || image.data[index - image.width] >= settings.threshold) addEdge(vertex(x, y), vertex(x + 1, y));
      if (x === image.width - 1 || image.data[index + 1] >= settings.threshold) addEdge(vertex(x + 1, y), vertex(x + 1, y + 1));
      if (y === image.height - 1 || image.data[index + image.width] >= settings.threshold) addEdge(vertex(x + 1, y + 1), vertex(x, y + 1));
      if (x === 0 || image.data[index - 1] >= settings.threshold) addEdge(vertex(x, y + 1), vertex(x, y));
    }
    if (y % 8 === 0) onProgress?.('extract', y, image.height * 2);
  }

  const takeNext = (from: number): number | undefined => {
    const edges = outgoing.get(from);
    if (!edges?.length) return undefined;
    let nextIndex = 0;
    for (let index = 1; index < edges.length; index += 1) if (edges[index] < edges[nextIndex]) nextIndex = index;
    const next = edges[nextIndex];
    edges[nextIndex] = edges[edges.length - 1];
    edges.pop();
    if (!edges.length) outgoing.delete(from);
    return next;
  };
  const paths: Path[] = [];
  let id = 0;
  let traced = 0;
  while (outgoing.size) {
    const start = outgoing.keys().next().value as number | undefined;
    if (start === undefined) break;
    const first = takeNext(start);
    if (first === undefined) continue;
    const loop = [start, first];
    traced += 1;
    while (loop[loop.length - 1] !== loop[0]) {
      const next = takeNext(loop[loop.length - 1]);
      if (next === undefined) break;
      loop.push(next);
      traced += 1;
      if (traced % 2048 === 0) onProgress?.('extract', image.height + traced, image.height + edgeCount);
    }
    if (loop.length > 3 && loop[0] === loop[loop.length - 1]) {
      const openLoop = loop.slice(0, -1).map((key) => point(key % stride, Math.floor(key / stride)));
      // Contours are simplified in output coordinates so Toolpath Detail always
      // represents a physical tolerance, independent of input pixel density.
      const outputLoop = openLoop.map((item) => point(item.x / image.width * settings.outputWidth, item.y / image.height * settings.outputHeight));
      const legacyTolerance = settings.simplify * Math.max(settings.outputWidth / image.width, settings.outputHeight / image.height);
      const reduced = simplify(outputLoop, Math.max(detailInOutputUnits(settings), legacyTolerance));
      const simplifiedPoints = (reduced.length >= 3 ? reduced : outputLoop)
        .map((item) => point(item.x / settings.outputWidth * image.width, item.y / settings.outputHeight * image.height));
      const closed = [...simplifiedPoints, simplifiedPoints[0]];
      if (closed.length > 3) paths.push({ id: `c${id++}`, points: closed, kind: 'work' });
    }
  }
  onProgress?.('extract', image.height + edgeCount, image.height + edgeCount);
  return { paths: orderPaths(paths, onProgress), width: image.width, height: image.height, mode: 'contour' };
}

export const convert = (image: GrayImage, settings: ConversionSettings, mode: ConversionMode, onProgress?: ConversionProgress) =>
  mode === 'contour' ? contour(image, settings, onProgress) : raster(image, settings, mode, onProgress);
