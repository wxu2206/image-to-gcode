import { serializeLinearMoves } from './common';
import type { MachineCapabilities, PostProcessor } from './types';

const capabilities: MachineCapabilities = {
  supportsZ: true,
  supportsRapidMoves: true,
  supportsComments: true,
  supportsAbsolutePositioning: true,
  requiresSafeZ: true,
  toolStateModel: 'spindle',
};

export const genericCncPostProcessor: PostProcessor = {
  id: 'generic-cnc',
  name: 'Generic CNC',
  controllerFamily: 'Generic CNC',
  expectedKind: 'cnc',
  capabilities: () => capabilities,
  validateProfile(profile) {
    return profile.toolOn.trim() || profile.toolOff.trim() ? [] : [{
      id: 'cnc-tool-manual',
      severity: 'warning',
      message: 'No spindle/tool commands are configured. The operator must manage the tool state safely.',
    }];
  },
  serialize(moves, context) {
    return serializeLinearMoves(moves, context, { processorName: this.name, capabilities, feedMode: true, safeCustomFooter: true });
  },
};
