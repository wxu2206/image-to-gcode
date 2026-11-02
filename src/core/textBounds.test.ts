import { describe, expect, it } from 'vitest';
import { layoutText } from '../text/layout';
import { defaultTextLayout } from '../text/types';
import { buildMovements, statistics } from './gcode';
import { defaults, profiles } from './machine';
import { authorizeExport, buildPreflight } from './exportReview';

describe('text work-envelope warnings', () => {
  const toolpath = layoutText({ text: 'FIRST LINE\nSECOND LINE', page: 0, layout: defaultTextLayout }).toolpath;
  const settings = { ...defaults, outputWidth: 210, outputHeight: 297, workWidth: 300, workHeight: 200 };
  it('diagnoses real default-page overflow and aggregates paths without changing blocking bounds', () => {
    const generated = buildMovements(toolpath, settings, profiles[0]);
    const stats = statistics(generated.moves, undefined, { machineKind: 'cnc', safeZ: settings.safeZ, precision: settings.precision });
    expect(stats.bounds!.maxY).toBeGreaterThan(270);
    expect(generated.warnings.filter((warning) => /outside work area/.test(warning))).toHaveLength(1);
    expect(generated.warnings.join(' ')).toMatch(/\d+ paths outside work area/);
    expect(generated.warnings.length).toBeLessThanOrEqual(2);
    const preflight = buildPreflight({ settings, stats, pathCount: toolpath.paths.length, profile: profiles[0], warnings: generated.warnings, placementPending: false, current: true });
    expect(preflight.checks.find((check) => check.id === 'work-envelope-y')?.severity).toBe('blocking');
    expect(authorizeExport(preflight, 'download', true).allowed).toBe(false);
  });
  it('has no out-of-bounds warning for a fitting page and blocks a deliberately shifted page', () => {
    const fitting = { ...settings, workHeight: 320 };
    expect(buildMovements(toolpath, fitting, profiles[0]).warnings).toEqual([]);
    const shifted = buildMovements(toolpath, { ...fitting, offsetX: 400 }, profiles[0]);
    expect(shifted.warnings.join(' ')).toContain(`${toolpath.paths.length} paths outside work area`);
    expect(shifted.moves.some((move) => move.to.x > 300)).toBe(true);
  });
});
