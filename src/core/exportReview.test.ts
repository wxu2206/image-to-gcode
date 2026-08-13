import { describe, expect, it } from 'vitest';
import { authorizeExport, buildPreflight, type PreflightInput } from './exportReview';
import { generate, statistics, type ToolpathStats } from './gcode';
import { canonicalJobKey, isCurrentRevision } from './jobRevision';
import { defaults, profiles } from './machine';
import type { MachineProfile, Move, Toolpath } from './types';

const toolpath: Toolpath = {
  width: 10,
  height: 10,
  mode: 'contour',
  paths: [{ id: 'square', kind: 'work', points: [{ x: 1, y: 9 }, { x: 9, y: 9 }, { x: 9, y: 1 }, { x: 1, y: 1 }, { x: 1, y: 9 }] }],
};
const cnc = profiles[0];
const built = generate(toolpath, defaults, cnc);
const validStats = statistics(built.moves, undefined, { machineKind: 'cnc', safeZ: defaults.safeZ, precision: defaults.precision });

const input = (overrides: Partial<PreflightInput> = {}): PreflightInput => ({
  settings: defaults,
  stats: validStats,
  pathCount: 1,
  profile: cnc,
  warnings: [],
  placementPending: false,
  current: true,
  ...overrides,
});

const withDiagnostics = (stats: ToolpathStats, values: Partial<ToolpathStats['diagnostics']>): ToolpathStats => ({
  ...stats,
  diagnostics: { ...stats.diagnostics, ...values },
});

