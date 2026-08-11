import { machinePoint } from '../core/geometry';
import type { Move, Point, Settings } from '../core/types';

export type PreviewMode = 'original' | 'processed' | 'toolpath';

/**
 * A bounded grayscale bitmap returned by the existing processing worker.  It is
 * intentionally separate from canonical toolpath state: it informs the canvas
 * only and never participates in G-code generation.
 */
export type ProcessedPreview = {
  jobId: number;
  jobKey: string;
  processingKey: string;
  width: number;
  height: number;
  data: Uint8ClampedArray;
};

export function processingPreviewKey(sourceRevision: number, settings: Pick<Settings, 'brightness' | 'contrast' | 'invert' | 'filter' | 'threshold'>): string {
  return JSON.stringify([sourceRevision, settings.brightness, settings.contrast, settings.invert, settings.filter, settings.threshold]);
}

export function isCurrentProcessedPreview(preview: ProcessedPreview | null, processingKey: string | null): preview is ProcessedPreview {
  return Boolean(preview && processingKey && preview.processingKey === processingKey);
}

/** Converts the worker's one-byte grayscale representation into canvas RGBA. */
export function grayscaleToRgba(data: Uint8ClampedArray): Uint8ClampedArray {
  const rgba = new Uint8ClampedArray(data.length * 4);
  for (let index = 0; index < data.length; index += 1) {
    const value = data[index];
    const target = index * 4;
    rgba[target] = value;
    rgba[target + 1] = value;
    rgba[target + 2] = value;
    rgba[target + 3] = 255;
  }
  return rgba;
}

/**
 * Maps source-image corners through the same physical transform used by the
 * G-code generator. Source image coordinates are top-left/Y-down, while
 * machinePoint receives physical image coordinates that are Y-up.
 */
export function imagePlacementCorners(settings: Settings): { topLeft: Point; topRight: Point; bottomLeft: Point } {
  return {
    topLeft: machinePoint({ x: 0, y: settings.outputHeight }, settings),
    topRight: machinePoint({ x: settings.outputWidth, y: settings.outputHeight }, settings),
    bottomLeft: machinePoint({ x: 0, y: 0 }, settings),
  };
}

/** Start/end markers represent the first and last tool-active preview move. */
export function activePathEndpoints(moves: Move[] | null): { start: Point; end: Point } | null {
  if (!moves?.length) return null;
  let start: Point | null = null;
  let end: Point | null = null;
  for (const move of moves) {
    if (!move.working) continue;
    if (!start) start = move.from;
    end = move.to;
  }
  return start && end ? { start, end } : null;
}
