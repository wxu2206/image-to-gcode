import type { Move, Point } from '../core/types';

export type PlaybackPosition = { point: Point; working: boolean; index: number };

/** Finds the bounded preview segment active at a canonical elapsed time. */
export function playbackPosition(moves: readonly Move[], endMinutes: Float64Array, elapsedMinutes: number): PlaybackPosition | null {
  if (!moves.length || endMinutes.length !== moves.length) return null;
  const total = endMinutes[endMinutes.length - 1];
  const elapsed = Math.min(Math.max(0, Number.isFinite(elapsedMinutes) ? elapsedMinutes : 0), total);
  let low = 0;
  let high = endMinutes.length - 1;
  while (low < high) {
    const middle = low + Math.floor((high - low) / 2);
    if (endMinutes[middle] < elapsed) low = middle + 1;
    else high = middle;
  }
  const index = low;
  const move = moves[index];
  const start = index === 0 ? 0 : endMinutes[index - 1];
  const end = endMinutes[index];
  const progress = end > start ? Math.min(1, Math.max(0, (elapsed - start) / (end - start))) : 1;
  return {
    point: {
      x: move.from.x + (move.to.x - move.from.x) * progress,
      y: move.from.y + (move.to.y - move.from.y) * progress,
    },
    working: move.working,
    index,
  };
}

export function advancePlaybackMinutes(startMinutes: number, elapsedWallMs: number, speed: number, totalMinutes: number): number {
  if (!Number.isFinite(startMinutes) || !Number.isFinite(elapsedWallMs) || !Number.isFinite(speed) || !Number.isFinite(totalMinutes)) return 0;
  return Math.min(Math.max(0, startMinutes + elapsedWallMs * speed / 60_000), Math.max(0, totalMinutes));
}
