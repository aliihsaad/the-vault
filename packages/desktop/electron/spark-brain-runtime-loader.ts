import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { getSparkBrainExtensionPaths, type SparkBrainModuleLike } from '@the-vault/core';

export interface SparkBrainRuntimeLoader {
  loadModule: () => Promise<SparkBrainModuleLike | null>;
  getPackageInfo: () => { available: boolean; version: string | null };
}

/**
 * Loads the externally-built `@spark/brain` runtime from the installed
 * extension folder (`<vaultRoot>/extensions/spark-brain/.../dist/index.js`).
 *
 * The Vault desktop app does not depend on `@spark/brain` at build time — that
 * package is built in the vault-spark workspace and dropped into the Vault
 * extensions folder. We therefore resolve and dynamically import its compiled
 * ESM entrypoint at runtime, returning `null` (rather than throwing) when it is
 * absent or unbuilt so the Settings UI can degrade gracefully.
 */
export function createSparkBrainRuntimeLoader(vaultRoot: string): SparkBrainRuntimeLoader {
  const { packageRoot } = getSparkBrainExtensionPaths(vaultRoot);
  const distEntry = join(packageRoot, 'dist', 'index.js');
  const packageJsonPath = join(packageRoot, 'package.json');

  function readVersion(): string | null {
    if (!existsSync(packageJsonPath)) {
      return null;
    }
    try {
      const parsed = JSON.parse(readFileSync(packageJsonPath, 'utf8')) as { version?: unknown };
      return typeof parsed.version === 'string' ? parsed.version : null;
    } catch {
      return null;
    }
  }

  return {
    getPackageInfo() {
      return {
        available: existsSync(distEntry),
        version: readVersion(),
      };
    },
    async loadModule() {
      if (!existsSync(distEntry)) {
        return null;
      }
      const mod = (await import(pathToFileURL(distEntry).href)) as Partial<SparkBrainModuleLike>;
      if (typeof mod.createSparkBrainRuntime !== 'function') {
        return null;
      }
      return mod as SparkBrainModuleLike;
    },
  };
}
