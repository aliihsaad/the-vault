# opensrc Extension Architecture (Graphify-Style) for vault-memory / the-vault

**Status:** Architecture plan — ready for spec writer → implementer
**Pattern reference:** Graphify extension (`packages/core/src/services/graphify-*`, `packages/mcp-server/src/graphify-tools.ts`)
**Decision memory:** vm_bO3tapm7OWyrwqi3 · **Exploration report:** vm_jcWqmTZhef-0xQeE
**opensrc verified facts:** npm package `opensrc@0.7.2`, bin `opensrc` → `bin/opensrc.js` → native `opensrc-<os>-<arch>[.exe]`; `postinstall` downloads the native binary from GitHub releases (network at install). Commands: `path`, `fetch`, `list [--json]`, `remove/rm`, `clean`. Cache overridable via `OPENSRC_HOME` (default `~/.opensrc/`); index at `<home>/sources.json`; trees at `<home>/repos/<host>/<owner>/<repo>/<version>/`. Auth via `GITHUB_TOKEN`/`GITLAB_TOKEN`/`BITBUCKET_TOKEN` injected into clone URLs.

---

## 0. How Graphify is structured inside this codebase (what we mirror)

Graphify is **not** a separate npm package or plugin folder. It is a vertical feature slice that lives inside the existing monorepo packages and registers itself with the MCP server at startup:

| Concern | Graphify location | What it does |
|---|---|---|
| Domain logic | `packages/core/src/services/graphify-*.service.ts` | Pure functions taking `(vaultRoot, db, input)`. Config, paths, runtime detect/install-plan, build, query, artifact IO, telemetry. |
| Controlled values | `packages/core/src/rules/graphify.ts` | Enums + Zod schemas + shared predicates. |
| Types | `packages/core/src/types/graphify.ts` | All interfaces. |
| On-disk extension storage | `getGraphifyExtensionPaths(vaultRoot)` → `<vaultRoot>/extensions/graphify/{runtime,cache,projects,config.json}` | Vault-scoped, created lazily. |
| Vault facade | `Vault` class methods (`getGraphifyRuntimeConfig`, `buildGraphifyProjectGraph`, …) | Thin wrappers delegating to services with `this.vaultRoot` / `this.db`. |
| MCP exposure | `packages/mcp-server/src/graphify-tools.ts` exports `registerGraphifyMcpTools(server, vault, options?)` | Registers tools via `server.tool(name, desc, zodShape, handler)`. Called once in `index.ts`: `registerGraphifyMcpTools(server, vault);` |
| Tool name registry | `GRAPHIFY_MCP_TOOL_NAMES` const array | Single source of truth for tool names. |

**Key sub-patterns to copy verbatim:**

