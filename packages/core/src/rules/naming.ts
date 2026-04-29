// ============================================================================
// Vault — Naming Rules
// Deterministic path and filename generation for memory files.
// ============================================================================

import { generateShortUid } from '../utils/uid.js';

/**
 * Create a URL-safe slug from a title string.
 * Lowercase, hyphenated, max 60 chars.
 */
export function slugify(text: string): string {
  const slug = text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60);

  return slug || 'memory';
}

function normalizeVaultRoot(vaultRoot: string): string {
  return vaultRoot.replace(/\\/g, '/').replace(/\/$/, '');
}

function getDatePrefix(createdAt?: string): string {
  const candidate = createdAt && /^\d{4}-\d{2}-\d{2}/.test(createdAt)
    ? createdAt.slice(0, 10)
    : new Date().toISOString().slice(0, 10);

  return candidate;
}

export function buildMemoryFilename(
  title: string,
  shortUid: string,
  createdAt?: string,
): string {
  const datePrefix = getDatePrefix(createdAt);
  const slug = slugify(title);
  return `${datePrefix}-${slug}-${shortUid}.md`;
}

export function buildVaultRelativePath(
  project: string | undefined,
  memoryType: string,
  title: string,
  shortUid: string,
  createdAt?: string,
): string {
  const dirName = memoryTypeToDir(memoryType);
  const filename = buildMemoryFilename(title, shortUid, createdAt);

  if (project) {
    return `projects/${slugify(project)}/${dirName}/${filename}`;
  }

  return `shared/${dirName}/${filename}`;
}

/**
 * Generate the vault path for a memory file.
 *
 * Pattern:
 *   {vaultRoot}/projects/{project}/{memoryType}/{slug}-{shortUid}.md
 *
 * For shared (no project):
 *   {vaultRoot}/shared/{memoryType}/{slug}-{shortUid}.md
 */
export function generateVaultPath(
  vaultRoot: string,
  project: string | undefined,
  memoryType: string,
  title: string,
  shortUid: string = 'new-item',
  createdAt?: string,
): string {
  const root = normalizeVaultRoot(vaultRoot);
  const relativePath = buildVaultRelativePath(project, memoryType, title, shortUid, createdAt);
  return `${root}/${relativePath}`;
}

/**
 * Get the memory type subdirectories that should exist for a project.
 */
export function getProjectSubdirectories(): string[] {
  return [
    'sessions',
    'summaries',
    'decisions',
    'plans',
    'artifacts',
    'references',
    'handoffs',
    'archive',
  ];
}

/**
 * Map a memory type to its directory name.
 * The directory uses plural form.
 */
export function memoryTypeToDir(memoryType: string): string {
  const mapping: Record<string, string> = {
    session: 'sessions',
    summary: 'summaries',
    decision: 'decisions',
    plan: 'plans',
    artifact: 'artifacts',
    reference: 'references',
    handoff: 'handoffs',
  };
  return mapping[memoryType] || memoryType;
}

export function generateConcreteVaultPath(
  vaultRoot: string,
  project: string | undefined,
  memoryType: string,
  title: string,
  createdAt?: string,
): string {
  return generateVaultPath(
    vaultRoot,
    project,
    memoryType,
    title,
    generateShortUid(),
    createdAt,
  );
}
