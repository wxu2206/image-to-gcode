import type { Settings, Units } from './types';

export const MM_PER_INCH = 25.4;

export function toMillimetres(value: number, units: Units): number {
  return units === 'in' ? value * MM_PER_INCH : value;
}

export function fromMillimetres(value: number, units: Units): number {
  return units === 'in' ? value / MM_PER_INCH : value;
}

/**
 * Unit selection is a representation change, not a physical resize. Toolpath
 * detail remains millimetres by design; dimension, Z, and speed values follow
 * the selected G-code unit system.
 */
export function convertSettingsUnits(settings: Settings, units: Units): Settings {
  if (settings.units === units) return settings;
  const factor = settings.units === 'mm' ? 1 / MM_PER_INCH : MM_PER_INCH;
  return {
    ...settings,
    units,
    workWidth: settings.workWidth * factor,
    workHeight: settings.workHeight * factor,
    outputWidth: settings.outputWidth * factor,
    outputHeight: settings.outputHeight * factor,
    offsetX: settings.offsetX * factor,
    offsetY: settings.offsetY * factor,
    feed: settings.feed * factor,
    travel: settings.travel * factor,
    safeZ: settings.safeZ * factor,
    workZ: settings.workZ * factor,
    maxDepth: settings.maxDepth * factor,
    lineSpacing: settings.lineSpacing * factor,
  };
}
