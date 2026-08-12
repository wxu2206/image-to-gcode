import { describe, expect, it } from 'vitest';
import { generate } from '../core/gcode';
import { defaults, profiles } from '../core/machine';
import type { Toolpath } from '../core/types';
import { activePathEndpoints, grayscaleToRgba, imagePlacementCorners, isCurrentProcessedPreview, processingPreviewKey, type PreviewMode } from './preview';

describe('preview-only state', () => {
  const toolpath: Toolpath = { mode: 'raster', width: 2, height: 1, paths: [{ id: 'line', kind: 'work', points: [{ x: 0, y: 0 }, { x: 2, y: 0 }] }] };
  const settings = { ...defaults, outputWidth: 20, outputHeight: 10 };

  it('keeps generated G-code unchanged when preview mode, overlays, or viewport change', () => {
    const before = generate(toolpath, settings, profiles[1]).code;
    const preview: { mode: PreviewMode; travel: boolean; endpoints: boolean; zoom: number; pan: { x: number; y: number } } = {
      mode: 'toolpath', travel: true, endpoints: true, zoom: 1, pan: { x: 0, y: 0 },
    };
    preview.mode = 'processed'; preview.travel = false; preview.endpoints = false; preview.zoom = 4; preview.pan = { x: 120, y: -32 };
    expect(generate(toolpath, settings, profiles[1]).code).toBe(before);
  });

  it('uses only source and image-processing settings for the processed-preview revision', () => {
    const key = processingPreviewKey(4, settings);
    const repositioned = { ...settings, outputWidth: 99, offsetX: 20 };
    expect(processingPreviewKey(4, repositioned)).toBe(key);
    expect(processingPreviewKey(4, { ...settings, invert: !settings.invert })).not.toBe(key);
    expect(processingPreviewKey(4, { ...settings, noiseCleanup: 'strong' })).not.toBe(key);
    expect(isCurrentProcessedPreview({ jobId: 9, jobKey: 'job', processingKey: key, width: 1, height: 1, data: new Uint8ClampedArray([0]) }, key)).toBe(true);
    expect(isCurrentProcessedPreview({ jobId: 9, jobKey: 'job', processingKey: key, width: 1, height: 1, data: new Uint8ClampedArray([0]) }, `${key}-new`)).toBe(false);
  });

  it('converts grayscale pixels to opaque canvas data without changing intensity', () => {
    expect([...grayscaleToRgba(new Uint8ClampedArray([0, 128, 255]))]).toEqual([0, 0, 0, 255, 128, 128, 128, 255, 255, 255, 255, 255]);
  });

  it('maps the visual source top edge through the authoritative placement transform', () => {
    const placed = { ...settings, outputWidth: 40, outputHeight: 20, offsetX: 8, offsetY: 4, rotationDeg: 90, invertX: true };
    const corners = imagePlacementCorners(placed);
    expect(corners.topLeft).toMatchObject({ x: 38, y: -6 });
    expect(corners.topRight).toMatchObject({ x: 38, y: 34 });
    expect(corners.bottomLeft).toMatchObject({ x: 18, y: -6 });
  });

  it('selects active path endpoints without treating travel as drawing', () => {
    expect(activePathEndpoints([
      { command: 'G0', from: { x: 0, y: 0 }, to: { x: 4, y: 4 }, working: false },
      { command: 'G1', from: { x: 4, y: 4 }, to: { x: 8, y: 4 }, working: true },
      { command: 'G0', from: { x: 8, y: 4 }, to: { x: 9, y: 4 }, working: false },
      { command: 'G1', from: { x: 9, y: 4 }, to: { x: 9, y: 8 }, working: true },
    ])).toEqual({ start: { x: 4, y: 4 }, end: { x: 9, y: 8 } });
  });
});
