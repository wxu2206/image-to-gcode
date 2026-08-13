import { classifyMovementCount } from './complexity';
import type { ToolpathStats } from './gcode';
import { configurationErrors, profileErrors, profileWarnings, profiles } from './machine';
import type { MachineProfile, Point, Settings } from './types';

export type PreflightSeverity = 'pass' | 'warning' | 'blocking';
export type PreflightStatus = 'passed' | 'warnings' | 'blocked';
export type PreflightExportAction = 'copy' | 'download';

export type PreflightCheck = {
  id: string;
  severity: PreflightSeverity;
  title: string;
  message?: string;
};

export type PreflightSummary = {
  start: Point | null;
  end: Point | null;
  movementCount: number;
  pathCount: number;
  drawingDistance: number;
  travelDistance: number;
  travelEfficiency: number;
  estimatedMinutes: number;
  bounds: ToolpathStats['bounds'];
};

export type PreflightResult = {
  status: PreflightStatus;
  checks: PreflightCheck[];
  warningCount: number;
  blockingCount: number;
  summary: PreflightSummary | null;
};

export type PreflightInput = {
  settings: Settings;
  stats: ToolpathStats | null;
  pathCount: number | null;
  profile: MachineProfile;
  warnings: string[];
  placementPending: boolean;
  current: boolean;
};

export type ExportAuthorization = { allowed: boolean; reason?: string };

const check = (id: string, severity: PreflightSeverity, title: string, message?: string): PreflightCheck => ({
  id,
  severity,
  title,
  ...(message ? { message } : {}),
});

const unique = (messages: readonly string[]) => [...new Set(messages)];
const joinMessages = (messages: readonly string[]) => unique(messages).join(' ');
const isFeedError = (message: string) => /feed rate/i.test(message);
const isZError = (message: string) => /(?:\bZ\b|depth|pass count|pass depth)/i.test(message);

function customCommandsPresent(profile: MachineProfile): boolean {
  const builtIn = profiles.find((candidate) => candidate.id === profile.id);
  const commands = (candidate: MachineProfile) => [candidate.header, candidate.footer, candidate.toolOn, candidate.toolOff].map((value) => value.trim());
  if (!builtIn) return commands(profile).some(Boolean);
  return commands(profile).some((value, index) => value !== commands(builtIn)[index]);
}

function finiteStats(stats: ToolpathStats): boolean {
  const finiteValues = [
    stats.work,
    stats.travel,
    stats.total,
    stats.movementCount,
    stats.working,
    stats.travels,
    stats.toolLifts,
    stats.travelEfficiency,
    stats.time,
    stats.estimate.totalMinutes,
  ].every(Number.isFinite);
  const counts = [stats.movementCount, stats.working, stats.travels, stats.toolLifts];
  const diagnosticCounts = stats.diagnostics ? [
    stats.diagnostics.nonFiniteCoordinateCount,
    stats.diagnostics.invalidFeedCount,
    stats.diagnostics.zeroLengthMoveCount,
    stats.diagnostics.discontinuityCount,
    stats.diagnostics.invalidStateCount,
    stats.diagnostics.unsafeCncRapidCount,
    stats.diagnostics.missingCncWorkingZCount,
  ] : [];
  const bounds = stats.bounds;
  const finitePoint = (point: Point | null) => point === null || (Number.isFinite(point.x) && Number.isFinite(point.y) && (point.z === undefined || Number.isFinite(point.z)));
  const finiteBounds = !bounds || [bounds.minX, bounds.maxX, bounds.minY, bounds.maxY, bounds.minZ, bounds.maxZ]
    .every((value) => value === null || Number.isFinite(value));
  const finiteWorkingZ = [stats.diagnostics?.minWorkingZ, stats.diagnostics?.maxWorkingZ]
    .every((value) => value === null || Number.isFinite(value));
  return finiteValues
    && stats.work >= 0 && stats.travel >= 0 && stats.total >= 0 && stats.time >= 0
    && stats.travelEfficiency >= 0 && stats.travelEfficiency <= 1
    && counts.every((value) => Number.isInteger(value) && value >= 0)
    && stats.movementCount === stats.working + stats.travels
    && diagnosticCounts.length === 7
    && diagnosticCounts.every((value) => Number.isInteger(value) && value >= 0)
    && finitePoint(stats.diagnostics.start)
    && finitePoint(stats.diagnostics.end)
    && finiteWorkingZ
    && finiteBounds;
}

