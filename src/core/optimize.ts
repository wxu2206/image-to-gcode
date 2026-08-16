import { distance } from './geometry';
import { toMillimetres } from './units';
import type { Path, Point, Settings, Toolpath } from './types';

const NEAREST_NEIGHBOR_LIMIT = 1_200;
const LOCAL_SWAP_LIMIT = 256;

const samePoint = (a: Point, b: Point, tolerance = 0) => distance(a, b) <= tolerance;
const closed = (path: Path, tolerance: number) => path.points.length > 2 && samePoint(path.points[0], path.points[path.points.length - 1], tolerance);
const reverse = (path: Path): Path => ({ ...path, points: [...path.points].reverse() });
const tie = (a: Path, b: Path) => a.id.localeCompare(b.id);

export type OptimizationResult = { toolpath: Toolpath; beforeTravel: number; afterTravel: number; joins: number; strategy: 'nearest-local' | 'spatial' };

export function travelDistance(paths: readonly Path[]): number {
  let total = 0;
  let cursor: Point = { x: 0, y: 0 };
  for (const path of paths) {
    if (path.kind !== 'work' || path.points.length < 2) continue;
    total += distance(cursor, path.points[0]);
    cursor = path.points[path.points.length - 1];
  }
  return total;
}

function nearestOrder(paths: Path[]): Path[] {
  const remaining = paths.slice().sort(tie);
  const ordered: Path[] = [];
  let cursor: Point = { x: 0, y: 0 };
  while (remaining.length) {
    let bestIndex = 0;
    let bestPath = remaining[0];
    let bestDistance = distance(cursor, bestPath.points[0]);
    for (let index = 0; index < remaining.length; index += 1) {
      const candidate = remaining[index];
      const firstDistance = distance(cursor, candidate.points[0]);
      let candidatePath = candidate;
      let candidateDistance = firstDistance;
      if (!closed(candidate, 0)) {
        const lastDistance = distance(cursor, candidate.points[candidate.points.length - 1]);
        if (lastDistance < firstDistance) { candidatePath = reverse(candidate); candidateDistance = lastDistance; }
      }
      if (candidateDistance < bestDistance || (candidateDistance === bestDistance && tie(candidate, bestPath) < 0)) {
        bestIndex = index; bestPath = candidate; bestDistance = candidateDistance; bestPath = candidatePath;
      }
    }
    remaining.splice(bestIndex, 1);
    ordered.push(bestPath);
    cursor = bestPath.points[bestPath.points.length - 1];
  }
  return ordered;
}

/** Bounded adjacent 2-opt-style pass: cheap and deterministic, never quadratic on large jobs. */
function localImprove(paths: Path[]): Path[] {
  if (paths.length > LOCAL_SWAP_LIMIT) return paths;
  const next = paths.slice();
  for (let pass = 0; pass < 2; pass += 1) {
    let changed = false;
    for (let index = 0; index + 1 < next.length; index += 1) {
      const previous = index === 0 ? { x: 0, y: 0 } : next[index - 1].points[next[index - 1].points.length - 1];
      const a = next[index]; const b = next[index + 1];
      const after = index + 2 < next.length ? next[index + 2].points[0] : null;
      const aEnd = a.points[a.points.length - 1]; const bEnd = b.points[b.points.length - 1];
      const beforeCost = distance(previous, a.points[0]) + distance(aEnd, b.points[0]) + (after ? distance(bEnd, after) : 0);
      const swappedCost = distance(previous, b.points[0]) + distance(bEnd, a.points[0]) + (after ? distance(aEnd, after) : 0);
      if (swappedCost + 1e-9 < beforeCost) { next[index] = b; next[index + 1] = a; changed = true; }
    }
    if (!changed) break;
  }
  return next;
}

function joinCompatible(paths: Path[], tolerance: number, enabled: boolean): { paths: Path[]; joins: number } {
  if (!enabled) return { paths, joins: 0 };
  const result: Path[] = [];
  let joins = 0;
  for (const path of paths) {
    const previous = result[result.length - 1];
    if (previous && previous.kind === 'work' && path.kind === 'work' && !closed(previous, tolerance) && !closed(path, tolerance)
      && samePoint(previous.points[previous.points.length - 1], path.points[0], tolerance)) {
      const previousEnd = previous.points[previous.points.length - 1];
      previous.points = [...previous.points, ...(samePoint(previousEnd, path.points[0]) ? path.points.slice(1) : path.points)];
      joins += 1;
    } else result.push({ ...path, points: path.points.slice() });
  }
  return { paths: result, joins };
}

/**
 * Keeps conversion geometry in image coordinates, but derives all physical
 * tolerances from Toolpath Detail. Contours and grayscale paths are never joined:
 * their closure/intensity semantics take priority over eliminating a lift. Native
 * vector centerlines may be joined only when their open endpoints are physically
 * coincident within the same conservative detail-derived tolerance.
 */
export function optimizeToolpath(toolpath: Toolpath, settings: Pick<Settings, 'outputWidth' | 'outputHeight' | 'toolpathDetail' | 'units'>): OptimizationResult {
  const work = toolpath.paths.filter((path) => path.kind === 'work' && path.points.length > 1);
  const other = toolpath.paths.filter((path) => path.kind !== 'work' || path.points.length <= 1);
  const beforeTravel = travelDistance(work);
  const strategy = work.length <= NEAREST_NEIGHBOR_LIMIT ? 'nearest-local' : 'spatial';
  // Existing spatial sweep remains the scalable fallback; it has already proven
  // deterministic on 10k-path fixtures.
  const ordered = strategy === 'nearest-local' ? localImprove(nearestOrder(work)) : work;
  const toleranceMm = Math.max(0.01, settings.toolpathDetail * 0.5);
  const mmPerSource = Math.max(toMillimetres(settings.outputWidth, settings.units) / toolpath.width, toMillimetres(settings.outputHeight, settings.units) / toolpath.height);
  const joinTolerance = toleranceMm / mmPerSource;
  const joined = joinCompatible(ordered, joinTolerance, toolpath.mode === 'raster' || toolpath.mode === 'vector');
  const optimized = { ...toolpath, paths: [...joined.paths, ...other] };
  return { toolpath: optimized, beforeTravel, afterTravel: travelDistance(joined.paths), joins: joined.joins, strategy };
}
