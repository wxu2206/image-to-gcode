import { describe, expect, it } from 'vitest';
import type { Move } from '../core/types';
import { packMoves, packedMoveBytes, previewFromPacked } from './packedMoves';

const moves: Move[] = Array.from({ length: 50_000 }, (_, index) => ({ command: 'G1', from: { x: index, y: 0 }, to: { x: index + 1, y: 0 }, working: true, feed: 600, pathId: 'line' }));

describe('packed worker movements', () => {
  it('stores dense movements in fixed transferable buffers and derives a bounded preview', () => {
    const packed = packMoves(moves);
    expect(packedMoveBytes(packed)).toBe(moves.length * 33);
    const preview = previewFromPacked(packed, 'low');
    expect(preview.length).toBeLessThanOrEqual(8_001);
    expect(preview[0].from).toEqual(moves[0].from);
    expect(preview[preview.length - 1].to).toEqual(moves[moves.length - 1].to);
  });
});
