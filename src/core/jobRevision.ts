import type { ConversionMode, MachineProfile, Settings } from './types';

/**
 * Canonical movement identity. Controller syntax and custom commands are kept
 * out so processor changes can reuse completed image/vector geometry.
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
    settings.toolpathDetail, settings.noiseCleanup,
    settings.brightness, settings.contrast, settings.invert, settings.filter,
    profile.kind === 'cnc' ? 'cnc' : 'xy',
    profile.kind === 'cnc' ? profile.passDepth : null,
  ]);
}

/** Machine-output identity layered on top of an authoritative canonical job. */
export function outputJobKey(canonicalKey: string, profile: MachineProfile): string {
  return JSON.stringify([
    canonicalKey,
    profile.postProcessorId,
    profile.kind,
    profile.header,
    profile.footer,
    profile.toolOn,
    profile.toolOff,
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
