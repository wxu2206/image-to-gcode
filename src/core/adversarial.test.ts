import { describe, expect, it } from 'vitest';
import { buildExportReview } from './exportReview';
import { distance, machinePoint, scaleToOutput } from './geometry';
import { buildMovements, generate, statistics } from './gcode';
import { canonicalJobKey, isCurrentJobRevision, isCurrentRevision } from './jobRevision';
import { configurationErrors, defaults, profileErrors, profiles, validate } from './machine';
import type { MachineProfile, Path, Settings, Toolpath } from './types';
import { convertSettingsUnits, MM_PER_INCH } from './units';

const base: Settings = {
  ...defaults,
  workWidth: 100,
  workHeight: 80,
  outputWidth: 10,
  outputHeight: 10,
  offsetX: 10,
  offsetY: 10,
  lineSpacing: 1,
  precision: 3,
};

const makeToolpath = (paths: Path[], mode: Toolpath['mode'] = 'raster'): Toolpath => ({
  width: 10,
  height: 10,
  mode,
  paths,
});

const workPath = (id: string, points: Path['points']): Path => ({ id, kind: 'work', points });

describe('adversarial coordinate transforms', () => {
  it('inverts center-origin coordinates around zero without translating a full image extent', () => {
    const settings = { ...base, origin: 'center' as const, offsetX: 0, offsetY: 0 };
    const normal = machinePoint({ x: 2, y: 3 }, settings);
    const inverted = machinePoint({ x: 2, y: 3 }, { ...settings, invertX: true, invertY: true });
    expect(normal).toMatchObject({ x: -3, y: -2 });
    expect(inverted).toMatchObject({ x: 3, y: 2 });
  });

  it('restores local geometry after applying the same pair of axis reflections twice', () => {
    const settings = { ...base, rotationDeg: 0, origin: 'bottom-left' as const, invertX: true, invertY: true, offsetX: 0, offsetY: 0 };
    const original = { x: 1.25, y: 7.5 };
    expect(machinePoint(machinePoint(original, settings), settings)).toMatchObject(original);
  });

  it('preserves distance under translation, rotation, origins, and reflections', () => {
    const first = { x: 1.25, y: 2.5 };
    const second = { x: 8.5, y: 6.75 };
    const original = distance(first, second);
    for (const origin of ['bottom-left', 'top-left', 'center'] as const) {
      for (const rotationDeg of [0, 90, 180, 270, 37, -123]) {
        const settings = { ...base, origin, rotationDeg, invertX: true, offsetX: 31.5, offsetY: -7.25 };
        expect(distance(machinePoint(first, settings), machinePoint(second, settings))).toBeCloseTo(original, 10);
      }
    }
  });

  it('keeps a deterministic asymmetric transform matrix finite', () => {
    const path = makeToolpath([workPath('asymmetric', [{ x: 1, y: 2 }, { x: 8, y: 3 }, { x: 6, y: 9 }])]);
    for (const origin of ['bottom-left', 'top-left', 'center'] as const) {
      for (const rotationDeg of [0, 90, 180, 270, 33, -47]) {
        for (const invertX of [false, true]) {
          for (const invertY of [false, true]) {
            const settings = { ...base, origin, rotationDeg, invertX, invertY, offsetX: 40, offsetY: 35 };
            const first = generate(path, settings, profiles[1]);
            const second = generate(path, settings, profiles[1]);
            expect(first.code).toBe(second.code);
            expect(first.moves).toEqual(second.moves);
            expect(buildMovements(path, settings, profiles[1]).moves).toEqual(first.moves);
            expect(first.moves.every((move) => [move.from.x, move.from.y, move.to.x, move.to.y].every(Number.isFinite))).toBe(true);
            expect(first.code).not.toMatch(/(?:NaN|Infinity)/);
          }
        }
      }
    }
  });

  it('rejects zero or non-finite coordinate scaling inputs', () => {
    expect(() => scaleToOutput({ x: 1, y: 1 }, 0, 10, base)).toThrow('finite, positive');
    expect(() => scaleToOutput({ x: Infinity, y: 1 }, 10, 10, base)).toThrow('finite, positive');
  });

  it('treats work-area edges as inclusive and any real epsilon outside as out of bounds', () => {
    const exact = { ...defaults, workWidth: 10, workHeight: 5, outputWidth: 10, outputHeight: 5, offsetX: 0, offsetY: 0 };
    expect(validate(exact)).not.toContain('Transformed image exceeds the configured work area.');
    expect(validate({ ...exact, offsetX: -Number.EPSILON })).toContain('Transformed image exceeds the configured work area.');
    expect(validate({ ...exact, offsetY: 1e-12 })).toContain('Transformed image exceeds the configured work area.');
  });
});

