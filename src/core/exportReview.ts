import type { ToolpathStats } from './gcode';
import { configurationErrors, profileErrors, profileWarnings, validate } from './machine';
import type { MachineProfile, Settings } from './types';

export type ReviewLevel = 'ready' | 'warning' | 'blocking';
export type ExportReview = { level: ReviewLevel; messages: string[]; boundsMessages: string[] };

export function buildExportReview({
  settings,
  stats,
  profile,
  warnings,
  placementPending,
  current,
}: {
  settings: Settings;
  stats: ToolpathStats | null;
  profile: MachineProfile;
  warnings: string[];
  placementPending: boolean;
  current: boolean;
}): ExportReview {
  const configuration = configurationErrors(settings, profile.kind);
  const profileConfiguration = profileErrors(profile);
  const messages = [...validate(settings, profile.kind), ...profileConfiguration, ...profileWarnings(profile), ...warnings];
  if (placementPending) messages.unshift('Image placement is still updating.');
  if (!current || !stats) messages.unshift('No completed toolpath is available for the current settings.');
  if (stats && stats.movementCount === 0) messages.push('The completed toolpath contains no machine movements.');
  else if (stats && stats.working === 0) messages.push('The completed toolpath contains no working movements.');

  const boundsMessages: string[] = [];
  const bounds = stats?.bounds;
  const boundsPrecision = Math.max(1, Math.min(6, Number.isInteger(settings.precision) ? settings.precision : 3));
  const amount = (value: number) => value.toFixed(boundsPrecision);
  if (bounds) {
    if (bounds.minX < 0) boundsMessages.push(`X exceeds minimum by ${amount(Math.abs(bounds.minX))} ${settings.units}.`);
    if (bounds.maxX > settings.workWidth) boundsMessages.push(`X exceeds maximum by ${amount(bounds.maxX - settings.workWidth)} ${settings.units}.`);
    if (bounds.minY < 0) boundsMessages.push(`Y exceeds minimum by ${amount(Math.abs(bounds.minY))} ${settings.units}.`);
    if (bounds.maxY > settings.workHeight) boundsMessages.push(`Y exceeds maximum by ${amount(bounds.maxY - settings.workHeight)} ${settings.units}.`);
  }
  messages.push(...boundsMessages);

  const canonicalBoundsWarning = warnings.some((message) => /outside work area/i.test(message));
  const blocking = placementPending
    || !current
    || !stats
    || configuration.length > 0
    || profileConfiguration.length > 0
    || boundsMessages.length > 0
    || canonicalBoundsWarning;
  return { level: blocking ? 'blocking' : messages.length ? 'warning' : 'ready', messages: [...new Set(messages)], boundsMessages };
}
