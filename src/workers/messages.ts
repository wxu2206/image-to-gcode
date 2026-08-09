import type { ToolpathStats } from '../core/gcode';
import type { Move } from '../core/types';
import type { WorkerProgressMessage, WorkerStage, WorkerTimings } from './progress';

export type WorkerErrorStage = 'run' | 'preview' | 'serialize';
export type WorkerMessage =
  | WorkerProgressMessage
  | { type: 'result'; id: number; warnings: string[]; stats: ToolpathStats; timings: WorkerTimings; sentAt: number }
  | { type: 'preview-result'; id: number; requestId: number; moves: Move[]; segments: number; previewMs: number }
  | { type: 'gcode-result'; id: number; requestId: number; code: string; characters: number; lines: number }
  | { type: 'error'; id: number; stage: WorkerErrorStage; requestId?: number; message: string };

const stages = new Set<WorkerStage>(['image', 'reduce', 'extract', 'order', 'movements', 'gcode', 'statistics', 'preview', 'serialize']);
const record = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);
const finite = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value);
const nonNegative = (value: unknown): value is number => finite(value) && value >= 0;
const integer = (value: unknown): value is number => nonNegative(value) && Number.isInteger(value);

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

function validStats(value: unknown): value is ToolpathStats {
  if (!(record(value)
    && nonNegative(value.work) && nonNegative(value.travel) && nonNegative(value.total)
    && integer(value.movementCount) && integer(value.working) && integer(value.travels)
    && nonNegative(value.time) && validBounds(value.bounds))) return false;
  return Math.abs(value.total - (value.work + value.travel)) <= 1e-8 * Math.max(1, value.total)
    && value.movementCount === value.working + value.travels;
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
  if (value.type === 'preview-result') {
    return integer(value.requestId) && Array.isArray(value.moves) && value.moves.length <= 60_001
      && value.moves.every(validMove) && integer(value.segments) && value.segments === value.moves.length
      && nonNegative(value.previewMs);
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
