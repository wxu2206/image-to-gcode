/// <reference lib="webworker" />

import { convert } from '../core/conversion';
import { resampleForToolpath } from '../core/detail';
import { buildMovements, generate, statistics, type ToolpathStats } from '../core/gcode';
import { cleanupTinyArtifacts, processImage } from '../core/image';
import { configurationErrors, profileErrors } from '../core/machine';
import { optimizeToolpath } from '../core/optimize';
import type { ConversionMode, MachineProfile, PreviewQuality, Settings, Toolpath } from '../core/types';
import { flattenVectorDocument } from '../vector/flatten';
import type { VectorDocument } from '../vector/model';
import { packedMoveBytes, packMoves, timedPreviewFromPacked, type PackedMoves } from './packedMoves';
import { overallProgress, stageLabel, type WorkerProgressMessage, type WorkerStage, type WorkerTimings } from './progress';
import { isSerializeGcodeRequest, type SerializeGcodeRequest } from './requests';

type RasterSource = { kind: 'raster'; pixels: { width: number; height: number; data: ArrayBuffer } };
type VectorSource = { kind: 'vector'; document: VectorDocument };
type RunJobRequest = { type: 'run'; id: number; source: RasterSource | VectorSource; settings: Settings; profile: MachineProfile; mode: ConversionMode };
type PreviewJobRequest = { type: 'prepare-preview'; id: number; requestId: number; quality: PreviewQuality };
type JobRequest = RunJobRequest | PreviewJobRequest | SerializeGcodeRequest;
type JobResult = { type: 'result'; id: number; warnings: string[]; stats: ToolpathStats; timings: WorkerTimings; sentAt: number };
type ProcessedPreviewResult = { type: 'processed-preview-result'; id: number; preview: { width: number; height: number; data: ArrayBuffer } };
type PreviewResult = { type: 'preview-result'; id: number; requestId: number; moves: ReturnType<typeof timedPreviewFromPacked>['moves']; timing: { endMinutes: ArrayBuffer; totalMinutes: number }; segments: number; previewMs: number };
type GcodeResult = { type: 'gcode-result'; id: number; requestId: number; outputKey: string; code: string; characters: number; lines: number };
type JobError = { type: 'error'; id: number; stage: 'run' | 'preview' | 'serialize'; requestId?: number; message: string };
const worker = self as unknown as DedicatedWorkerGlobalScope;
let completed: { id: number; toolpath: Toolpath; settings: Settings; profile: MachineProfile; packed: PackedMoves } | null = null;

function reporter(id: number, requestId?: number, vectorSource = false) {
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
    const label = vectorSource && stage === 'image' ? 'Reading SVG geometry…'
      : vectorSource && stage === 'reduce' ? 'Preparing vector geometry…'
        : vectorSource && stage === 'extract' ? 'Flattening SVG curves…'
          : stageLabel[stage];
    worker.postMessage({ type: 'progress', id, stage, label, stageProgress, overallProgress: value, ...(requestId === undefined ? {} : { requestId }) } satisfies WorkerProgressMessage);
  };
}

function countLines(code: string): number {
  if (!code) return 0;
  let count = 1;
  for (let index = 0; index < code.length; index += 1) if (code.charCodeAt(index) === 10) count += 1;
  return code.endsWith('\n') ? count - 1 : count;
}

