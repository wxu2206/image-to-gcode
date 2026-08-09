import type { ConversionMode, MachineProfile, Settings } from './types';

/**
 * Canonical-output identity. Viewport state, preview quality, filename, aspect
 * lock, and fit preference are deliberately excluded because they cannot alter
 * machine geometry or serialized G-code.
 */
export function canonicalJobKey(sourceRevision: number, settings: Settings, profile: MachineProfile, mode: ConversionMode): string {
  return JSON.stringify([
    sourceRevision,
    mode,
    settings.units,
    settings.workWidth, settings.workHeight,
    settings.outputWidth, settings.outputHeight,
    settings.offsetX, settings.offsetY, settings.rotationDeg,
    settings.origin, settings.invertX, settings.invertY,
    settings.feed, settings.travel,
    settings.safeZ, settings.workZ, settings.maxDepth,
    settings.passes, settings.lineSpacing, settings.precision,
    settings.threshold, settings.serpentine, settings.simplify,
    settings.toolpathDetail,
    settings.brightness, settings.contrast, settings.invert, settings.filter,
    profile.kind, profile.header, profile.footer, profile.toolOn, profile.toolOff,
    profile.passDepth,
  ]);
}

export function isCurrentRevision(completedKey: string | null | undefined, currentKey: string | null): boolean {
  return currentKey !== null && completedKey === currentKey;
}

export function isCurrentJobRevision(
  completed: { id: number; key: string } | null | undefined,
  currentId: number,
  currentKey: string | null,
): boolean {
  return Boolean(completed && completed.id === currentId && isCurrentRevision(completed.key, currentKey));
}
