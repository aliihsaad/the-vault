import { join, resolve } from 'node:path';

export interface VaultCollabExtensionPaths {
  root: string;
  runtime: string;
  config: string;
  database: string;
  logsRoot: string;
}

export function getVaultCollabExtensionPaths(vaultRoot: string): VaultCollabExtensionPaths {
  const root = resolve(vaultRoot, 'extensions', 'vault-collab');

  return {
    root,
    runtime: join(root, 'runtime'),
    config: join(root, 'config.json'),
    database: join(root, 'vault-collab.db'),
    logsRoot: join(root, 'logs'),
  };
}