describe('canonical G-code preflight', () => {
  it('provides the small golden safety fixture with deterministic exact findings', () => {
    const first = buildPreflight(input());
    const second = buildPreflight(input());
    expect(first).toEqual(second);
    expect(first.status).toBe('passed');
    expect(first).toMatchObject({ warningCount: 0, blockingCount: 0 });
    expect(first.checks.map(({ id, severity }) => `${id}:${severity}`)).toEqual([
      'completed-revision:pass',
      'configuration:pass',
      'canonical-coordinates:pass',
      'work-envelope-x:pass',
      'work-envelope-y:pass',
      'feed-values:pass',
      'cnc-z-range:pass',
      'tool-sequencing:pass',
      'movement-geometry:pass',
      'job-size:pass',
      'custom-commands:pass',
    ]);
    expect(first.summary).toMatchObject({ movementCount: validStats.movementCount, pathCount: 1, start: validStats.diagnostics.start, end: validStats.diagnostics.end });
  });

  it('uses canonical bounds and reports axis-specific overrun in current units', () => {
    const stats = { ...validStats, bounds: { ...validStats.bounds!, maxX: defaults.workWidth + 3.4 } };
    const result = buildPreflight(input({ stats }));
    expect(result.status).toBe('blocked');
    expect(result.checks.find((item) => item.id === 'work-envelope-x')).toMatchObject({ severity: 'blocking', message: 'X exceeds maximum by 3.400 mm.' });
    expect(result.checks.find((item) => item.id === 'work-envelope-y')?.severity).toBe('pass');
  });

  it('blocks non-finite canonical coordinates even when finite points still produce bounds', () => {
    const moves: Move[] = [
      { command: 'G0', from: { x: 0, y: 0 }, to: { x: 1, y: 1 }, working: false, feed: 100 },
      { command: 'G1', from: { x: 1, y: 1 }, to: { x: Number.NaN, y: 2 }, working: true, feed: 100 },
    ];
    const result = buildPreflight(input({ stats: statistics(moves) }));
    expect(result.checks.find((item) => item.id === 'canonical-coordinates')).toMatchObject({ severity: 'blocking' });
  });

  it.each([0, -10, Number.NaN, Number.POSITIVE_INFINITY])('blocks invalid configured feed %s', (feed) => {
    const result = buildPreflight(input({ settings: { ...defaults, feed } }));
    expect(result.checks.find((item) => item.id === 'feed-values')?.severity).toBe('blocking');
  });

  it('blocks invalid generated feed values independently of settings', () => {
    const stats = withDiagnostics(validStats, { invalidFeedCount: 2 });
    expect(buildPreflight(input({ stats })).checks.find((item) => item.id === 'feed-values')).toMatchObject({ severity: 'blocking' });
  });

  it('blocks invalid CNC Z configuration and canonical Z outside the configured range', () => {
    const invalidSettings = buildPreflight(input({ settings: { ...defaults, safeZ: -1, workZ: 0 } }));
    expect(invalidSettings.checks.find((item) => item.id === 'cnc-z-range')?.severity).toBe('blocking');
    const outside = { ...validStats, bounds: { ...validStats.bounds!, minZ: defaults.maxDepth - 0.5 } };
    expect(buildPreflight(input({ stats: outside })).checks.find((item) => item.id === 'cnc-z-range')?.severity).toBe('blocking');
    const unexpectedCut = withDiagnostics(validStats, { maxWorkingZ: 1 });
    expect(buildPreflight(input({ stats: unexpectedCut })).checks.find((item) => item.id === 'cnc-z-range')?.severity).toBe('blocking');
    const missingCutDepth = withDiagnostics(validStats, { missingCncWorkingZCount: 1 });
    expect(buildPreflight(input({ stats: missingCutDepth })).checks.find((item) => item.id === 'cnc-z-range')?.severity).toBe('blocking');
    expect(buildPreflight(input({ settings: { ...defaults, passes: 0 } })).checks.find((item) => item.id === 'cnc-z-range')?.severity).toBe('blocking');
    expect(buildPreflight(input({ profile: { ...cnc, passDepth: -1 } })).checks.find((item) => item.id === 'cnc-z-range')?.severity).toBe('blocking');
  });

  it('omits CNC Z checks for a valid pen profile', () => {
    const pen: MachineProfile = { ...profiles[1], toolOn: 'PEN DOWN', toolOff: 'PEN UP' };
    const penBuilt = generate(toolpath, defaults, pen);
    const result = buildPreflight(input({ profile: pen, stats: statistics(penBuilt.moves), warnings: penBuilt.warnings }));
    expect(result.checks.some((item) => item.id === 'cnc-z-range')).toBe(false);
    expect(result.checks.find((item) => item.id === 'tool-sequencing')?.severity).toBe('pass');
  });

  it('blocks discontinuities, invalid work/travel states, and unsafe CNC XY rapids', () => {
    const stats = withDiagnostics(validStats, { discontinuityCount: 1, invalidStateCount: 2, unsafeCncRapidCount: 1 });
    const sequence = buildPreflight(input({ stats })).checks.find((item) => item.id === 'tool-sequencing');
    expect(sequence).toMatchObject({ severity: 'blocking' });
    expect(sequence?.message).toContain('safe Z');
  });

  it('uses existing command-pairing validation as a blocking tool-state check', () => {
    const profile = { ...profiles[1], toolOn: 'DOWN', toolOff: '' };
    expect(buildPreflight(input({ profile })).checks.find((item) => item.id === 'tool-sequencing')).toMatchObject({ severity: 'blocking' });
  });

  it('warns for materially redundant zero-length movements but not an isolated one', () => {
    const one = buildPreflight(input({ stats: withDiagnostics(validStats, { zeroLengthMoveCount: 1 }) }));
    expect(one.checks.find((item) => item.id === 'movement-geometry')?.severity).toBe('pass');
    const manyStats = { ...validStats, movementCount: 100, working: 50, travels: 50, diagnostics: { ...validStats.diagnostics, zeroLengthMoveCount: 3 } };
    const many = buildPreflight(input({ stats: manyStats }));
    expect(many.checks.find((item) => item.id === 'movement-geometry')).toMatchObject({ severity: 'warning' });
  });

  it('warns for completed large and extreme jobs without blocking them', () => {
    const stats = { ...validStats, movementCount: 312_481, working: 300_000, travels: 12_481 };
    const result = buildPreflight(input({ stats }));
    expect(result.checks.find((item) => item.id === 'job-size')).toMatchObject({ severity: 'warning' });
    expect(result.blockingCount).toBe(0);
  });

  it('warns that modified or user-defined custom command blocks are not simulated', () => {
    const profile = { ...cnc, id: 'custom-cnc', header: 'G90\nG17\nM7' };
    const result = buildPreflight(input({ profile }));
    expect(result.checks.find((item) => item.id === 'custom-commands')).toMatchObject({ severity: 'warning' });
  });

  it('blocks a stale or placement-pending revision', () => {
    for (const overrides of [{ current: false }, { placementPending: true }]) {
      const result = buildPreflight(input(overrides));
      expect(result.status).toBe('blocked');
      expect(result.checks[0]).toMatchObject({ id: 'completed-revision', severity: 'blocking' });
      expect(result.summary).toBeNull();
    }
  });

  it('keeps preview-only changes current and invalidates output-affecting changes through the canonical key', () => {
    const completedKey = canonicalJobKey(1, defaults, cnc, 'contour');
    const previewOnlyKey = canonicalJobKey(1, { ...defaults, previewQuality: 'full' }, cnc, 'contour');
    const outputKey = canonicalJobKey(1, { ...defaults, feed: defaults.feed + 1 }, cnc, 'contour');
    expect(isCurrentRevision(completedKey, previewOnlyKey)).toBe(true);
    expect(buildPreflight(input({ current: isCurrentRevision(completedKey, previewOnlyKey) })).status).toBe('passed');
    expect(isCurrentRevision(completedKey, outputKey)).toBe(false);
    expect(buildPreflight(input({ current: isCurrentRevision(completedKey, outputKey) })).status).toBe('blocked');
  });

  it('does not treat exact machine boundaries or valid negative center-origin assumptions specially', () => {
    const boundaryStats = { ...validStats, bounds: { ...validStats.bounds!, minX: 0, maxX: defaults.workWidth, minY: 0, maxY: defaults.workHeight } };
    expect(buildPreflight(input({ stats: boundaryStats })).checks.filter((item) => item.id.startsWith('work-envelope')).every((item) => item.severity === 'pass')).toBe(true);
    const centered = buildPreflight(input({ settings: { ...defaults, origin: 'center' }, stats: { ...validStats, bounds: { ...validStats.bounds!, minX: -1 } } }));
    expect(centered.checks.find((item) => item.id === 'work-envelope-x')?.message).toContain('below the configured work area');
  });
});

