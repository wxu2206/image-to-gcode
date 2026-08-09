import type { GcodeResult, MachineProfile, Move, Point, Settings, Toolpath } from './types';
import { distance, machinePoint, scaleToOutput } from './geometry';
import { validate } from './machine';

const format = (value: number, precision: number) => value.toFixed(precision).replace(/\.?0+$/, '');
const coordinates = (point: Point, settings: Settings) =>
  `X${format(point.x, settings.precision)} Y${format(point.y, settings.precision)}${point.z === undefined ? '' : ` Z${format(point.z, settings.precision)}`}`;

function isSamePoint(a: Point, b: Point) {
  return a.x === b.x && a.y === b.y && a.z === b.z;
}

export function generate(toolpath: Toolpath, settings: Settings, profile: MachineProfile): GcodeResult {
  const warnings = validate(settings);
  const lines = [
    '; image-to-gcode — inspect before running',
    `; mode: ${toolpath.mode}`,
    settings.units === 'mm' ? 'G21' : 'G20',
    'G90',
  ];
  for (const line of profile.header.trim().split('\n')) if (line) lines.push(line);
  const moves: Move[] = [];
  let current: Point = profile.kind === 'cnc' ? { x: 0, y: 0, z: settings.safeZ } : { x: 0, y: 0 };
  const mapped = (point: Point) => machinePoint(scaleToOutput(point, toolpath.width, toolpath.height, settings), settings);

  const addMove = (command: Move['command'], target: Point, working: boolean, feed: number, pathId?: string) => {
    if (isSamePoint(current, target)) return;
    lines.push(`${command} ${coordinates(target, settings)} F${format(feed, settings.precision)}`);
    moves.push({ command, from: current, to: target, working, feed, pathId });
    current = target;
  };
  const liftToSafeZ = (pathId?: string) => {
    if (current.z === settings.safeZ) return;
    const target = { ...current, z: settings.safeZ };
    lines.push(`G0 Z${format(settings.safeZ, settings.precision)}`);
    moves.push({ command: 'G0', from: current, to: target, working: false, feed: settings.travel, pathId });
    current = target;
  };

  for (const path of toolpath.paths) {
    if (path.points.length < 2) continue;
    const start = mapped(path.points[0]);
    if (start.x < 0 || start.y < 0 || start.x > settings.workWidth || start.y > settings.workHeight) {
      warnings.push(`Path ${path.id} begins outside work area.`);
    }

    for (let pass = 0; pass < settings.passes; pass += 1) {
      if (profile.kind === 'cnc') liftToSafeZ(path.id);
      addMove('G0', { ...start, z: profile.kind === 'cnc' ? settings.safeZ : current.z }, false, settings.travel, path.id);
      if (profile.toolOn.trim()) lines.push(profile.toolOn);

      const depth = Math.max(settings.maxDepth, settings.workZ - pass * profile.passDepth);
      if (profile.kind === 'cnc') addMove('G1', { ...start, z: depth }, true, settings.feed, path.id);

      for (let pointIndex = 1; pointIndex < path.points.length; pointIndex += 1) {
        const target = mapped(path.points[pointIndex]);
        if (profile.kind === 'cnc') target.z = depth;
        if (target.x < 0 || target.y < 0 || target.x > settings.workWidth || target.y > settings.workHeight) {
          warnings.push(`Path ${path.id} extends outside work area.`);
        }
        addMove('G1', target, true, settings.feed, path.id);
      }
      if (profile.toolOff.trim()) lines.push(profile.toolOff);
    }
  }

  if (profile.kind === 'cnc') liftToSafeZ();
  for (const line of profile.footer.trim().split('\n')) if (line) lines.push(line);
  return { code: `${lines.join('\n')}\n`, moves, warnings: [...new Set(warnings)] };
}

export function statistics(moves: Move[]) {
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

  for (const move of moves) {
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
  }
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
