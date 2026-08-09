import type { GrayImage } from './image';
import type { ConversionMode, Path, Point, Settings, Toolpath } from './types';
import { distance, simplify } from './geometry';

const point = (x: number, y: number): Point => ({ x, y });
const pointKey = (value: Point) => `${value.x},${value.y}`;

/** Reorders independent paths to reduce travel without changing their geometry. */
export function orderPaths(paths: Path[]): Path[] {
  const remaining = paths.map((path) => ({ ...path, points: [...path.points] }));
  const ordered: Path[] = [];
  let cursor = point(0, 0);

  while (remaining.length) {
    const choice = remaining
      .map((path, index) => {
        const first = path.points[0];
        const last = path.points[path.points.length - 1];
        const closed = first.x === last.x && first.y === last.y;
        const reverse = !closed
          && distance(cursor, last) < distance(cursor, first);
        const start = reverse ? last : first;
        return { index, path, reverse, distance: distance(cursor, start) };
      })
      .sort((a, b) => a.distance - b.distance || a.path.id.localeCompare(b.path.id))[0];
    const selected = remaining.splice(choice.index, 1)[0];
    const points = choice.reverse ? [...selected.points].reverse() : selected.points;
    ordered.push({ ...selected, points });
    cursor = points[points.length - 1];
  }
  return ordered;
}

export function raster(image: GrayImage, settings: Settings, mode: ConversionMode = 'raster'): Toolpath {
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
export function contour(image: GrayImage, settings: Settings): Toolpath {
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
    const startKey = [...outgoing.keys()].sort()[0];
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

export const convert = (image: GrayImage, settings: Settings, mode: ConversionMode) =>
  mode === 'contour' ? contour(image, settings) : raster(image, settings, mode);