1. **Tool registrar** — `getToolRegistrar(server)` reads `server.tool` and binds it; throws if absent. Server type is opaque (`GraphifyMcpServerLike = object`).
2. **Vault facade interface** — `GraphifyMcpVaultLike` lists exactly the methods the tools call (decouples mcp-server from concrete `Vault`). We add `OpensrcMcpVaultLike`.
3. **`jsonResult(build, activity?)` wrapper** — every handler returns `{ content: [{ type: 'text', text: JSON.stringify(value, null, 2) }] }`; on throw returns the same shape with `{ success: false, error }` and `isError: true`. Optionally records activity via `vault.recordGraphify­ToolActivity`.
4. **Injectable command runner** — `runGraphifyBuildProcess` uses `spawn(command, args, { cwd, windowsHide: true, shell: false, env: { ...process.env, ...options.env } })`, collects stdout/stderr, resolves `{ exitCode, stdout, stderr }`, never rejects. Passed in via `options.buildRunner` so tests inject a fake. We mirror as `runOpensrcProcess`.
5. **Config IO** — `get<X>RuntimeConfig` reads `config.json`, returns `getDefault…` if missing/corrupt, normalizes via Zod; `save…` writes pretty JSON + trailing newline; `reset…` deletes the file.
6. **Runtime detect / install-plan split** — `detect…Runtime` runs `--version`; `plan…Install` returns *command previews* (label/command/args/env/preview). Graphify does not auto-exec installs in core; the desktop/host runs them. We extend this with an opt-in `ensureOpensrcInstalled` executor because opensrc is a plain npm dependency (much cheaper than Graphify's Python venv).

---

## 1. Folder structure (mirrors Graphify exactly)

```
packages/core/src/
  rules/
    opensrc.ts                         # enums (Registry, ErrorCode), zod schemas, spec parser/validator, secret redaction
  types/
    opensrc.ts                         # all TS interfaces (config, cache index, tool IO shapes)
  services/
    opensrc-paths.service.ts           # getOpensrcExtensionPaths(vaultRoot); path-safety helpers
    opensrc-config.service.ts          # get/save/reset/getDefault OpensrcRuntimeConfig (config.json)
    opensrc-runtime.service.ts         # detectOpensrcRuntime, planOpensrcInstall, ensureOpensrcInstalled, resolveOpensrcCommand, buildOpensrcEnv
    opensrc-cli.service.ts             # runOpensrcCommand wrapper + parsers for path/fetch/list stdout
    opensrc-cache.service.ts           # listCache, cache size accounting, eviction (LRU), lock file
    opensrc-source.service.ts          # resolvePath, fetchSources, searchSource (ripgrep), readSourceFile (with traversal guard)
  vault.ts                             # add Opensrc facade methods (see §8)

packages/mcp-server/src/
  opensrc-tools.ts                     # registerOpensrcMcpTools(server, vault, options?), OPENSRC_MCP_TOOL_NAMES, runOpensrcProcess
  index.ts                             # add: registerOpensrcMcpTools(server, vault);

packages/core/src/
  opensrc-paths.test.ts                # unit tests mirroring graphify-paths.test.ts
  opensrc-config.test.ts
  opensrc-runtime.test.ts
  opensrc-cache.test.ts
  opensrc-source.test.ts
packages/mcp-server/src/
  opensrc-tools.test.ts

On disk (lazily created, Vault-scoped):
<vaultRoot>/extensions/opensrc/
  config.json                          # OpensrcRuntimeConfig
  cache/                               # === OPENSRC_HOME ===  (sources.json + repos/ live here)
    sources.json                       # opensrc's own index
    repos/<host>/<owner>/<repo>/<version>/...
  runtime/                             # optional: local npm prefix when self-installing the CLI
    node_modules/.bin/opensrc(.cmd)
  cache.lock                           # cross-process mutation lock (fetch/remove/clean/evict)
  logs/
    latest.log
```

> **OPENSRC_HOME reconciliation:** the brief wrote `~/.vault/extensions/opensrc/cache`; the actual codebase convention (Graphify) is `<vaultRoot>/extensions/<name>/` where `vaultRoot` defaults to `~/Vault`. We follow the real convention: **`OPENSRC_HOME = getOpensrcExtensionPaths(vaultRoot).cache`**. This keeps the cache inside the same Vault the rest of the extension uses and never touches the user's global `~/.opensrc`.

---

## 2. Controlled values & types

### `rules/opensrc.ts`

```ts
import { z } from 'zod';

export const OPENSRC_REGISTRIES = ['npm', 'pypi', 'crates'] as const;
export type OpensrcRegistry = (typeof OPENSRC_REGISTRIES)[number];

// Accepted spec prefixes (host repos use owner/repo or gitlab:/bitbucket:/URL)
export const OPENSRC_SPEC_PREFIXES = [
  'npm:', 'pypi:', 'pip:', 'python:', 'crates:', 'cargo:', 'rust:',
  'gitlab:', 'bitbucket:', 'github:',
] as const;

export const OPENSRC_RUNTIME_MODES = ['managed', 'path'] as const;   // managed = self-install under runtime/; path = use opensrc on PATH
export type OpensrcRuntimeMode = (typeof OPENSRC_RUNTIME_MODES)[number];
export const OpensrcRuntimeModeSchema = z.enum(OPENSRC_RUNTIME_MODES);

export const OPENSRC_ERROR_CODES = [
  'BINARY_NOT_FOUND', 'INSTALL_FAILED', 'NETWORK_ERROR', 'AUTH_REQUIRED',
  'PACKAGE_NOT_FOUND', 'CACHE_CORRUPTION', 'CACHE_LOCKED', 'PATH_TRAVERSAL',
  'FILE_TOO_LARGE', 'INVALID_SPEC', 'TIMEOUT', 'CLI_ERROR',
] as const;
export type OpensrcErrorCode = (typeof OPENSRC_ERROR_CODES)[number];

// A package spec is validated, never shell-interpolated. Reject control chars / flags.
const SPEC_RE = /^[A-Za-z0-9._\-/@:+]+$/;
export function assertSafeOpensrcSpec(spec: string): void {
  const s = spec.trim();
  if (!s || s.startsWith('-') || !SPEC_RE.test(s)) {
    throw new OpensrcError('INVALID_SPEC', `Invalid package spec: ${JSON.stringify(spec)}`);
  }
}

// Redact tokens from any string before it reaches a log or a tool response.
const TOKEN_RE = /(x-access-token|oauth2|[A-Za-z0-9_-]*token[A-Za-z0-9_-]*)[:=][^@\s"']+/gi;
export function redactSecrets(text: string): string {
  return text
    .replace(/https?:\/\/[^@\s/]+@/g, 'https://***@')   // creds in clone URLs
    .replace(TOKEN_RE, '$1=***');
}

export class OpensrcError extends Error {
  constructor(public code: OpensrcErrorCode, message: string, public cause?: unknown) {
    super(message);
    this.name = 'OpensrcError';
  }
}
```

### `types/opensrc.ts`

```ts
import type { OpensrcRegistry, OpensrcRuntimeMode, OpensrcErrorCode } from '../rules/opensrc.js';

// ---- Config ----
export interface OpensrcRuntimeConfig {
  runtimeMode: OpensrcRuntimeMode;        // 'managed' | 'path'
  opensrcHome: string;                    // = extension cache dir (OPENSRC_HOME)
  customExecutablePath: string | null;    // explicit opensrc binary (overrides discovery)
  npmPackageSpec: string;                 // default 'opensrc@^0.7.2'
  autoInstall: boolean;                   // default true — install on first use if missing
  maxCacheBytes: number;                  // default 2 GiB
  evictionStrategy: 'lru' | 'oldest' | 'manual'; // default 'lru'
  commandTimeoutMs: number;               // default 120_000 (fetch can be slow)
  maxFileReadBytes: number;               // default 1 MiB (read_source_file cap)
  maxSearchMatches: number;               // default 100
  auth: {
    forwardGithubToken: boolean;          // default true
    forwardGitlabToken: boolean;          // default true
    forwardBitbucketToken: boolean;       // default true
  };
}

export interface SaveOpensrcRuntimeConfigInput extends Partial<Omit<OpensrcRuntimeConfig, 'auth'>> {
  auth?: Partial<OpensrcRuntimeConfig['auth']>;
}

// ---- Cache index (mirrors opensrc sources.json, camelCase preserved) ----
export interface OpensrcPackageEntry {
  kind: 'package';
  name: string;
  version: string;
  registry: OpensrcRegistry;             // 'npm' | 'pypi' | 'crates'
  path: string;                          // absolute path inside OPENSRC_HOME
  fetchedAt: string;                     // ISO
  sizeBytes?: number;                    // computed lazily by cache service
}
export interface OpensrcRepoEntry {
  kind: 'repo';
  name: string;                          // host/owner/repo display name
  version: string;
  path: string;
  fetchedAt: string;
  sizeBytes?: number;
}
export type OpensrcCacheEntry = OpensrcPackageEntry | OpensrcRepoEntry;

export interface OpensrcCacheIndex {
  updatedAt: string | null;
  packages: OpensrcPackageEntry[];
  repos: OpensrcRepoEntry[];
  totalBytes: number;
  maxBytes: number;
}

// ---- Runtime status / install ----
export interface OpensrcRuntimeStatus {
  available: boolean;
  command: string | null;                // resolved executable used
  version: string | null;
  opensrcHome: string;
  source: 'custom' | 'managed' | 'path' | 'none';
  reason?: string;
}
export interface OpensrcInstallPlan {
  runtimeMode: OpensrcRuntimeMode;
  packageSpec: string;
  command: string;                       // 'npm'
  args: string[];                        // ['install', 'opensrc@^0.7.2', '--prefix', '<runtime>']
  env?: Record<string, string>;
  preview: string;
}
export interface OpensrcInstallResult {
  installed: boolean;
  version: string | null;
  command: string | null;
  log: string;                           // redacted
}

// ---- Tool result shapes (see §4) ----
export interface OpensrcResolvedPath {
  spec: string;
  path: string;
  cached: boolean;                       // false ⇒ was fetched during this call
}
export interface OpensrcFetchedSource {
  spec: string;
  ok: boolean;
  path: string | null;
  error?: { code: OpensrcErrorCode; message: string };
}
export interface OpensrcSearchMatch {
  file: string;                          // path RELATIVE to the package root
  line: number;
  column: number;
  text: string;                          // trimmed line, redacted
}
export interface OpensrcReadFile {
  spec: string;
  file: string;                          // relative path echoed back
  absolutePath: string;
  bytes: number;
  truncated: boolean;
  content: string;
}
```

---

## 3. Extension entry point, binary check, install, OPENSRC_HOME

### `opensrc-paths.service.ts`

```ts
import { join, resolve } from 'node:path';

export interface OpensrcExtensionPaths {
  root: string;        // <vaultRoot>/extensions/opensrc
  cache: string;       // === OPENSRC_HOME (sources.json + repos/)
  runtime: string;     // managed npm prefix for self-install
  config: string;      // config.json
  lock: string;        // cache.lock
  logsRoot: string;
  latestLog: string;
}

export function getOpensrcExtensionPaths(vaultRoot: string): OpensrcExtensionPaths {
  const root = resolve(vaultRoot, 'extensions', 'opensrc');
  return {
    root,
    cache: join(root, 'cache'),
    runtime: join(root, 'runtime'),
    config: join(root, 'config.json'),
    lock: join(root, 'cache.lock'),
    logsRoot: join(root, 'logs'),
    latestLog: join(root, 'logs', 'latest.log'),
  };
}
```

### `opensrc-runtime.service.ts` — initialize / detect / install

Initialization is **lazy and idempotent**, triggered on the first tool call (not at server boot, mirroring how Graphify builds on demand). Sequence performed by `ensureOpensrcReady(vaultRoot, config, runner)`:

1. `mkdirSync(paths.cache, { recursive: true })` and `paths.root`.
2. **Resolve command** via `resolveOpensrcCommand(config, paths)`:
   - `config.customExecutablePath` if set and exists;
   - else managed: `<runtime>/node_modules/.bin/opensrc(.cmd)` if exists;
   - else `'opensrc'` (PATH) when `runtimeMode === 'path'`.
3. **Detect**: `detectOpensrcRuntime` runs `<command> --version` through the injectable runner (`spawn`, `shell:false`). Parse `\d+\.\d+\.\d+`. Returns `OpensrcRuntimeStatus`.
4. **If missing and `config.autoInstall`** → `ensureOpensrcInstalled`:
   - `planOpensrcInstall` → `npm install opensrc@^0.7.2 --prefix <runtime> --no-audit --no-fund`.
   - Execute via runner with `cwd: paths.root`. Network + postinstall binary download happen here; on failure throw `OpensrcError('INSTALL_FAILED' | 'NETWORK_ERROR', redacted)`.
   - Re-detect; if still missing → `BINARY_NOT_FOUND`.
5. Return `{ command, version, opensrcHome: paths.cache }`. Cache the resolved command in-process to avoid re-detecting on every call.

### `buildOpensrcEnv(config, paths, processEnv)` — env injection (single source)

```ts
export function buildOpensrcEnv(
  config: OpensrcRuntimeConfig,
  paths: OpensrcExtensionPaths,
  processEnv = process.env,
): Record<string, string> {
  const env: Record<string, string> = { OPENSRC_HOME: paths.cache };
  if (config.auth.forwardGithubToken && processEnv.GITHUB_TOKEN) env.GITHUB_TOKEN = processEnv.GITHUB_TOKEN;
  if (config.auth.forwardGitlabToken && processEnv.GITLAB_TOKEN) env.GITLAB_TOKEN = processEnv.GITLAB_TOKEN;
  if (config.auth.forwardBitbucketToken && processEnv.BITBUCKET_TOKEN) env.BITBUCKET_TOKEN = processEnv.BITBUCKET_TOKEN;
  return env; // merged as { ...process.env, ...env } at spawn time
}
```

---

## 4. The 5 MCP tools (input/output schemas + steps + errors)

All tools are registered in `registerOpensrcMcpTools` and wrapped by the shared `jsonResult(build, activity?)` helper (copied from graphify-tools). Every CLI invocation goes through `runOpensrcProcess` (spawn, `shell:false`, env from `buildOpensrcEnv`, `timeout = config.commandTimeoutMs`). All stdout/stderr surfaced to the agent passes through `redactSecrets`.

### 4.1 `opensrc_resolve_path`

- **Description:** "Resolve a package/repo spec to its locally-cached source path, fetching on cache miss. Returns the absolute path inside the Vault-scoped opensrc cache."
- **Input (zod):**
  ```ts
  { package: z.string().describe('Package or repo spec, e.g. "zod", "zod@3.22.0", "pypi:requests", "vercel/next.js"'),
    version: z.string().optional().describe('Version/tag; alternative to "@version" in package'),
    cwd: z.string().optional().describe('Working dir for npm lockfile version resolution') }
  ```
- **Output:** `OpensrcResolvedPath` → `{ spec, path, cached }`.
- **Steps:** 1) `assertSafeOpensrcSpec`; merge `version` → `spec@version`. 2) `ensureOpensrcReady`. 3) Snapshot whether spec already in `list --json` (sets `cached`). 4) Acquire cache lock (shared-read ok; fetch path takes it). 5) Run `opensrc path <spec> [--cwd <cwd>]`; trim stdout (first line) as the path. 6) Verify path exists; return.
- **Errors:** invalid spec → `INVALID_SPEC`; private/404 → map stderr "set GITHUB_TOKEN" → `AUTH_REQUIRED`, "not found" → `PACKAGE_NOT_FOUND`; DNS/timeout → `NETWORK_ERROR`/`TIMEOUT`; missing binary → `BINARY_NOT_FOUND`.

