import type { GcodeResult, MachineProfile, Move, Point, Settings, Toolpath } from './types';
import { distance, machinePoint } from './geometry';
import { canonicalProfileErrors, configurationErrors, profileErrors, validate } from './machine';
import { quantizeMachineNumber } from './numberFormat';
import { movementDurationMinutes, type RuntimeEstimate } from './runtime';
import { fromMillimetres } from './units';
import { requirePostProcessor } from '../postprocessors/registry';

export type ToolpathStats = {
  work: number;
  travel: number;
  total: number;
  movementCount: number;
  working: number;
  travels: number;
  /** Number of inactive-to-working transitions, a conservative proxy for tool lowers/lifts. */
  toolLifts: number;
  travelEfficiency: number;
  /** Estimated duration in minutes; configured feeds are units per minute. */
  time: number;
  estimate: RuntimeEstimate;
  bounds: { minX: number; maxX: number; minY: number; maxY: number; minZ: number | null; maxZ: number | null } | null;
  /** Compact canonical diagnostics calculated in the worker's existing statistics pass. */
  diagnostics: {
    start: Point | null;
    end: Point | null;
    nonFiniteCoordinateCount: number;
    invalidFeedCount: number;
    zeroLengthMoveCount: number;
    discontinuityCount: number;
    invalidStateCount: number;
    unsafeCncRapidCount: number;
    missingCncWorkingZCount: number;
    minWorkingZ: number | null;
    maxWorkingZ: number | null;
  };
};

export type StatisticsSafetyContext = {
  machineKind: MachineProfile['kind'];
  safeZ: number;
  precision: number;
};

function quantizePoint(point: Point, settings: Settings): Point {
  return {
    ...point,
    x: quantizeMachineNumber(point.x, settings.precision),
    y: quantizeMachineNumber(point.y, settings.precision),
    ...(point.z === undefined ? {} : { z: quantizeMachineNumber(point.z, settings.precision) }),
  };
}

export type GenerationStage = 'movements' | 'gcode';
export type GenerationProgress = (stage: GenerationStage, completed: number, total: number) => void;
export type MovementResult = Pick<GcodeResult, 'moves' | 'warnings'>;

function isSamePoint(a: Point, b: Point) {
  return a.x === b.x && a.y === b.y && a.z === b.z;
}

function assertToolpath(toolpath: Toolpath): void {
  if (!Number.isFinite(toolpath.width) || !Number.isFinite(toolpath.height) || toolpath.width <= 0 || toolpath.height <= 0) {
    throw new Error('Toolpath dimensions must be finite and greater than zero.');
  }
  for (const path of toolpath.paths) {
    if (path.kind !== 'work' && path.kind !== 'travel') throw new Error('Toolpath contains an unknown path kind.');
    for (const point of path.points) {
      if (!Number.isFinite(point.x) || !Number.isFinite(point.y) || (point.z !== undefined && !Number.isFinite(point.z))) {
        throw new Error('Toolpath contains a non-finite coordinate.');
      }
      if (point.intensity !== undefined && (!Number.isFinite(point.intensity) || point.intensity < 0 || point.intensity > 1)) {
        throw new Error('Toolpath contains an invalid intensity.');
      }
    }
  }
}

function assertConfiguration(settings: Settings, profile: MachineProfile): void {
  const errors = [...configurationErrors(settings, profile.kind), ...canonicalProfileErrors(profile)];
  if (profile.kind === 'cnc' && Number.isFinite(profile.passDepth)) {
    const passDepth = fromMillimetres(profile.passDepth, settings.units);
    if (quantizeMachineNumber(passDepth, settings.precision) <= 0) errors.push('Machine profile pass depth rounds to zero at the selected precision.');
  }
  if (errors.length) throw new Error(errors[0]);
}

function outsideWorkArea(point: Point, settings: Settings): boolean {
  return point.x < 0 || point.y < 0 || point.x > settings.workWidth || point.y > settings.workHeight;
}