describe('canonical precision and bounds', () => {
  it('quantizes canonical moves before preview statistics and catches rounding beyond machine bounds', () => {
    const settings = { ...base, workWidth: 1.6, workHeight: 1, outputWidth: 1.6, outputHeight: 1, offsetX: 0, offsetY: 0, precision: 0 };
    const generated = generate(makeToolpath([workPath('edge', [{ x: 0, y: 10 }, { x: 10, y: 0 }])]), settings, profiles[1]);
    const summary = statistics(generated.moves);
    expect(summary.bounds?.maxX).toBe(2);
    expect(generated.code).toContain('X2 Y1');
    expect(generated.warnings.some((warning) => warning.includes('outside work area'))).toBe(true);
    expect(buildExportReview({ settings, stats: summary, profile: profiles[1], warnings: generated.warnings, placementPending: false, current: true }).level).toBe('blocking');
  });

  it('never serializes negative zero', () => {
    const settings = { ...base, outputWidth: 1, outputHeight: 1, offsetX: -0.0004, offsetY: 0, precision: 3 };
    const generated = generate(makeToolpath([workPath('zero', [{ x: 0, y: 10 }, { x: 10, y: 0 }])]), settings, profiles[1]);
    expect(generated.code).not.toMatch(/[XYZF]-0(?:\D|$)/);
  });

  it('preserves integer trailing zeros at precision zero', () => {
    const settings = { ...base, outputWidth: 100, outputHeight: 20, offsetX: 0, offsetY: 0, precision: 0, feed: 600, travel: 1800 };
    const generated = generate(makeToolpath([workPath('integer-zeroes', [{ x: 0, y: 10 }, { x: 10, y: 0 }])]), settings, profiles[1]);
    expect(generated.code).toContain('G1 X100 Y20 F600');
    expect(generated.code).not.toContain('X1 Y2 F6');
  });

  it('rounds negative half steps symmetrically without producing negative zero', () => {
    const settings = { ...base, outputWidth: 10, outputHeight: 10, offsetX: -1.5, offsetY: 0, precision: 0 };
    const generated = generate(makeToolpath([workPath('negative-half', [{ x: 0, y: 10 }, { x: 1, y: 10 }])]), settings, profiles[1]);
    expect(generated.code).toContain('G0 X-2 Y0');
    expect(generated.code).not.toContain('X-0');
  });

  it('rejects malformed numeric geometry instead of emitting non-finite G-code', () => {
    const path = makeToolpath([workPath('bad', [{ x: 0, y: 0 }, { x: Number.NaN, y: 2 }])]);
    expect(() => generate(path, base, profiles[1])).toThrow('non-finite');
    expect(() => generate(makeToolpath([workPath('ok', [{ x: 0, y: 0 }, { x: 1, y: 1 }])]), { ...base, feed: Infinity }, profiles[1])).toThrow('malformed');
  });
});

