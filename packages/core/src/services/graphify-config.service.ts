import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import {
  GraphifyInstallProfileSchema,
  GraphifyRuntimeModeSchema,
} from '../rules/graphify.js';
import { getGraphifyExtensionPaths } from './graphify-paths.service.js';
import type {
  GraphifyRuntimeConfig,
  SaveGraphifyRuntimeConfigInput,
} from '../types/graphify.js';

export function getDefaultGraphifyRuntimeConfig(vaultRoot: string): GraphifyRuntimeConfig {
  return {
    runtimeMode: 'managed',
    managedRuntimePath: getGraphifyExtensionPaths(vaultRoot).runtime,
    customExecutablePath: null,
    localSourceCheckoutPath: null,
    installProfile: 'base',
    installExtras: [],
    debounce: {
      autoBuildDelayMs: 60000,
      maxCoalesceDelayMs: 300000,
    },
    semantic: {
      enabled: false,
      provider: null,
      allowExternalProviders: false,
    },
  };
}

export function getGraphifyRuntimeConfig(vaultRoot: string): GraphifyRuntimeConfig {
  const configPath = getGraphifyExtensionPaths(vaultRoot).config;
  if (!existsSync(configPath)) {
    return getDefaultGraphifyRuntimeConfig(vaultRoot);
  }

  try {
    const parsed = JSON.parse(readFileSync(configPath, 'utf8')) as SaveGraphifyRuntimeConfigInput;
    return normalizeGraphifyRuntimeConfig(vaultRoot, parsed, getDefaultGraphifyRuntimeConfig(vaultRoot));
  } catch {
    return getDefaultGraphifyRuntimeConfig(vaultRoot);
  }
}

export function saveGraphifyRuntimeConfig(
  vaultRoot: string,
  input: SaveGraphifyRuntimeConfigInput,
): GraphifyRuntimeConfig {
  const current = getGraphifyRuntimeConfig(vaultRoot);
  const next = normalizeGraphifyRuntimeConfig(vaultRoot, input, current);
  const configPath = getGraphifyExtensionPaths(vaultRoot).config;
  mkdirSync(dirname(configPath), { recursive: true });
  writeFileSync(configPath, `${JSON.stringify(next, null, 2)}\n`, 'utf8');
  return next;
}

export function resetGraphifyRuntimeConfig(vaultRoot: string): GraphifyRuntimeConfig {
  const configPath = getGraphifyExtensionPaths(vaultRoot).config;
  if (existsSync(configPath)) {
    rmSync(configPath, { force: true });
  }
  return getDefaultGraphifyRuntimeConfig(vaultRoot);
}

function normalizeGraphifyRuntimeConfig(
  vaultRoot: string,
  input: SaveGraphifyRuntimeConfigInput,
  base: GraphifyRuntimeConfig,
): GraphifyRuntimeConfig {
  const runtimeMode = GraphifyRuntimeModeSchema.parse(input.runtimeMode ?? base.runtimeMode);
  const installProfile = GraphifyInstallProfileSchema.parse(input.installProfile ?? base.installProfile);
  const debounce = {
    ...base.debounce,
    ...(input.debounce ?? {}),
  };
  const semantic = {
    ...base.semantic,
    ...(input.semantic ?? {}),
  };

  return {
    runtimeMode,
    managedRuntimePath: normalizeRequiredPath(
      input.managedRuntimePath ?? base.managedRuntimePath ?? getGraphifyExtensionPaths(vaultRoot).runtime,
    ),
    customExecutablePath: normalizeOptionalPath(pickOptionalPath(input, base, 'customExecutablePath')),
    localSourceCheckoutPath: normalizeOptionalPath(pickOptionalPath(input, base, 'localSourceCheckoutPath')),
    installProfile,
    installExtras: normalizeExtras(input.installExtras ?? base.installExtras),
    debounce: {
      autoBuildDelayMs: normalizePositiveInteger(debounce.autoBuildDelayMs, base.debounce.autoBuildDelayMs),
      maxCoalesceDelayMs: normalizePositiveInteger(debounce.maxCoalesceDelayMs, base.debounce.maxCoalesceDelayMs),
    },
    semantic: {
      enabled: Boolean(semantic.enabled),
      provider: normalizeOptionalString(semantic.provider),
      allowExternalProviders: Boolean(semantic.allowExternalProviders),
    },
  };
}

function normalizeRequiredPath(pathValue: string): string {
  const trimmed = pathValue.trim();
  if (!trimmed) {
    throw new Error('Graphify path is required.');
  }
  return resolve(trimmed);
}

function normalizeOptionalPath(pathValue: string | null | undefined): string | null {
  if (!pathValue?.trim()) {
    return null;
  }
  return resolve(pathValue.trim());
}

function normalizeOptionalString(value: string | null | undefined): string | null {
  const trimmed = value?.trim() ?? '';
  return trimmed ? trimmed : null;
}

function normalizeExtras(extras: string[]): string[] {
  return Array.from(new Set(
    extras
      .map((extra) => extra.trim())
      .filter(Boolean),
  ));
}

function pickOptionalPath(
  input: SaveGraphifyRuntimeConfigInput,
  base: GraphifyRuntimeConfig,
  key: 'customExecutablePath' | 'localSourceCheckoutPath',
): string | null | undefined {
  return Object.prototype.hasOwnProperty.call(input, key) ? input[key] : base[key];
}

function normalizePositiveInteger(value: number | undefined, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0
    ? Math.floor(value)
    : fallback;
}