### 4.2 `opensrc_fetch_sources`

- **Description:** "Pre-fetch one or more packages/repos into the cache without returning file contents. Returns per-spec success + cached path."
- **Input:** `{ packages: z.array(z.string()).min(1).max(20), cwd: z.string().optional() }`
- **Output:** `{ results: OpensrcFetchedSource[], cache: { totalBytes, maxBytes, evicted: string[] } }`
- **Steps:** validate every spec; `ensureOpensrcReady`; acquire write lock; run a single `opensrc fetch <specs...> [--cwd]` (batched, as the CLI supports multiple). Then `opensrc list --json` to resolve each spec → path. Run eviction if over `maxCacheBytes`. Per-spec failures are captured individually (re-run failing specs one-by-one to attribute errors) so partial success is reported, never a hard fail.
- **Errors:** same taxonomy as 4.1, per spec in `results[].error`.

### 4.3 `opensrc_list_cache`

- **Description:** "List cached opensrc sources (parsed `sources.json`) with sizes and totals. Optional substring/registry filter."
- **Input:** `{ filter: z.string().optional().describe('Case-insensitive substring on name'), registry: z.enum(['npm','pypi','crates']).optional(), kind: z.enum(['package','repo']).optional() }`
- **Output:** `OpensrcCacheIndex` (filtered) → `{ updatedAt, packages[], repos[], totalBytes, maxBytes }`.
- **Steps:** `ensureOpensrcReady` (no fetch); run `opensrc list --json`; parse `{ updatedAt?, packages?, repos? }`; tag entries with `kind`, compute `sizeBytes` (cheap `statvfs`-style dir walk, memoized by path+mtime), `totalBytes`; apply filters. If JSON parse fails → attempt one recovery read of `sources.json`; if still bad → `CACHE_CORRUPTION` with remediation hint (`opensrc clean`).
- **Errors:** `CACHE_CORRUPTION`, `BINARY_NOT_FOUND`.

