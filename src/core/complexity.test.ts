import { describe, expect, it } from 'vitest';
import { estimateComplexity } from './complexity';
import { defaults } from './machine';

describe('complexity guardrails', () => {
  it('classifies fine dense raster jobs as extreme and recommends a safer detail', () => {
    const estimate = estimateComplexity({ width: 900, height: 900 }, { ...defaults, outputWidth: 150, outputHeight: 150, lineSpacing: .5, toolpathDetail: .1 }, 'raster');
    expect(estimate).toMatchObject({ level: 'extreme', movements: 270_300 });
    expect(estimate.recommendedDetail).toBeGreaterThanOrEqual(.3);
  });
  it('does not treat normal jobs as a browser-safety confirmation case', () => {
    expect(estimateComplexity({ width: 900, height: 900 }, { ...defaults, toolpathDetail: 1 }, 'raster').level).toBe('normal');
  });
  it('accounts for multi-pass movement multiplication', () => {
    const single = estimateComplexity({ width: 500, height: 500 }, { ...defaults, outputWidth: 100, outputHeight: 100, toolpathDetail: .5, passes: 1 }, 'raster');
    const repeated = estimateComplexity({ width: 500, height: 500 }, { ...defaults, outputWidth: 100, outputHeight: 100, toolpathDetail: .5, passes: 8 }, 'raster');
    expect(repeated.movements).toBe(single.movements * 8);
    expect(repeated.level).toBe('extreme');
  });
});
