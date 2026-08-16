import { describe, expect, it } from 'vitest';
import genericGolden from './fixtures/generic.gcode?raw';
import grblPenGolden from './fixtures/grbl-pen.gcode?raw';
import grblLaserGolden from './fixtures/grbl-laser.gcode?raw';
import marlinPenGolden from './fixtures/marlin-pen.gcode?raw';
import genericCncGolden from './fixtures/generic-cnc.gcode?raw';
import { generate } from '../core/gcode';
import { defaults, profiles } from '../core/machine';
import type { MachineProfile, PostProcessorId, Toolpath } from '../core/types';
import { getPostProcessor, listPostProcessors, migratePostProcessorId, requirePostProcessor } from './registry';

const settings = { ...defaults, workWidth: 10, workHeight: 10, outputWidth: 10, outputHeight: 10, offsetX: 0, offsetY: 0, feed: 100, travel: 200, precision: 2, passes: 1 };
const toolpath: Toolpath = { width: 10, height: 10, mode: 'contour', paths: [{ id: 'line', kind: 'work', points: [{ x: 1, y: 9 }, { x: 3, y: 7 }] }] };

const pen = (postProcessorId: PostProcessorId): MachineProfile => ({ ...profiles[1], postProcessorId, kind: 'pen', header: 'G17', footer: 'M2', toolOn: 'DOWN', toolOff: 'UP' });
const cases: Array<[PostProcessorId, MachineProfile, string]> = [
  ['generic', pen('generic'), genericGolden],
  ['grbl-pen', pen('grbl-pen'), grblPenGolden],
  ['grbl-laser', { ...profiles[2], postProcessorId: 'grbl-laser', kind: 'laser', header: 'G17', footer: 'M2', toolOn: 'M4 S100', toolOff: 'M5' }, grblLaserGolden],
  ['marlin-pen', pen('marlin-pen'), marlinPenGolden],
  ['generic-cnc', { ...profiles[0], header: 'G17', footer: 'M2', toolOn: '', toolOff: '' }, genericCncGolden],
];

describe('trusted post-processor registry', () => {
  it('has stable unique IDs and order', () => {
    expect(listPostProcessors().map((processor) => processor.id)).toEqual(['generic', 'grbl-pen', 'grbl-laser', 'marlin-pen', 'generic-cnc']);
    expect(new Set(listPostProcessors().map((processor) => processor.id)).size).toBe(5);
  });

  it('migrates unknown persisted IDs but blocks unknown active output', () => {
    expect(migratePostProcessorId('removed-controller')).toBe('generic');
    expect(getPostProcessor('removed-controller')).toBeNull();
    expect(() => requirePostProcessor('removed-controller')).toThrow('unavailable or untrusted');
  });

  it('publishes capability models without controller string checks in consumers', () => {
    expect(requirePostProcessor('grbl-pen').capabilities(pen('grbl-pen'))).toMatchObject({ supportsZ: false, requiresSafeZ: false, toolStateModel: 'pen' });
    expect(requirePostProcessor('grbl-laser').capabilities(cases[2][1])).toMatchObject({ supportsZ: false, toolStateModel: 'laser' });
    expect(requirePostProcessor('generic-cnc').capabilities(cases[4][1])).toMatchObject({ supportsZ: true, requiresSafeZ: true, toolStateModel: 'spindle' });
  });
});

describe('exact post-processor golden output', () => {
  it.each(cases)('%s is byte-identical and deterministic', (_id, profile, golden) => {
    const first = generate(toolpath, settings, profile);
    const second = generate(toolpath, settings, profile);
    expect(first.code).toBe(golden);
    expect(second.code).toBe(first.code);
  });

  it.each(cases)('%s respects inch mode without changing canonical physical conversion', (_id, profile) => {
    const result = generate(toolpath, { ...settings, units: 'in' }, profile);
    expect(result.code).toContain('G20');
    expect(result.code).not.toContain('G21');
    expect(result.moves[result.moves.length - 1]?.to.x).toBe(3);
  });

  it('requires explicit pen and laser state commands', () => {
    expect(() => generate(toolpath, settings, { ...pen('grbl-pen'), toolOn: '' })).toThrow('tool-on');
    expect(() => generate(toolpath, settings, { ...cases[2][1], toolOff: '' })).toThrow('tool-off');
  });

  it('never allows an unsafe CNC XY rapid through serialization', () => {
    const processor = requirePostProcessor('generic-cnc');
    expect(() => processor.serialize([{
      command: 'G0', from: { x: 0, y: 0, z: 0 }, to: { x: 2, y: 2, z: 5 }, working: false, feed: 200,
    }], { settings, profile: cases[4][1], mode: 'contour' })).toThrow('not fully retracted');
  });

  it('rejects non-finite canonical input instead of emitting malformed G-code', () => {
    const processor = requirePostProcessor('grbl-pen');
    expect(() => processor.serialize([{
      command: 'G1', from: { x: Number.NaN, y: 0 }, to: { x: 1, y: 1 }, working: true, feed: 100,
    }], { settings, profile: pen('grbl-pen'), mode: 'contour' })).toThrow('non-finite');
  });

  it('puts custom non-terminal shutdown commands before the mandatory final off state', () => {
    const profile = { ...pen('grbl-pen'), footer: 'M7\nM2' };
    const lines = generate(toolpath, settings, profile).code.trim().split('\n');
    expect(lines.slice(-3)).toEqual(['M7', 'UP', 'M2']);
  });

  it('changes syntax and tool state without changing controller-independent XY geometry', () => {
    const grbl = generate(toolpath, settings, pen('grbl-pen'));
    const marlin = generate(toolpath, settings, pen('marlin-pen'));
    expect(grbl.moves).toEqual(marlin.moves);
    expect(grbl.code).not.toBe(marlin.code);
  });

  it('emits one initial safe-off, keeps travel inactive, and ends pen and laser programs off', () => {
    for (const profile of [pen('grbl-pen'), cases[2][1], pen('marlin-pen')]) {
      const lines = generate(toolpath, settings, profile).code.trim().split('\n');
      const off = profile.toolOff;
      const on = profile.toolOn;
      const firstMotion = lines.findIndex((line) => /^G[01] /.test(line));
      expect(lines.indexOf(off)).toBeLessThan(firstMotion);
      expect(lines.indexOf(on)).toBeGreaterThan(firstMotion);
      expect(lines[lines.length - 2]).toBe(off);
      expect(lines[lines.length - 1]).toBe('M2');
    }
  });
});
