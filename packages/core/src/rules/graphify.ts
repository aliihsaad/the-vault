import { z } from 'zod';

export const GRAPHIFY_FRESHNESS_STATES = [
  'missing',
  'queued',
  'building',
  'fresh',
  'stale',
  'failed',
  'disabled',
] as const;

export type GraphifyFreshnessState = (typeof GRAPHIFY_FRESHNESS_STATES)[number];
export const GraphifyFreshnessStateSchema = z.enum(GRAPHIFY_FRESHNESS_STATES);

export const GRAPHIFY_RUNTIME_MODES = [
  'managed',
  'path',
  'localSource',
] as const;

export type GraphifyRuntimeMode = (typeof GRAPHIFY_RUNTIME_MODES)[number];
export const GraphifyRuntimeModeSchema = z.enum(GRAPHIFY_RUNTIME_MODES);

export const GRAPHIFY_BUILD_MODES = [
  'fast',
  'full',
  'semantic',
] as const;

export type GraphifyBuildMode = (typeof GRAPHIFY_BUILD_MODES)[number];
export const GraphifyBuildModeSchema = z.enum(GRAPHIFY_BUILD_MODES);

export const GRAPHIFY_INSTALL_PROFILES = [
  'base',
  'mcp',
  'documents',
  'semantic',
  'full',
] as const;

export type GraphifyInstallProfile = (typeof GRAPHIFY_INSTALL_PROFILES)[number];
export const GraphifyInstallProfileSchema = z.enum(GRAPHIFY_INSTALL_PROFILES);

// A Graphify build that dies with its process (app quit, crash, power loss) leaves the
// lock file and the DB 'building'/'queued' freshness behind. Anything older than this
// (comfortably above the 30-minute desktop build timeout) is treated as interrupted
// and reclaimed/reconciled. Shared by the build lock and the project-status recovery.
export const GRAPHIFY_BUILD_STALE_MS = 35 * 60 * 1000;

// Directory names that are never useful (and often harmful) to feed into Graphify:
// VCS metadata, dependency/build output, and packaged Electron bundles. Copying a
// packaged `app.asar` in particular breaks staging, because Electron's main process
// patches fs to treat `.asar` archives as directories, so a recursive copy of one
// fails with ENOENT.
const GRAPHIFY_EXCLUDED_DIR_SEGMENTS = new Set([
  '.git',
  'node_modules',
  'dist',
  'dist-electron',
  'dist-renderer',
  'coverage',
  '.next',
  '.turbo',
  '.vite',
  '.cache',
  'out',
  'build',
  'release',
  'win-unpacked',
  'graphify-out',
]);

// OS/sidecar junk files. `desktop.ini` is especially important: on Windows it marks
// its folder as a system folder with the read-only attribute, which then makes the
// staged copy of that folder fail to delete (EPERM on rmdir) on the next build.
const GRAPHIFY_EXCLUDED_FILENAMES = new Set([
  'desktop.ini',
  'thumbs.db',
  '.ds_store',
]);

const GRAPHIFY_SECRET_NAME_PATTERN = /\b(secret|token|credential|password)\b/;

/**
 * Shared predicate for paths that must be excluded from Graphify source staging and
 * corpus hashing. Accepts a path relative to (or under) the project source root.
 * Excludes build/vendor directories, packaged `.asar` archives, `.env` files, and
 * obvious secret-like filenames. Used by both the build staging copy and the corpus
 * hasher so they stay consistent.
 */
export function isGraphifyExcludedSourcePath(pathValue: string): boolean {
  const normalized = pathValue.replace(/\\/g, '/').toLowerCase();
  if (!normalized) {
    return false;
  }

  const segments = normalized.split('/').filter(Boolean);
  if (segments.some((segment) =>
    GRAPHIFY_EXCLUDED_DIR_SEGMENTS.has(segment) || segment.endsWith('.asar'),
  )) {
    return true;
  }

  const name = segments[segments.length - 1] ?? '';
  if (GRAPHIFY_EXCLUDED_FILENAMES.has(name)) {
    return true;
  }
  if (name === '.env' || name.startsWith('.env.')) {
    return true;
  }

  return GRAPHIFY_SECRET_NAME_PATTERN.test(normalized);
}