function buildCanonicalMovements(toolpath: Toolpath, settings: Settings, profile: MachineProfile, onProgress?: GenerationProgress): MovementResult {
  assertConfiguration(settings, profile);
  assertToolpath(toolpath);

  const warningSet = new Set(validate(settings, profile.kind));
  if (toolpath.mode === 'grayscale' && profile.kind !== 'cnc') {
    warningSet.add('Variable grayscale intensity is only mapped to depth for CNC profiles.');
  }

  const moves: Move[] = [];
  let current: Point = profile.kind === 'cnc' ? { x: 0, y: 0 } : { x: 0, y: 0 };
  const xScale = settings.outputWidth / toolpath.width;
  const yScale = settings.outputHeight / toolpath.height;

  // Decoded image rows are top-to-bottom; physical image geometry is Y-up.
  // This is the single source-orientation correction in the final pipeline.
  const mapped = (source: Point): Point => {
    const machine = machinePoint({
      x: source.x * xScale,
      y: settings.outputHeight - source.y * yScale,
      intensity: source.intensity,
    }, settings);
    return quantizePoint(profile.kind === 'cnc' ? machine : { ...machine, z: undefined }, settings);
  };

  let pointTotal = 0;
  for (const path of toolpath.paths) {
    const repeats = path.kind === 'work' ? settings.passes : 1;
    pointTotal += Math.max(0, path.points.length - 1) * repeats;
  }
  let pointDone = 0;

  const addMove = (command: Move['command'], rawTarget: Point, working: boolean, feed: number, pathId?: string, zOnly = false) => {
    const target = quantizePoint(rawTarget, settings);
    if (isSamePoint(current, target)) return;
    const move: Move = { command, from: current, to: target, working, feed: quantizeMachineNumber(feed, settings.precision), pathId, ...(zOnly ? { zOnly: true } : {}) };
    moves.push(move);
    current = target;
  };

  const liftToSafeZ = (pathId?: string) => {
    const safeZ = quantizeMachineNumber(settings.safeZ, settings.precision);
    if (current.z === safeZ) return;
    addMove('G0', { ...current, z: safeZ }, false, settings.travel, pathId, true);
  };

  // Never assume a CNC begins at safe Z. Emit a standalone retract before the
  // first XY rapid so the first move cannot be a diagonal lift/travel.
  if (profile.kind === 'cnc') liftToSafeZ();

  const passDepth = fromMillimetres(profile.passDepth, settings.units);
  for (const path of toolpath.paths) {
    if (path.points.length < 2) continue;
    const start = mapped(path.points[0]);
    if (outsideWorkArea(start, settings)) warningSet.add(`Path ${path.id} begins outside work area.`);

    if (path.kind === 'travel') {
      if (profile.kind === 'cnc') liftToSafeZ(path.id);
      addMove('G0', { ...start, z: profile.kind === 'cnc' ? settings.safeZ : undefined }, false, settings.travel, path.id);
      for (let pointIndex = 1; pointIndex < path.points.length; pointIndex += 1) {
        const target = mapped(path.points[pointIndex]);
        if (outsideWorkArea(target, settings)) warningSet.add(`Path ${path.id} extends outside work area.`);
        addMove('G0', { ...target, z: profile.kind === 'cnc' ? settings.safeZ : undefined }, false, settings.travel, path.id);
        pointDone += 1;
      }
      continue;
    }

    for (let pass = 0; pass < settings.passes; pass += 1) {
      if (profile.kind === 'cnc') liftToSafeZ(path.id);
      addMove('G0', { ...start, z: profile.kind === 'cnc' ? settings.safeZ : undefined }, false, settings.travel, path.id);
      const fullDepth = Math.max(settings.maxDepth, settings.workZ - pass * passDepth);
      const depthAt = (point: Point) => toolpath.mode === 'grayscale'
        ? fullDepth * (point.intensity ?? 1)
        : fullDepth;
      if (profile.kind === 'cnc') addMove('G1', { ...start, z: depthAt(start) }, true, settings.feed, path.id);

      for (let pointIndex = 1; pointIndex < path.points.length; pointIndex += 1) {
        const target = mapped(path.points[pointIndex]);
        if (profile.kind === 'cnc') target.z = depthAt(target);
        if (outsideWorkArea(target, settings)) warningSet.add(`Path ${path.id} extends outside work area.`);
        addMove('G1', target, true, settings.feed, path.id);
        pointDone += 1;
        if (pointDone % 4096 === 0) onProgress?.('movements', pointDone, pointTotal);
      }
    }
  }

  if (profile.kind === 'cnc') liftToSafeZ();
  onProgress?.('movements', pointTotal, pointTotal);
  return { moves, warnings: [...warningSet] };
}

