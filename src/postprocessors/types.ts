import type { MachineProfile, Move, PostProcessorId, Settings } from '../core/types';

export type ToolStateModel = 'pen' | 'laser' | 'spindle' | 'generic';

export type MachineCapabilities = {
  supportsZ: boolean;
  supportsRapidMoves: boolean;
  supportsComments: boolean;
  supportsAbsolutePositioning: boolean;
  requiresSafeZ: boolean;
  toolStateModel: ToolStateModel;
};

export type ValidationFinding = {
  id: string;
  severity: 'warning' | 'blocking';
  message: string;
};

export type PostProcessorContext = {
  settings: Settings;
  profile: MachineProfile;
  mode: string;
  onProgress?: (completed: number, total: number) => void;
};

export type PostProcessor = {
  id: PostProcessorId;
  name: string;
  controllerFamily: string;
  expectedKind: MachineProfile['kind'] | null;
  capabilities(profile: MachineProfile): MachineCapabilities;
  validateProfile(profile: MachineProfile, settings: Settings): ValidationFinding[];
  serialize(moves: readonly Move[], context: PostProcessorContext): string;
};
