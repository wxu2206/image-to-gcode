/// <reference lib="webworker" />

import { convert, type ConversionSettings } from '../core/conversion';
import { generate, statistics } from '../core/gcode';
import { processImage } from '../core/image';
import type { ConversionMode, MachineProfile, Settings } from '../core/types';
import { overallProgress, stageLabel, type WorkerProgressMessage, type WorkerStage, type WorkerTimings } from './progress';

type JobRequest = {
  type: 'run'; id: number; pixels: { width: number; height: number; data: ArrayBuffer };
  imageSettings: { brightness: number; contrast: number; invert: boolean; filter: string; threshold: number };
  conversionSettings: ConversionSettings; settings: Settings; profile: MachineProfile; mode: ConversionMode;
};
type JobResult = {
  type: 'result'; id: number; result: ReturnType<typeof generate>; stats: ReturnType<typeof statistics>; timings: WorkerTimings; sentAt: number;
};
type JobError = { type: 'error'; id: number; message: string };
const worker = self as unknown as DedicatedWorkerGlobalScope;

worker.onmessage = (event: MessageEvent<JobRequest>) => {
  const job = event.data;
  const started = performance.now();
  let lastProgressAt = -Infinity;
  let lastStage: WorkerStage | null = null;
  let lastValue = -1;
  const report = (stage: WorkerStage, completed: number, total: number) => {
    const stageProgress = total > 0 ? Math.min(1, Math.max(0, completed / total)) : 1;
    const value = overallProgress(stage, stageProgress);
    const now = performance.now();
    // Reporting is proportional to real completed work, but messages are rate-limited
    // to keep postMessage traffic out of hot image/path loops.
    if (stage === lastStage && value === lastValue) return;
    if (stage === lastStage && stageProgress < 1 && now - lastProgressAt < 40) return;
    lastProgressAt = now;
    lastStage = stage;
    lastValue = value;
    worker.postMessage({ type: 'progress', id: job.id, stage, label: stageLabel[stage], stageProgress, overallProgress: value } satisfies WorkerProgressMessage);
  };
  try {
    report('image', 0, 1);
    const imageStart = performance.now();
    const image = processImage(
      { width: job.pixels.width, height: job.pixels.height, data: new Uint8ClampedArray(job.pixels.data) },
      job.imageSettings,
      (completed, total) => report('image', completed, total),
    );
    const imageMs = performance.now() - imageStart;

    let extractionMs = 0;
    let orderingMs = 0;
    const extractionStarted = performance.now();
    let orderingStarted = 0;
    const toolpath = convert(image, job.conversionSettings, job.mode, (stage, completed, total) => {
      if (stage === 'order' && orderingStarted === 0) {
        extractionMs += performance.now() - extractionStarted;
        orderingStarted = performance.now();
      }
      report(stage, completed, total);
    });
    if (orderingStarted) orderingMs = performance.now() - orderingStarted;
    else extractionMs += performance.now() - extractionStarted;
    report('order', 1, 1);

    let pointCount = 0;
    for (const path of toolpath.paths) pointCount += path.points.length;
    const movementStart = performance.now();
    let serializationStarted = 0;
    const result = generate(toolpath, job.settings, job.profile, (stage, completed, total) => {
      if (stage === 'gcode' && serializationStarted === 0) serializationStarted = performance.now();
      report(stage, completed, total);
    });
    const generationEnded = performance.now();
    const movementMs = (serializationStarted || generationEnded) - movementStart;
    const gcodeMs = serializationStarted ? generationEnded - serializationStarted : 0;

    const statisticsStart = performance.now();
    const stats = statistics(result.moves, (completed, total) => report('statistics', completed, total));
    const statisticsMs = performance.now() - statisticsStart;
    report('statistics', 1, 1);

    worker.postMessage({
      type: 'result', id: job.id, result, stats,
      timings: {
        imageMs, extractionMs, orderingMs, movementMs, gcodeMs, statisticsMs,
        totalMs: performance.now() - started, pathCount: toolpath.paths.length, pointCount,
        movementCount: result.moves.length, gcodeCharacters: result.code.length,
      },
      // timeOrigin makes this comparable with the receiving Window's clock.
      sentAt: performance.timeOrigin + performance.now(),
    } satisfies JobResult);
  } catch (error) {
    worker.postMessage({ type: 'error', id: job.id, message: error instanceof Error ? error.message : 'Toolpath processing failed.' } satisfies JobError);
  }
};
