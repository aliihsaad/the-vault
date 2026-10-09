import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
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
  // Credential stores that sometimes sit inside a source folder.
  '.ssh',
  '.aws',
  '.gnupg',
]);

// OS/sidecar junk files. `desktop.ini` is especially important: on Windows it marks
// its folder as a system folder with the read-only attribute, which then makes the
// staged copy of that folder fail to delete (EPERM on rmdir) on the next build.
const GRAPHIFY_EXCLUDED_FILENAMES = new Set([
  'desktop.ini',
  'thumbs.db',
  '.ds_store',
]);

// Secret-looking words anywhere in the path. "token" stays singular on purpose so
// design-token files (tokens.css) are still indexed.
const GRAPHIFY_SECRET_NAME_PATTERN = /\b(secrets?|token|credentials?|passwords?|recovery[-_ ]?codes?)\b/;

// Credential and private-key files matched on their exact name or extension.
const GRAPHIFY_SECRET_FILENAMES = new Set([
  '.npmrc',
  '.pypirc',
  '.netrc',
  '.git-credentials',
  '.htpasswd',
]);
const GRAPHIFY_SSH_KEY_PATTERN = /^id_(rsa|dsa|ecdsa|ed25519)(\.pub)?$/;
const GRAPHIFY_SECRET_EXTENSIONS = ['.pem', '.key', '.p12', '.pfx', '.jks', '.keystore', '.kdbx', '.ppk'];

// Per-project exclude file at the source root, using a gitignore-style subset.
export const GRAPHIFY_IGNORE_FILENAME = '.graphifyignore';

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
  if (
    GRAPHIFY_SECRET_FILENAMES.has(name)
    || GRAPHIFY_SSH_KEY_PATTERN.test(name)
    || GRAPHIFY_SECRET_EXTENSIONS.some((extension) => name.endsWith(extension))
  ) {
    return true;
  }

  return GRAPHIFY_SECRET_NAME_PATTERN.test(normalized);
}

/**
 * Build the source filter for one project: the built-in exclusions plus the
 * patterns in `<sourceRoot>/.graphifyignore`. Supported syntax is a gitignore
 * subset: `#` comments, `*`, `**`, `?`, a leading `/` to anchor at the root, and a
 * trailing `/` (ignored; a matching folder excludes everything under it). A
 * pattern without a slash matches at any depth. Negation (`!`) is not supported.
 */
export function createGraphifySourceFilter(sourceRoot: string): (relativePath: string) => boolean {
  const patterns = readGraphifyIgnorePatterns(sourceRoot);
  return (relativePath) => {
    if (isGraphifyExcludedSourcePath(relativePath)) {
      return true;
    }
    const normalized = relativePath.replace(/\\/g, '/').replace(/^\/+/, '').toLowerCase();
    return normalized.length > 0 && patterns.some((pattern) => pattern.test(normalized));
  };
}

function readGraphifyIgnorePatterns(sourceRoot: string): RegExp[] {
  const ignorePath = join(sourceRoot, GRAPHIFY_IGNORE_FILENAME);
  if (!existsSync(ignorePath)) {
    return [];
  }

  return readFileSync(ignorePath, 'utf8')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !line.startsWith('#') && !line.startsWith('!'))
    .map(compileIgnorePattern);
}

function compileIgnorePattern(rawPattern: string): RegExp {
  let pattern = rawPattern.toLowerCase().replace(/\\/g, '/').replace(/\/+$/, '');
  // gitignore: a slash at the start or in the middle anchors the pattern to the root.
  const anchored = pattern.includes('/');
  pattern = pattern.replace(/^\/+/, '');

  let body = '';
  for (let index = 0; index < pattern.length; index += 1) {
    const char = pattern[index];
    if (char === '*' && pattern[index + 1] === '*') {
      const followedBySlash = pattern[index + 2] === '/';
      body += followedBySlash ? '(?:.*/)?' : '.*';
      index += followedBySlash ? 2 : 1;
    } else if (char === '*') {
      body += '[^/]*';
    } else if (char === '?') {
      body += '[^/]';
    } else {
      body += char.replace(/[.+^${}()|[\]\\]/g, '\\$&');
    }
  }

  // Matching a folder excludes everything beneath it.
  return new RegExp(`${anchored ? '^' : '(?:^|/)'}${body}(?:/.*)?$`);
}

/**
 * Detect a source root that is a plain folder holding several separate projects
 * (for example a git clone next to an extracted archive of the same repo), which
 * makes Graphify index every file twice. A child folder counts as a project when
 * it, or one of its own subfolders, holds a `.git` or `package.json`, because zip
 * extracts often add a wrapper folder (`repo-main/repo-main/package.json`).
 * Returns the child folder names, or an empty list when the root is itself a
 * project or holds at most one.
 */
export function detectGraphifyMultiProjectRoot(sourceRoot: string): string[] {
  if (!existsSync(sourceRoot) || hasProjectMarker(sourceRoot)) {
    return [];
  }

  const isExcluded = createGraphifySourceFilter(sourceRoot);
  const projects = listSubfolders(sourceRoot, isExcluded)
    .filter((name) => {
      const child = join(sourceRoot, name);
      return hasProjectMarker(child)
        || listSubfolders(child, (path) => isExcluded(`${name}/${path}`))
          .some((grandchild) => hasProjectMarker(join(child, grandchild)));
    })
    .sort((left, right) => left.localeCompare(right));
  return projects.length > 1 ? projects : [];
}

function hasProjectMarker(dir: string): boolean {
  return existsSync(join(dir, '.git')) || existsSync(join(dir, 'package.json'));
}

function listSubfolders(dir: string, isExcluded: (name: string) => boolean): string[] {
  try {
    return readdirSync(dir, { withFileTypes: true })
      .filter((entry) => entry.isDirectory() && !isExcluded(entry.name))
      .map((entry) => entry.name);
  } catch {
    return [];
  }
}
