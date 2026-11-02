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
const physicalFields = ['workWidth', 'workHeight', 'outputWidth', 'outputHeight', 'offsetX', 'offsetY', 'feed', 'travel', 'safeZ', 'workZ', 'maxDepth', 'lineSpacing'] as const;
type PhysicalField = typeof physicalFields[number];

/** Retain each field's authored value/unit pair across representation changes.
 * Edits establish a new anchor for that field; unrelated edits preserve anchors.
 * Anchors are session-local and never change stored Settings or machine precision.
 */
export function createSettingsUnitConverter() {
  let previous: Settings | undefined;
  const anchors = new Map<PhysicalField, { value: number; units: Units }>();
  return (settings: Settings, units: Units): Settings => {
    if (settings.units === units) return settings;
    const next = { ...settings, units };
    for (const key of physicalFields) {
      let anchor = anchors.get(key);
      if (!anchor || !previous || previous.units !== settings.units || previous[key] !== settings[key]) {
        anchor = { value: settings[key], units: settings.units };
        anchors.set(key, anchor);
      }
      next[key] = anchor.units === units ? anchor.value
        : units === 'mm' ? anchor.value * MM_PER_INCH : anchor.value / MM_PER_INCH;
    }
    previous = next;
    return next;
  };
}

/** Single conversion for stateless callers; interactive sessions reuse a converter. */
export function convertSettingsUnits(settings: Settings, units: Units): Settings {
  return createSettingsUnitConverter()(settings, units);
}
