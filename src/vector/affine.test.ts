import { describe, expect, it } from 'vitest';
import { multiplyAffine, parseSvgTransform, transformVectorPoint } from './affine';

describe('SVG affine transforms', () => {
  it('parses each supported transform without evaluating arbitrary text', () => {
    expect(parseSvgTransform('translate(4 5)')).toEqual([1, 0, 0, 1, 4, 5]);
    expect(parseSvgTransform('scale(2,3)')).toEqual([2, 0, 0, 3, 0, 0]);
    expect(parseSvgTransform('matrix(1 2 3 4 5 6)')).toEqual([1, 2, 3, 4, 5, 6]);
    expect(transformVectorPoint(parseSvgTransform('skewX(45)'), { x: 0, y: 2 }).x).toBeCloseTo(2);
    expect(transformVectorPoint(parseSvgTransform('skewY(45)'), { x: 2, y: 0 }).y).toBeCloseTo(2);
  });

  it('applies a transform list and nested matrices in deterministic SVG order', () => {
    expect(transformVectorPoint(parseSvgTransform('translate(10,20) scale(2)'), { x: 1, y: 2 })).toEqual({ x: 12, y: 24 });
    const nested = multiplyAffine(parseSvgTransform('translate(5 0)'), parseSvgTransform('rotate(90)'));
    const result = transformVectorPoint(nested, { x: 2, y: 0 });
    expect(result.x).toBeCloseTo(5);
    expect(result.y).toBeCloseTo(2);
  });

  it('rotates around a supplied center', () => {
    const result = transformVectorPoint(parseSvgTransform('rotate(90 10 10)'), { x: 12, y: 10 });
    expect(result.x).toBeCloseTo(10);
    expect(result.y).toBeCloseTo(12);
  });

  it.each(['scale()', 'translate(1 2 3)', 'wat(1)', 'translate(NaN)', 'matrix(1 0 0 1 0)'])('rejects malformed transform %s', (source) => {
    expect(() => parseSvgTransform(source)).toThrow();
  });
});
