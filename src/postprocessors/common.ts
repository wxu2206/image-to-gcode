import { formatMachineNumber } from '../core/numberFormat';
import type { MachineProfile, Move, Settings } from '../core/types';
import type { MachineCapabilities, PostProcessorContext, ValidationFinding } from './types';

export type SerializerPolicy = {
  processorName: string;
  capabilities: MachineCapabilities;
  feedMode: boolean;
  safeCustomFooter: boolean;
};

const commandLines = (value: string): string[] => value
  .split(/\r?\n/)
  .map((line) => line.trim())
  .filter(Boolean);

const modeLines = (settings: Settings, feedMode: boolean): string[] => [
  settings.units === 'mm' ? 'G21' : 'G20',
  'G90',
  ...(feedMode ? ['G94'] : []),
];

function coordinates(move: Move, settings: Settings): string {
  if (move.zOnly) return `Z${formatMachineNumber(move.to.z ?? settings.safeZ, settings.precision)}`;
  return `X${formatMachineNumber(move.to.x, settings.precision)} Y${formatMachineNumber(move.to.y, settings.precision)}${move.to.z === undefined ? '' : ` Z${formatMachineNumber(move.to.z, settings.precision)}`}`;
}

function splitFooter(profile: MachineProfile, safe: boolean): { beforeShutdown: string[]; terminal: string[] } {
  const lines = commandLines(profile.footer);
  if (!safe) return { beforeShutdown: [], terminal: lines };
  const terminal: string[] = [];
  const beforeShutdown: string[] = [];
  for (const line of lines) (/^(?:M2|M30)(?:\s|$)/i.test(line) ? terminal : beforeShutdown).push(line);
  return { beforeShutdown, terminal };
}

function assertSafeZ(moves: readonly Move[], settings: Settings): void {
  const tolerance = 0.5 * 10 ** -settings.precision;
  for (const move of moves) {
    if (move.command !== 'G0' || move.zOnly || (move.from.x === move.to.x && move.from.y === move.to.y)) continue;
    if (move.from.z === undefined || move.to.z === undefined
      || Math.abs(move.from.z - settings.safeZ) > tolerance
      || Math.abs(move.to.z - settings.safeZ) > tolerance) {
      throw new Error('CNC post-processor rejected an XY rapid that is not fully retracted to safe Z.');
    }
  }
}

export function serializeLinearMoves(moves: readonly Move[], context: PostProcessorContext, policy: SerializerPolicy): string {
  const { settings, profile } = context;
  if (policy.capabilities.requiresSafeZ) assertSafeZ(moves, settings);
  const lines: string[] = [];
  if (policy.capabilities.supportsComments) {
    lines.push('; image-to-gcode - inspect before running', `; mode: ${context.mode}`, `; post-processor: ${policy.processorName}`);
  }
  lines.push(...commandLines(profile.header), ...modeLines(settings, policy.feedMode));

  const toolState: { value: 'unknown' | 'off' | 'on' } = { value: 'unknown' };
  let modesDirty = false;
  const emitCustom = (value: string, state: 'off' | 'on', force = false) => {
    if (!force && toolState.value === state) return;
    const commands = commandLines(value);
    if (commands.length) {
      lines.push(...commands);
      modesDirty = true;
    }
    toolState.value = state;
  };
  const reassertModes = () => {
    if (!modesDirty) return;
    lines.push(...modeLines(settings, policy.feedMode));
    modesDirty = false;
  };

  // The startup state is unknowable. An explicitly configured off command is
  // therefore emitted before the first generated movement.
  emitCustom(profile.toolOff, 'off', true);
  reassertModes();
  for (let index = 0; index < moves.length; index += 1) {
    const move = moves[index];
    if (!Number.isFinite(move.from.x) || !Number.isFinite(move.from.y)
      || (move.from.z !== undefined && !Number.isFinite(move.from.z))
      || !Number.isFinite(move.to.x) || !Number.isFinite(move.to.y)
      || (move.to.z !== undefined && !Number.isFinite(move.to.z))) {
      throw new Error('Post-processor received a canonical movement with a non-finite coordinate.');
    }
    if (move.working) emitCustom(profile.toolOn, 'on');
    else emitCustom(profile.toolOff, 'off');
    reassertModes();
    const feed = move.feed ?? (move.working ? settings.feed : settings.travel);
    lines.push(move.zOnly
      ? `${move.command} ${coordinates(move, settings)}`
      : `${move.command} ${coordinates(move, settings)} F${formatMachineNumber(feed, settings.precision)}`);
    if (index % 4096 === 0) context.onProgress?.(index, moves.length);
  }

  const footer = splitFooter(profile, policy.safeCustomFooter);
  lines.push(...footer.beforeShutdown);
  if (footer.beforeShutdown.length) toolState.value = 'unknown';
  emitCustom(profile.toolOff, 'off', toolState.value !== 'off');
  lines.push(...footer.terminal);
  context.onProgress?.(moves.length, moves.length);
  return `${lines.join('\n')}\n`;
}

export function commandPairFindings(profile: MachineProfile, label: string): ValidationFinding[] {
  const findings: ValidationFinding[] = [];
  if (!profile.toolOn.trim()) findings.push({ id: 'tool-on-required', severity: 'blocking', message: `${label} requires an explicit tool-on command.` });
  if (!profile.toolOff.trim()) findings.push({ id: 'tool-off-required', severity: 'blocking', message: `${label} requires an explicit tool-off command for travel and shutdown.` });
  return findings;
}

export function genericCapabilities(profile: MachineProfile): MachineCapabilities {
  return {
    supportsZ: profile.kind === 'cnc',
    supportsRapidMoves: true,
    supportsComments: true,
    supportsAbsolutePositioning: true,
    requiresSafeZ: profile.kind === 'cnc',
    toolStateModel: profile.kind === 'cnc' ? 'spindle' : profile.kind,
  };
}