describe('machine-control state sequencing', () => {
  const cncProfile: MachineProfile = { ...profiles[0], header: 'G91\nG20\nM3', toolOn: 'M3', toolOff: 'M5', footer: 'M2' };
  const disconnected = makeToolpath([
    workPath('first', [{ x: 2, y: 8 }, { x: 4, y: 8 }]),
    workPath('second', [{ x: 7, y: 4 }, { x: 9, y: 4 }]),
  ]);

  it('retracts CNC Z in a standalone move before the first XY rapid', () => {
    const generated = generate(disconnected, base, cncProfile);
    expect(generated.moves[0]).toMatchObject({ command: 'G0', zOnly: true, from: { x: 0, y: 0 }, to: { x: 0, y: 0, z: base.safeZ } });
    const firstXyTravel = generated.moves.find((move) => !move.working && !move.zOnly && (move.from.x !== move.to.x || move.from.y !== move.to.y));
    expect(firstXyTravel?.from.z).toBe(base.safeZ);
    expect(firstXyTravel?.to.z).toBe(base.safeZ);
    expect(generated.code.indexOf('G0 Z5')).toBeLessThan(generated.code.indexOf('G0 X12 Y12 Z5'));
  });

  it('reasserts units and absolute positioning after a hostile modal header and turns the tool off before travel', () => {
    const lines = generate(disconnected, base, cncProfile).code.trim().split('\n');
    const headerG91 = lines.indexOf('G91');
    const initialOff = lines.indexOf('M5');
    const authoritativeUnits = lines.slice(0, initialOff).lastIndexOf('G21');
    const authoritativeAbsolute = lines.slice(0, initialOff).lastIndexOf('G90');
    const firstMotion = lines.findIndex((line) => /^G0 /.test(line));
    expect(authoritativeUnits).toBeGreaterThan(headerG91);
    expect(authoritativeAbsolute).toBeGreaterThan(authoritativeUnits);
    expect(initialOff).toBeGreaterThan(authoritativeAbsolute);
    expect(initialOff).toBeLessThan(firstMotion);
  });

  it('reasserts motion modes after custom tool-state commands before generated motion', () => {
    const generated = generate(
      makeToolpath([workPath('modal-tool', [{ x: 2, y: 8 }, { x: 4, y: 8 }])]),
      base,
      { ...profiles[1], toolOn: 'G91\nM3', toolOff: 'G20\nM5' },
    );
    const lines = generated.code.trim().split('\n');
    const toolOn = lines.indexOf('G91');
    const workingMove = lines.findIndex((line) => line.startsWith('G1 '));
    const absoluteBeforeWork = lines.slice(0, workingMove).lastIndexOf('G90');
    expect(toolOn).toBeGreaterThanOrEqual(0);
    expect(absoluteBeforeWork).toBeGreaterThan(toolOn);
    expect(lines[workingMove]).toContain('X14 Y12');
  });

  it('retracts before every disconnected CNC travel and finishes retracted before the footer', () => {
    const generated = generate(disconnected, base, cncProfile);
    const xyTravels = generated.moves.filter((move) => !move.working && !move.zOnly && (move.from.x !== move.to.x || move.from.y !== move.to.y));
    expect(xyTravels).toHaveLength(2);
    expect(xyTravels.every((move) => move.from.z === base.safeZ && move.to.z === base.safeZ)).toBe(true);
    const lines = generated.code.trim().split('\n');
    expect(lines[lines.length - 2]).toBe('G0 Z5');
    expect(lines[lines.length - 1]).toBe('M2');
  });

  it('keeps travel-only paths inactive and uses rapid moves throughout', () => {
    const travel: Path = { id: 'positioning', kind: 'travel', points: [{ x: 1, y: 9 }, { x: 5, y: 5 }, { x: 9, y: 1 }] };
    const generated = generate(makeToolpath([travel]), base, { ...profiles[1], toolOn: 'DOWN', toolOff: 'UP' });
    expect(generated.moves.every((move) => move.command === 'G0' && !move.working)).toBe(true);
    expect(generated.code).not.toContain('DOWN');
  });

  it('strips source Z from pen and laser programs', () => {
    const path = makeToolpath([workPath('z', [{ x: 0, y: 0, z: -99 }, { x: 10, y: 10, z: -99 }])]);
    expect(generate(path, base, profiles[1]).code).not.toMatch(/\bZ/);
    expect(generate(path, base, profiles[2]).code).not.toMatch(/\bZ/);
  });

  it('estimates duration in minutes from units-per-minute feeds', () => {
    const summary = statistics([{ command: 'G1', from: { x: 0, y: 0 }, to: { x: 60, y: 0 }, working: true, feed: 60 }]);
    expect(summary.time).toBe(1);
    expect(summary.estimate).toEqual({ totalMinutes: 1, workMinutes: 1, travelMinutes: 0 });
  });

  it('separates working and travel time while retaining CNC Z travel in the estimate', () => {
    const summary = statistics([
      { command: 'G0', from: { x: 0, y: 0, z: 0 }, to: { x: 0, y: 0, z: 12 }, working: false, feed: 600, zOnly: true },
      { command: 'G1', from: { x: 0, y: 0, z: 12 }, to: { x: 30, y: 0, z: 12 }, working: true, feed: 300 },
    ]);
    expect(summary.estimate.workMinutes).toBeCloseTo(0.1);
    expect(summary.estimate.travelMinutes).toBeCloseTo(0.02);
    expect(summary.estimate.totalMinutes).toBeCloseTo(0.12);
  });

  it('handles empty, single zero-length, and Z-less statistics without invented extrema', () => {
    expect(statistics([])).toMatchObject({ movementCount: 0, work: 0, travel: 0, time: 0, bounds: null });
    const single = statistics([{ command: 'G1', from: { x: 2, y: 3 }, to: { x: 2, y: 3 }, working: true, feed: 100 }]);
    expect(single).toMatchObject({ movementCount: 1, working: 1, work: 0, time: 0, bounds: { minX: 2, maxX: 2, minY: 3, maxY: 3, minZ: null, maxZ: null } });
  });

  it('counts contour closure and scales working distance geometrically', () => {
    const square = makeToolpath([workPath('closed', [
      { x: 0, y: 10 }, { x: 10, y: 10 }, { x: 10, y: 0 }, { x: 0, y: 0 }, { x: 0, y: 10 },
    ])], 'contour');
    const unscaled = statistics(generate(square, { ...base, outputWidth: 10, outputHeight: 10, offsetX: 0, offsetY: 0, precision: 6 }, profiles[1]).moves);
    const scaled = statistics(generate(square, { ...base, outputWidth: 20, outputHeight: 20, offsetX: 23, offsetY: 17, precision: 6 }, profiles[1]).moves);
    expect(unscaled.work).toBeCloseTo(40, 8);
    expect(scaled.work).toBeCloseTo(80, 8);
  });
});

