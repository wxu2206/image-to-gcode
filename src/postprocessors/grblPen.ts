import { commandPairFindings, serializeLinearMoves } from './common';
import type { MachineCapabilities, PostProcessor } from './types';

const capabilities: MachineCapabilities = {
  supportsZ: false,
  supportsRapidMoves: true,
  supportsComments: true,
  supportsAbsolutePositioning: true,
  requiresSafeZ: false,
  toolStateModel: 'pen',
};

export const grblPenPostProcessor: PostProcessor = {
  id: 'grbl-pen',
  name: 'GRBL Pen Plotter',
  controllerFamily: 'GRBL',
  expectedKind: 'pen',
  capabilities: () => capabilities,
  validateProfile(profile) { return commandPairFindings(profile, 'GRBL pen output'); },
  serialize(moves, context) {
    return serializeLinearMoves(moves, context, { processorName: this.name, capabilities, feedMode: true, safeCustomFooter: true });
  },
};