### 4.4 `opensrc_search_source`

- **Description:** "Search within a cached package's source tree (ripgrep) and return matching snippets with file + line. Resolves/fetches the package first."
- **Input:**
  ```ts
  { package: z.string(), query: z.string().describe('Regex or literal'),
    version: z.string().optional(),
    glob: z.string().optional().describe('Restrict to files matching glob, e.g. "*.ts"'),
    max_results: z.number().int().min(1).max(500).optional(),
    case_sensitive: z.boolean().optional() }
  ```
- **Output:** `{ package: string, root: string, matches: OpensrcSearchMatch[], truncated: boolean }`
- **Steps:** 1) resolve path via §4.1 logic (fetch on miss). 2) Run **ripgrep as a spawned arg-array** — `rg --json [--ignore-case] [-g <glob>] -- <query> <root>` with `shell:false`; **`query` is passed as a positional arg, never interpolated**. 3) Parse rg JSON stream → `{ file (relative to root), line, column, text }`, redacted, capped at `max_results ?? config.maxSearchMatches`. 4) Fallback: if `rg` not on PATH, use a bounded Node directory walk + `RegExp` (respecting the same cap and excluding `.git`).
- **Errors:** `PACKAGE_NOT_FOUND` (resolve failed); empty matches → `{ matches: [], truncated: false }` (not an error). Bad regex → `CLI_ERROR` with the rg message.

