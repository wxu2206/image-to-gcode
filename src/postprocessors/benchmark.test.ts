import { describe, expect, it } from 'vitest';
import { defaults, profiles } from '../core/machine';
import { generate } from '../core/gcode';
import type { MachineProfile, Move, PostProcessorId, Toolpath } from '../core/types';
import { requirePostProcessor } from './registry';

const sizes = [1_000, 25_000, 100_000, 250_000] as const;
const processors: PostProcessorId[] = ['generic', 'grbl-pen', 'grbl-laser', 'marlin-pen', 'generic-cnc'];
const settings = { ...defaults, precision: 3, feed: 1_200, travel: 2_400 };

const profileFor = (id: PostProcessorId): MachineProfile => {
  if (id === 'generic-cnc') return { ...profiles[0], header: '', toolOn: '', toolOff: '' };
  const kind = id === 'grbl-laser' ? 'laser' as const : 'pen' as const;
  return {
    ...profiles[1], kind, postProcessorId: id, header: '', footer: 'M2',
    toolOn: id === 'grbl-laser' ? 'M4 S100' : 'DOWN',
    toolOff: id === 'grbl-laser' ? 'M5' : 'UP',
  };
};

function moves(count: number): Move[] {
  return Array.from({ length: count }, (_, index) => ({
    command: 'G1' as const,
    from: { x: index % 997, y: Math.floor(index / 997) },
    to: { x: (index + 1) % 997, y: Math.floor((index + 1) / 997) },
    working: true,
    feed: 1_200,
  }));
}

function lineCount(code: string): number {
  let lines = 0;
  for (let index = 0; index < code.length; index += 1) if (code.charCodeAt(index) === 10) lines += 1;
  return lines;
}

describe('post-processor serialization benchmarks', () => {
  it('serializes representative canonical jobs deterministically at bounded linear sizes', () => {
    const results: Array<{ processor: string; moves: number; milliseconds: number; characters: number; lines: number }> = [];
    for (const size of sizes) {
      const canonical = moves(size);
      for (const id of processors) {
        const processor = requirePostProcessor(id);
        const profile = profileFor(id);
        const started = performance.now();
        const code = processor.serialize(canonical, { settings, profile, mode: 'benchmark' });
        results.push({ processor: id, moves: size, milliseconds: Number((performance.now() - started).toFixed(2)), characters: code.length, lines: lineCount(code) });
        expect(code).not.toMatch(/(?:NaN|Infinity)/);
        expect(code).toBe(processor.serialize(canonical, { settings, profile, mode: 'benchmark' }));
      }
    }
    expect(results).toHaveLength(sizes.length * processors.length);
  }, 30_000);

  it('benchmarks compatible processor switches from one retained optimized toolpath', () => {
    const pointCount = 25_001;
    const toolpath: Toolpath = {
      width: 1_000,
      height: 30,
      mode: 'contour',
      paths: [{
        id: 'retained',
        kind: 'work',
        points: Array.from({ length: pointCount }, (_, index) => ({ x: index % 1_000, y: Math.floor(index / 1_000) })),
      }],
    };
    const switchSettings = { ...settings, workWidth: 1_000, workHeight: 30, outputWidth: 1_000, outputHeight: 30 };
    const results: Array<{ processor: string; milliseconds: number; movements: number; characters: number }> = [];
    for (const id of ['generic', 'grbl-pen', 'grbl-laser', 'marlin-pen'] as const) {
      const started = performance.now();
      const generated = generate(toolpath, switchSettings, profileFor(id));
      results.push({ processor: id, milliseconds: Number((performance.now() - started).toFixed(2)), movements: generated.moves.length, characters: generated.code.length });
    }
    expect(results.every((result) => result.movements === 25_001 && result.characters > 400_000)).toBe(true);
  }, 15_000);
});
