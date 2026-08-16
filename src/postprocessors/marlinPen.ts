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

export const marlinPenPostProcessor: PostProcessor = {
  id: 'marlin-pen',
  name: 'Marlin Pen Plotter',
  controllerFamily: 'Marlin',
  expectedKind: 'pen',
  capabilities: () => capabilities,
  validateProfile(profile) { return commandPairFindings(profile, 'Marlin pen output'); },
  serialize(moves, context) {
    // Marlin consumes feed on G0/G1 directly; avoid assuming G94 support.
    return serializeLinearMoves(moves, context, { processorName: this.name, capabilities, feedMode: false, safeCustomFooter: true });
  },
};
