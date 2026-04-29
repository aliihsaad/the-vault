// ============================================================================
// Vault — File Service
// Handles writing, reading, and archiving memory files as Markdown with
// YAML frontmatter.
// ============================================================================

import { existsSync, mkdirSync, readFileSync, writeFileSync, renameSync } from 'node:fs';
import { dirname, join, basename } from 'node:path';
import matter from 'gray-matter';
import type { MemoryItem } from '../types/index.js';
import { generateVaultPath } from '../rules/naming.js';

export function normalizeTagLikeValues(values: string[]): string[] {
  return [...new Set(
    values
      .map((value) => value.trim().toLowerCase())
      .filter(Boolean),
  )].sort((left, right) => left.localeCompare(right));
}

export function normalizeOrderedValues(values: string[]): string[] {
  const seen = new Set<string>();
  const normalized: string[] = [];

  for (const value of values) {
    const nextValue = value.trim();
    if (!nextValue) {
      continue;
    }

    const fingerprint = nextValue.toLowerCase();
    if (seen.has(fingerprint)) {
      continue;
    }

    seen.add(fingerprint);
    normalized.push(nextValue);
  }

  return normalized;
}

export function normalizeRelatedFiles(values: string[]): string[] {
  return normalizeOrderedValues(
    values.map((value) =>
      value
        .replace(/\\/g, '/')
        .replace(/\/+/g, '/')
        .replace(/^\.\//, '')
        .trim(),
    ),
  );
}

/**
 * Write a memory item as a Markdown file with YAML frontmatter.
 */
export function writeMemoryFile(vaultPath: string, item: MemoryItem): void {
  // Ensure directory exists
  const dir = dirname(vaultPath);
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }

  // Build frontmatter data
  const frontmatterData: Record<string, unknown> = {
    item_uid: item.itemUid,
    title: item.title,
    project: item.project,
    memory_type: item.memoryType,
    subject: item.subject,
    keywords: item.keywords,
    tags: item.tags,
    status: item.status,
    priority: item.priority,
    promoted: item.promoted,
    source_app: item.sourceApp,
    created_at: item.createdAt,
    updated_at: item.updatedAt,
  };

  if (item.routineType) {
    frontmatterData.routine_type = item.routineType;
  }
  if (item.sourceSessionId) {
    frontmatterData.source_session_id = item.sourceSessionId;
  }
  if (item.nextSteps.length > 0) {
    frontmatterData.next_steps = item.nextSteps;
  }
  if (item.relatedItemIds.length > 0) {
    frontmatterData.related_items = item.relatedItemIds;
  }
  if (item.relatedFiles.length > 0) {
    frontmatterData.related_files = item.relatedFiles;
  }

  // Build the Markdown body
  let body = `# ${item.title}\n\n`;
  body += `## Summary\n${item.summary}\n`;

  if (item.content) {
    body += `\n## Content\n${item.content}\n`;
  }

  if (item.nextSteps.length > 0) {
    body += `\n## Next Steps\n`;
    for (const step of item.nextSteps) {
      body += `- [ ] ${step}\n`;
    }
  }

  // Write the file
  const fileContent = matter.stringify(body, frontmatterData);
  writeFileSync(vaultPath, fileContent, 'utf-8');
}

/**
 * Read a memory file and parse its frontmatter and content.
 */
export function readMemoryFile(
  vaultPath: string,
): { frontmatter: Record<string, unknown>; content: string } | null {
  if (!existsSync(vaultPath)) return null;

  const raw = readFileSync(vaultPath, 'utf-8');
  const parsed = matter(raw);

  return {
    frontmatter: parsed.data as Record<string, unknown>,
    content: parsed.content,
  };
}

/**
 * Archive a memory file by moving it to the project's archive/ directory.
 */
export function archiveFile(vaultRoot: string, vaultPath: string): string | null {
  if (!existsSync(vaultPath)) return null;

  const filename = basename(vaultPath);

  // Derive project from the path: .../projects/{project}/{type}/{file}
  const normalizedPath = vaultPath.replace(/\\/g, '/');
  const projectsMatch = normalizedPath.match(/\/projects\/([^/]+)\//);

  let archivePath: string;
  if (projectsMatch) {
    archivePath = join(vaultRoot, 'projects', projectsMatch[1], 'archive', filename);
  } else {
    // Shared memory
    archivePath = join(vaultRoot, 'shared', 'archive', filename);
  }

  const archiveDir = dirname(archivePath);
  if (!existsSync(archiveDir)) {
    mkdirSync(archiveDir, { recursive: true });
  }

  renameSync(vaultPath, archivePath);
  return archivePath;
}

function extractShortUidFromPath(vaultPath: string): string {
  const filename = basename(vaultPath, '.md');
  const segments = filename.split('-').filter(Boolean);
  return segments[segments.length - 1] || 'memory';
}

export function rehomeMemoryFile(
  vaultRoot: string,
  item: Pick<MemoryItem, 'vaultPath' | 'project' | 'memoryType' | 'title' | 'createdAt'>,
): string | null {
  if (!item.vaultPath || !existsSync(item.vaultPath)) {
    return item.vaultPath;
  }

  const nextPath = generateVaultPath(
    vaultRoot,
    item.project,
    item.memoryType,
    item.title,
    extractShortUidFromPath(item.vaultPath),
    item.createdAt,
  );

  if (nextPath.replace(/\\/g, '/') === item.vaultPath.replace(/\\/g, '/')) {
    return item.vaultPath;
  }

  const nextDir = dirname(nextPath);
  if (!existsSync(nextDir)) {
    mkdirSync(nextDir, { recursive: true });
  }

  renameSync(item.vaultPath, nextPath);
  return nextPath;
}

/**
 * Generate a vault path for a memory item.
 * Uses the vault root, project, memory type, and title.
 */
export function buildVaultPath(
  vaultRoot: string,
  project: string,
  memoryType: string,
  title: string,
  shortUid: string,
  createdAt?: string,
): string {
  return generateVaultPath(vaultRoot, project, memoryType, title, shortUid, createdAt);
}
