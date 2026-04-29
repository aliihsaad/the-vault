// ============================================================================
// Vault — Vault Root Initialization
// Creates the full directory hierarchy on first run.
// ============================================================================

import { existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { getProjectSubdirectories } from '../rules/naming.js';

/**
 * The default Vault root path.
 */
export const DEFAULT_VAULT_ROOT = 'C:\\Users\\Mini\\Vault';

/**
 * Top-level directories that should exist in the Vault root.
 */
const ROOT_DIRECTORIES = [
  'projects',
  'shared',
  'registry',
  'logs',
  'settings',
  'temp',
];

/**
 * Initialize the Vault root directory structure.
 * Creates all required directories if they don't exist.
 */
export function initializeVaultRoot(vaultRoot: string): void {
  // Create root if needed
  if (!existsSync(vaultRoot)) {
    mkdirSync(vaultRoot, { recursive: true });
  }

  // Create top-level directories
  for (const dir of ROOT_DIRECTORIES) {
    const path = join(vaultRoot, dir);
    if (!existsSync(path)) {
      mkdirSync(path, { recursive: true });
    }
  }

  // Create shared subdirectories for each memory type
  const subdirs = getProjectSubdirectories();
  for (const subdir of subdirs) {
    const path = join(vaultRoot, 'shared', subdir);
    if (!existsSync(path)) {
      mkdirSync(path, { recursive: true });
    }
  }
}

/**
 * Ensure project directories exist.
 * Called whenever a new project is first used.
 */
export function ensureProjectDirs(vaultRoot: string, projectSlug: string): void {
  const projectRoot = join(vaultRoot, 'projects', projectSlug);

  if (!existsSync(projectRoot)) {
    mkdirSync(projectRoot, { recursive: true });
  }

  const subdirs = getProjectSubdirectories();
  for (const subdir of subdirs) {
    const path = join(projectRoot, subdir);
    if (!existsSync(path)) {
      mkdirSync(path, { recursive: true });
    }
  }
}

/**
 * Get the database path within the vault root.
 */
export function getDatabasePath(vaultRoot: string): string {
  return join(vaultRoot, 'registry', 'vault.db');
}

/**
 * Get the logs directory within the vault root.
 */
export function getLogsPath(vaultRoot: string): string {
  return join(vaultRoot, 'logs');
}
