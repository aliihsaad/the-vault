import { createHash } from 'node:crypto';
import {
  existsSync,
  lstatSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { join, relative, resolve } from 'node:path';
import matter from 'gray-matter';
import { isGraphifyExcludedSourcePath } from '../rules/graphify.js';
import { getGraphifyRuntimeConfig } from './graphify-config.service.js';
import { getGraphifyProjectStatus } from './graphify-project.service.js';
import { getGraphifyProjectPaths } from './graphify-paths.service.js';
import { findMemory } from './retrieve.service.js';
import { normalizeOrderedValues, normalizeRelatedFiles } from './file.service.js';
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import type * as schema from '../database/schema.js';
import type { MemoryItem, ProjectWorkspaceRegistry } from '../types/index.js';
import type {
  ExportGraphifyCorpusInput,
  GraphifyArtifactPaths,
  GraphifyCorpusExportResult,
  GraphifyMemoryExportEntry,
  GraphifySourceManifest,
} from '../types/graphify.js';

type DB = BetterSQLite3Database<typeof schema>;

const DEFAULT_INCLUDE_PATTERNS = ['**/*'];
const DEFAULT_EXCLUDE_PATTERNS = [
  '.git/**',
  'node_modules/**',
  'dist/**',
  'dist-electron/**',
  'coverage/**',
  'extensions/graphify/**',
  '**/.env',
  '**/.env.*',
  '**/*secret*',
  '**/*token*',
  '**/*credential*',
];
const DEFAULT_CONTENT_EXCERPT_CHARS = 280;
const HASH_ALGORITHM = 'sha256';

export function exportGraphifyProjectCorpus(
  db: DB,
  vaultRoot: string,
  input: ExportGraphifyCorpusInput,
  workspaceRegistry?: ProjectWorkspaceRegistry | null,
): GraphifyCorpusExportResult {
  const status = getGraphifyProjectStatus(db, input.project, workspaceRegistry);
  if (!status.enabled) {
    throw new Error('Graphify is disabled for this project.');
  }
  if (!status.sourceRoot || !status.buildEligible) {
    throw new Error('Choose a source folder before exporting a Graphify corpus.');
  }

  const paths = getGraphifyProjectPaths(vaultRoot, status.project);
  const sourceRoot = resolve(status.sourceRoot);
  const runtimeConfig = getGraphifyRuntimeConfig(vaultRoot);
  const buildMode = input.buildMode ?? status.buildMode;
  const includePatterns = normalizeOrderedValues(input.includePatterns ?? DEFAULT_INCLUDE_PATTERNS);
  const excludePatterns = normalizeOrderedValues(input.excludePatterns ?? DEFAULT_EXCLUDE_PATTERNS);
  const sourceSnapshot = hashSourceRoot(sourceRoot);

  assertManagedPath(paths.corpusRoot, vaultRoot);
  assertManagedPath(paths.memoryExportRoot, vaultRoot);
  assertManagedPath(paths.memoryExportItems, vaultRoot);
  mkdirSync(paths.corpusRoot, { recursive: true });
  mkdirSync(paths.memoryExportRoot, { recursive: true });
  rmSync(paths.memoryExportItems, { recursive: true, force: true });
  mkdirSync(paths.memoryExportItems, { recursive: true });

  const includeMemories = input.includeMemories ?? true;
  const memoryExport = includeMemories
    ? writeMemoryExport(db, paths.memoryExportNdjson, paths.memoryExportItems, status.project, input.contentExcerptMaxChars)
    : {
        entries: [] as GraphifyMemoryExportEntry[],
        memoryFiles: {} as Record<string, string>,
        hash: hashText(''),
      };
  const artifactPaths = normalizeArtifactPaths(status.state?.artifactPaths ?? null);
  const managedArtifactPaths = normalizeArtifactPaths({
    graphJson: paths.graphJson,
    graphHtml: paths.graphHtml,
    graphReport: paths.graphReport,
    graphSvg: paths.graphSvg,
  });
  const inputHash = hashStable({
    buildMode,
    excludePatterns,
    includePatterns,
    memoryExportHash: memoryExport.hash,
    project: status.project,
    runtimeMode: runtimeConfig.runtimeMode,
    sourceHash: sourceSnapshot.hash,
    sourceRoot,
  });
  const manifest: GraphifySourceManifest = {
    schemaVersion: 1,
    project: status.project,
    projectSlug: paths.projectSlug,
    sourceRoot,
    buildMode,
    runtimeMode: runtimeConfig.runtimeMode,
    graphifyVersion: status.state?.detectedGraphifyVersion ?? null,
    includePatterns,
    excludePatterns,
    source: {
      root: sourceRoot,
      fileCount: sourceSnapshot.fileCount,
      hash: sourceSnapshot.hash,
    },
    memoryExport: {
      included: includeMemories,
      rootPath: paths.memoryExportRoot,
      ndjsonPath: paths.memoryExportNdjson,
      itemCount: memoryExport.entries.length,
      hash: memoryExport.hash,
    },
    latestArtifacts: artifactPaths,
    managedArtifactPaths,
    inputHashes: {
      source: sourceSnapshot.hash,
      memoryExport: memoryExport.hash,
      corpus: inputHash,
    },
  };
  const manifestText = `${JSON.stringify(manifest, null, 2)}\n`;
  writeFileSync(paths.sourceManifest, manifestText, 'utf8');

  return {
    project: status.project,
    projectSlug: paths.projectSlug,
    sourceRoot,
    corpusRoot: paths.corpusRoot,
    manifestPath: paths.sourceManifest,
    memoryExportRoot: paths.memoryExportRoot,
    memoryExportNdjsonPath: paths.memoryExportNdjson,
    memoryFiles: memoryExport.memoryFiles,
    memoryCount: memoryExport.entries.length,
    sourceHash: sourceSnapshot.hash,
    memoryExportHash: memoryExport.hash,
    inputHash,
    manifestHash: hashText(manifestText),
  };
}

function writeMemoryExport(
  db: DB,
  ndjsonPath: string,
  itemDir: string,
  project: string,
  contentExcerptMaxChars: number | undefined,
): {
  entries: GraphifyMemoryExportEntry[];
  memoryFiles: Record<string, string>;
  hash: string;
} {
  const entries = findMemory(db, { project, limit: 1000 })
    .filter((item) => item.status !== 'archived' && item.status !== 'pending_delete')
    .sort((left, right) => compareCodePoint(left.itemUid, right.itemUid))
    .map((item) => toMemoryExportEntry(item, contentExcerptMaxChars ?? DEFAULT_CONTENT_EXCERPT_CHARS));
  const ndjson = entries.map((entry) => JSON.stringify(entry)).join('\n') + (entries.length > 0 ? '\n' : '');
  const memoryFiles: Record<string, string> = {};

  for (const entry of entries) {
    const markdownPath = join(itemDir, `${entry.uid}.md`);
    writeFileSync(markdownPath, formatMemoryMarkdown(entry), 'utf8');
    memoryFiles[entry.uid] = markdownPath;
  }

  writeFileSync(ndjsonPath, ndjson, 'utf8');
  return {
    entries,
    memoryFiles,
    hash: hashText(ndjson),
  };
}

function toMemoryExportEntry(item: MemoryItem, excerptMaxChars: number): GraphifyMemoryExportEntry {
  const relatedFiles = normalizeRelatedFiles(item.relatedFiles)
    .filter((filePath) => !isIgnoredOrSecretPath(filePath));
  const nextSteps = item.nextSteps.map(redactSecrets);

  return {
    uid: item.itemUid,
    title: redactSecrets(item.title),
    project: item.project,
    memoryType: item.memoryType,
    subject: redactSecrets(item.subject),
    summary: redactSecrets(item.summary),
    tags: item.tags.map(redactSecrets),
    keywords: item.keywords.map(redactSecrets),
    priority: item.priority,
    status: item.status,
    createdAt: item.createdAt,
    updatedAt: item.updatedAt,
    relatedFiles,
    relatedItemIds: item.relatedItemIds,
    openLoop: {
      isOpen: isOpenLoop(item),
      nextSteps,
      snoozedUntil: item.snoozedUntil,
    },
    contentExcerpt: excerptMemoryContent(item.content, excerptMaxChars),
  };
}

function formatMemoryMarkdown(entry: GraphifyMemoryExportEntry): string {
  const frontmatterData: Record<string, unknown> = {
    item_uid: entry.uid,
    title: entry.title,
    project: entry.project,
    memory_type: entry.memoryType,
    subject: entry.subject,
    keywords: entry.keywords,
    tags: entry.tags,
    status: entry.status,
    priority: entry.priority,
    created_at: entry.createdAt,
    updated_at: entry.updatedAt,
    open_loop: entry.openLoop,
  };

  if (entry.relatedFiles.length > 0) {
    frontmatterData.related_files = entry.relatedFiles;
  }
  if (entry.relatedItemIds.length > 0) {
    frontmatterData.related_items = entry.relatedItemIds;
  }

  let body = `# ${entry.title}\n\n`;
  body += `## Summary\n${entry.summary}\n`;
  if (entry.contentExcerpt) {
    body += `\n## Content Excerpt\n${entry.contentExcerpt}\n`;
  }

  return matter.stringify(body, frontmatterData);
}

function isOpenLoop(item: MemoryItem): boolean {
  if (item.status !== 'active') {
    return false;
  }
  if (item.snoozedUntil && new Date(item.snoozedUntil).getTime() > Date.now()) {
    return false;
  }
  return item.nextSteps.length > 0 || item.routineType === 'debugging';
}

function excerptMemoryContent(content: string | null, maxChars: number): string | null {
  if (!content?.trim()) {
    return null;
  }

  const normalized = redactSecrets(content).replace(/\s+/g, ' ').trim();
  const firstSentence = normalized.match(/^.*?[.!?](?=\s|$)/)?.[0]?.trim();
  if (firstSentence && firstSentence.length < normalized.length) {
    return firstSentence.length <= maxChars
      ? firstSentence
      : `${firstSentence.slice(0, maxChars).trimEnd()}...`;
  }

  if (normalized.length <= maxChars) {
    return normalized;
  }

  const candidate = normalized.slice(0, maxChars);
  const sentenceBoundary = candidate.search(/[.!?](?=\s|$)/);
  if (sentenceBoundary >= 0) {
    return candidate.slice(0, sentenceBoundary + 1).trim();
  }

  return `${candidate.trimEnd()}...`;
}

function hashSourceRoot(sourceRoot: string): { hash: string; fileCount: number } {
  const files = listSourceFiles(sourceRoot);
  const hash = createHash(HASH_ALGORITHM);
  hash.update(`root:${sourceRoot.replace(/\\/g, '/')}\n`);

  for (const filePath of files) {
    const relativePath = relative(sourceRoot, filePath).replace(/\\/g, '/');
    hash.update(`path:${relativePath}\n`);
    hash.update(readFileSync(filePath));
    hash.update('\n');
  }

  return {
    hash: hash.digest('hex'),
    fileCount: files.length,
  };
}

function listSourceFiles(sourceRoot: string): string[] {
  const files: string[] = [];
  visit(sourceRoot);
  return files.sort((left, right) => left.localeCompare(right));

  function visit(directory: string): void {
    const entries = readdirSync(directory, { withFileTypes: true })
      .sort((left, right) => left.name.localeCompare(right.name));

    for (const entry of entries) {
      const fullPath = join(directory, entry.name);
      const relativePath = relative(sourceRoot, fullPath).replace(/\\/g, '/');
      if (isIgnoredOrSecretPath(relativePath)) {
        continue;
      }

      if (entry.isDirectory()) {
        visit(fullPath);
      } else if (entry.isFile()) {
        files.push(fullPath);
      } else if (entry.isSymbolicLink()) {
        const stat = lstatSync(fullPath);
        if (stat.isFile()) {
          files.push(fullPath);
        }
      }
    }
  }
}

function compareCodePoint(left: string, right: string): number {
  if (left < right) {
    return -1;
  }
  if (left > right) {
    return 1;
  }
  return 0;
}

function isIgnoredOrSecretPath(pathValue: string): boolean {
  return isGraphifyExcludedSourcePath(pathValue);
}

function redactSecrets(value: string): string {
  return value
    .replace(/\b((?:api[_-]?key|secret|token|password|credential)[\w-]*\s*[:=]\s*)[^\s`'",)]+/gi, '$1[REDACTED]')
    .replace(/\bsk-[A-Za-z0-9_-]{8,}\b/g, 'sk-[REDACTED]');
}

function normalizeArtifactPaths(input: Partial<GraphifyArtifactPaths> | null | undefined): GraphifyArtifactPaths {
  return {
    graphJson: input?.graphJson ?? null,
    graphHtml: input?.graphHtml ?? null,
    graphReport: input?.graphReport ?? null,
    graphSvg: input?.graphSvg ?? null,
  };
}

function assertManagedPath(targetPath: string, vaultRoot: string): void {
  const target = resolve(targetPath);
  const root = resolve(vaultRoot);
  const pathFromRoot = relative(root, target);
  if (pathFromRoot.startsWith('..') || pathFromRoot === '' || resolve(root, pathFromRoot) !== target) {
    throw new Error('Graphify corpus paths must stay under the Vault root.');
  }
}

function hashStable(value: unknown): string {
  return hashText(stableStringify(value));
}

function hashText(value: string): string {
  return createHash(HASH_ALGORITHM).update(value).digest('hex');
}

function stableStringify(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map(stableStringify).join(',')}]`;
  }
  if (value && typeof value === 'object') {
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, nextValue]) => `${JSON.stringify(key)}:${stableStringify(nextValue)}`)
      .join(',')}}`;
  }
  return JSON.stringify(value);
}