### 4.5 `opensrc_read_source_file`

- **Description:** "Read a single file from a cached package's source tree. Path-traversal-safe; bounded by maxFileReadBytes."
- **Input:** `{ package: z.string(), file_path: z.string().describe('Path relative to the package root'), version: z.string().optional() }`
- **Output:** `OpensrcReadFile` → `{ spec, file, absolutePath, bytes, truncated, content }`.
- **Steps:** 1) resolve package root (fetch on miss). 2) **Traversal guard:** `const abs = resolve(root, file_path); if (!isWithin(root, abs)) throw OpensrcError('PATH_TRAVERSAL')` where `isWithin` checks `abs === root || abs.startsWith(root + sep)` AND, after `realpathSync`, the resolved real path is still inside `root` (defeats symlink escapes). 3) `statSync`; if `size > maxFileReadBytes` read first `maxFileReadBytes` and set `truncated: true`. 4) Return UTF-8 content, redacted only for obvious token patterns (source files generally not redacted, but the redactor still strips embedded clone-URL creds).
- **Errors:** `PATH_TRAVERSAL`, `FILE_TOO_LARGE` (if config set to hard-fail instead of truncate), `PACKAGE_NOT_FOUND`, `ENOENT` → `CLI_ERROR('file not found in package')`.

---

