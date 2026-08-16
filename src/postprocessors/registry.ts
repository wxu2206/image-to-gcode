import type { MachineProfile, PostProcessorId } from '../core/types';
import { genericPostProcessor } from './generic';
import { genericCncPostProcessor } from './genericCnc';
import { grblLaserPostProcessor } from './grblLaser';
import { grblPenPostProcessor } from './grblPen';
import { marlinPenPostProcessor } from './marlinPen';
import type { PostProcessor } from './types';

const registry = [
  genericPostProcessor,
  grblPenPostProcessor,
  grblLaserPostProcessor,
  marlinPenPostProcessor,
  genericCncPostProcessor,
] as const satisfies readonly PostProcessor[];

const byId = new Map<PostProcessorId, PostProcessor>(registry.map((processor) => [processor.id, processor]));

export function listPostProcessors(): readonly PostProcessor[] { return registry; }

export function isPostProcessorId(value: unknown): value is PostProcessorId {
  return typeof value === 'string' && byId.has(value as PostProcessorId);
}

/** Loading untrusted legacy storage may conservatively migrate to generic. */
export function migratePostProcessorId(value: unknown): PostProcessorId {
  return isPostProcessorId(value) ? value : 'generic';
}

/** Active serialization never silently falls back to a different processor. */
export function requirePostProcessor(value: unknown): PostProcessor {
  if (!isPostProcessorId(value)) throw new Error('The selected post-processor is unavailable or untrusted. Select a valid controller/output before export.');
  return byId.get(value)!;
}

export function getPostProcessor(value: unknown): PostProcessor | null {
  return isPostProcessorId(value) ? byId.get(value)! : null;
}

export function kindForProcessor(id: PostProcessorId, current: MachineProfile['kind']): MachineProfile['kind'] {
  return requirePostProcessor(id).expectedKind ?? current;
}
