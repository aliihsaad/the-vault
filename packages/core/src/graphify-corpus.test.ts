import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { homedir, tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { Vault } from './index.js';
import { getGraphifyProjectPaths } from './services/graphify-paths.service.js';

describe('Graphify corpus export pipeline', () => {
  let vaultRoot: string;
  let sourceRoot: string;
  let vault: Vault;
  let extractedNativeBindingDir: string | null = null;
  const previousNativeBinding = process.env.VAULT_BETTER_SQLITE3_NATIVE_BINDING;

  beforeAll(async () => {
    const cachedPrebuild = await findCachedBetterSqlitePrebuild();
    if (!cachedPrebuild) {
      return;
    }

    extractedNativeBindingDir = await mkdtemp(join(tmpdir(), 'vault-sqlite-native-'));
    execFileSync('tar', ['-xf', cachedPrebuild, '-C', extractedNativeBindingDir]);
    process.env.VAULT_BETTER_SQLITE3_NATIVE_BINDING = join(
      extractedNativeBindingDir,
      'build',
      'Release',
      'better_sqlite3.node',
    );
  });

  beforeEach(async () => {
    vaultRoot = await mkdtemp(join(tmpdir(), 'vault-graphify-corpus-'));
    sourceRoot = await makeTempSourceRoot();
    vault = new Vault(vaultRoot);
    vault.initialize();
    vault.setGraphifyProjectSourceRoot('The Vault', sourceRoot);
  });

  afterEach(async () => {
    vault.close();
    await rm(vaultRoot, { recursive: true, force: true });
    await rm(sourceRoot, { recursive: true, force: true });
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

  it('writes a managed source manifest plus stable Vault memory NDJSON and Markdown export', async () => {
    const related = vault.saveMemory({
      title: 'Related implementation note',
      project: 'The Vault',
      memoryType: 'summary',
      subject: 'Graphify corpus related memory',
      summary: 'A related note used to validate related memory ID export.',
      sourceApp: 'codex',
    });
    const openLoop = vault.saveMemory({
      title: 'Graphify corpus export decision',
      project: 'The Vault',
      memoryType: 'decision',
      subject: 'Graphify corpus export',
      summary: 'Export only safe memory metadata and short excerpts for Graphify.',
      content: [
        'The export should include enough context for graph building.',
        'Do not include this full-body sentinel: FULL_BODY_SENTINEL_SHOULD_NOT_EXPORT.',
        'OPENAI_API_KEY=sk-secret-test-value must never be written to Graphify corpus files.',
      ].join(' '),
      tags: ['Graphify', 'Corpus'],
      keywords: ['memory export', 'freshness'],
      priority: 'high',
      status: 'active',
      sourceApp: 'codex',
      nextSteps: ['Wire the export into a later build phase.'],
      relatedItemIds: [related.item.itemUid],
      relatedFiles: [
        'packages/core/src/vault.ts',
        '.env',
        'secrets/token.txt',
      ],
    });
    vault.saveMemory({
      title: 'Other project memory',
      project: 'Other Project',
      memoryType: 'summary',
      subject: 'Unrelated',
      summary: 'This memory must not be exported for The Vault.',
      sourceApp: 'codex',
    });

    const result = vault.exportGraphifyProjectCorpus('The Vault');
    const paths = getGraphifyProjectPaths(vaultRoot, 'The Vault');
    const manifest = JSON.parse(await readFile(paths.sourceManifest, 'utf8'));
    const ndjson = await readFile(paths.memoryExportNdjson, 'utf8');
    const entries = ndjson.trim().split('\n').map((line) => JSON.parse(line));
    const markdownPath = join(paths.memoryExportItems, `${openLoop.item.itemUid}.md`);
    const markdown = await readFile(markdownPath, 'utf8');

    expect(result).toEqual(expect.objectContaining({
      project: 'The Vault',
      projectSlug: 'the-vault',
      sourceRoot: resolve(sourceRoot),
      corpusRoot: paths.corpusRoot,
      manifestPath: paths.sourceManifest,
      memoryExportNdjsonPath: paths.memoryExportNdjson,
      memoryCount: 2,
    }));
    expect(result.inputHash).toMatch(/^[a-f0-9]{64}$/);
    expect(manifest).toEqual(expect.objectContaining({
      schemaVersion: 1,
      project: 'The Vault',
      projectSlug: 'the-vault',
      sourceRoot: resolve(sourceRoot),
      buildMode: 'fast',
      runtimeMode: 'managed',
      graphifyVersion: null,
    }));
    expect(manifest.memoryExport).toEqual(expect.objectContaining({
      included: true,
      itemCount: 2,
      ndjsonPath: paths.memoryExportNdjson,
      hash: result.memoryExportHash,
    }));
    expect(manifest.inputHashes).toEqual(expect.objectContaining({
      source: expect.stringMatching(/^[a-f0-9]{64}$/),
      memoryExport: result.memoryExportHash,
      corpus: result.inputHash,
    }));
    expect(entries.map((entry) => entry.uid)).toEqual(
      [openLoop.item.itemUid, related.item.itemUid].sort(),
    );

    const exported = entries.find((entry) => entry.uid === openLoop.item.itemUid);
    expect(exported).toEqual(expect.objectContaining({
      uid: openLoop.item.itemUid,
      title: 'Graphify corpus export decision',
      project: 'The Vault',
      memoryType: 'decision',
      subject: 'Graphify corpus export',
      summary: 'Export only safe memory metadata and short excerpts for Graphify.',
      tags: ['corpus', 'graphify'],
      keywords: ['freshness', 'memory export'],
      priority: 'high',
      status: 'active',
      createdAt: openLoop.item.createdAt,
      updatedAt: openLoop.item.updatedAt,
      relatedFiles: ['packages/core/src/vault.ts'],
      relatedItemIds: [related.item.itemUid],
      openLoop: {
        isOpen: true,
        nextSteps: ['Wire the export into a later build phase.'],
        snoozedUntil: null,
      },
    }));
    expect(exported.contentExcerpt).toContain('The export should include enough context');
    expect(exported.contentExcerpt).not.toContain('FULL_BODY_SENTINEL_SHOULD_NOT_EXPORT');
    expect(exported.contentExcerpt).not.toContain('sk-secret-test-value');

    expect(markdownPath).toBe(result.memoryFiles[openLoop.item.itemUid]);
    expect(markdown).toContain(`item_uid: ${openLoop.item.itemUid}`);
    expect(markdown).toContain('memory_type: decision');
    expect(markdown).toContain('related_files:');
    expect(markdown).toContain('packages/core/src/vault.ts');
    expect(markdown).toContain('## Content Excerpt');
    expect(markdown).not.toContain('FULL_BODY_SENTINEL_SHOULD_NOT_EXPORT');
    expect(markdown).not.toContain('sk-secret-test-value');
    expect(ndjson).not.toContain('Other project memory');
    expect(ndjson).not.toContain('.env');
    expect(ndjson).not.toContain('secrets/token.txt');

    expect(existsSync(join(sourceRoot, 'source-manifest.json'))).toBe(false);
    expect(existsSync(join(sourceRoot, 'vault-memory-export'))).toBe(false);
    expect(existsSync(join(sourceRoot, 'graphify-out'))).toBe(false);
  });

  it('computes stable hashes from source and memory inputs for freshness checks', async () => {
    vault.saveMemory({
      title: 'Stable export memory',
      project: 'The Vault',
      memoryType: 'summary',
      subject: 'Graphify stable export',
      summary: 'The same corpus inputs should produce the same freshness hashes.',
      content: 'Short content that is safe to export.',
      sourceApp: 'codex',
      relatedFiles: ['packages/core/src/services/graphify-corpus.service.ts'],
    });

    const first = vault.exportGraphifyProjectCorpus('The Vault');
    const firstManifest = JSON.parse(await readFile(first.manifestPath, 'utf8'));
    const firstNdjson = await readFile(first.memoryExportNdjsonPath, 'utf8');
    const second = vault.exportGraphifyProjectCorpus('The Vault');
    const secondManifest = JSON.parse(await readFile(second.manifestPath, 'utf8'));
    const secondNdjson = await readFile(second.memoryExportNdjsonPath, 'utf8');

    expect(second.inputHash).toBe(first.inputHash);
    expect(second.memoryExportHash).toBe(first.memoryExportHash);
    expect(secondManifest.inputHashes).toEqual(firstManifest.inputHashes);
    expect(secondNdjson).toBe(firstNdjson);

    await writeFile(join(sourceRoot, '.env'), 'OPENAI_API_KEY=changed-but-ignored\n');
    const ignoredChange = vault.exportGraphifyProjectCorpus('The Vault');
    const ignoredManifest = JSON.parse(await readFile(ignoredChange.manifestPath, 'utf8'));
    expect(ignoredManifest.inputHashes.source).toBe(firstManifest.inputHashes.source);
    expect(ignoredChange.inputHash).toBe(first.inputHash);

    await writeFile(join(sourceRoot, 'src', 'index.ts'), 'export const answer = 43;\n');
    const sourceChange = vault.exportGraphifyProjectCorpus('The Vault');
    const sourceChangeManifest = JSON.parse(await readFile(sourceChange.manifestPath, 'utf8'));
    expect(sourceChangeManifest.inputHashes.source).not.toBe(firstManifest.inputHashes.source);
    expect(sourceChange.inputHash).not.toBe(first.inputHash);
  });

  it('refuses to export a corpus before the project has a confirmed source root', () => {
    expect(() => vault.exportGraphifyProjectCorpus('Unmapped Project'))
      .toThrow('Choose a source folder before exporting a Graphify corpus.');
  });
});

async function makeTempSourceRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'vault-graphify-source-root-'));
  await mkdir(join(root, '.git'), { recursive: true });
  await mkdir(join(root, 'src'), { recursive: true });
  await mkdir(join(root, 'node_modules', 'ignored-package'), { recursive: true });
  await writeFile(join(root, 'src', 'index.ts'), 'export const answer = 42;\n');
  await writeFile(join(root, 'README.md'), '# Test project\n');
  await writeFile(join(root, '.env'), 'OPENAI_API_KEY=sk-source-secret\n');
  await writeFile(join(root, 'node_modules', 'ignored-package', 'index.js'), 'module.exports = 1;\n');
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