## 5. Cache management

- **OPENSRC_HOME** = `getOpensrcExtensionPaths(vaultRoot).cache`, injected on every spawn. opensrc owns `sources.json` + `repos/` underneath it; we never write into those directly except `remove`/`clean` via the CLI.
- **Size accounting:** `opensrc-cache.service.ts` computes per-entry `sizeBytes` by walking each entry's `path` (memoized on `path:mtimeMs`), sums to `totalBytes`.
- **Eviction (`evictionStrategy`, default `lru`):** after any `fetch`, if `totalBytes > maxCacheBytes`, evict until under the high-water mark.
  - `lru`: order by last-access time. Access time tracked in a sidecar `cache/access.json` (`{ [path]: isoTimestamp }`) updated by `resolve_path`/`search`/`read`. opensrc's own `fetchedAt` is the fallback when no access record exists.
  - `oldest`: order by `fetchedAt`.
  - `manual`: never auto-evict; only warn in the tool response (`cache.warning`).
  - Eviction calls `opensrc remove <name>` (registry-aware) so opensrc's index stays consistent; evicted specs returned in `cache.evicted`.
- **Lock file** (`cache.lock`): copy Graphify's `acquireBuildLock` pattern — `writeFileSync(lock, {pid, startedAt}, { flag: 'wx' })`; stale-reclaim after `LOCK_STALE_MS` (e.g. 10 min, > commandTimeoutMs). Held for **mutating** ops (`fetch`, eviction, `remove`, `clean`). Read-only ops (`list`, `search`, `read`) do not block. On `EEXIST` → `OpensrcError('CACHE_LOCKED')`.

