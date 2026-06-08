import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, readdir, rm } from 'node:fs/promises';
import { homedir, tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { Vault } from './index.js';

describe('Graphify project source roots and build eligibility', () => {
  let vaultRoot: string;
  let vault: Vault;
  let extractedNativeBindingDir: string | null = null;
  const previousNativeBinding = process.env.VAULT_BETTER_SQLITE3_NATIVE_BINDING;

  beforeAll(async () => {
    const cachedPrebuild = await findCachedBetterSqlitePrebuild();
    if (!cachedPrebuild) {
      return;
    }

    extractedNativeBindingDir = await mkdtemp(join(tmpdir(), 'vault-sqlite-native-'));
    execFileSync('tar', ['-xf', basename(cachedPrebuild), '-C', extractedNativeBindingDir.replace(/\\/g, '/')], {
      cwd: dirname(cachedPrebuild),
    });
    process.env.VAULT_BETTER_SQLITE3_NATIVE_BINDING = join(
      extractedNativeBindingDir,
      'build',
      'Release',
      'better_sqlite3.node',
    );
  });

  beforeEach(async () => {
    vaultRoot = await mkdtemp(join(tmpdir(), 'vault-graphify-source-'));
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

  it('uses the workspace registry as an initial source-root candidate without making builds eligible', async () => {
    const workspacePath = await makeTempWorkspace();
    vault.setProjectWorkspace({
      project: 'The Vault',
      workspacePath,
      trusted: true,
      notes: 'Main repo',
    });

    const status = vault.getGraphifyProjectStatus('The Vault');

    expect(status).toEqual(expect.objectContaining({
      project: 'The Vault',
      enabled: true,
      sourceRoot: null,
      uiState: 'sourceRootRequired',
      buildEligible: false,
      buildBlockedReason: 'sourceRootRequired',
    }));
    expect(status.sourceRootCandidate).toEqual({
      source: 'project_workspace_registry',
      path: resolve(workspacePath),
      trusted: true,
      message: 'Existing project workspace can be used as the Graphify source root after confirmation.',
    });
    expect(status.message).toContain('Choose a source folder');
  });

  it('stores a user-selected Graphify source root per project and enables manual build eligibility', async () => {
    const sourceRoot = await makeTempWorkspace();

    const state = vault.setGraphifyProjectSourceRoot('The Vault', sourceRoot);
    const status = vault.getGraphifyProjectStatus('The Vault');

    expect(state).toEqual(expect.objectContaining({
      project: 'The Vault',
      enabled: true,
      sourceRoot: resolve(sourceRoot),
      freshness: 'missing',
      buildMode: 'fast',
    }));
    expect(status).toEqual(expect.objectContaining({
      sourceRoot: resolve(sourceRoot),
      sourceRootCandidate: null,
      uiState: 'ready',
      buildEligible: true,
      buildBlockedReason: null,
      message: 'Graphify source root is configured. Manual graph builds can be enabled in a later phase.',
    }));
    expect(vault.getGraphifyProjectState('The Vault')?.sourceRoot).toBe(resolve(sourceRoot));
  });

  it('rejects relative and missing folders before storing a Graphify source root', () => {
    expect(() => vault.setGraphifyProjectSourceRoot('The Vault', 'relative/project'))
      .toThrow('Workspace path must be absolute.');

    expect(() => vault.setGraphifyProjectSourceRoot('The Vault', join(vaultRoot, 'missing-folder')))
      .toThrow('Workspace path does not exist.');

    expect(vault.getGraphifyProjectState('The Vault')).toBeNull();
  });

  it('returns sourceRootRequired and blocks build eligibility when no source root exists', () => {
    const status = vault.getGraphifyProjectStatus('Unmapped Project');

    expect(status).toEqual(expect.objectContaining({
      project: 'Unmapped Project',
      enabled: true,
      sourceRoot: null,
      sourceRootCandidate: null,
      uiState: 'sourceRootRequired',
      buildEligible: false,
      buildBlockedReason: 'sourceRootRequired',
      message: 'Choose a source folder before building a Graphify project graph.',
    }));
  });

  it('blocks builds when a previously saved source root no longer exists', async () => {
    const sourceRoot = await makeTempWorkspace();
    vault.setGraphifyProjectSourceRoot('The Vault', sourceRoot);
    await rm(sourceRoot, { recursive: true, force: true });

    const status = vault.getGraphifyProjectStatus('The Vault');

    expect(status).toEqual(expect.objectContaining({
      sourceRoot: resolve(sourceRoot),
      sourceRootCandidate: null,
      uiState: 'sourceRootRequired',
      buildEligible: false,
      buildBlockedReason: 'sourceRootRequired',
      message: 'Saved Graphify source folder is invalid: Workspace path does not exist. Choose a source folder before building.',
    }));
  });

  it('allows per-project disablement without affecting Vault memory behavior', async () => {
    const sourceRoot = await makeTempWorkspace();
    vault.setGraphifyProjectSourceRoot('The Vault', sourceRoot);

    const disabled = vault.setGraphifyProjectEnabled('The Vault', false);
    const status = vault.getGraphifyProjectStatus('The Vault');
    const saved = vault.saveMemory({
      title: 'Memory save while Graphify is disabled',
      project: 'The Vault',
      memoryType: 'summary',
      subject: 'Graphify disabled isolation',
      summary: 'Memory save and recall still work while a project opts out of Graphify.',
      sourceApp: 'codex',
    });

    expect(disabled).toEqual(expect.objectContaining({
      enabled: false,
      sourceRoot: resolve(sourceRoot),
      freshness: 'disabled',
    }));
    expect(status).toEqual(expect.objectContaining({
      enabled: false,
      uiState: 'disabled',
      buildEligible: false,
      buildBlockedReason: 'disabled',
      message: 'Graphify is disabled for this project. Vault memory remains available.',
    }));
    expect(vault.getMemoryDetail(saved.item.itemUid)?.summary).toBe(
      'Memory save and recall still work while a project opts out of Graphify.',
    );
  });
});

async function makeTempWorkspace(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'vault-graphify-workspace-'));
  await mkdir(join(root, '.git'));
  return root;
}

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
