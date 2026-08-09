/// <reference lib="webworker" />

import { convert, type ConversionSettings } from '../core/conversion';
import { generate, statistics } from '../core/gcode';
import { processImage } from '../core/image';
import type { ConversionMode, MachineProfile, Settings } from '../core/types';

type JobRequest = {
  type: 'run'; id: number; pixels: { width: number; height: number; data: ArrayBuffer };
  imageSettings: { brightness: number; contrast: number; invert: boolean; filter: string; threshold: number };
  conversionSettings: ConversionSettings; settings: Settings; profile: MachineProfile; mode: ConversionMode;
};
type JobProgress = { type: 'progress'; id: number; stage: string };
type JobResult = { type: 'result'; id: number; result: ReturnType<typeof generate>; stats: ReturnType<typeof statistics> };
type JobError = { type: 'error'; id: number; message: string };
const worker = self as unknown as DedicatedWorkerGlobalScope;

worker.onmessage = (event: MessageEvent<JobRequest>) => {
  const job = event.data;
  try {
    const progress = (stage: string) => worker.postMessage({ type: 'progress', id: job.id, stage } satisfies JobProgress);
    progress('Processing image…');
    const image = processImage({ width: job.pixels.width, height: job.pixels.height, data: new Uint8ClampedArray(job.pixels.data) }, job.imageSettings);
    progress('Generating toolpath…');
    const toolpath = convert(image, job.conversionSettings, job.mode);
    progress('Generating machine movements…');
    const result = generate(toolpath, job.settings, job.profile);
    progress('Calculating statistics…');
    const stats = statistics(result.moves);
    worker.postMessage({ type: 'result', id: job.id, result, stats } satisfies JobResult);
  } catch (error) {
    worker.postMessage({ type: 'error', id: job.id, message: error instanceof Error ? error.message : 'Toolpath processing failed.' } satisfies JobError);
  }
};
