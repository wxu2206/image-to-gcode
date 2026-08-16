import type { VectorPath, VectorPoint, VectorSegment } from './model';
import { IDENTITY_MATRIX } from './affine';

type Token = string | number;
type ParseBudget = { commands: number; segments: number; maxCommands: number; maxSegments: number };

const pathNumber = /[-+]?(?:\d*\.\d+|\d+\.?)(?:[eE][-+]?\d+)?/gy;
const supportedCommands = new Set('MmLlHhVvCcSsQqTtAaZz'.split(''));

function tokenizePathData(source: string, maximumTokens: number): Token[] {
  const tokens: Token[] = [];
  let index = 0;
  while (index < source.length) {
    const character = source[index];
    if (/[\s,]/.test(character)) { index += 1; continue; }
    if (/[a-zA-Z]/.test(character)) {
      if (!supportedCommands.has(character)) throw new Error(`Unsupported SVG path command “${character}”.`);
      tokens.push(character);
      if (tokens.length > maximumTokens) throw new Error('SVG path command limit exceeded. Simplify the SVG and try again.');
      index += 1;
      continue;
    }
    pathNumber.lastIndex = index;
    const match = pathNumber.exec(source);
    if (!match || match.index !== index) throw new Error('SVG path data contains malformed syntax.');
    const value = Number(match[0]);
    if (!Number.isFinite(value)) throw new Error('SVG path data contains a non-finite coordinate.');
    tokens.push(value);
    if (tokens.length > maximumTokens) throw new Error('SVG path command limit exceeded. Simplify the SVG and try again.');
    index = pathNumber.lastIndex;
  }
  return tokens;
}

const point = (x: number, y: number): VectorPoint => ({ x, y });
const samePoint = (a: VectorPoint, b: VectorPoint) => a.x === b.x && a.y === b.y;
const reflected = (control: VectorPoint | null, around: VectorPoint) => control ? point(2 * around.x - control.x, 2 * around.y - control.y) : around;

