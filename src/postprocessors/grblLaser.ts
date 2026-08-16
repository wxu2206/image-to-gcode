import { commandPairFindings, serializeLinearMoves } from './common';
import type { MachineCapabilities, PostProcessor } from './types';

const capabilities: MachineCapabilities = {
  supportsZ: false,
  supportsRapidMoves: true,
  supportsComments: true,
  supportsAbsolutePositioning: true,
  requiresSafeZ: false,
  toolStateModel: 'laser',
};

export const grblLaserPostProcessor: PostProcessor = {
  id: 'grbl-laser',
  name: 'GRBL / FluidNC Laser',
  controllerFamily: 'GRBL / FluidNC',
  expectedKind: 'laser',
  capabilities: () => capabilities,
  validateProfile(profile) { return commandPairFindings(profile, 'GRBL laser output'); },
  serialize(moves, context) {
    return serializeLinearMoves(moves, context, { processorName: this.name, capabilities, feedMode: true, safeCustomFooter: true });
  },
};