describe('grayscale depth and unit invariants', () => {
  it('maps white-to-black intensity continuously from surface to configured CNC depth', () => {
    const path = makeToolpath([workPath('gray', [
      { x: 0, y: 5, intensity: 0 },
      { x: 5, y: 5, intensity: 0.5 },
      { x: 10, y: 5, intensity: 1 },
    ])], 'grayscale');
    const generated = generate(path, { ...base, workZ: -1, maxDepth: -2, passes: 1 }, profiles[0]);
    const workingZ = generated.moves.filter((move) => move.working).map((move) => move.to.z);
    expect(workingZ).toEqual([0, -0.5, -1]);
  });

  it('warns when a non-CNC profile cannot map variable grayscale intensity', () => {
    const path = makeToolpath([workPath('gray', [{ x: 0, y: 0, intensity: 0 }, { x: 10, y: 10, intensity: 1 }])], 'grayscale');
    expect(buildMovements(path, base, profiles[2]).warnings).toContain('Variable grayscale intensity is only mapped to depth for CNC profiles.');
  });

  it('changes unit representation without changing physical geometry or profile pass depth', () => {
    const millimetres = { ...base, precision: 6, outputWidth: MM_PER_INCH, outputHeight: MM_PER_INCH, passes: 2, workZ: -1, maxDepth: -2 };
    const inches = convertSettingsUnits(millimetres, 'in');
    const path = makeToolpath([workPath('units', [{ x: 0, y: 10 }, { x: 10, y: 0 }])]);
    const mmPen = generate(path, millimetres, profiles[1]);
    const inPen = generate(path, inches, profiles[1]);
    const mmTarget = mmPen.moves.find((move) => move.working)!.to;
    const inTarget = inPen.moves.find((move) => move.working)!.to;
    expect(inTarget.x * MM_PER_INCH).toBeCloseTo(mmTarget.x, 4);
    expect(inTarget.y * MM_PER_INCH).toBeCloseTo(mmTarget.y, 4);
    expect(inPen.code).toContain('G20');

    const depths = generate(path, inches, profiles[0]).moves
      .filter((move) => move.working && move.from.x === move.to.x && move.from.y === move.to.y)
      .map((move) => (move.to.z ?? 0) * MM_PER_INCH);
    expect(depths[0]).toBeCloseTo(-1, 3);
    expect(depths[1]).toBeCloseTo(-2, 3);
  });
});

