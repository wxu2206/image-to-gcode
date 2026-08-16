import { describe, expect, it } from 'vitest';
import { buildPreflight } from '../core/exportReview';
import { statistics } from '../core/gcode';
import { defaults, profiles } from '../core/machine';
import type { Move } from '../core/types';
import { isWorkerMessage } from './messages';
import { packMoves, previewFromPacked } from './packedMoves';
import { stageLabel } from './progress';

describe('packed movement integrity', () => {
  it('preserves XY, command, working state, and visual run boundaries', () => {
    const moves: Move[] = [
      { command: 'G0', from: { x: 0, y: 0, z: 5 }, to: { x: 2, y: 2, z: 5 }, working: false, pathId: 'a' },
      { command: 'G1', from: { x: 2, y: 2, z: 5 }, to: { x: 3, y: 2, z: -1 }, working: true, pathId: 'a' },
      { command: 'G0', from: { x: 3, y: 2, z: 5 }, to: { x: 7, y: 4, z: 5 }, working: false, pathId: 'b' },
    ];
    const preview = previewFromPacked(packMoves(moves), 'full');
    expect(preview).toEqual(moves.map((move) => ({
      command: move.command,
      from: { x: move.from.x, y: move.from.y },
      to: { x: move.to.x, y: move.to.y },
      working: move.working,
    })));
  });

  it('rejects malformed counts and buffer strides', () => {
    expect(() => previewFromPacked({ count: 2, coordinates: new Float64Array(4), durations: new Float64Array(2), flags: new Uint8Array(2) }, 'low')).toThrow('inconsistent');
    expect(() => previewFromPacked({ count: -1, coordinates: new Float64Array(), durations: new Float64Array(), flags: new Uint8Array() }, 'low')).toThrow('inconsistent');
  });

  it('allows preview decimation to omit an extreme while canonical bounds still block export', () => {
    const moves: Move[] = [];
    let cursor = 0;
    for (let index = 0; index < 20_000; index += 1) {
      const target = index === 1 ? 1_000 : index === 2 ? 0 : index % 2;
      moves.push({ command: 'G1', from: { x: cursor, y: 1 }, to: { x: target, y: 1 }, working: true, feed: 100, pathId: 'one-run' });
      cursor = target;
    }
    const preview = previewFromPacked(packMoves(moves), 'low');
    const previewMaxX = preview.reduce((maximum, move) => Math.max(maximum, move.from.x, move.to.x), -Infinity);
    const canonical = statistics(moves);
    expect(previewMaxX).toBeLessThanOrEqual(1);
    expect(canonical.bounds?.maxX).toBe(1_000);
    const settings = { ...defaults, workWidth: 10, workHeight: 10, outputWidth: 5, outputHeight: 5 };
    expect(buildPreflight({ settings, stats: canonical, pathCount: 1, profile: profiles[1], warnings: [], placementPending: false, current: true }).status).toBe('blocked');
  });
});

describe('worker message trust boundary', () => {
  it('accepts structurally valid progress and inert G-code text', () => {
    expect(isWorkerMessage({ type: 'progress', id: 1, stage: 'preview', label: stageLabel.preview, stageProgress: 0.5, overallProgress: 0.9, requestId: 2 })).toBe(true);
    const code = '<script>alert(1)</script>\n';
    expect(isWorkerMessage({ type: 'gcode-result', id: 1, requestId: 2, code, characters: code.length, lines: 1 })).toBe(true);
    expect(isWorkerMessage({ type: 'processed-preview-result', id: 1, preview: { width: 2, height: 1, data: new Uint8Array([0, 255]).buffer } })).toBe(true);
    const endMinutes = new Float64Array([0.5]);
    expect(isWorkerMessage({
      type: 'preview-result', id: 1, requestId: 1,
      moves: [{ command: 'G1', from: { x: 0, y: 0 }, to: { x: 1, y: 0 }, working: true }],
      timing: { endMinutes: endMinutes.buffer, totalMinutes: 0.5 }, segments: 1, previewMs: 1,
    })).toBe(true);
  });

  it('rejects malformed response envelopes, non-finite preview coordinates, and inconsistent metadata', () => {
    expect(isWorkerMessage({ type: 'result', id: 1, warnings: [], stats: null, timings: {}, sentAt: 0 })).toBe(false);
    expect(isWorkerMessage({
      type: 'preview-result',
      id: 1,
      requestId: 1,
      moves: [{ command: 'G1', from: { x: Number.NaN, y: 0 }, to: { x: 1, y: 1 }, working: true }],
      timing: { endMinutes: new Float64Array([1]).buffer, totalMinutes: 1 },
      segments: 1,
      previewMs: 1,
    })).toBe(false);
    expect(isWorkerMessage({ type: 'preview-result', id: 1, requestId: 1, moves: [], timing: { endMinutes: new Float64Array(0).buffer, totalMinutes: 2 }, segments: 0, previewMs: 1 })).toBe(false);
    expect(isWorkerMessage({ type: 'gcode-result', id: 1, requestId: 2, code: 'G90\n', characters: 999, lines: 1 })).toBe(false);
    expect(isWorkerMessage({ type: 'processed-preview-result', id: 1, preview: { width: 2, height: 1, data: new Uint8Array([0]).buffer } })).toBe(false);
    expect(isWorkerMessage({ type: 'error', id: 1, stage: 'other', message: 'bad' })).toBe(false);
  });

  it('accepts compact canonical diagnostics and rejects malformed diagnostic counts', () => {
    const stats = statistics([{ command: 'G0', from: { x: 0, y: 0 }, to: { x: 1, y: 0 }, working: false, feed: 100 }]);
    const timings = {
      imageMs: 1, reductionMs: 1, extractionMs: 1, orderingMs: 1, movementMs: 1,
      gcodeMs: 0, statisticsMs: 1, totalMs: 6, pathCount: 1, pointCount: 2,
      movementCount: 1, gcodeCharacters: 0, packedMovementBytes: 64, transferBytes: 1,
      sourceSegmentCount: 0, flattenedPointCount: 0,
    };
    const message = { type: 'result', id: 1, warnings: [], stats, timings, sentAt: 1 };
    expect(isWorkerMessage(message)).toBe(true);
    expect(isWorkerMessage({ ...message, stats: { ...stats, diagnostics: { ...stats.diagnostics, invalidFeedCount: -1 } } })).toBe(false);
  });
});