describe('preflight export policy and lazy generation', () => {
  it('applies the same review policy to Copy and Download intents', () => {
    const warning = buildPreflight(input({ profile: { ...cnc, id: 'custom', footer: 'M30' } }));
    for (const action of ['copy', 'download'] as const) {
      expect(action).toBeTruthy();
      expect(authorizeExport(warning, action, false)).toEqual({ allowed: false, reason: 'Review and explicitly accept preflight warnings before export.' });
      expect(authorizeExport(warning, action, true)).toEqual({ allowed: true });
    }
    expect(warning.warningCount).toBe(warning.checks.filter((item) => item.severity === 'warning').length);
    expect(warning.blockingCount).toBe(warning.checks.filter((item) => item.severity === 'blocking').length);
  });

  it('never allows blocking findings to be overridden', () => {
    const blocked = buildPreflight(input({ current: false }));
    expect(authorizeExport(blocked, 'copy', false).allowed).toBe(false);
    expect(authorizeExport(blocked, 'download', true).allowed).toBe(false);
  });

  it('preflights canonical statistics without requiring a serialized G-code document', () => {
    const result = buildPreflight(input());
    expect(result.status).toBe('passed');
    expect(Object.prototype.hasOwnProperty.call(result, 'code')).toBe(false);
    expect(authorizeExport(result, 'download', false)).toEqual({ allowed: true });
  });
});
