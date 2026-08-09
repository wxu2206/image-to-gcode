import type { ToolpathStats } from './gcode';
import { validate } from './machine';
import type { MachineProfile, Settings } from './types';

export type ReviewLevel = 'ready' | 'warning' | 'blocking';
export type ExportReview = { level: ReviewLevel; messages: string[]; boundsMessages: string[] };

const blockingConfiguration = (message: string) => /malformed|Dimensions must|Feed rates|Safe Z|Working Z|Pass count|Line spacing|Toolpath detail|Precision/.test(message);

export function buildExportReview({ settings, stats, profile, warnings, placementPending, current }: { settings: Settings; stats: ToolpathStats | null; profile: MachineProfile; warnings: string[]; placementPending: boolean; current: boolean }): ExportReview {
  const messages = [...validate(settings), ...warnings];
  if (!profile.name.trim()) messages.unshift('Machine profile has no name.');
  if (placementPending) messages.unshift('Image placement is still updating.');
  if (!current || !stats) messages.unshift('No completed toolpath is available for the current settings.');
  const boundsMessages: string[] = [];
  const bounds = stats?.bounds;
  if (bounds) {
    if (bounds.minX < 0) boundsMessages.push(`X exceeds minimum by ${Math.abs(bounds.minX).toFixed(1)} ${settings.units}.`);
    if (bounds.maxX > settings.workWidth) boundsMessages.push(`X exceeds maximum by ${(bounds.maxX - settings.workWidth).toFixed(1)} ${settings.units}.`);
    if (bounds.minY < 0) boundsMessages.push(`Y exceeds minimum by ${Math.abs(bounds.minY).toFixed(1)} ${settings.units}.`);
    if (bounds.maxY > settings.workHeight) boundsMessages.push(`Y exceeds maximum by ${(bounds.maxY - settings.workHeight).toFixed(1)} ${settings.units}.`);
  }
  messages.push(...boundsMessages);
  const blocking = placementPending || !current || !stats || messages.some(blockingConfiguration);
  return { level: blocking ? 'blocking' : messages.length ? 'warning' : 'ready', messages, boundsMessages };
}