export function parsePathData(source: string, idPrefix: string, budget: ParseBudget): VectorPath[] {
  const tokens = tokenizePathData(source, budget.maxCommands * 8 + 16);
  const paths: VectorPath[] = [];
  let index = 0;
  let command: string | null = null;
  let current = point(0, 0);
  let start = point(0, 0);
  let segments: VectorSegment[] = [];
  let closed = false;
  let subpathIndex = 0;
  let previousCommand = '';
  let lastCubicControl: VectorPoint | null = null;
  let lastQuadraticControl: VectorPoint | null = null;
  let hasInitialMove = false;

  const flush = () => {
    if (segments.length) paths.push({ id: `${idPrefix}-${subpathIndex++}`, closed, segments, transform: IDENTITY_MATRIX });
    segments = [];
    closed = false;
  };
  const hasNumbers = () => index < tokens.length && typeof tokens[index] === 'number';
  const read = (count: number): number[] => {
    if (index + count > tokens.length) throw new Error('SVG path command is missing parameters.');
    const values = tokens.slice(index, index + count);
    if (values.some((value) => typeof value !== 'number')) throw new Error('SVG path command is missing numeric parameters.');
    index += count;
    return values as number[];
  };
  const target = (x: number, y: number, relative: boolean) => relative ? point(current.x + x, current.y + y) : point(x, y);
  const add = (segment: VectorSegment) => {
    budget.commands += 1;
    budget.segments += 1;
    if (budget.commands > budget.maxCommands) throw new Error('SVG path command limit exceeded. Simplify the SVG and try again.');
    if (budget.segments > budget.maxSegments) throw new Error('SVG vector segment limit exceeded. Simplify the SVG and try again.');
    segments.push(segment);
    current = segment.to;
  };
  const addCommand = () => {
    budget.commands += 1;
    if (budget.commands > budget.maxCommands) throw new Error('SVG path command limit exceeded. Simplify the SVG and try again.');
  };

  while (index < tokens.length) {
    if (typeof tokens[index] === 'string') command = tokens[index++] as string;
    else if (!command) throw new Error('SVG path data must begin with a command.');
    const relative: boolean = command === command.toLowerCase();
    const upper = command.toUpperCase();
    if (!hasInitialMove && upper !== 'M') throw new Error('SVG path data must begin with a move command.');
    if (upper === 'Z') {
      if (segments.length && !samePoint(current, start)) add({ type: 'line', from: current, to: start });
      else addCommand();
      current = start;
      closed = true;
      flush();
      previousCommand = upper;
      lastCubicControl = null;
      lastQuadraticControl = null;
      command = null;
      continue;
    }
    if (!hasNumbers()) throw new Error(`SVG path command “${command}” is missing parameters.`);

    if (upper === 'M') {
      const [x, y] = read(2);
      addCommand();
      flush();
      current = target(x, y, relative);
      start = current;
      hasInitialMove = true;
      previousCommand = upper;
      lastCubicControl = null;
      lastQuadraticControl = null;
      command = relative ? 'l' : 'L';
      continue;
    }
    if (upper === 'L') {
      const [x, y] = read(2); const to = target(x, y, relative);
      add({ type: 'line', from: current, to });
      lastCubicControl = null; lastQuadraticControl = null;
    } else if (upper === 'H') {
      const [x] = read(1); const to = point(relative ? current.x + x : x, current.y);
      add({ type: 'line', from: current, to });
      lastCubicControl = null; lastQuadraticControl = null;
    } else if (upper === 'V') {
      const [y] = read(1); const to = point(current.x, relative ? current.y + y : y);
      add({ type: 'line', from: current, to });
      lastCubicControl = null; lastQuadraticControl = null;
    } else if (upper === 'C') {
      const [x1, y1, x2, y2, x, y] = read(6);
      const control1 = target(x1, y1, relative); const control2 = target(x2, y2, relative); const to = target(x, y, relative);
      add({ type: 'cubic', from: current, control1, control2, to });
      lastCubicControl = control2; lastQuadraticControl = null;
    } else if (upper === 'S') {
      const [x2, y2, x, y] = read(4);
      const control1 = reflected(previousCommand === 'C' || previousCommand === 'S' ? lastCubicControl : null, current);
      const control2 = target(x2, y2, relative); const to = target(x, y, relative);
      add({ type: 'cubic', from: current, control1, control2, to });
      lastCubicControl = control2; lastQuadraticControl = null;
    } else if (upper === 'Q') {
      const [cx, cy, x, y] = read(4);
      const control = target(cx, cy, relative); const to = target(x, y, relative);
      add({ type: 'quadratic', from: current, control, to });
      lastQuadraticControl = control; lastCubicControl = null;
    } else if (upper === 'T') {
      const [x, y] = read(2);
      const control = reflected(previousCommand === 'Q' || previousCommand === 'T' ? lastQuadraticControl : null, current);
      const to = target(x, y, relative);
      add({ type: 'quadratic', from: current, control, to });
      lastQuadraticControl = control; lastCubicControl = null;
    } else if (upper === 'A') {
      const [rx, ry, rotation, largeArc, sweep, x, y] = read(7);
      if ((largeArc !== 0 && largeArc !== 1) || (sweep !== 0 && sweep !== 1)) throw new Error('SVG arc flags must be 0 or 1.');
      const to = target(x, y, relative);
      if (rx === 0 || ry === 0) add({ type: 'line', from: current, to });
      else add({ type: 'arc', from: current, to, rx: Math.abs(rx), ry: Math.abs(ry), rotation, largeArc: largeArc === 1, sweep: sweep === 1 });
      lastCubicControl = null; lastQuadraticControl = null;
    } else {
      throw new Error(`Unsupported SVG path command “${command}”.`);
    }
    previousCommand = upper;
  }
  flush();
  return paths;
}
