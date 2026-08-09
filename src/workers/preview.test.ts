import { describe, expect, it } from 'vitest';
import type { Move } from '../core/types';
import { buildPreviewMoves, previewBudgets } from './preview';

const moves = (count: number): Move[] => Array.from({ length: count }, (_, index) => ({ command: 'G1', from: { x: index, y: index % 20 }, to: { x: index + 1, y: (index + 1) % 20 }, working: true, feed: 600, pathId: 'path' }));

describe('preview-only geometry', () => {
  it('caps visual segments without modifying the final movement collection', () => {
    const finalMoves = moves(100_000);
    const original = JSON.stringify(finalMoves);
    const preview = buildPreviewMoves(finalMoves, 'balanced');
    expect(preview.length).toBeLessThanOrEqual(previewBudgets.balanced + 1);
    expect(JSON.stringify(finalMoves)).toBe(original);
    expect(preview[0].from).toEqual(finalMoves[0].from);
    expect(preview[preview.length - 1].to).toEqual(finalMoves[finalMoves.length - 1].to);
  });

  it('uses more preview detail at higher quality without changing the final program', () => {
    const finalMoves = moves(80_000);
    expect(buildPreviewMoves(finalMoves, 'low').length).toBeLessThanOrEqual(buildPreviewMoves(finalMoves, 'high').length);
    expect(buildPreviewMoves(finalMoves, 'full').length).toBeLessThanOrEqual(previewBudgets.full + 1);
    expect(finalMoves).toHaveLength(80_000);
  });
});
