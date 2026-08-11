import type { GcodeResult, MachineProfile, Move, Point, Settings, Toolpath } from './types';
import { distance, machinePoint } from './geometry';
import { configurationErrors, profileErrors, profileWarnings, validate } from './machine';
import { movementDurationMinutes, type RuntimeEstimate } from './runtime';
import { fromMillimetres } from './units';

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
};

function format(value: number, precision: number): string {
  if (!Number.isFinite(value)) throw new Error('G-code serialization received a non-finite number.');
  const fixed = value.toFixed(precision);
  if (Number(fixed) === 0) return '0';
  return fixed.includes('.') ? fixed.replace(/0+$/, '').replace(/\.$/, '') : fixed;
}

function quantize(value: number, precision: number): number {
  if (!Number.isFinite(value)) throw new Error('Machine geometry contains a non-finite coordinate.');
  const factor = 10 ** precision;
  const rounded = Math.sign(value) * Math.round(Math.abs(value) * factor) / factor;
  return rounded === 0 ? 0 : rounded;
}

function quantizePoint(point: Point, settings: Settings): Point {
  return {
    ...point,
    x: quantize(point.x, settings.precision),
    y: quantize(point.y, settings.precision),
    ...(point.z === undefined ? {} : { z: quantize(point.z, settings.precision) }),
  };
}

const coordinates = (point: Point, settings: Settings) =>
  `X${format(point.x, settings.precision)} Y${format(point.y, settings.precision)}${point.z === undefined ? '' : ` Z${format(point.z, settings.precision)}`}`;

export type GenerationStage = 'movements' | 'gcode';
export type GenerationProgress = (stage: GenerationStage, completed: number, total: number) => void;
export type MovementResult = Pick<GcodeResult, 'moves' | 'warnings'>;
type ProgramBuild = MovementResult & { program: Array<string | Move> };

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
  const errors = [...configurationErrors(settings, profile.kind), ...profileErrors(profile)];
  if (profile.kind === 'cnc' && Number.isFinite(profile.passDepth)) {
    const passDepth = fromMillimetres(profile.passDepth, settings.units);
    if (quantize(passDepth, settings.precision) <= 0) errors.push('Machine profile pass depth rounds to zero at the selected precision.');
  }
  if (errors.length) throw new Error(errors[0]);
}

function outsideWorkArea(point: Point, settings: Settings): boolean {
  return point.x < 0 || point.y < 0 || point.x > settings.workWidth || point.y > settings.workHeight;
}

function buildProgram(toolpath: Toolpath, settings: Settings, profile: MachineProfile, onProgress?: GenerationProgress): ProgramBuild {
  assertConfiguration(settings, profile);
  assertToolpath(toolpath);

  const warningSet = new Set([...validate(settings, profile.kind), ...profileWarnings(profile)]);
  if (toolpath.mode === 'grayscale' && profile.kind !== 'cnc') {
    warningSet.add('Variable grayscale intensity is only mapped to depth for CNC profiles.');
  }

  const program: Array<string | Move> = [
    '; image-to-gcode - inspect before running',
    `; mode: ${toolpath.mode}`,
  ];
  // Custom setup may contain modal commands. Reassert the generator's required
  // unit and absolute-positioning modes immediately before generated motion.
  for (const line of profile.header.trim().split('\n')) if (line) program.push(line);
  program.push(settings.units === 'mm' ? 'G21' : 'G20', 'G90', 'G94');

  const moves: Move[] = [];
  let current: Point = profile.kind === 'cnc' ? { x: 0, y: 0 } : { x: 0, y: 0 };
  let toolActive = false;
  let motionModesDirty = false;
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
    if (motionModesDirty) {
      program.push(settings.units === 'mm' ? 'G21' : 'G20', 'G90', 'G94');
      motionModesDirty = false;
    }
    const move: Move = { command, from: current, to: target, working, feed: quantize(feed, settings.precision), pathId, ...(zOnly ? { zOnly: true } : {}) };
    moves.push(move);
    program.push(move);
    current = target;
  };

  const liftToSafeZ = (pathId?: string) => {
    const safeZ = quantize(settings.safeZ, settings.precision);
    if (current.z === safeZ) return;
    addMove('G0', { ...current, z: safeZ }, false, settings.travel, pathId, true);
  };

  const turnToolOff = (force = false) => {
    const command = profile.toolOff.trim();
    if (command && (force || toolActive)) {
      program.push(command);
      motionModesDirty = true;
    }
    toolActive = false;
  };

  const turnToolOn = () => {
    const command = profile.toolOn.trim();
    if (command) {
      program.push(command);
      toolActive = true;
      motionModesDirty = true;
    }
  };

  // Establish an explicitly inactive tool after the custom header and before
  // any travel. No command is assumed when the profile leaves this blank.
  turnToolOff(true);
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
      turnToolOn();

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
      turnToolOff();
    }
  }

  turnToolOff();
  if (profile.kind === 'cnc') liftToSafeZ();
  onProgress?.('movements', pointTotal, pointTotal);
  return { program, moves, warnings: [...warningSet] };
}

function serializeProgram(program: Array<string | Move>, settings: Settings, profile: MachineProfile, onProgress?: GenerationProgress): string {
  const lines = new Array<string>(program.length);
  for (let index = 0; index < program.length; index += 1) {
    const instruction = program[index];
    lines[index] = typeof instruction === 'string'
      ? instruction
      : instruction.zOnly
        ? `G0 Z${format(instruction.to.z ?? settings.safeZ, settings.precision)}`
        : `${instruction.command} ${coordinates(instruction.to, settings)} F${format(instruction.feed ?? settings.feed, settings.precision)}`;
    if (index % 4096 === 0) onProgress?.('gcode', index, program.length);
  }
  for (const line of profile.footer.trim().split('\n')) if (line) lines.push(line);
  onProgress?.('gcode', program.length, program.length);
  return `${lines.join('\n')}\n`;
}

/** Builds machine geometry without retaining or serializing a G-code document. */
export function buildMovements(toolpath: Toolpath, settings: Settings, profile: MachineProfile, onProgress?: GenerationProgress): MovementResult {
  const { moves, warnings } = buildProgram(toolpath, settings, profile, onProgress);
  return { moves, warnings };
}

/** Serializes only on demand; callers that only need geometry should use buildMovements. */
export function generate(toolpath: Toolpath, settings: Settings, profile: MachineProfile, onProgress?: GenerationProgress): GcodeResult {
  const { program, moves, warnings } = buildProgram(toolpath, settings, profile, onProgress);
  return { code: serializeProgram(program, settings, profile, onProgress), moves, warnings };
}

export function statistics(moves: Move[], onProgress?: (completed: number, total: number) => void): ToolpathStats {
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
  };
}
