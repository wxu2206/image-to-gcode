import { describe, expect, it } from 'vitest';
import { estimateRuntime, movementDurationMinutes } from './runtime';
import type { Move } from './types';

describe('feed-aware runtime estimates', () => {
  it('uses each canonical move rate and includes Z-only travel distance', () => {
    const moves: Move[] = [
      { command: 'G0', from: { x: 0, y: 0, z: 0 }, to: { x: 0, y: 0, z: 10 }, working: false, feed: 600, zOnly: true },
      { command: 'G0', from: { x: 0, y: 0, z: 10 }, to: { x: 60, y: 0, z: 10 }, working: false, feed: 1_200 },
      { command: 'G1', from: { x: 60, y: 0, z: 10 }, to: { x: 60, y: 80, z: 10 }, working: true, feed: 400 },
    ];
    expect(movementDurationMinutes(moves[0])).toBeCloseTo(10 / 600);
    expect(estimateRuntime(moves)).toEqual({ totalMinutes: 0.26666666666666666, workMinutes: 0.2, travelMinutes: 0.06666666666666667 });
  });

  it('ignores malformed and zero-length movement durations safely', () => {
    expect(estimateRuntime([
      { command: 'G1', from: { x: 0, y: 0 }, to: { x: 0, y: 0 }, working: true, feed: 100 },
      { command: 'G0', from: { x: 0, y: 0 }, to: { x: 1, y: 0 }, working: false, feed: 0 },
    ])).toEqual({ totalMinutes: 0, workMinutes: 0, travelMinutes: 0 });
  });
});
