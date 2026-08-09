/// <reference lib="webworker" />

import { convert, type ConversionSettings } from '../core/conversion';
import { resampleForToolpath } from '../core/detail';
import { buildMovements, generate, statistics, type ToolpathStats } from '../core/gcode';
import { processImage } from '../core/image';
import type { ConversionMode, MachineProfile, PreviewQuality, Settings, Toolpath } from '../core/types';
import { packedMoveBytes, packMoves, previewFromPacked, type PackedMoves } from './packedMoves';
import { overallProgress, stageLabel, type WorkerProgressMessage, type WorkerStage, type WorkerTimings } from './progress';

type RunJobRequest = { type: 'run'; id: number; pixels: { width: number; height: number; data: ArrayBuffer }; imageSettings: { brightness: number; contrast: number; invert: boolean; filter: string; threshold: number }; conversionSettings: ConversionSettings; settings: Settings; profile: MachineProfile; mode: ConversionMode };
type PreviewJobRequest = { type: 'prepare-preview'; id: number; requestId: number; quality: PreviewQuality };
type SerializeRequest = { type: 'serialize-gcode'; id: number; requestId: number };
type JobRequest = RunJobRequest | PreviewJobRequest | SerializeRequest;
type JobResult = { type: 'result'; id: number; warnings: string[]; stats: ToolpathStats; timings: WorkerTimings; sentAt: number };
type PreviewResult = { type: 'preview-result'; id: number; requestId: number; moves: ReturnType<typeof previewFromPacked>; segments: number; previewMs: number };
type GcodeResult = { type: 'gcode-result'; id: number; requestId: number; code: string; characters: number; lines: number };
type JobError = { type: 'error'; id: number; message: string };
const worker = self as unknown as DedicatedWorkerGlobalScope;
let completed: { id: number; toolpath: Toolpath; settings: Settings; profile: MachineProfile; packed: PackedMoves } | null = null;

function reporter(id: number, requestId?: number) {
  let lastProgressAt = -Infinity;
  let lastStage: WorkerStage | null = null;
  let lastValue = -1;
  return (stage: WorkerStage, done: number, total: number) => {
    const stageProgress = total > 0 ? Math.min(1, Math.max(0, done / total)) : 1;
    const value = overallProgress(stage, stageProgress);
    const now = performance.now();
    if (stage === lastStage && value === lastValue) return;
    if (stage === lastStage && stageProgress < 1 && now - lastProgressAt < 40) return;
    lastProgressAt = now; lastStage = stage; lastValue = value;
    worker.postMessage({ type: 'progress', id, stage, label: stageLabel[stage], stageProgress, overallProgress: value, ...(requestId === undefined ? {} : { requestId }) } satisfies WorkerProgressMessage);
  };
}

function countLines(code: string): number {
  let count = code ? 1 : 0;
  for (let index = 0; index < code.length; index += 1) if (code.charCodeAt(index) === 10) count += 1;
  return count;
}

function run(job: RunJobRequest) {
  const started = performance.now();
  const report = reporter(job.id);
  try {
    report('image', 0, 1);
    const imageStart = performance.now();
    const image = processImage({ width: job.pixels.width, height: job.pixels.height, data: new Uint8ClampedArray(job.pixels.data) }, job.imageSettings, (done, total) => report('image', done, total));
    const imageMs = performance.now() - imageStart;
    const reductionStart = performance.now();
    const machineImage = resampleForToolpath(image, job.settings, (done, total) => report('reduce', done, total));
    const reductionMs = performance.now() - reductionStart;
    let extractionMs = 0;
    let orderingMs = 0;
    const extractionStarted = performance.now();
    let orderingStarted = 0;
    const toolpath = convert(machineImage, job.conversionSettings, job.mode, (stage, done, total) => {
      if (stage === 'order' && orderingStarted === 0) { extractionMs = performance.now() - extractionStarted; orderingStarted = performance.now(); }
      report(stage, done, total);
    });
    if (orderingStarted) orderingMs = performance.now() - orderingStarted;
    else extractionMs = performance.now() - extractionStarted;
    report('order', 1, 1);
    let pointCount = 0;
    for (const path of toolpath.paths) pointCount += path.points.length;
    const movementStart = performance.now();
    const built = buildMovements(toolpath, job.settings, job.profile, (stage, done, total) => report(stage, done, total));
    const movementMs = performance.now() - movementStart;
    const statisticsStart = performance.now();
    const stats = statistics(built.moves, (done, total) => report('statistics', done, total));
    const statisticsMs = performance.now() - statisticsStart;
    report('statistics', 1, 1);
    const packed = packMoves(built.moves);
    const packedBytes = packedMoveBytes(packed);
    const movementCount = built.moves.length;
    // The object array is intentionally not retained. Canonical paths and packed
    // movements remain in the worker; the main thread only receives preview geometry.
    built.moves.length = 0;
    completed = { id: job.id, toolpath, settings: job.settings, profile: job.profile, packed };
    worker.postMessage({ type: 'result', id: job.id, warnings: built.warnings, stats, timings: { imageMs, reductionMs, extractionMs, orderingMs, movementMs, gcodeMs: 0, statisticsMs, totalMs: performance.now() - started, pathCount: toolpath.paths.length, pointCount, movementCount, gcodeCharacters: 0, packedMovementBytes: packedBytes, transferBytes: 0 }, sentAt: performance.timeOrigin + performance.now() } satisfies JobResult);
  } catch (error) {
    worker.postMessage({ type: 'error', id: job.id, message: error instanceof Error ? error.message : 'Toolpath processing failed.' } satisfies JobError);
  }
}

function preparePreview(job: PreviewJobRequest) {
  if (!completed || completed.id !== job.id) return;
  const report = reporter(job.id, job.requestId);
  const started = performance.now();
  const moves = previewFromPacked(completed.packed, job.quality, (done, total) => report('preview', done, total));
  report('preview', 1, 1);
  worker.postMessage({ type: 'preview-result', id: job.id, requestId: job.requestId, moves, segments: moves.length, previewMs: performance.now() - started } satisfies PreviewResult);
}

function serializeGcode(job: SerializeRequest) {
  if (!completed || completed.id !== job.id) return;
  const report = reporter(job.id, job.requestId);
  try {
    const generated = generate(completed.toolpath, completed.settings, completed.profile, (stage, done, total) => report('serialize', stage === 'gcode' ? done : 0, stage === 'gcode' ? total : 1));
    report('serialize', 1, 1);
    worker.postMessage({ type: 'gcode-result', id: job.id, requestId: job.requestId, code: generated.code, characters: generated.code.length, lines: countLines(generated.code) } satisfies GcodeResult);
  } catch (error) {
    worker.postMessage({ type: 'error', id: job.id, message: error instanceof Error ? error.message : 'G-code serialization failed.' } satisfies JobError);
  }
}

worker.onmessage = (event: MessageEvent<JobRequest>) => {
  if (event.data.type === 'run') run(event.data);
  else if (event.data.type === 'prepare-preview') preparePreview(event.data);
  else serializeGcode(event.data);
};
