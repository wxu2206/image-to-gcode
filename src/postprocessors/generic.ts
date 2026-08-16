import { genericCapabilities, serializeLinearMoves } from './common';
import type { PostProcessor } from './types';

export const genericPostProcessor: PostProcessor = {
  id: 'generic',
  name: 'Custom / Generic G-code',
  controllerFamily: 'Generic',
  expectedKind: null,
  capabilities: genericCapabilities,
  validateProfile(profile) {
    const findings = [];
    if (profile.toolOn.trim() && !profile.toolOff.trim()) {
      findings.push({ id: 'generic-tool-pair', severity: 'blocking' as const, message: 'A tool-off command is required when a tool-on command is configured.' });
    }
    findings.push({ id: 'generic-custom-semantics', severity: 'warning' as const, message: 'Generic custom commands cannot be fully simulated or verified for this controller.' });
    return findings;
  },
  serialize(moves, context) {
    return serializeLinearMoves(moves, context, {
      processorName: this.name,
      capabilities: this.capabilities(context.profile),
      feedMode: true,
      safeCustomFooter: false,
    });
  },
};
