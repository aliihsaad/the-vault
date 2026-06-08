import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdtemp, readdir, rm } from 'node:fs/promises';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { Vault } from './index.js';
import { MEMORY_CONTENT_MAX_CHARS } from './rules/validation.js';

describe('save memory content size', () => {
  let vaultRoot: string;
  let vault: Vault;
  let extractedNativeBindingDir: string | null = null;
  const previousNativeBinding = process.env.VAULT_BETTER_SQLITE3_NATIVE_BINDING;

  beforeAll(async () => {
    const cachedPrebuild = await findCachedBetterSqlitePrebuild();
    if (!cachedPrebuild) {
      return;
    }

    extractedNativeBindingDir = await mkdtemp(join(tmpdir(), 'vault-save-size-sqlite-native-'));
    // The bundled Windows tar is GNU/MSYS: it reads a drive-letter path (C:\...)
    // as a remote "host:path" and mangles backslashes. --force-local disables the
    // remote-host parsing, and forward slashes avoid the backslash escaping.
    execFileSync('tar', [
      '--force-local',
      '-xf',
      cachedPrebuild.replace(/\\/g, '/'),
      '-C',
      extractedNativeBindingDir.replace(/\\/g, '/'),
    ]);
    process.env.VAULT_BETTER_SQLITE3_NATIVE_BINDING = join(
      extractedNativeBindingDir,
      'build',
      'Release',
      'better_sqlite3.node',
    );
  });

  beforeEach(async () => {
    vaultRoot = await mkdtemp(join(tmpdir(), 'vault-save-size-test-'));
    vault = new Vault(vaultRoot);
    vault.initialize();
  });

  afterEach(async () => {
    vault.close();
    await rm(vaultRoot, { recursive: true, force: true });
  });

  afterAll(async () => {
    if (previousNativeBinding === undefined) {
      delete process.env.VAULT_BETTER_SQLITE3_NATIVE_BINDING;
    } else {
      process.env.VAULT_BETTER_SQLITE3_NATIVE_BINDING = previousNativeBinding;
    }

    if (extractedNativeBindingDir) {
      try {
        await rm(extractedNativeBindingDir, { recursive: true, force: true });
      } catch {
        // Windows keeps native .node files locked for the lifetime of the process.
      }
    }
  });

  it('allows memory content bodies larger than prior agent report failures', () => {
    expect(MEMORY_CONTENT_MAX_CHARS).toBeGreaterThanOrEqual(1024 * 1024);

    const largeContent = 'x'.repeat(64 * 1024);
    expect(largeContent.length).toBeGreaterThan(50 * 1024);

    const saved = vault.saveMemory({
      title: 'Large agent report',
      project: 'Vault Memory Size Test',
      memoryType: 'handoff',
      subject: 'large agent report',
      summary: 'Regression coverage for long content bodies in vault_save_memory.',
      content: largeContent,
      sourceApp: 'codex',
    });

    expect(saved.item.content).toBe(largeContent);

    const detail = vault.getMemoryDetail(saved.item.itemUid);
    expect(detail?.content).toBe(largeContent);
  });
});

async function findCachedBetterSqlitePrebuild(): Promise<string | null> {
  const expectedSuffix = `better-sqlite3-v12.9.0-node-v${process.versions.modules}-${process.platform}-${process.arch}.tar.gz`;
  const cacheDirs = [
    join(process.env.APPDATA || join(homedir(), 'AppData', 'Roaming'), 'npm-cache', '_prebuilds'),
    join(homedir(), '.npm', '_prebuilds'),
  ];

  for (const cacheDir of cacheDirs) {
    if (!existsSync(cacheDir)) {
      continue;
    }

    const entries = await readdir(cacheDir);
    const match = entries.find((entry) => entry.endsWith(expectedSuffix));
    if (match) {
      return join(cacheDir, match);
    }
  }

  return null;
}
