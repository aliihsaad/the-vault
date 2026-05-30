import { z } from 'zod';

export const VAULT_COLLAB_RUNTIME_MODES = [
  'managed',
  'localSource',
  'path',
] as const;

export type VaultCollabRuntimeMode = (typeof VAULT_COLLAB_RUNTIME_MODES)[number];
export const VaultCollabRuntimeModeSchema = z.enum(VAULT_COLLAB_RUNTIME_MODES);