function run(job: RunJobRequest) {
  completed = null;
  const started = performance.now();
  const report = reporter(job.id, undefined, job.source.kind === 'vector');
  try {
    const errors = [...configurationErrors(job.settings, job.profile.kind), ...profileErrors(job.profile)];
    if (errors.length) throw new Error(errors[0]);
    let imageMs = 0;
    let reductionMs = 0;
    let extractionMs = 0;
    let orderingMs = 0;
    let processedPreviewBytes = 0;
    let removedComponents = 0;
    let sourceSegmentCount = 0;
    let flattenedPointCount = 0;
    let sourceWarnings: string[] = [];
    let toolpath: Toolpath;

    if (job.source.kind === 'raster') {
      if (job.mode === 'vector') throw new Error('A raster source cannot use native vector conversion.');
      report('image', 0, 1);
      const imageStart = performance.now();
      const processed = processImage(
        { width: job.source.pixels.width, height: job.source.pixels.height, data: new Uint8ClampedArray(job.source.pixels.data) },
        { brightness: job.settings.brightness, contrast: job.settings.contrast, invert: job.settings.invert, filter: job.settings.filter, threshold: job.settings.threshold },
        (done, total) => report('image', done, total),
      );
      const cleanup = cleanupTinyArtifacts(processed, job.settings);
      const image = cleanup.image;
      removedComponents = cleanup.removedComponents;
      imageMs = performance.now() - imageStart;
      // Return a bounded grayscale copy so the Processed tab reflects this exact pass.
      const processedPreview = image.data.slice();
      processedPreviewBytes = processedPreview.byteLength;
      worker.postMessage({
        type: 'processed-preview-result',
        id: job.id,
        preview: { width: image.width, height: image.height, data: processedPreview.buffer },
      } satisfies ProcessedPreviewResult, [processedPreview.buffer]);
      const reductionStart = performance.now();
      const machineImage = resampleForToolpath(image, job.settings, (done, total) => report('reduce', done, total));
      reductionMs = performance.now() - reductionStart;
      const extractionStarted = performance.now();
      let orderingStarted = 0;
      toolpath = convert(machineImage, job.settings, job.mode, (stage, done, total) => {
        if (stage === 'order' && orderingStarted === 0) { extractionMs = performance.now() - extractionStarted; orderingStarted = performance.now(); }
        report(stage, done, total);
      });
      if (orderingStarted) orderingMs = performance.now() - orderingStarted;
      else extractionMs = performance.now() - extractionStarted;
    } else {
      if (job.mode !== 'vector') throw new Error('An SVG source must use native vector conversion.');
      report('image', 1, 1);
      report('reduce', 1, 1);
      sourceSegmentCount = job.source.document.segmentCount;
      sourceWarnings = job.source.document.warnings.slice();
      const extractionStarted = performance.now();
      const flattened = flattenVectorDocument(job.source.document, job.settings, (done, total) => report('extract', done, total));
      extractionMs = performance.now() - extractionStarted;
      flattenedPointCount = flattened.flattenedPoints;
      const orderingStarted = performance.now();
      report('order', 0, flattened.toolpath.paths.length);
      toolpath = optimizeToolpath(flattened.toolpath, job.settings).toolpath;
      report('order', flattened.toolpath.paths.length, flattened.toolpath.paths.length);
      orderingMs = performance.now() - orderingStarted;
    }
    report('order', 1, 1);
    let pointCount = 0;
    for (const path of toolpath.paths) pointCount += path.points.length;
    const movementStart = performance.now();
    const built = buildMovements(toolpath, job.settings, job.profile, (stage, done, total) => report(stage, done, total));
    const movementMs = performance.now() - movementStart;
    const statisticsStart = performance.now();
    const stats = statistics(
      built.moves,
      (done, total) => report('statistics', done, total),
      { machineKind: job.profile.kind, safeZ: job.settings.safeZ, precision: job.settings.precision },
    );
    const statisticsMs = performance.now() - statisticsStart;
    report('statistics', 1, 1);
    const packed = packMoves(built.moves);
    const packedBytes = packedMoveBytes(packed);
    const movementCount = built.moves.length;
    // The object array is intentionally not retained. Canonical paths and packed
    // movements remain in the worker; the main thread only receives preview geometry.
    built.moves.length = 0;
    completed = { id: job.id, toolpath, settings: job.settings, profile: job.profile, packed };
    if (removedComponents) built.warnings.push(`Noise cleanup removed ${removedComponents.toLocaleString()} isolated artifact${removedComponents === 1 ? '' : 's'}.`);
    built.warnings.push(...sourceWarnings);
    worker.postMessage({ type: 'result', id: job.id, warnings: built.warnings, stats, timings: { imageMs, reductionMs, extractionMs, orderingMs, movementMs, gcodeMs: 0, statisticsMs, totalMs: performance.now() - started, pathCount: toolpath.paths.length, pointCount, movementCount, gcodeCharacters: 0, packedMovementBytes: packedBytes, transferBytes: processedPreviewBytes, sourceSegmentCount, flattenedPointCount }, sentAt: performance.timeOrigin + performance.now() } satisfies JobResult);
  } catch (error) {
    worker.postMessage({ type: 'error', id: job.id, stage: 'run', message: error instanceof Error ? error.message : 'Toolpath processing failed.' } satisfies JobError);
  }
}

function preparePreview(job: PreviewJobRequest) {
  if (!completed || completed.id !== job.id) return;
  try {
    const report = reporter(job.id, job.requestId);
    const started = performance.now();
    const preview = timedPreviewFromPacked(completed.packed, job.quality, (done, total) => report('preview', done, total));
    report('preview', 1, 1);
    const timingBuffer = preview.endMinutes.buffer as ArrayBuffer;
    worker.postMessage({ type: 'preview-result', id: job.id, requestId: job.requestId, moves: preview.moves, timing: { endMinutes: timingBuffer, totalMinutes: preview.totalMinutes }, segments: preview.moves.length, previewMs: performance.now() - started } satisfies PreviewResult, [timingBuffer]);
  } catch (error) {
    worker.postMessage({ type: 'error', id: job.id, stage: 'preview', requestId: job.requestId, message: error instanceof Error ? error.message : 'Preview preparation failed.' } satisfies JobError);
  }
}

function serializeGcode(job: SerializeGcodeRequest) {
  if (!completed || completed.id !== job.id) return;
  const report = reporter(job.id, job.requestId);
  try {
    const requestedCnc = job.profile.kind === 'cnc';
    const completedCnc = completed.profile.kind === 'cnc';
    if (requestedCnc !== completedCnc || (requestedCnc && job.profile.passDepth !== completed.profile.passDepth)) {
      throw new Error('The machine geometry changed; regenerate the canonical job before serialization.');
    }
    const generated = generate(completed.toolpath, completed.settings, job.profile, (stage, done, total) => report('serialize', stage === 'gcode' ? done : 0, stage === 'gcode' ? total : 1));
    report('serialize', 1, 1);
    worker.postMessage({ type: 'gcode-result', id: job.id, requestId: job.requestId, outputKey: job.outputKey, code: generated.code, characters: generated.code.length, lines: countLines(generated.code) } satisfies GcodeResult);
  } catch (error) {
    worker.postMessage({ type: 'error', id: job.id, stage: 'serialize', requestId: job.requestId, message: error instanceof Error ? error.message : 'G-code serialization failed.' } satisfies JobError);
  }
}

worker.onmessage = (event: MessageEvent<JobRequest>) => {
  if (event.data.type === 'run') run(event.data);
  else if (event.data.type === 'prepare-preview') preparePreview(event.data);
  else if (isSerializeGcodeRequest(event.data)) serializeGcode(event.data);
  else {
    const candidate = event.data as { id?: unknown; requestId?: unknown };
    if (typeof candidate.id === 'number' && typeof candidate.requestId === 'number') {
      worker.postMessage({ type: 'error', id: candidate.id, requestId: candidate.requestId, stage: 'serialize', message: 'The G-code serialization request was invalid or untrusted.' } satisfies JobError);
    }
  }
};