describe('configuration and revision integrity', () => {
  it('blocks equal safe/working Z, excessive passes, rounded-zero feeds, and invalid profile pass depth', () => {
    expect(configurationErrors({ ...base, safeZ: 0, workZ: 0, maxDepth: -1 })).toContain('Working Z values must be strictly below safe Z.');
    expect(configurationErrors({ ...base, safeZ: 5, workZ: 1, maxDepth: 0 })).toContain('CNC working depths must be zero or negative.');
    expect(configurationErrors({ ...base, passes: 101 })).toContain('Pass count must be an integer from 1 to 100.');
    expect(configurationErrors({ ...base, precision: 0, feed: 0.4 })).toContain('Feed rates round to zero at the selected precision.');
    expect(profileErrors({ ...profiles[0], passDepth: -1 })).toContain('Machine profile pass depth must be positive and reasonably bounded.');
    expect(() => generate(makeToolpath([workPath('unsafe-tool', [{ x: 0, y: 0 }, { x: 1, y: 1 }])]), base, { ...profiles[2], toolOn: 'M3', toolOff: '' })).toThrow('tool-off');
  });

  it('keys every output dependency while excluding preview-only preferences', () => {
    const original = canonicalJobKey(1, base, profiles[0], 'raster');
    const changes: Array<Partial<Settings>> = [
      { outputWidth: 11 }, { offsetX: 11 }, { rotationDeg: 17 }, { origin: 'center' },
      { invertX: true }, { feed: 601 }, { safeZ: 6 }, { passes: 2 },
      { threshold: 129 }, { serpentine: false }, { toolpathDetail: 0.4 }, { noiseCleanup: 'strong' },
      { brightness: 1 }, { filter: 'edge' }, { units: 'in' },
    ];
    for (const change of changes) expect(canonicalJobKey(1, { ...base, ...change }, profiles[0], 'raster')).not.toBe(original);
    expect(canonicalJobKey(2, base, profiles[0], 'raster')).not.toBe(original);
    expect(canonicalJobKey(1, base, profiles[0], 'contour')).not.toBe(original);
    expect(canonicalJobKey(1, base, { ...profiles[0], header: 'G17\nG54' }, 'raster')).not.toBe(original);
    expect(canonicalJobKey(1, { ...base, previewQuality: 'full', lockAspect: false, fit: false }, profiles[0], 'raster')).toBe(original);
    const geometry = makeToolpath([workPath('preview-independent', [{ x: 0, y: 0 }, { x: 10, y: 10 }])]);
    expect(generate(geometry, { ...base, previewQuality: 'low' }, profiles[1]).code)
      .toBe(generate(geometry, { ...base, previewQuality: 'full' }, profiles[1]).code);
    expect(isCurrentRevision(original, original)).toBe(true);
    expect(isCurrentRevision(original, null)).toBe(false);
    expect(isCurrentJobRevision({ id: 7, key: original }, 8, original)).toBe(false);
    expect(isCurrentJobRevision({ id: 8, key: original }, 8, original)).toBe(true);
  });

  it('rejects old asynchronous results across an adversarial revision sequence', () => {
    const first = canonicalJobKey(1, base, profiles[0], 'raster');
    const dense = canonicalJobKey(1, { ...base, toolpathDetail: 0.1 }, profiles[0], 'raster');
    const rotated = canonicalJobKey(1, { ...base, toolpathDetail: 0.1, rotationDeg: 90 }, profiles[0], 'raster');
    const replacement = canonicalJobKey(2, { ...base, toolpathDetail: 0.1, rotationDeg: 90 }, profiles[0], 'raster');
    const oldResult = { id: 1, key: first };
    expect(isCurrentJobRevision(oldResult, 2, dense)).toBe(false);
    expect(isCurrentJobRevision(oldResult, 3, rotated)).toBe(false);
    expect(isCurrentJobRevision(oldResult, 4, replacement)).toBe(false);
    // Returning to identical settings does not revive a completed buffer from
    // an older worker instance because the monotonic job id must also match.
    expect(isCurrentJobRevision(oldResult, 5, first)).toBe(false);
  });
});
