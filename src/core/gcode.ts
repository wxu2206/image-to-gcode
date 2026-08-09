import type { GcodeResult, MachineProfile, Move, Point, Settings, Toolpath } from './types';
import { distance, machinePoint } from './geometry';
import { validate } from './machine';

export type ToolpathStats = {
  work: number; travel: number; total: number; movementCount: number; working: number; travels: number; time: number;
  bounds: { minX: number; maxX: number; minY: number; maxY: number; minZ: number | null; maxZ: number | null } | null;
};

const format = (value: number, precision: number) => value.toFixed(precision).replace(/\.?0+$/, '');
const coordinates = (point: Point, settings: Settings) =>
  `X${format(point.x, settings.precision)} Y${format(point.y, settings.precision)}${point.z === undefined ? '' : ` Z${format(point.z, settings.precision)}`}`;
export type GenerationStage = 'movements' | 'gcode';
export type GenerationProgress = (stage: GenerationStage, completed: number, total: number) => void;
export type MovementResult = Pick<GcodeResult, 'moves' | 'warnings'>;
type ProgramBuild = MovementResult & { program: Array<string | Move> };

function isSamePoint(a: Point, b: Point) {
  return a.x === b.x && a.y === b.y && a.z === b.z;
}

function buildProgram(toolpath: Toolpath, settings: Settings, profile: MachineProfile, onProgress?: GenerationProgress): ProgramBuild {
  const warningSet = new Set(validate(settings));
  const program: Array<string | Move> = [
    '; image-to-gcode — inspect before running',
    `; mode: ${toolpath.mode}`,
    settings.units === 'mm' ? 'G21' : 'G20',
    'G90',
  ];
  for (const line of profile.header.trim().split('\n')) if (line) program.push(line);
  const moves: Move[] = [];
  let current: Point = profile.kind === 'cnc' ? { x: 0, y: 0, z: settings.safeZ } : { x: 0, y: 0 };
  const xScale = settings.outputWidth / toolpath.width;
  const yScale = settings.outputHeight / toolpath.height;
  // Decoded image rows are top-to-bottom; machine geometry is bottom-to-top. Flip
  // source Y exactly once before applying the user-selected machine transforms.
  const mapped = (source: Point): Point => machinePoint({ x: source.x * xScale, y: settings.outputHeight - source.y * yScale, z: source.z }, settings);
  let pointTotal = 0;
  for (const path of toolpath.paths) pointTotal += Math.max(0, path.points.length - 1) * settings.passes;
  let pointDone = 0;

  const addMove = (command: Move['command'], target: Point, working: boolean, feed: number, pathId?: string) => {
    if (isSamePoint(current, target)) return;
    const move = { command, from: current, to: target, working, feed, pathId } as Move;
    moves.push(move);
    program.push(move);
    current = target;
  };
  const liftToSafeZ = (pathId?: string) => {
    if (current.z === settings.safeZ) return;
    const target = { ...current, z: settings.safeZ };
    const move: Move = { command: 'G0', from: current, to: target, working: false, feed: settings.travel, pathId, zOnly: true };
    moves.push(move);
    program.push(move);
    current = target;
  };

  for (const path of toolpath.paths) {
    if (path.points.length < 2) continue;
    const start = mapped(path.points[0]);
    if (start.x < 0 || start.y < 0 || start.x > settings.workWidth || start.y > settings.workHeight) {
      warningSet.add(`Path ${path.id} begins outside work area.`);
    }

    for (let pass = 0; pass < settings.passes; pass += 1) {
      if (profile.kind === 'cnc') liftToSafeZ(path.id);
      addMove('G0', { ...start, z: profile.kind === 'cnc' ? settings.safeZ : current.z }, false, settings.travel, path.id);
      if (profile.toolOn.trim()) program.push(profile.toolOn);

      const depth = Math.max(settings.maxDepth, settings.workZ - pass * profile.passDepth);
      if (profile.kind === 'cnc') addMove('G1', { ...start, z: depth }, true, settings.feed, path.id);

      for (let pointIndex = 1; pointIndex < path.points.length; pointIndex += 1) {
        const target = mapped(path.points[pointIndex]);
        if (profile.kind === 'cnc') target.z = depth;
        if (target.x < 0 || target.y < 0 || target.x > settings.workWidth || target.y > settings.workHeight) {
          warningSet.add(`Path ${path.id} extends outside work area.`);
        }
        addMove('G1', target, true, settings.feed, path.id);
        pointDone += 1;
        if (pointDone % 4096 === 0) onProgress?.('movements', pointDone, pointTotal);
      }
      if (profile.toolOff.trim()) program.push(profile.toolOff);
    }
  }

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
  let time = 0;
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
    } else {
      travel += validDistance;
      travels += 1;
    }
    if (Number.isFinite(move.feed) && move.feed !== undefined && move.feed > 0) time += validDistance / move.feed * 60;
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
    time,
    bounds: hasCoordinates ? { minX: minX === 0 ? 0 : minX, maxX: maxX === 0 ? 0 : maxX, minY: minY === 0 ? 0 : minY, maxY: maxY === 0 ? 0 : maxY, minZ: hasZ ? (minZ === 0 ? 0 : minZ) : null, maxZ: hasZ ? (maxZ === 0 ? 0 : maxZ) : null } : null,
  };
}
