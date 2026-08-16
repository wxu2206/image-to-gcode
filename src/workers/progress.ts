export type WorkerStage = 'image' | 'reduce' | 'extract' | 'order' | 'movements' | 'gcode' | 'statistics' | 'preview' | 'serialize';

export type WorkerProgressMessage = {
  type: 'progress';
  id: number;
  stage: WorkerStage;
  label: string;
  stageProgress: number;
  overallProgress: number;
  requestId?: number;
};

export type WorkerTimings = {
  imageMs: number;
  reductionMs: number;
  extractionMs: number;
  orderingMs: number;
  movementMs: number;
  gcodeMs: number;
  statisticsMs: number;
  totalMs: number;
  pathCount: number;
  pointCount: number;
  movementCount: number;
  gcodeCharacters: number;
  packedMovementBytes: number;
  transferBytes: number;
  sourceSegmentCount: number;
  flattenedPointCount: number;
};

export type PipelineProgress = {
  label: string;
  value: number;
  active: boolean;
};

// The weights are intentionally biased toward conversion and program generation:
// those are the measured expensive stages for dense raster and contour jobs.
const RANGES: Record<WorkerStage, readonly [number, number]> = {
  image: [0, 0.08],
  reduce: [0.08, 0.16],
  extract: [0.16, 0.43],
  order: [0.43, 0.49],
  movements: [0.49, 0.72],
  gcode: [0.72, 0.88],
  statistics: [0.88, 0.9],
  preview: [0.9, 0.94],
  serialize: [0, 1],
};

export const stageLabel: Record<WorkerStage, string> = {
  image: 'Processing image…',
  reduce: 'Reducing to machine resolution…',
  extract: 'Extracting geometry…',
  order: 'Ordering paths…',
  movements: 'Building machine movements…',
  gcode: 'Serializing G-code…',
  statistics: 'Calculating statistics…',
  preview: 'Preparing preview…',
  serialize: 'Generating G-code…',
};

export function clampProgress(value: number): number {
  return Math.min(1, Math.max(0, Number.isFinite(value) ? value : 0));
}

export function overallProgress(stage: WorkerStage, stageProgress: number): number {
  const [start, end] = RANGES[stage];
  return start + (end - start) * clampProgress(stageProgress);
}

export function initialProgress(): PipelineProgress {
  return { label: 'Waiting for image…', value: 0, active: false };
}

export function startingProgress(): PipelineProgress {
  return { label: stageLabel.image, value: 0, active: true };
}

export function applyWorkerProgress(currentJobId: number, message: WorkerProgressMessage): PipelineProgress | null {
  if (message.id !== currentJobId) return null;
  return { label: message.label, value: clampProgress(message.overallProgress), active: true };
}

export function isCurrentPreviewRequest(currentRequestId: number, incomingRequestId: number | undefined): boolean {
  return incomingRequestId === undefined || incomingRequestId === currentRequestId;
}

export function previewProgress(rendered: number, total: number): number {
  return total <= 0 ? 1 : 0.94 + 0.06 * clampProgress(rendered / total);
}
