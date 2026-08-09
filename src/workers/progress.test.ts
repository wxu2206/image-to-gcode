import { describe, expect, it } from 'vitest';
import { applyWorkerProgress, initialProgress, isCurrentPreviewRequest, overallProgress, previewProgress, stageLabel, startingProgress } from './progress';

describe('pipeline progress', () => {
  it('uses weighted, bounded worker progress', () => {
    expect(overallProgress('image', 0)).toBe(0);
    expect(overallProgress('statistics', 1)).toBe(0.9);
    expect(overallProgress('reduce', 1)).toBe(0.16);
    expect(overallProgress('extract', 3)).toBeCloseTo(0.43);
    expect(overallProgress('extract', -3)).toBeGreaterThanOrEqual(0.16);
  });

  it('rejects stale worker progress and accepts only the active job', () => {
    expect(applyWorkerProgress(8, { type: 'progress', id: 7, stage: 'image', label: stageLabel.image, stageProgress: 1, overallProgress: 0.08 })).toBeNull();
    expect(applyWorkerProgress(8, { type: 'progress', id: 8, stage: 'gcode', label: stageLabel.gcode, stageProgress: 0.5, overallProgress: 0.8 })).toEqual({ label: 'Serializing G-code…', value: 0.8, active: true });
  });

  it('resets a new job and completes the rendering allocation at 100%', () => {
    expect(initialProgress()).toEqual({ label: 'Waiting for image…', value: 0, active: false });
    expect(startingProgress()).toEqual({ label: 'Processing image…', value: 0, active: true });
    expect(previewProgress(0, 100)).toBe(0.94);
    expect(previewProgress(100, 100)).toBe(1);
    expect(previewProgress(0, 0)).toBe(1);
  });

  it('rejects stale same-job preview requests after a quality change', () => {
    expect(isCurrentPreviewRequest(4, 3)).toBe(false);
    expect(isCurrentPreviewRequest(4, 4)).toBe(true);
    expect(isCurrentPreviewRequest(4, undefined)).toBe(true);
  });
});