---

## 6. Auth token handling (safe)

- Tokens are **only** read from `process.env` (`GITHUB_TOKEN` / `GITLAB_TOKEN` / `BITBUCKET_TOKEN`), gated by `config.auth.forward*`, and injected via `buildOpensrcEnv` into the child env **at spawn time** — never persisted to `config.json`, never echoed.
- **Never logged:** all child stdout/stderr passes through `redactSecrets` before logging or returning. The redactor strips `https://creds@host` and `*token*=value` patterns. Install/CLI logs written to `logs/latest.log` are redacted too.
- **Missing token for a private repo:** opensrc returns an error whose stderr contains "If this is a private repo, set GITHUB_TOKEN" → we map to `OpensrcError('AUTH_REQUIRED', 'Private repo requires <TOKEN>. Set it in the MCP server environment.')`. The tool result is `{ success: false, error: { code: 'AUTH_REQUIRED', ... } }` — actionable, no secret leaked.
- **No token forwarding override:** setting `forwardGithubToken: false` lets an operator deliberately restrict the extension to public sources.

---

## 7. Error handling patterns

Single taxonomy (`OpensrcError` + `OpensrcErrorCode`). `runOpensrcProcess` returns `{ exitCode, stdout, stderr }` and never rejects; the service layer maps exit≠0 + stderr text → a code:

| Symptom (stderr / errno) | Code | Agent-facing remediation |
|---|---|---|
| spawn ENOENT on opensrc | `BINARY_NOT_FOUND` | "opensrc CLI missing; enable autoInstall or set customExecutablePath" |
| npm install non-zero | `INSTALL_FAILED` | redacted npm tail |
| DNS/ECONN/registry 5xx/"rate limit" | `NETWORK_ERROR` | "network/registry unavailable; retry" |
| "set GITHUB_TOKEN"/401/403 | `AUTH_REQUIRED` | which token to set |
| "not found"/404/unknown package | `PACKAGE_NOT_FOUND` | check spec/registry prefix |
| `sources.json` unparyable | `CACHE_CORRUPTION` | "run opensrc_clean or delete extensions/opensrc/cache" |
| lock EEXIST | `CACHE_LOCKED` | "another fetch in progress; retry" |
| resolve outside root | `PATH_TRAVERSAL` | rejected |
| file > cap (hard mode) | `FILE_TOO_LARGE` | raise maxFileReadBytes |
| bad spec | `INVALID_SPEC` | rejected pre-spawn |
| timeout | `TIMEOUT` | raise commandTimeoutMs |

`jsonResult` serializes thrown `OpensrcError` to `{ success: false, error: { code, message } }` + `isError: true`, identical shape to Graphify's error path.

---

## 8. Extension registration contract

### Vault facade (`packages/core/src/vault.ts`)

Add thin methods delegating to services (mirror the Graphify facade block):

