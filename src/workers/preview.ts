import type { Move, PreviewQuality } from '../core/types';

export const previewBudgets: Record<PreviewQuality, number> = {
  low: 8_000,
  balanced: 16_000,
  high: 32_000,
  // Full means all useful visual geometry up to a generous safety cap. The final
  // machine program is never changed by this cap.
  full: 60_000,
};

export type PreviewProgress = (completed: number, total: number) => void;

function sameVisualRun(a: Move, b: Move): boolean {
  return a.working === b.working && a.command === b.command && a.pathId === b.pathId;
}

/**
 * Produces a separate, contiguous visual approximation. Adjacent moves are folded
 * only within the same tool/path run, preserving travel versus working geometry and
 * each run endpoint while leaving the final movement collection untouched.
 */
export function buildPreviewMoves(moves: readonly Move[], quality: PreviewQuality, onProgress?: PreviewProgress): Move[] {
  const budget = previewBudgets[quality];
  if (moves.length <= budget) {
    onProgress?.(moves.length, moves.length);
    return moves.slice();
  }
  let runCount = 1;
  for (let index = 1; index < moves.length; index += 1) if (!sameVisualRun(moves[index - 1], moves[index])) runCount += 1;
  // Reserve one representative segment for every visual run, then distribute the
  // remaining budget across continuous geometry.
  const stride = Math.max(1, Math.ceil((moves.length - runCount) / Math.max(1, budget - runCount)));
  const preview: Move[] = [];
  let runStart = 0;
  while (runStart < moves.length) {
    let runEnd = runStart + 1;
    while (runEnd < moves.length && sameVisualRun(moves[runEnd - 1], moves[runEnd])) runEnd += 1;
    let anchor = moves[runStart].from;
    for (let index = runStart; index < runEnd; index += stride) {
      const end = Math.min(runEnd - 1, index + stride - 1);
      const source = moves[end];
      preview.push({ ...source, from: anchor, to: source.to });
      anchor = source.to;
    }
    const last = moves[runEnd - 1];
    if (preview[preview.length - 1].to !== last.to) preview.push({ ...last, from: anchor, to: last.to });
    runStart = runEnd;
    if (runStart % 4096 === 0) onProgress?.(runStart, moves.length);
  }
  onProgress?.(moves.length, moves.length);
  if (preview.length <= budget) return preview;
  // Highly fragmented input can create more visual runs than the budget. Retain
  // representative independent segments rather than asking Canvas to draw them all.
  const limited: Move[] = [];
  const visualStride = Math.ceil(preview.length / budget);
  for (let index = 0; index < preview.length; index += visualStride) limited.push(preview[index]);
  const last = preview[preview.length - 1];
  if (limited[limited.length - 1] !== last) limited.push(last);
  return limited;
}
