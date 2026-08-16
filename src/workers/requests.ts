import { profileErrors } from '../core/machine';
import type { MachineProfile } from '../core/types';
import { isPostProcessorId } from '../postprocessors/registry';

export type SerializeGcodeRequest = {
  type: 'serialize-gcode';
  id: number;
  requestId: number;
  outputKey: string;
  profile: MachineProfile;
};

const record = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);
const integer = (value: unknown): value is number => typeof value === 'number' && Number.isInteger(value) && value >= 0;
const boundedText = (value: unknown, maximum: number) => typeof value === 'string' && value.length <= maximum;

export function isSerializeGcodeRequest(value: unknown): value is SerializeGcodeRequest {
  if (!record(value) || value.type !== 'serialize-gcode' || !integer(value.id) || !integer(value.requestId)
    || !boundedText(value.outputKey, 131_072) || !record(value.profile)) return false;
  const profile = value.profile as MachineProfile;
  return boundedText(profile.id, 128)
    && boundedText(profile.name, 128)
    && (profile.kind === 'cnc' || profile.kind === 'pen' || profile.kind === 'laser')
    && isPostProcessorId(profile.postProcessorId)
    && boundedText(profile.header, 16_384)
    && boundedText(profile.footer, 16_384)
    && boundedText(profile.toolOn, 16_384)
    && boundedText(profile.toolOff, 16_384)
    && profileErrors(profile).length === 0;
}
