import { describe, expect, it } from 'vitest';
import type { Move } from '../core/types';
import { packMoves, packedMoveBytes, previewFromPacked, timedPreviewFromPacked } from './packedMoves';

const moves: Move[] = Array.from({ length: 50_000 }, (_, index) => ({ command: 'G1', from: { x: index, y: 0 }, to: { x: index + 1, y: 0 }, working: true, feed: 600, pathId: 'line' }));

describe('packed worker movements', () => {
  it('stores dense movements in fixed transferable buffers and derives a bounded preview', () => {
    const packed = packMoves(moves);
    expect(packedMoveBytes(packed)).toBe(moves.length * 41);
    const preview = previewFromPacked(packed, 'low');
    expect(preview.length).toBeLessThanOrEqual(8_001);
    expect(preview[0].from).toEqual(moves[0].from);
    expect(preview[preview.length - 1].to).toEqual(moves[moves.length - 1].to);
  });

  it('returns bounded preview timing from canonical feeds without sending all moves', () => {
    const packed = packMoves([
      { command: 'G0', from: { x: 0, y: 0, z: 0 }, to: { x: 0, y: 0, z: 10 }, working: false, feed: 600 },
      { command: 'G1', from: { x: 0, y: 0, z: 10 }, to: { x: 60, y: 0, z: 10 }, working: true, feed: 300 },
    ]);
    const preview = timedPreviewFromPacked(packed, 'full');
    expect(preview.moves).toHaveLength(2);
    expect([...preview.endMinutes]).toEqual([10 / 600, 10 / 600 + 60 / 300]);
    expect(preview.totalMinutes).toBeCloseTo(13 / 60);
    expect(timedPreviewFromPacked(packed, 'low').totalMinutes).toBeCloseTo(preview.totalMinutes);
  });
});
