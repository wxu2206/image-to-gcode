import { detailResolution } from './detail';
import type { ConversionMode, Settings } from './types';

export type ComplexityLevel = 'normal' | 'large' | 'very-large' | 'extreme';
export type ComplexityEstimate = { samples: number; scanlines: number; movements: number; level: ComplexityLevel; recommendedDetail: number };

export const classifyMovementCount = (movements: number): ComplexityLevel => movements > 250_000 ? 'extreme' : movements > 200_000 ? 'very-large' : movements > 100_000 ? 'large' : 'normal';

/** Cheap upper-bound estimate used to guard automatic processing, not machine capability. */
export function estimateComplexity(source: { width: number; height: number }, settings: Pick<Settings, 'outputWidth' | 'outputHeight' | 'toolpathDetail' | 'units' | 'lineSpacing' | 'passes'>, mode: Exclude<ConversionMode, 'vector'>): ComplexityEstimate {
  const resolution = detailResolution(source, settings);
  const scanlines = Math.ceil(settings.outputHeight / Math.max(.001, settings.lineSpacing));
  const samples = resolution.width * resolution.height;
  const passMultiplier = Number.isInteger(settings.passes) && settings.passes > 0 ? settings.passes : 1;
  const baseMovements = mode === 'contour'
    ? Math.min(samples * 4, 3_500_000)
    : Math.min(samples, resolution.width * scanlines) + scanlines;
  const movements = baseMovements * passMultiplier;
  let recommendedDetail = Math.max(.3, settings.toolpathDetail);
  while (recommendedDetail < 5) {
    const candidate = detailResolution(source, { ...settings, toolpathDetail: recommendedDetail });
    const candidateBase = mode === 'contour'
      ? Math.min(candidate.width * candidate.height * 4, 3_500_000)
      : Math.min(candidate.width * scanlines, candidate.width * candidate.height) + scanlines;
    const candidateMoves = candidateBase * passMultiplier;
    if (candidateMoves <= 150_000) break;
    recommendedDetail = Math.round((recommendedDetail + .05) * 100) / 100;
  }
  return { samples, scanlines, movements, level: classifyMovementCount(movements), recommendedDetail };
}
