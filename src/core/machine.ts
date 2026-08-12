import type { MachineProfile, Settings } from './types';
import { transformedBounds } from './transform';

export const MAX_DIMENSION = 1_000_000;
export const MAX_FEED_RATE = 1_000_000;
export const MAX_PASSES = 100;
const MAX_Z_MAGNITUDE = 1_000_000;
const MAX_CUSTOM_PROFILES = 100;

export const profiles: MachineProfile[] = [
  { id: 'cnc', name: 'Generic CNC Router', kind: 'cnc', header: 'G90\nG17', footer: 'M2', toolOn: '', toolOff: '', safeZ: 5, workZ: -1, passDepth: 1, feed: 600, travel: 1800 },
  { id: 'pen', name: 'Generic Pen Plotter', kind: 'pen', header: 'G90', footer: 'M2', toolOn: '', toolOff: '', safeZ: 5, workZ: 0, passDepth: 1, feed: 1500, travel: 3000 },
  { id: 'laser', name: 'Generic XY Laser-Style', kind: 'laser', header: 'G90', footer: 'M2', toolOn: '', toolOff: '', safeZ: 0, workZ: 0, passDepth: 1, feed: 1200, travel: 3000 },
];

export const defaults: Settings = {
  units: 'mm', workWidth: 300, workHeight: 200, outputWidth: 150, outputHeight: 100,
  lockAspect: true, offsetX: 0, offsetY: 0, rotationDeg: 0, origin: 'bottom-left',
  invertX: false, invertY: false, feed: 600, travel: 1800, safeZ: 5, workZ: -1,
  maxDepth: -2, passes: 1, lineSpacing: 0.5, precision: 3, threshold: 128,
  serpentine: true, simplify: 1, toolpathDetail: 0.3, noiseCleanup: 'light', previewQuality: 'balanced',
  brightness: 0, contrast: 0, invert: false, filter: 'grayscale', fit: true,
};

const record = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);
const finite = (value: unknown, fallback: number) => typeof value === 'number' && Number.isFinite(value) ? value : fallback;
const bounded = (value: unknown, fallback: number, minimum: number, maximum: number) => {
  const parsed = finite(value, fallback);
  return parsed >= minimum && parsed <= maximum ? parsed : fallback;
};
const positive = (value: unknown, fallback: number, maximum: number) => {
  const parsed = finite(value, fallback);
  return parsed > 0 && parsed <= maximum ? parsed : fallback;
};
const integer = (value: unknown, fallback: number, minimum: number, maximum: number) => {
  const parsed = finite(value, fallback);
  return Number.isInteger(parsed) && parsed >= minimum && parsed <= maximum ? parsed : fallback;
};
const flag = (value: unknown, fallback: boolean) => typeof value === 'boolean' ? value : fallback;
const text = (value: unknown, fallback: string, maximum = 16_384) => typeof value === 'string' ? value.slice(0, maximum) : fallback;
const oneOf = <T extends string>(value: unknown, values: readonly T[], fallback: T): T =>
  typeof value === 'string' && values.includes(value as T) ? value as T : fallback;

/** localStorage is untrusted input: reconstruct only bounded, known settings fields. */
export const loadSettings = (): Settings => {
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem('i2g-settings') || '{}');
    if (!record(parsed)) return { ...defaults };
    return {
      units: oneOf(parsed.units, ['mm', 'in'], defaults.units),
      workWidth: positive(parsed.workWidth, defaults.workWidth, MAX_DIMENSION),
      workHeight: positive(parsed.workHeight, defaults.workHeight, MAX_DIMENSION),
      outputWidth: positive(parsed.outputWidth, defaults.outputWidth, MAX_DIMENSION),
      outputHeight: positive(parsed.outputHeight, defaults.outputHeight, MAX_DIMENSION),
      lockAspect: flag(parsed.lockAspect, defaults.lockAspect),
      offsetX: bounded(parsed.offsetX, defaults.offsetX, -MAX_DIMENSION, MAX_DIMENSION),
      offsetY: bounded(parsed.offsetY, defaults.offsetY, -MAX_DIMENSION, MAX_DIMENSION),
      rotationDeg: bounded(parsed.rotationDeg, defaults.rotationDeg, -1_000_000, 1_000_000),
      origin: oneOf(parsed.origin, ['bottom-left', 'top-left', 'center'], defaults.origin),
      invertX: flag(parsed.invertX, defaults.invertX),
      invertY: flag(parsed.invertY, defaults.invertY),
      feed: positive(parsed.feed, defaults.feed, MAX_FEED_RATE),
      travel: positive(parsed.travel, defaults.travel, MAX_FEED_RATE),
      safeZ: bounded(parsed.safeZ, defaults.safeZ, 0, MAX_Z_MAGNITUDE),
      workZ: bounded(parsed.workZ, defaults.workZ, -MAX_Z_MAGNITUDE, MAX_Z_MAGNITUDE),
      maxDepth: bounded(parsed.maxDepth, defaults.maxDepth, -MAX_Z_MAGNITUDE, MAX_Z_MAGNITUDE),
      passes: integer(parsed.passes, defaults.passes, 1, MAX_PASSES),
      lineSpacing: positive(parsed.lineSpacing, defaults.lineSpacing, MAX_DIMENSION),
      precision: integer(parsed.precision, defaults.precision, 0, 8),
      threshold: bounded(parsed.threshold, defaults.threshold, 0, 255),
      serpentine: flag(parsed.serpentine, defaults.serpentine),
      simplify: bounded(parsed.simplify, defaults.simplify, 0, MAX_DIMENSION),
      toolpathDetail: bounded(parsed.toolpathDetail, defaults.toolpathDetail, 0.025, 2),
      noiseCleanup: oneOf(parsed.noiseCleanup, ['off', 'light', 'normal', 'strong'], defaults.noiseCleanup),
      previewQuality: oneOf(parsed.previewQuality, ['low', 'balanced', 'high', 'full'], defaults.previewQuality),
      brightness: bounded(parsed.brightness, defaults.brightness, -255, 255),
      contrast: bounded(parsed.contrast, defaults.contrast, -100, 100),
      invert: flag(parsed.invert, defaults.invert),
      filter: oneOf(parsed.filter, ['grayscale', 'threshold', 'edge', 'dither'], defaults.filter),
      fit: flag(parsed.fit, defaults.fit),
    };
  } catch {
    return { ...defaults };
  }
};

