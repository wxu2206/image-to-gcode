import type { GrayImage } from './image';
import type { ConversionMode, Path, Point, Settings, Toolpath } from './types';
import { distance, simplify } from './geometry';
import { detailInOutputUnits } from './detail';
import { optimizeToolpath } from './optimize';

const point = (x: number, y: number): Point => ({ x, y });
const rasterCoordinate = (index: number, size: number) => size === 1 ? 0.5 : index * size / (size - 1);
export type ConversionSettings = Pick<Settings, 'lineSpacing' | 'outputWidth' | 'outputHeight' | 'threshold' | 'serpentine' | 'simplify' | 'toolpathDetail' | 'units'>;
export type ConversionStage = 'extract' | 'order';
export type ConversionProgress = (stage: ConversionStage, completed: number, total: number) => void;

function assertConversionInput(image: GrayImage, settings: ConversionSettings): void {
  const pixels = image.width * image.height;
  if (!Number.isInteger(image.width) || !Number.isInteger(image.height) || image.width <= 0 || image.height <= 0 || !Number.isSafeInteger(pixels) || image.data.length !== pixels) {
    throw new Error('Processed image data does not match its dimensions.');
  }
  if (!Number.isFinite(settings.outputWidth) || !Number.isFinite(settings.outputHeight) || settings.outputWidth <= 0 || settings.outputHeight <= 0) {
    throw new Error('Output dimensions must be finite and greater than zero.');
  }
  if (!Number.isFinite(settings.lineSpacing) || settings.lineSpacing <= 0) throw new Error('Line spacing must be finite and greater than zero.');
  if (!Number.isFinite(settings.threshold) || settings.threshold < 0 || settings.threshold > 255) throw new Error('Threshold must be between 0 and 255.');
}

/**
 * Deterministic spatial sweep for independent paths. The previous nearest-neighbor
 * scan was O(n²) and dominated noisy contour jobs. Row buckets retain locality in
 * O(n log n), and open paths may still reverse to reduce the immediately preceding travel.
 */
export function orderPaths(paths: Path[], onProgress?: ConversionProgress): Path[] {
  const rowSize = 32;
  onProgress?.('order', 0, paths.length);
  const empty = paths.filter((path) => path.points.length === 0);
  const ordered = paths.filter((path) => path.points.length > 0).sort((a, b) => {
    const aStart = a.points[0];
    const bStart = b.points[0];
    const aRow = Math.floor(aStart.y / rowSize);
    const bRow = Math.floor(bStart.y / rowSize);
    if (aRow !== bRow) return aRow - bRow;
    const direction = aRow % 2 ? -1 : 1;
    const position = direction * (aStart.x - bStart.x);
    if (position) return position;
    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
  });
  let cursor = point(0, 0);
  const result: Path[] = new Array(paths.length);
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
  for (let index = 0; index < empty.length; index += 1) result[ordered.length + index] = empty[index];
  onProgress?.('order', paths.length, paths.length);
  return result;
}

export function raster(image: GrayImage, settings: ConversionSettings, mode: ConversionMode = 'raster', onProgress?: ConversionProgress): Toolpath {
  assertConversionInput(image, settings);
  const paths: Path[] = [];
  const step = Math.max(1, Math.round(settings.lineSpacing / settings.outputHeight * image.height));
  let id = 0;
  for (let y = 0, line = 0; y < image.height; y += step, line += 1) {
    const linePaths: Path[] = [];
    let run: Point[] = [];
    const pathY = rasterCoordinate(y, image.height);
    for (let x = 0; x < image.width; x += 1) {
      const intensity = image.data[y * image.width + x];
      if (intensity < settings.threshold || mode === 'grayscale') {
        const pathX = rasterCoordinate(x, image.width);
        run.push(mode === 'grayscale' ? { x: pathX, y: pathY, intensity: (255 - intensity) / 255 } : point(pathX, pathY));
      }
      else if (run.length > 1) {
        linePaths.push({ id: `r${id++}`, points: run, kind: 'work' });
        run = [];
      } else run = [];
    }
    if (run.length > 1) linePaths.push({ id: `r${id++}`, points: run, kind: 'work' });
    if (settings.serpentine && line % 2) {
      linePaths.reverse();
      for (const path of linePaths) path.points.reverse();
    }
    for (const path of linePaths) paths.push(path);
    if (line % 16 === 0) onProgress?.('extract', y, image.height);
  }
  onProgress?.('extract', image.height, image.height);
  onProgress?.('order', 0, paths.length);
  onProgress?.('order', paths.length, paths.length);
  return { paths, width: image.width, height: image.height, mode };
}

/**
 * Traces binary-pixel boundaries as connected loops. Pixels contribute only their
 * exposed cell edges; joining matching edge endpoints produces actual contour geometry.
 * Integer vertex keys avoid hundreds of thousands of short-lived Point objects and
 * string keys on dense images. At junctions we choose the same top-to-bottom,
 * left-to-right edge ordering as the original implementation.
 */
export function contour(image: GrayImage, settings: ConversionSettings, onProgress?: ConversionProgress): Toolpath {
  assertConversionInput(image, settings);
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
  return optimizeToolpath({ paths: orderPaths(paths, onProgress), width: image.width, height: image.height, mode: 'contour' }, settings).toolpath;
}

export const convert = (image: GrayImage, settings: ConversionSettings, mode: ConversionMode, onProgress?: ConversionProgress) => {
  const toolpath = mode === 'contour' ? contour(image, settings, onProgress) : raster(image, settings, mode, onProgress);
  return mode === 'contour' ? toolpath : optimizeToolpath(toolpath, settings).toolpath;
};
