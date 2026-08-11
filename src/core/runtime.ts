import { distance } from './geometry';
import type { Move } from './types';

/** A feed-aware estimate in machine minutes. Feeds are expressed in units/minute. */
export type RuntimeEstimate = {
  totalMinutes: number;
  workMinutes: number;
  travelMinutes: number;
};

/**
 * Returns a movement's time without inventing acceleration, dwell, spindle, or
 * controller-specific delays. XYZ distance is intentionally used for safe-Z and
 * depth moves; each move already carries the rate selected by the machine profile.
 */
export function movementDurationMinutes(move: Move): number {
  if (!Number.isFinite(move.feed) || move.feed === undefined || move.feed <= 0) return 0;
  const length = distance(move.from, move.to);
  return Number.isFinite(length) && length > 0 ? length / move.feed : 0;
}

export function estimateRuntime(moves: readonly Move[]): RuntimeEstimate {
  let workMinutes = 0;
  let travelMinutes = 0;
  for (const move of moves) {
    const duration = movementDurationMinutes(move);
    if (move.working) workMinutes += duration;
    else travelMinutes += duration;
  }
  return { totalMinutes: workMinutes + travelMinutes, workMinutes, travelMinutes };
}