const safeProfile = (value: unknown): MachineProfile | null => {
  if (!record(value)) return null;
  const kind = value.kind === 'cnc' || value.kind === 'pen' || value.kind === 'laser' ? value.kind : null;
  if (!kind) return null;
  const id = text(value.id, '', 128);
  const name = text(value.name, '', 128);
  if (!id || !name) return null;
  return {
    id, name, kind,
    header: text(value.header, ''),
    footer: text(value.footer, ''),
    toolOn: text(value.toolOn, ''),
    toolOff: text(value.toolOff, ''),
    safeZ: bounded(value.safeZ, 0, 0, MAX_Z_MAGNITUDE),
    workZ: bounded(value.workZ, 0, -MAX_Z_MAGNITUDE, MAX_Z_MAGNITUDE),
    passDepth: positive(value.passDepth, 1, MAX_Z_MAGNITUDE),
    feed: positive(value.feed, defaults.feed, MAX_FEED_RATE),
    travel: positive(value.travel, defaults.travel, MAX_FEED_RATE),
  };
};

export const loadProfiles = (): MachineProfile[] => {
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem('i2g-profiles') || '[]');
    if (!Array.isArray(parsed)) return profiles;
    const builtInIds = new Set(profiles.map((profile) => profile.id));
    const seen = new Set(builtInIds);
    const custom: MachineProfile[] = [];
    for (const value of parsed) {
      if (custom.length >= MAX_CUSTOM_PROFILES) break;
      const profile = safeProfile(value);
      if (profile && !seen.has(profile.id)) {
        seen.add(profile.id);
        custom.push(profile);
      }
    }
    return [...profiles, ...custom];
  } catch {
    return profiles;
  }
};

const rounded = (value: number, precision: number) => {
  const factor = 10 ** precision;
  const result = Math.sign(value) * Math.round(Math.abs(value) * factor) / factor;
  return result === 0 ? 0 : result;
};

