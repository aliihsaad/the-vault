import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { VaultCollabRuntimeModeSchema } from '../rules/vault-collab.js';
import { getVaultCollabExtensionPaths } from './vault-collab-paths.service.js';
import type {
  SaveVaultCollabRuntimeConfigInput,
  VaultCollabRuntimeConfig,
} from '../types/vault-collab.js';

export function getDefaultVaultCollabRuntimeConfig(vaultRoot: string): VaultCollabRuntimeConfig {
  const paths = getVaultCollabExtensionPaths(vaultRoot);
  return {
    runtimeMode: 'managed',
    managedRuntimePath: paths.runtime,
    localSourceCheckoutPath: null,
    customCliPath: null,
    databasePath: paths.database,
  };
}

export function getVaultCollabRuntimeConfig(vaultRoot: string): VaultCollabRuntimeConfig {
  const configPath = getVaultCollabExtensionPaths(vaultRoot).config;
  if (!existsSync(configPath)) {
    return getDefaultVaultCollabRuntimeConfig(vaultRoot);
  }

  try {
    const parsed = JSON.parse(readFileSync(configPath, 'utf8')) as SaveVaultCollabRuntimeConfigInput;
    return normalizeVaultCollabRuntimeConfig(vaultRoot, parsed, getDefaultVaultCollabRuntimeConfig(vaultRoot));
  } catch {
    return getDefaultVaultCollabRuntimeConfig(vaultRoot);
  }
}

export function saveVaultCollabRuntimeConfig(
  vaultRoot: string,
  input: SaveVaultCollabRuntimeConfigInput,
): VaultCollabRuntimeConfig {
  const current = getVaultCollabRuntimeConfig(vaultRoot);
  const next = normalizeVaultCollabRuntimeConfig(vaultRoot, input, current);
  const configPath = getVaultCollabExtensionPaths(vaultRoot).config;
  mkdirSync(dirname(configPath), { recursive: true });
  writeFileSync(configPath, `${JSON.stringify(next, null, 2)}\n`, 'utf8');
  return next;
}

export function resetVaultCollabRuntimeConfig(vaultRoot: string): VaultCollabRuntimeConfig {
  const configPath = getVaultCollabExtensionPaths(vaultRoot).config;
  if (existsSync(configPath)) {
    rmSync(configPath, { force: true });
  }
  return getDefaultVaultCollabRuntimeConfig(vaultRoot);
}

function normalizeVaultCollabRuntimeConfig(
  vaultRoot: string,
  input: SaveVaultCollabRuntimeConfigInput,
  base: VaultCollabRuntimeConfig,
): VaultCollabRuntimeConfig {
  const runtimeMode = VaultCollabRuntimeModeSchema.parse(input.runtimeMode ?? base.runtimeMode);
  const defaultPaths = getVaultCollabExtensionPaths(vaultRoot);

  return {
    runtimeMode,
    managedRuntimePath: normalizeRequiredPath(input.managedRuntimePath ?? base.managedRuntimePath ?? defaultPaths.runtime),
    localSourceCheckoutPath: normalizeOptionalPath(pickOptionalPath(input, base, 'localSourceCheckoutPath')),
    customCliPath: normalizeOptionalPath(pickOptionalPath(input, base, 'customCliPath')),
    databasePath: normalizeRequiredPath(input.databasePath ?? base.databasePath ?? defaultPaths.database),
  };
}

function normalizeRequiredPath(pathValue: string): string {
  const trimmed = pathValue.trim();
  if (!trimmed) {
    throw new Error('Vault Collab path is required.');
  }
  return resolve(trimmed);
}

function normalizeOptionalPath(pathValue: string | null | undefined): string | null {
  if (!pathValue?.trim()) {
    return null;
  }
  return resolve(pathValue.trim());
}

function pickOptionalPath(
  input: SaveVaultCollabRuntimeConfigInput,
  base: VaultCollabRuntimeConfig,
  key: 'localSourceCheckoutPath' | 'customCliPath',
): string | null | undefined {
  return Object.prototype.hasOwnProperty.call(input, key) ? input[key] : base[key];
}