/**
 * Aggregates existing machine/profile validation with compact diagnostics from
 * the exact canonical movement pass. Check ordering is deliberately stable.
 */
export function buildPreflight(input: PreflightInput): PreflightResult {
  const { settings, profile, placementPending } = input;
  const canonical = input.current && !placementPending ? input.stats : null;
  const checks: PreflightCheck[] = [];
  const configured = configurationErrors(settings, profile.kind);
  const profileConfiguration = profileErrors(profile);
  const feedErrors = [...configured.filter(isFeedError), ...profileConfiguration.filter(isFeedError)];
  if ([settings.feed, settings.travel, profile.feed, profile.travel].some((value) => !Number.isFinite(value) || value <= 0)) {
    feedErrors.push('Configured work and travel feed values must be finite and positive.');
  }
  const zErrors = profile.kind === 'cnc'
    ? [...configured.filter(isZError), ...profileConfiguration.filter(isZError)]
    : [];
  const toolErrors = profileConfiguration.filter((message) => /tool-(?:on|off)/i.test(message));
  const generalErrors = [...configured, ...profileConfiguration].filter((message) => (
    !isFeedError(message)
    && !(profile.kind === 'cnc' && isZError(message))
    && !/tool-(?:on|off)/i.test(message)
  ));

  checks.push(input.current && !placementPending
    ? check('completed-revision', 'pass', 'Completed revision', 'Preflight matches the exact completed canonical job.')
    : check(
      'completed-revision',
      'blocking',
      'Completed revision',
      placementPending ? 'Image placement is still updating.' : 'No completed toolpath is available for the current output settings.',
    ));

  checks.push(generalErrors.length
    ? check('configuration', 'blocking', 'Machine configuration', joinMessages(generalErrors))
    : check('configuration', 'pass', 'Machine configuration', 'Known configuration fields are valid.'));

  if (!canonical) {
    checks.push(check('canonical-coordinates', 'blocking', 'Canonical coordinates', 'Canonical movement diagnostics are unavailable for the current revision.'));
  } else if (!canonical.diagnostics || !finiteStats(canonical) || canonical.diagnostics.nonFiniteCoordinateCount > 0) {
    const count = canonical.diagnostics?.nonFiniteCoordinateCount ?? 0;
    checks.push(check(
      'canonical-coordinates',
      'blocking',
      'Canonical coordinates',
      count > 0 ? `${count.toLocaleString()} canonical movement${count === 1 ? '' : 's'} contain non-finite coordinates.` : 'Canonical statistics are malformed or non-finite.',
    ));
  } else if (canonical.movementCount === 0) {
    checks.push(check('canonical-coordinates', 'blocking', 'Canonical coordinates', 'The completed toolpath contains no machine movements.'));
  } else {
    checks.push(check('canonical-coordinates', 'pass', 'Canonical coordinates', `${canonical.movementCount.toLocaleString()} rounded movements contain finite coordinates.`));
  }

  const bounds = canonical?.bounds;
  const precision = Math.max(1, Math.min(6, Number.isInteger(settings.precision) ? settings.precision : 3));
  const amount = (value: number) => value.toFixed(precision);
  const axisCheck = (axis: 'X' | 'Y', minimum: number | undefined, maximum: number | undefined, limit: number) => {
    const id = `work-envelope-${axis.toLowerCase()}`;
    if (minimum === undefined || maximum === undefined) return check(id, 'blocking', `${axis} work envelope`, `Canonical ${axis} bounds are unavailable.`);
    if (minimum < 0) return check(id, 'blocking', `${axis} work envelope`, `${axis} begins ${amount(Math.abs(minimum))} ${settings.units} below the configured work area.`);
    if (maximum > limit) return check(id, 'blocking', `${axis} work envelope`, `${axis} exceeds maximum by ${amount(maximum - limit)} ${settings.units}.`);
    return check(id, 'pass', `${axis} work envelope`, `${axis} ${amount(minimum)}–${amount(maximum)} ${settings.units} is within the configured work area.`);
  };
  checks.push(axisCheck('X', bounds?.minX, bounds?.maxX, settings.workWidth));
  checks.push(axisCheck('Y', bounds?.minY, bounds?.maxY, settings.workHeight));

  const invalidFeeds = canonical?.diagnostics?.invalidFeedCount ?? 0;
  checks.push(feedErrors.length || invalidFeeds > 0
    ? check('feed-values', 'blocking', 'Feed values', joinMessages([
      ...feedErrors,
      ...(invalidFeeds > 0 ? [`${invalidFeeds.toLocaleString()} canonical movement${invalidFeeds === 1 ? '' : 's'} have missing, zero, negative, or non-finite feed values.`] : []),
    ]))
    : check('feed-values', 'pass', 'Feed values', `Work and travel feeds are finite and positive in ${settings.units}/min.`));

  if (profile.kind === 'cnc') {
    const minimumZ = bounds?.minZ;
    const maximumZ = bounds?.maxZ;
    const tolerance = Number.isInteger(settings.precision) && settings.precision >= 0 ? 0.5 * 10 ** -settings.precision : 0;
    const workingMinimumZ = canonical?.diagnostics?.minWorkingZ;
    const workingMaximumZ = canonical?.diagnostics?.maxWorkingZ;
    const missingWorkingZ = canonical?.diagnostics?.missingCncWorkingZCount ?? 0;
    const workingZInvalid = Boolean(canonical?.working)
      && (missingWorkingZ > 0
        || workingMinimumZ === null || workingMinimumZ === undefined
        || workingMaximumZ === null || workingMaximumZ === undefined
        || workingMinimumZ < settings.maxDepth - tolerance
        || workingMaximumZ > tolerance);
    const canonicalZInvalid = minimumZ === null || maximumZ === null
      || minimumZ === undefined || maximumZ === undefined
      || minimumZ < settings.maxDepth - tolerance || maximumZ > settings.safeZ + tolerance;
    const zMessage = canonicalZInvalid && minimumZ !== null && maximumZ !== null && minimumZ !== undefined && maximumZ !== undefined
      ? `Canonical Z range ${amount(minimumZ)}–${amount(maximumZ)} ${settings.units} exceeds configured depth ${amount(settings.maxDepth)} to safe Z ${amount(settings.safeZ)}.`
      : 'Canonical CNC movements do not provide a complete finite Z range.';
    const workingZMessage = missingWorkingZ > 0
      ? `${missingWorkingZ.toLocaleString()} CNC working movement${missingWorkingZ === 1 ? '' : 's'} lack a finite target Z.`
      : workingMinimumZ !== null && workingMinimumZ !== undefined && workingMaximumZ !== null && workingMaximumZ !== undefined
        ? `Canonical working Z targets ${amount(workingMinimumZ)}–${amount(workingMaximumZ)} ${settings.units} exceed the configured cutting range.`
        : 'Canonical CNC working movements do not provide a finite target Z range.';
    checks.push(zErrors.length || canonicalZInvalid || workingZInvalid
      ? check('cnc-z-range', 'blocking', 'CNC Z configuration', joinMessages([...zErrors, ...(canonicalZInvalid ? [zMessage] : []), ...(workingZInvalid ? [workingZMessage] : [])]))
      : check('cnc-z-range', 'pass', 'CNC Z configuration', `Canonical Z ${amount(minimumZ)}–${amount(maximumZ)} ${settings.units} stays within configured depth and safe Z.`));
  }

  const diagnostics = canonical?.diagnostics;
  const sequencingProblems = (diagnostics?.discontinuityCount ?? 0)
    + (diagnostics?.invalidStateCount ?? 0)
    + (diagnostics?.unsafeCncRapidCount ?? 0);
  checks.push(toolErrors.length || sequencingProblems > 0
    ? check('tool-sequencing', 'blocking', 'Tool sequencing', joinMessages([
      ...toolErrors,
      ...(diagnostics?.discontinuityCount ? [`${diagnostics.discontinuityCount.toLocaleString()} discontinuous movement transition${diagnostics.discontinuityCount === 1 ? '' : 's'} were detected.`] : []),
      ...(diagnostics?.invalidStateCount ? [`${diagnostics.invalidStateCount.toLocaleString()} movement${diagnostics.invalidStateCount === 1 ? '' : 's'} conflict with their work/travel state.`] : []),
      ...(diagnostics?.unsafeCncRapidCount ? [`${diagnostics.unsafeCncRapidCount.toLocaleString()} CNC XY rapid${diagnostics.unsafeCncRapidCount === 1 ? '' : 's'} occur without both endpoints at safe Z.`] : []),
    ]))
    : check('tool-sequencing', 'pass', 'Tool sequencing', profile.kind === 'cnc'
      ? 'Generator-owned work/travel states are consistent and XY rapids follow safe retracts.'
      : 'Generator-owned work/travel states and transitions are consistent.'));

  const zeroLength = diagnostics?.zeroLengthMoveCount ?? 0;
  const zeroLengthRatio = canonical && canonical.movementCount > 0 ? zeroLength / canonical.movementCount : 0;
  checks.push(zeroLength >= 3 && zeroLengthRatio >= 0.01
    ? check('movement-geometry', 'warning', 'Movement geometry', `${zeroLength.toLocaleString()} redundant zero-length movements were detected (${Math.round(zeroLengthRatio * 100)}% of the job).`)
    : check('movement-geometry', 'pass', 'Movement geometry', zeroLength > 0 ? `${zeroLength.toLocaleString()} isolated zero-length movement${zeroLength === 1 ? '' : 's'} will not block export.` : 'No redundant zero-length canonical movements were detected.'));

  const complexity = classifyMovementCount(canonical?.movementCount ?? 0);
  checks.push(complexity === 'normal'
    ? check('job-size', 'pass', 'Job size', `${(canonical?.movementCount ?? 0).toLocaleString()} movements is within the normal completed-job range.`)
    : check('job-size', 'warning', 'Job size', `${(canonical?.movementCount ?? 0).toLocaleString()} movements. ${complexity === 'extreme' ? 'Extreme' : 'Large'} job: inspection and execution may take significant time and memory.`));

  checks.push(customCommandsPresent(profile)
    ? check('custom-commands', 'warning', 'Custom machine commands', 'Custom machine commands are present and were not fully simulated by preflight.')
    : check('custom-commands', 'pass', 'Custom machine commands', 'No modified or user-defined command blocks require additional interpretation.'));

  const advisoryMessages = unique([
    ...profileWarnings(profile),
    ...input.warnings.filter((message) => !/outside work area|exceeds the configured work area/i.test(message)),
  ]);
  if (canonical && canonical.working === 0) advisoryMessages.push('The completed toolpath contains no working movements.');
  if (advisoryMessages.length) checks.push(check('generator-advisories', 'warning', 'Generator advisories', joinMessages(advisoryMessages)));

  const warningCount = checks.filter((item) => item.severity === 'warning').length;
  const blockingCount = checks.filter((item) => item.severity === 'blocking').length;
  return {
    status: blockingCount > 0 ? 'blocked' : warningCount > 0 ? 'warnings' : 'passed',
    checks,
    warningCount,
    blockingCount,
    summary: canonical ? {
      start: canonical.diagnostics?.start ?? null,
      end: canonical.diagnostics?.end ?? null,
      movementCount: canonical.movementCount,
      pathCount: input.pathCount ?? 0,
      drawingDistance: canonical.work,
      travelDistance: canonical.travel,
      travelEfficiency: canonical.travelEfficiency,
      estimatedMinutes: canonical.estimate.totalMinutes,
      bounds: canonical.bounds,
    } : null,
  };
}

/** Warnings require an explicit reviewed override; blockers are never overridable. */
export function authorizeExport(result: PreflightResult, _action: PreflightExportAction, reviewedWarnings: boolean): ExportAuthorization {
  if (result.blockingCount > 0) return { allowed: false, reason: 'Resolve blocking preflight issues before copying or downloading G-code.' };
  if (result.warningCount > 0 && !reviewedWarnings) return { allowed: false, reason: 'Review and explicitly accept preflight warnings before export.' };
  return { allowed: true };
}