export function configurationErrors(settings: Settings, kind: MachineProfile['kind'] = 'cnc'): string[] {
  const errors: string[] = [];
  const numeric = [
    settings.workWidth, settings.workHeight, settings.outputWidth, settings.outputHeight,
    settings.offsetX, settings.offsetY, settings.rotationDeg, settings.feed, settings.travel,
    settings.safeZ, settings.workZ, settings.maxDepth, settings.passes, settings.lineSpacing,
    settings.precision, settings.threshold, settings.simplify, settings.toolpathDetail,
    settings.brightness, settings.contrast,
  ];
  if (numeric.some((value) => !Number.isFinite(value))) errors.push('Configuration contains a malformed numeric value.');
  if (settings.units !== 'mm' && settings.units !== 'in') errors.push('Configuration contains an unknown unit system.');
  if (!['bottom-left', 'top-left', 'center'].includes(settings.origin)) errors.push('Configuration contains an unknown origin.');
  if (!['grayscale', 'threshold', 'edge', 'dither'].includes(settings.filter)) errors.push('Configuration contains an unknown image filter.');
  if (settings.workWidth <= 0 || settings.workHeight <= 0 || settings.outputWidth <= 0 || settings.outputHeight <= 0) errors.push('Dimensions must be greater than zero.');
  if ([settings.workWidth, settings.workHeight, settings.outputWidth, settings.outputHeight].some((value) => value > MAX_DIMENSION)) errors.push(`Dimensions must not exceed ${MAX_DIMENSION.toLocaleString()} configured units.`);
  if (Math.abs(settings.offsetX) > MAX_DIMENSION || Math.abs(settings.offsetY) > MAX_DIMENSION) errors.push('Offsets are unreasonably large.');
  if (Math.abs(settings.rotationDeg) > 1_000_000) errors.push('Rotation is unreasonably large.');
  if (settings.feed <= 0 || settings.travel <= 0) errors.push('Feed rates must be positive.');
  if (settings.feed > MAX_FEED_RATE || settings.travel > MAX_FEED_RATE) errors.push('Feed rates are unreasonably large.');
  if (kind === 'cnc') {
    if ([settings.safeZ, settings.workZ, settings.maxDepth].some((value) => Math.abs(value) > MAX_Z_MAGNITUDE)) errors.push('Z values are unreasonably large.');
    if (settings.safeZ < 0) errors.push('Safe Z must not be negative.');
    if (settings.workZ > 0 || settings.maxDepth > 0) errors.push('CNC working depths must be zero or negative.');
    if (settings.maxDepth > settings.workZ) errors.push('Maximum depth must be at or below working Z.');
    if (settings.workZ >= settings.safeZ || settings.maxDepth >= settings.safeZ) errors.push('Working Z values must be strictly below safe Z.');
  }
  if (settings.passes < 1 || settings.passes > MAX_PASSES || !Number.isInteger(settings.passes)) errors.push(`Pass count must be an integer from 1 to ${MAX_PASSES}.`);
  if (settings.lineSpacing <= 0 || settings.lineSpacing > MAX_DIMENSION) errors.push('Line spacing must be positive and reasonably bounded.');
  if (settings.toolpathDetail < 0.025 || settings.toolpathDetail > 2) errors.push('Toolpath detail must be between 0.025 mm and 2 mm.');
  if (!['off', 'light', 'normal', 'strong'].includes(settings.noiseCleanup)) errors.push('Configuration contains an unknown noise cleanup level.');
  if (settings.precision < 0 || settings.precision > 8 || !Number.isInteger(settings.precision)) errors.push('Precision must be an integer from 0 to 8.');
  if (settings.threshold < 0 || settings.threshold > 255) errors.push('Threshold must be between 0 and 255.');
  if (settings.simplify < 0 || settings.simplify > MAX_DIMENSION) errors.push('Simplification must be finite, non-negative, and reasonably bounded.');
  if (settings.brightness < -255 || settings.brightness > 255 || settings.contrast < -100 || settings.contrast > 100) errors.push('Image tonal settings are outside their supported range.');
  if (Number.isInteger(settings.precision) && settings.precision >= 0 && settings.precision <= 8) {
    if (rounded(settings.feed, settings.precision) <= 0 || rounded(settings.travel, settings.precision) <= 0) errors.push('Feed rates round to zero at the selected precision.');
    if (kind === 'cnc' && (rounded(settings.safeZ, settings.precision) <= rounded(settings.workZ, settings.precision) || rounded(settings.safeZ, settings.precision) <= rounded(settings.maxDepth, settings.precision))) {
      errors.push('Z clearance is lost at the selected numeric precision.');
    }
  }
  return [...new Set(errors)];
}

export function profileErrors(profile: MachineProfile): string[] {
  const errors: string[] = [];
  if (profile.kind !== 'cnc' && profile.kind !== 'pen' && profile.kind !== 'laser') errors.push('Machine profile has an unknown kind.');
  if (!profile.name.trim()) errors.push('Machine profile has no name.');
  if (profile.kind === 'cnc' && (!Number.isFinite(profile.passDepth) || profile.passDepth <= 0 || profile.passDepth > MAX_Z_MAGNITUDE)) errors.push('Machine profile pass depth must be positive and reasonably bounded.');
  if (!Number.isFinite(profile.feed) || !Number.isFinite(profile.travel) || profile.feed <= 0 || profile.travel <= 0) errors.push('Machine profile feed rates must be positive.');
  if (profile.toolOn.trim() && !profile.toolOff.trim()) errors.push('A tool-off command is required when a tool-on command is configured.');
  return errors;
}

export function profileWarnings(profile: MachineProfile): string[] {
  if (profile.kind === 'cnc') return [];
  const warnings: string[] = [];
  if (!profile.toolOn.trim()) warnings.push('Tool-on command is not configured for this machine profile.');
  if (!profile.toolOff.trim()) warnings.push('Tool-off command is not configured for this machine profile.');
  return warnings;
}

export function validate(settings: Settings, kind: MachineProfile['kind'] = 'cnc'): string[] {
  const messages = configurationErrors(settings, kind);
  if (messages.length === 0) {
    const bounds = transformedBounds(settings);
    if (bounds.minX < 0 || bounds.minY < 0 || bounds.maxX > settings.workWidth || bounds.maxY > settings.workHeight) {
      messages.push('Transformed image exceeds the configured work area.');
    }
  }
  return messages;
}
