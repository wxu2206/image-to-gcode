import { describe, expect, it } from 'vitest';
import { advancePlaybackMinutes, playbackPosition } from './playback';
import type { Move } from '../core/types';

const moves: Move[] = [
  { command: 'G0', from: { x: 0, y: 0 }, to: { x: 10, y: 0 }, working: false },
  { command: 'G1', from: { x: 10, y: 0 }, to: { x: 10, y: 20 }, working: true },
];

describe('playback timeline', () => {
  it('interpolates from cumulative canonical timing, not segment count', () => {
    const timing = new Float64Array([2, 3]);
    expect(playbackPosition(moves, timing, 1)).toMatchObject({ point: { x: 5, y: 0 }, working: false, index: 0 });
    expect(playbackPosition(moves, timing, 2.5)).toMatchObject({ point: { x: 10, y: 10 }, working: true, index: 1 });
  });

  it('clamps scrub positions and advances at the selected simulation rate', () => {
    const timing = new Float64Array([2, 3]);
    expect(playbackPosition(moves, timing, 99)?.point).toEqual({ x: 10, y: 20 });
    expect(advancePlaybackMinutes(1, 30_000, 2, 3)).toBe(2);
    expect(advancePlaybackMinutes(2, 60_000, 10, 3)).toBe(3);
  });
});
