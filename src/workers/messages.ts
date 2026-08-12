import type { ToolpathStats } from '../core/gcode';
import type { Move } from '../core/types';
import type { WorkerProgressMessage, WorkerStage, WorkerTimings } from './progress';

export type WorkerErrorStage = 'run' | 'preview' | 'serialize';
export type WorkerMessage =
  | WorkerProgressMessage
  | { type: 'result'; id: number; warnings: string[]; stats: ToolpathStats; timings: WorkerTimings; sentAt: number }
  | { type: 'processed-preview-result'; id: number; preview: { width: number; height: number; data: ArrayBuffer } }
  | { type: 'preview-result'; id: number; requestId: number; moves: Move[]; timing: { endMinutes: ArrayBuffer; totalMinutes: number }; segments: number; previewMs: number }
  | { type: 'gcode-result'; id: number; requestId: number; code: string; characters: number; lines: number }
  | { type: 'error'; id: number; stage: WorkerErrorStage; requestId?: number; message: string };

const stages = new Set<WorkerStage>(['image', 'reduce', 'extract', 'order', 'movements', 'gcode', 'statistics', 'preview', 'serialize']);
const record = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);
const finite = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value);
const nonNegative = (value: unknown): value is number => finite(value) && value >= 0;
const integer = (value: unknown): value is number => nonNegative(value) && Number.isInteger(value);
const MAX_PROCESSED_PREVIEW_PIXELS = 900 * 900;

function validPoint(value: unknown): boolean {
  if (!record(value) || !finite(value.x) || !finite(value.y)) return false;
  return value.z === undefined || finite(value.z);
}

function validMove(value: unknown): value is Move {
  return record(value)
    && (value.command === 'G0' || value.command === 'G1')
    && validPoint(value.from)
    && validPoint(value.to)
    && typeof value.working === 'boolean';
}

function validBounds(value: unknown): boolean {
  return value === null || (record(value)
    && finite(value.minX) && finite(value.maxX)
    && finite(value.minY) && finite(value.maxY)
    && (value.minZ === null || finite(value.minZ))
    && (value.maxZ === null || finite(value.maxZ))
    && value.minX <= value.maxX && value.minY <= value.maxY
    && ((value.minZ === null && value.maxZ === null) || (finite(value.minZ) && finite(value.maxZ) && value.minZ <= value.maxZ)));
}

function validDiagnostics(value: unknown): boolean {
  return record(value)
    && (value.start === null || validPoint(value.start))
    && (value.end === null || validPoint(value.end))
    && integer(value.nonFiniteCoordinateCount)
    && integer(value.invalidFeedCount)
    && integer(value.zeroLengthMoveCount)
    && integer(value.discontinuityCount)
    && integer(value.invalidStateCount)
    && integer(value.unsafeCncRapidCount)
    && integer(value.missingCncWorkingZCount)
    && (value.minWorkingZ === null || finite(value.minWorkingZ))
    && (value.maxWorkingZ === null || finite(value.maxWorkingZ))
    && ((value.minWorkingZ === null && value.maxWorkingZ === null)
      || (finite(value.minWorkingZ) && finite(value.maxWorkingZ) && value.minWorkingZ <= value.maxWorkingZ));
}

function validStats(value: unknown): value is ToolpathStats {
  if (!(record(value)
    && nonNegative(value.work) && nonNegative(value.travel) && nonNegative(value.total)
    && integer(value.movementCount) && integer(value.working) && integer(value.travels) && integer(value.toolLifts) && nonNegative(value.travelEfficiency) && value.travelEfficiency <= 1
    && nonNegative(value.time) && record(value.estimate)
    && nonNegative(value.estimate.totalMinutes) && nonNegative(value.estimate.workMinutes) && nonNegative(value.estimate.travelMinutes)
    && validBounds(value.bounds) && validDiagnostics(value.diagnostics))) return false;
  return Math.abs(value.total - (value.work + value.travel)) <= 1e-8 * Math.max(1, value.total)
    && value.movementCount === value.working + value.travels
    && Math.abs(value.time - value.estimate.totalMinutes) <= 1e-8 * Math.max(1, value.time)
    && Math.abs(value.estimate.totalMinutes - (value.estimate.workMinutes + value.estimate.travelMinutes)) <= 1e-8 * Math.max(1, value.estimate.totalMinutes);
}

function validPreviewTiming(value: unknown, moves: readonly Move[]): boolean {
  if (!record(value) || !(value.endMinutes instanceof ArrayBuffer) || !nonNegative(value.totalMinutes) || value.endMinutes.byteLength !== moves.length * Float64Array.BYTES_PER_ELEMENT) return false;
  const endMinutes = new Float64Array(value.endMinutes);
  let previous = 0;
  for (const minute of endMinutes) {
    if (!nonNegative(minute) || minute < previous || minute > value.totalMinutes) return false;
    previous = minute;
  }
  return moves.length === 0 ? value.totalMinutes === 0 : Math.abs(previous - value.totalMinutes) <= 1e-8 * Math.max(1, value.totalMinutes);
}

const timingKeys: Array<keyof WorkerTimings> = [
  'imageMs', 'reductionMs', 'extractionMs', 'orderingMs', 'movementMs', 'gcodeMs',
  'statisticsMs', 'totalMs', 'pathCount', 'pointCount', 'movementCount',
  'gcodeCharacters', 'packedMovementBytes', 'transferBytes',
];

function validTimings(value: unknown): value is WorkerTimings {
  return record(value) && timingKeys.every((key) => nonNegative(value[key]));
}

function validWarnings(value: unknown): value is string[] {
  return Array.isArray(value) && value.length <= 10_000 && value.every((message) => typeof message === 'string' && message.length <= 16_384);
}

function validProcessedPreview(value: unknown): boolean {
  if (!record(value) || !integer(value.width) || !integer(value.height) || value.width === 0 || value.height === 0 || !(value.data instanceof ArrayBuffer)) return false;
  const pixels = value.width * value.height;
  return Number.isSafeInteger(pixels) && pixels <= MAX_PROCESSED_PREVIEW_PIXELS && value.data.byteLength === pixels;
}

export function isWorkerMessage(value: unknown): value is WorkerMessage {
  if (!record(value) || !integer(value.id) || typeof value.type !== 'string') return false;
  if (value.type === 'progress') {
    return typeof value.stage === 'string' && stages.has(value.stage as WorkerStage)
      && typeof value.label === 'string' && value.label.length <= 256
      && finite(value.stageProgress) && finite(value.overallProgress)
      && (value.requestId === undefined || integer(value.requestId));
  }
  if (value.type === 'result') {
    return validWarnings(value.warnings) && validStats(value.stats) && validTimings(value.timings)
      && value.timings.movementCount === value.stats.movementCount && finite(value.sentAt);
  }
  if (value.type === 'processed-preview-result') return validProcessedPreview(value.preview);
  if (value.type === 'preview-result') {
    return integer(value.requestId) && Array.isArray(value.moves) && value.moves.length <= 60_001
      && value.moves.every(validMove) && integer(value.segments) && value.segments === value.moves.length
      && validPreviewTiming(value.timing, value.moves) && nonNegative(value.previewMs);
  }
  if (value.type === 'gcode-result') {
    return integer(value.requestId) && typeof value.code === 'string'
      && integer(value.characters) && value.characters === value.code.length && integer(value.lines);
  }
  if (value.type === 'error') {
    return (value.stage === 'run' || value.stage === 'preview' || value.stage === 'serialize')
      && (value.requestId === undefined || integer(value.requestId))
      && typeof value.message === 'string' && value.message.length <= 16_384;
  }
  return false;
}