/** Builds machine geometry without retaining or serializing a G-code document. */
export function buildMovements(toolpath: Toolpath, settings: Settings, profile: MachineProfile, onProgress?: GenerationProgress): MovementResult {
  return buildCanonicalMovements(toolpath, settings, profile, onProgress);
}

/** Serializes only on demand; callers that only need geometry should use buildMovements. */
export function generate(toolpath: Toolpath, settings: Settings, profile: MachineProfile, onProgress?: GenerationProgress): GcodeResult {
  const profileConfiguration = profileErrors(profile);
  if (profileConfiguration.length) throw new Error(profileConfiguration[0]);
  const processor = requirePostProcessor(profile.postProcessorId);
  const findings = processor.validateProfile(profile, settings);
  const blocking = findings.find((finding) => finding.severity === 'blocking');
  if (blocking) throw new Error(blocking.message);
  const { moves, warnings } = buildCanonicalMovements(toolpath, settings, profile, onProgress);
  for (const finding of findings) if (finding.severity === 'warning') warnings.push(finding.message);
  const code = processor.serialize(moves, {
    settings,
    profile,
    mode: toolpath.mode,
    onProgress: (completed, total) => onProgress?.('gcode', completed, total),
  });
  return { code, moves, warnings };
}

export function statistics(
  moves: Move[],
  onProgress?: (completed: number, total: number) => void,
  safety?: StatisticsSafetyContext,
): ToolpathStats {
  let work = 0;
  let travel = 0;
  let working = 0;
  let travels = 0;
  let toolLifts = 0;
  let previousWorking = false;
  let time = 0;
  let workMinutes = 0;
  let travelMinutes = 0;
  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  let minZ = Infinity;
  let maxZ = -Infinity;
  let hasCoordinates = false;
  let hasZ = false;
  let nonFiniteCoordinateCount = 0;
  let invalidFeedCount = 0;
  let zeroLengthMoveCount = 0;
  let discontinuityCount = 0;
  let invalidStateCount = 0;
  let unsafeCncRapidCount = 0;
  let missingCncWorkingZCount = 0;
  let minWorkingZ = Infinity;
  let maxWorkingZ = -Infinity;
  let hasWorkingZ = false;

  const finitePoint = (point: Point) => Number.isFinite(point.x)
    && Number.isFinite(point.y)
    && (point.z === undefined || Number.isFinite(point.z));
  const copyPoint = (point: Point): Point => ({ x: point.x, y: point.y, ...(point.z === undefined ? {} : { z: point.z }) });
  const start = moves.length > 0 && finitePoint(moves[0].from) ? copyPoint(moves[0].from) : null;
  const end = moves.length > 0 && finitePoint(moves[moves.length - 1].to) ? copyPoint(moves[moves.length - 1].to) : null;
  const safeZTolerance = safety && Number.isInteger(safety.precision) && safety.precision >= 0
    ? 0.5 * 10 ** -safety.precision
    : 0;

  const includePoint = (point: Point) => {
    if (Number.isFinite(point.x) && Number.isFinite(point.y)) {
      minX = Math.min(minX, point.x);
      maxX = Math.max(maxX, point.x);
      minY = Math.min(minY, point.y);
      maxY = Math.max(maxY, point.y);
      hasCoordinates = true;
    }
    if (point.z !== undefined && Number.isFinite(point.z)) {
      minZ = Math.min(minZ, point.z);
      maxZ = Math.max(maxZ, point.z);
      hasZ = true;
    }
  };

  for (let index = 0; index < moves.length; index += 1) {
    const move = moves[index];
    if (!finitePoint(move.from) || !finitePoint(move.to)) nonFiniteCoordinateCount += 1;
    if (!Number.isFinite(move.feed) || (move.feed ?? 0) <= 0) invalidFeedCount += 1;
    if (index > 0 && !isSamePoint(moves[index - 1].to, move.from)) discontinuityCount += 1;
    if ((move.working && move.command !== 'G1') || (!move.working && move.command !== 'G0')) invalidStateCount += 1;
    const deltaX = move.to.x - move.from.x;
    const deltaY = move.to.y - move.from.y;
    const deltaZ = (move.to.z ?? 0) - (move.from.z ?? 0);
    const xyChanges = Number.isFinite(deltaX) && Number.isFinite(deltaY) && (deltaX !== 0 || deltaY !== 0);
    if (!move.zOnly && deltaX === 0 && deltaY === 0 && deltaZ === 0) zeroLengthMoveCount += 1;
    if (safety?.machineKind === 'cnc' && move.command === 'G0' && xyChanges) {
      const atSafeZ = move.from.z !== undefined && move.to.z !== undefined
        && Number.isFinite(move.from.z) && Number.isFinite(move.to.z)
        && Math.abs(move.from.z - safety.safeZ) <= safeZTolerance
        && Math.abs(move.to.z - safety.safeZ) <= safeZTolerance;
      if (!atSafeZ) unsafeCncRapidCount += 1;
    }
    if (safety?.machineKind === 'cnc' && move.working) {
      if (move.to.z === undefined || !Number.isFinite(move.to.z)) missingCncWorkingZCount += 1;
      else {
        minWorkingZ = Math.min(minWorkingZ, move.to.z);
        maxWorkingZ = Math.max(maxWorkingZ, move.to.z);
        hasWorkingZ = true;
      }
    }
    includePoint(move.from);
    includePoint(move.to);
    const moveDistance = distance(move.from, move.to);
    const validDistance = Number.isFinite(moveDistance) ? moveDistance : 0;
    if (move.working) {
      work += validDistance;
      working += 1;
      if (!previousWorking) toolLifts += 1;
    } else {
      travel += validDistance;
      travels += 1;
    }
    const duration = movementDurationMinutes(move);
    time += duration;
    if (move.working) workMinutes += duration;
    else travelMinutes += duration;
    previousWorking = move.working;
    if (index % 4096 === 0) onProgress?.(index, moves.length);
  }
  onProgress?.(moves.length, moves.length);
  return {
    work,
    travel,
    total: work + travel,
    movementCount: moves.length,
    working,
    travels,
    toolLifts,
    travelEfficiency: work + travel > 0 ? work / (work + travel) : 0,
    time,
    estimate: { totalMinutes: time, workMinutes, travelMinutes },
    bounds: hasCoordinates
      ? {
        minX: minX === 0 ? 0 : minX,
        maxX: maxX === 0 ? 0 : maxX,
        minY: minY === 0 ? 0 : minY,
        maxY: maxY === 0 ? 0 : maxY,
        minZ: hasZ ? (minZ === 0 ? 0 : minZ) : null,
        maxZ: hasZ ? (maxZ === 0 ? 0 : maxZ) : null,
      }
      : null,
    diagnostics: {
      start,
      end,
      nonFiniteCoordinateCount,
      invalidFeedCount,
      zeroLengthMoveCount,
      discontinuityCount,
      invalidStateCount,
      unsafeCncRapidCount,
      missingCncWorkingZCount,
      minWorkingZ: hasWorkingZ ? minWorkingZ : null,
      maxWorkingZ: hasWorkingZ ? maxWorkingZ : null,
    },
  };
}
