import { describe, expect, it } from 'vitest';
import { buildMovements } from '../core/gcode';
import { defaults, profiles } from '../core/machine';
import { optimizeToolpath } from '../core/optimize';
import { packMoves, packedMoveBytes, timedPreviewFromPacked } from '../workers/packedMoves';
import { flattenVectorDocument } from './flatten';
import { parseSvgText } from './parseSvg';

type BenchmarkResult = {
  fixture: string;
  detailMm: number;
  nodes: number;
  paths: number;
  parsedSegments: number;
  flattenedPoints: number;
  optimizationMs: number;
  totalMs: number;
  packedBytes: number;
  previewSegments: number;
};

const wrap = (body: string) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" fill="none" stroke="black">${body}</svg>`;
const fixtures = {
  'simple-icon': wrap('<circle cx="50" cy="50" r="32"/><path d="M30 52 Q50 70 70 52"/><line x1="35" y1="35" x2="35" y2="36"/><line x1="65" y1="35" x2="65" y2="36"/>'),
  'many-short-paths': wrap(Array.from({ length: 400 }, (_, index) => { const x = index % 20 * 5; const y = Math.floor(index / 20) * 5; return `<line x1="${x}" y1="${y}" x2="${x + 2}" y2="${y + 1}"/>`; }).join('')),
  'bezier-heavy': wrap(Array.from({ length: 160 }, (_, index) => { const y = index % 80 + 10; return `<path d="M0 ${y} C25 ${y - 20} 75 ${y + 20} 100 ${y}"/>`; }).join('')),
  'nested-transforms': wrap(`${'<g transform="translate(.05 .05) rotate(.1)">'.repeat(60)}<ellipse cx="50" cy="50" rx="40" ry="18"/>${'</g>'.repeat(60)}`),
  'high-command': wrap(`<path d="M0 0 ${Array.from({ length: 3_000 }, (_, index) => `L${index % 100} ${Math.floor(index / 100)}`).join(' ')}"/>`),
};

function benchmark(fixture: string, source: string, detailMm: number): BenchmarkResult {
  const started = performance.now();
  const document = parseSvgText(source);
  const settings = { ...defaults, outputWidth: 100, outputHeight: 100, workWidth: 120, workHeight: 120, toolpathDetail: detailMm, noiseCleanup: 'off' as const };
  const flattened = flattenVectorDocument(document, settings);
  const optimizationStarted = performance.now();
  const optimized = optimizeToolpath(flattened.toolpath, settings).toolpath;
  const optimizationMs = performance.now() - optimizationStarted;
  const movements = buildMovements(optimized, settings, profiles[1]).moves;
  const packed = packMoves(movements);
  const preview = timedPreviewFromPacked(packed, 'balanced');
  return {
    fixture, detailMm, nodes: document.nodeCount, paths: document.paths.length,
    parsedSegments: document.segmentCount, flattenedPoints: flattened.flattenedPoints,
    optimizationMs, totalMs: performance.now() - started, packedBytes: packedMoveBytes(packed), previewSegments: preview.moves.length,
  };
}

describe('deterministic SVG performance fixtures', () => {
  it('benchmarks representative and pathological SVGs across physical detail levels', () => {
    const results: BenchmarkResult[] = [];
    for (const [fixture, source] of Object.entries(fixtures)) {
      for (const detail of [0.5, 0.1, 0.05, 0.025]) results.push(benchmark(fixture, source, detail));
    }
    for (const result of results) {
      expect(result.nodes).toBeGreaterThan(0);
      expect(result.paths).toBeGreaterThan(0);
      expect(result.parsedSegments).toBeGreaterThan(0);
      expect(result.flattenedPoints).toBeGreaterThan(0);
      expect(result.optimizationMs).toBeGreaterThanOrEqual(0);
      expect(result.totalMs).toBeGreaterThanOrEqual(result.optimizationMs);
      expect(result.packedBytes).toBeGreaterThan(0);
      expect(result.previewSegments).toBeGreaterThan(0);
    }
    // Keep benchmark output machine-readable for milestone reporting; no timing is
    // used as a correctness assertion because CI hosts vary.
    console.table(results);
  }, 20_000);
});
