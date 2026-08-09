import type { Move, PreviewQuality } from '../core/types';
import { previewBudgets, type PreviewProgress } from './preview';

const WORKING = 1;
const G1 = 2;
const PATH_START = 4;

export type PackedMoves = {
  coordinates: Float64Array;
  flags: Uint8Array;
  count: number;
};

export function packMoves(moves: readonly Move[]): PackedMoves {
  const coordinates = new Float64Array(moves.length * 4);
  const flags = new Uint8Array(moves.length);
  let previousPath: string | undefined;
  for (let index = 0; index < moves.length; index += 1) {
    const move = moves[index];
    const offset = index * 4;
    coordinates[offset] = move.from.x;
    coordinates[offset + 1] = move.from.y;
    coordinates[offset + 2] = move.to.x;
    coordinates[offset + 3] = move.to.y;
    flags[index] = (move.working ? WORKING : 0) | (move.command === 'G1' ? G1 : 0) | (move.pathId !== previousPath ? PATH_START : 0);
    previousPath = move.pathId;
  }
  return { coordinates, flags, count: moves.length };
}

export function packedMoveBytes(packed: PackedMoves): number {
  return packed.coordinates.byteLength + packed.flags.byteLength;
}

function sameVisualRun(flagsA: number, flagsB: number): boolean {
  return (flagsA & (WORKING | G1)) === (flagsB & (WORKING | G1)) && !(flagsB & PATH_START);
}

/** Decimates directly from packed data, avoiding an intermediate full object array. */
export function previewFromPacked(packed: PackedMoves, quality: PreviewQuality, onProgress?: PreviewProgress): Move[] {
  const budget = previewBudgets[quality];
  if (!packed.count) return [];
  let runCount = 1;
  for (let index = 1; index < packed.count; index += 1) if (!sameVisualRun(packed.flags[index - 1], packed.flags[index])) runCount += 1;
  const stride = Math.max(1, Math.ceil((packed.count - runCount) / Math.max(1, budget - runCount)));
  const preview: Move[] = [];
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
      preview.push({ command: flag & G1 ? 'G1' : 'G0', from, to, working: Boolean(flag & WORKING) });
      from = to;
    }
    const last = runEnd - 1;
    const lastTo = point(last, true);
    if (preview[preview.length - 1].to.x !== lastTo.x || preview[preview.length - 1].to.y !== lastTo.y) {
      const flag = packed.flags[last];
      preview.push({ command: flag & G1 ? 'G1' : 'G0', from, to: lastTo, working: Boolean(flag & WORKING) });
    }
    runStart = runEnd;
    if (runStart % 4096 === 0) onProgress?.(runStart, packed.count);
  }
  onProgress?.(packed.count, packed.count);
  if (preview.length <= budget) return preview;
  const limited: Move[] = [];
  const visualStride = Math.ceil(preview.length / budget);
  for (let index = 0; index < preview.length; index += visualStride) limited.push(preview[index]);
  if (limited[limited.length - 1] !== preview[preview.length - 1]) limited.push(preview[preview.length - 1]);
  return limited;
}