```ts
getOpensrcRuntimeConfig(): OpensrcRuntimeConfig
saveOpensrcRuntimeConfig(input: SaveOpensrcRuntimeConfigInput): OpensrcRuntimeConfig
resetOpensrcRuntimeConfig(): OpensrcRuntimeConfig
detectOpensrcRuntime(runner: OpensrcCommandRunner): Promise<OpensrcRuntimeStatus>
ensureOpensrcInstalled(runner: OpensrcCommandRunner): Promise<OpensrcInstallResult>
resolveOpensrcPath(input, runner): Promise<OpensrcResolvedPath>
fetchOpensrcSources(input, runner): Promise<{ results: OpensrcFetchedSource[]; cache: {...} }>
listOpensrcCache(input, runner): OpensrcCacheIndex
searchOpensrcSource(input, runner): Promise<{ package; root; matches; truncated }>
readOpensrcSourceFile(input, runner): Promise<OpensrcReadFile>
recordOpensrcToolActivity?(input: OpensrcMcpActivityInput): void   // optional, mirrors Graphify
```

All take `this.vaultRoot` internally; the injectable `runner` defaults to the real `spawn` runner and is overridden in tests.

### MCP registration (`packages/mcp-server/src/opensrc-tools.ts`)

```ts
export const OPENSRC_MCP_TOOL_NAMES = [
  'opensrc_resolve_path', 'opensrc_fetch_sources', 'opensrc_list_cache',
  'opensrc_search_source', 'opensrc_read_source_file',
] as const;

export interface OpensrcMcpVaultLike {
  getOpensrcRuntimeConfig(): OpensrcRuntimeConfig;
  resolveOpensrcPath(i, r): Promise<OpensrcResolvedPath>;
  fetchOpensrcSources(i, r): Promise<...>;
  listOpensrcCache(i, r): OpensrcCacheIndex;
  searchOpensrcSource(i, r): Promise<...>;
  readOpensrcSourceFile(i, r): Promise<OpensrcReadFile>;
  recordOpensrcToolActivity?(i: OpensrcMcpActivityInput): void;
}

export function registerOpensrcMcpTools(
  server: object,
  vault: OpensrcMcpVaultLike,
  options: { runner?: OpensrcCommandRunner } = {},
): void {
  const registerTool = getToolRegistrar(server);        // same helper as Graphify
  const runner = options.runner ?? runOpensrcProcess;
  // ...register the 5 tools, each handler wrapped in jsonResult(...)
}
```

`runOpensrcProcess` is the `spawn`-based runner copied from `runGraphifyBuildProcess` (shell:false, windowsHide:true, env merge, never rejects, supports `timeout`).

### Wiring (`packages/mcp-server/src/index.ts`)

One line, right after `registerGraphifyMcpTools(server, vault);`:

```ts
import { registerOpensrcMcpTools } from './opensrc-tools.js';
// ...
registerOpensrcMcpTools(server, vault);
```

**Announcement contract:** registration is synchronous at server construction — the 5 tools appear in the MCP `tools/list` immediately (same as Graphify's 8). No runtime work happens until a tool is first called; the binary check/install is deferred to that first invocation so a server with no opensrc installed still starts and lists tools cleanly.

---

## 9. Build & conventions

- ESM, `.js` import extensions, TS strict, 2-space/semicolons/single-quotes — same as the rest of `@the-vault/core` and `@the-vault/mcp-server`.
- `opensrc` is added as a **dependency of `@the-vault/mcp-server`** (and/or desktop) in `package.json` so the binary is available without self-install in the default packaged path; `runtimeMode: 'managed'` self-install remains the fallback for source checkouts.
- `ripgrep` reuse: prefer the system `rg`; the Node-walk fallback keeps the tool working where `rg` is absent (CI, minimal installs).
- No new DB tables required (cache state lives in `sources.json` + sidecar `access.json`); only optional `activity_logs` rows via `recordOpensrcToolActivity`, mirroring Graphify telemetry.

---

## 10. Open questions for the spec writer / implementer

1. Confirm the published npm dist tag/version pin (`opensrc@^0.7.2`) and whether to vendor the binary or rely on postinstall download in the packaged Electron app (offline installs).
2. Decide `FILE_TOO_LARGE` behavior: truncate (default here) vs hard-fail.
3. Whether `opensrc_fetch_sources` should expose `--verbose` progress back to the agent or stay quiet.
4. LRU sidecar (`access.json`) vs relying solely on opensrc's `fetchedAt` — included LRU for quality; can be dropped to `oldest` for v1 simplicity.
