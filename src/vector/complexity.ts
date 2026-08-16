import { classifyMovementCount, type ComplexityEstimate } from '../core/complexity';
import type { Settings } from '../core/types';
import { toMillimetres } from '../core/units';
import { transformVectorPoint } from './affine';
import { arcToCenter } from './flatten';
import type { VectorDocument, VectorPoint } from './model';

const length = (a: VectorPoint, b: VectorPoint) => Math.hypot(b.x - a.x, b.y - a.y);

/** Conservative deterministic estimate used only for the existing pre-processing guardrail. */
export function estimateVectorComplexity(document: VectorDocument, settings: Pick<Settings, 'outputWidth' | 'outputHeight' | 'toolpathDetail' | 'units' | 'passes'>): ComplexityEstimate {
  const scaleX = toMillimetres(settings.outputWidth, settings.units) / document.width;
  const scaleY = toMillimetres(settings.outputHeight, settings.units) / document.height;
  const detail = Math.max(0.025, settings.toolpathDetail);
  let estimatedPoints = 0;
  for (const path of document.paths) {
    const map = (point: VectorPoint) => {
      const transformed = transformVectorPoint(path.transform, point);
      return { x: transformed.x * scaleX, y: transformed.y * scaleY };
    };
    for (const segment of path.segments) {
      const from = map(segment.from); const to = map(segment.to);
      let controlLength = length(from, to);
      if (segment.type === 'quadratic') controlLength = length(from, map(segment.control)) + length(map(segment.control), to);
      if (segment.type === 'cubic') controlLength = length(from, map(segment.control1)) + length(map(segment.control1), map(segment.control2)) + length(map(segment.control2), to);
      if (segment.type === 'arc') {
        const arc = arcToCenter(segment);
        if (arc) {
          const cosine = Math.cos(arc.rotation); const sine = Math.sin(arc.rotation);
          const vectorLength = (x: number, y: number) => Math.hypot(
            (path.transform[0] * x + path.transform[2] * y) * scaleX,
            (path.transform[1] * x + path.transform[3] * y) * scaleY,
          );
          const radius = Math.max(
            vectorLength(arc.rx * cosine, arc.rx * sine),
            vectorLength(-arc.ry * sine, arc.ry * cosine),
          );
          controlLength = Math.max(controlLength, Math.abs(arc.deltaAngle) * radius);
        }
      }
      estimatedPoints += Math.max(1, Math.ceil(controlLength / detail));
      if (estimatedPoints > 3_500_000) { estimatedPoints = 3_500_000; break; }
    }
  }
  const passMultiplier = Number.isInteger(settings.passes) && settings.passes > 0 ? settings.passes : 1;
  const movements = Math.min(3_500_000, estimatedPoints * passMultiplier + document.paths.length);
  let recommendedDetail = Math.max(0.3, settings.toolpathDetail);
  if (movements > 150_000) recommendedDetail = Math.min(5, recommendedDetail * movements / 150_000);
  return { samples: document.segmentCount, scanlines: document.paths.length, movements, level: classifyMovementCount(movements), recommendedDetail };
}
