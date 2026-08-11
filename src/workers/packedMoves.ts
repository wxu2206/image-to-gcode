import type { Move, PreviewQuality } from '../core/types';
import { movementDurationMinutes } from '../core/runtime';
import { previewBudgets, type PreviewProgress } from './preview';

const WORKING = 1;
const G1 = 2;
const PATH_START = 4;

export type PackedMoves = {
  coordinates: Float64Array;
  /** Canonical XYZ/feed time for each move, kept worker-side until preview preparation. */
  durations: Float64Array;
  flags: Uint8Array;
  count: number;
};

export function packMoves(moves: readonly Move[]): PackedMoves {
  const coordinates = new Float64Array(moves.length * 4);
  const durations = new Float64Array(moves.length);
  const flags = new Uint8Array(moves.length);
  let previousPath: string | undefined;
  for (let index = 0; index < moves.length; index += 1) {
    const move = moves[index];
    const offset = index * 4;
    coordinates[offset] = move.from.x;
    coordinates[offset + 1] = move.from.y;
    coordinates[offset + 2] = move.to.x;
    coordinates[offset + 3] = move.to.y;
    durations[index] = movementDurationMinutes(move);
    if (![move.from.x, move.from.y, move.to.x, move.to.y].every(Number.isFinite)) {
      throw new Error('Cannot pack a movement with non-finite XY coordinates.');
    }
    flags[index] = (move.working ? WORKING : 0) | (move.command === 'G1' ? G1 : 0) | (index === 0 || move.pathId !== previousPath ? PATH_START : 0);
    previousPath = move.pathId;
  }
  return { coordinates, durations, flags, count: moves.length };
}

export function assertPackedMoves(packed: PackedMoves): void {
  if (!Number.isInteger(packed.count) || packed.count < 0 || packed.coordinates.length !== packed.count * 4 || packed.durations.length !== packed.count || packed.flags.length !== packed.count) {
    throw new Error('Packed movement buffers have inconsistent lengths.');
  }
}

export function packedMoveBytes(packed: PackedMoves): number {
  return packed.coordinates.byteLength + packed.durations.byteLength + packed.flags.byteLength;
}

function sameVisualRun(flagsA: number, flagsB: number): boolean {
  return (flagsA & (WORKING | G1)) === (flagsB & (WORKING | G1)) && !(flagsB & PATH_START);
}

/** Decimates directly from packed data, avoiding an intermediate full object array. */
type PreviewRange = { move: Move; endIndex: number };

function previewRangesFromPacked(packed: PackedMoves, quality: PreviewQuality, onProgress?: PreviewProgress): PreviewRange[] {
  assertPackedMoves(packed);
  const budget = previewBudgets[quality];
  if (!packed.count) return [];
  let runCount = 1;
  for (let index = 1; index < packed.count; index += 1) if (!sameVisualRun(packed.flags[index - 1], packed.flags[index])) runCount += 1;
  const stride = Math.max(1, Math.ceil((packed.count - runCount) / Math.max(1, budget - runCount)));
  const preview: PreviewRange[] = [];
  let runStart = 0;
  const point = (index: number, target: boolean) => {
    const offset = index * 4 + (target ? 2 : 0);
    return { x: packed.coordinates[offset], y: packed.coordinates[offset + 1] };
  };
  while (runStart < packed.count) {
    let runEnd = runStart + 1;
    while (runEnd < packed.count && sameVisualRun(packed.flags[runEnd - 1], packed.flags[runEnd])) runEnd += 1;
    let from = point(runStart, false);
    for (let index = runStart; index < runEnd; index += stride) {
      const end = Math.min(runEnd - 1, index + stride - 1);
      const flag = packed.flags[end];
      const to = point(end, true);
      preview.push({ move: { command: flag & G1 ? 'G1' : 'G0', from, to, working: Boolean(flag & WORKING) }, endIndex: end });
      from = to;
    }
    const last = runEnd - 1;
    const lastTo = point(last, true);
    if (preview[preview.length - 1].move.to.x !== lastTo.x || preview[preview.length - 1].move.to.y !== lastTo.y) {
      const flag = packed.flags[last];
      preview.push({ move: { command: flag & G1 ? 'G1' : 'G0', from, to: lastTo, working: Boolean(flag & WORKING) }, endIndex: last });
    }
    runStart = runEnd;
    if (runStart % 4096 === 0) onProgress?.(runStart, packed.count);
  }
  onProgress?.(packed.count, packed.count);
  if (preview.length <= budget) return preview;
  const limited: PreviewRange[] = [];
  const visualStride = Math.ceil(preview.length / budget);
  for (let index = 0; index < preview.length; index += visualStride) limited.push(preview[index]);
  if (limited[limited.length - 1] !== preview[preview.length - 1]) limited.push(preview[preview.length - 1]);
  return limited;
}

/** Decimates directly from packed data, avoiding an intermediate full object array. */
export function previewFromPacked(packed: PackedMoves, quality: PreviewQuality, onProgress?: PreviewProgress): Move[] {
  return previewRangesFromPacked(packed, quality, onProgress).map((range) => range.move);
}

export type TimedPreview = { moves: Move[]; endMinutes: Float64Array; totalMinutes: number };

/**
 * Builds bounded preview geometry plus a compact cumulative timing vector. Each
 * value is derived from canonical XYZ/feed durations, so simulation duration is
 * independent of preview quality and never requires full movements in React.
 */
export function timedPreviewFromPacked(packed: PackedMoves, quality: PreviewQuality, onProgress?: PreviewProgress): TimedPreview {
  const ranges = previewRangesFromPacked(packed, quality, onProgress);
  let totalMinutes = 0;
  const endMinutes = new Float64Array(ranges.length);
  let rangeIndex = 0;
  for (let index = 0; index < packed.count; index += 1) {
    const duration = packed.durations[index];
    totalMinutes += Number.isFinite(duration) && duration > 0 ? duration : 0;
    while (rangeIndex < ranges.length && ranges[rangeIndex].endIndex === index) {
      endMinutes[rangeIndex] = totalMinutes;
      rangeIndex += 1;
    }
  }
  return { moves: ranges.map((range) => range.move), endMinutes, totalMinutes };
}
