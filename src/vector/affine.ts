import type { AffineMatrix, VectorPoint } from './model';

export const IDENTITY_MATRIX: AffineMatrix = [1, 0, 0, 1, 0, 0];

/** Matrix multiplication for SVG column vectors: multiply(parent, local). */
export function multiplyAffine(left: AffineMatrix, right: AffineMatrix): AffineMatrix {
  const [a, b, c, d, e, f] = left;
  const [g, h, i, j, k, l] = right;
  return [
    a * g + c * h,
    b * g + d * h,
    a * i + c * j,
    b * i + d * j,
    a * k + c * l + e,
    b * k + d * l + f,
  ];
}

export function transformVectorPoint(matrix: AffineMatrix, point: VectorPoint): VectorPoint {
  return {
    x: matrix[0] * point.x + matrix[2] * point.y + matrix[4],
    y: matrix[1] * point.x + matrix[3] * point.y + matrix[5],
  };
}

const numberPattern = /[-+]?(?:\d*\.\d+|\d+\.?)(?:[eE][-+]?\d+)?/gy;

function parseTransformNumbers(source: string): number[] {
  const numbers: number[] = [];
  let index = 0;
  while (index < source.length) {
    while (index < source.length && /[\s,]/.test(source[index])) index += 1;
    if (index >= source.length) break;
    numberPattern.lastIndex = index;
    const match = numberPattern.exec(source);
    if (!match || match.index !== index) throw new Error('Transform contains malformed numeric parameters.');
    const value = Number(match[0]);
    if (!Number.isFinite(value)) throw new Error('Transform contains a non-finite value.');
    numbers.push(value);
    index = numberPattern.lastIndex;
  }
  return numbers;
}

function operationMatrix(name: string, values: number[]): AffineMatrix {
  if (name === 'matrix' && values.length === 6) return values as unknown as AffineMatrix;
  if (name === 'translate' && (values.length === 1 || values.length === 2)) return [1, 0, 0, 1, values[0], values[1] ?? 0];
  if (name === 'scale' && (values.length === 1 || values.length === 2)) return [values[0], 0, 0, values[1] ?? values[0], 0, 0];
  if (name === 'rotate' && (values.length === 1 || values.length === 3)) {
    const radians = values[0] * Math.PI / 180;
    const rotation: AffineMatrix = [Math.cos(radians), Math.sin(radians), -Math.sin(radians), Math.cos(radians), 0, 0];
    if (values.length === 1) return rotation;
    const [cx, cy] = values.slice(1);
    return multiplyAffine(multiplyAffine([1, 0, 0, 1, cx, cy], rotation), [1, 0, 0, 1, -cx, -cy]);
  }
  if (name === 'skewx' && values.length === 1) return [1, 0, Math.tan(values[0] * Math.PI / 180), 1, 0, 0];
  if (name === 'skewy' && values.length === 1) return [1, Math.tan(values[0] * Math.PI / 180), 0, 1, 0, 0];
  throw new Error(`Unsupported or malformed SVG transform “${name}”.`);
}

export function parseSvgTransform(source: string | null): AffineMatrix {
  if (!source?.trim()) return IDENTITY_MATRIX;
  let result = IDENTITY_MATRIX;
  let index = 0;
  const expression = /([a-zA-Z]+)\s*\(([^)]*)\)/gy;
  while (index < source.length) {
    while (index < source.length && /[\s,]/.test(source[index])) index += 1;
    if (index >= source.length) break;
    expression.lastIndex = index;
    const match = expression.exec(source);
    if (!match || match.index !== index) throw new Error('SVG transform syntax is malformed.');
    const operation = operationMatrix(match[1].toLowerCase(), parseTransformNumbers(match[2]));
    result = multiplyAffine(result, operation);
    index = expression.lastIndex;
  }
  if (!result.every(Number.isFinite)) throw new Error('SVG transform produces non-finite coordinates.');
  return result;
}
