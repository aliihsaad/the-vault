import { resolve } from 'node:path';
import { getGraphifyExtensionPaths } from './graphify-paths.service.js';
import { now } from '../utils/datetime.js';
import type { GraphifyRuntimeMode } from '../rules/graphify.js';
import type { GraphifyRuntimeConfig } from '../types/graphify.js';

export type GraphifyCommandRunner = (
  command: string,
  args: string[],
) => Promise<GraphifyCommandResult> | GraphifyCommandResult;

export interface GraphifyCommandResult {
  exitCode: number;
  stdout?: string;
  stderr?: string;
}

export interface GraphifyDetectedTool {
  available: boolean;
  version: string | null;
  reason?: string;
}

export interface GraphifyDetectedCli extends GraphifyDetectedTool {
  command: string;
}

export interface GraphifyRuntimeStatus {
  python: GraphifyDetectedTool;
  uv: GraphifyDetectedTool;
  pipx: GraphifyDetectedTool;
  graphify: GraphifyDetectedCli;
}

export interface DetectGraphifyRuntimeInput {
  commandRunner: GraphifyCommandRunner;
  pythonCommand?: string;
  uvCommand?: string;
  pipxCommand?: string;
  graphifyCommand?: string;
}

export type GraphifyInstaller = 'uv' | 'pipx' | 'pythonVenv';

export interface GraphifyAvailableTools {
  uv: boolean;
  pipx: boolean;
  python: boolean;
}

export interface GraphifyInstallCommandPreview {
  label: string;
  command: string;
  args: string[];
  env?: Record<string, string>;
  preview: string;
}

export interface PlanGraphifyInstallInput {
  vaultRoot: string;
  runtimeMode: GraphifyRuntimeMode;
  availableTools: GraphifyAvailableTools;
  extras?: string[];
  localSourcePath?: string | null;
  commandRunner?: GraphifyCommandRunner;
}

export interface GraphifyInstallPlan {
  runtimeMode: GraphifyRuntimeMode;
  developerMode: boolean;
  packageName: 'graphifyy';
  cliCommand: 'graphify';
  runtimePath: string;
  selectedInstaller: GraphifyInstaller | null;
  commands: GraphifyInstallCommandPreview[];
  localSourcePath?: string | null;
  localSourceExists?: boolean | null;
}

export interface PlanGraphifyUpdateInput {
  vaultRoot: string;
  runtimeMode: GraphifyRuntimeMode;
  availableTools: GraphifyAvailableTools;
  extras?: string[];
}

export interface GraphifyUpdatePlan {
  runtimeMode: GraphifyRuntimeMode;
  packageName: 'graphifyy';
  cliCommand: 'graphify';
  runtimePath: string;
  selectedInstaller: GraphifyInstaller | null;
  supported: boolean;
  reason: string | null;
  commands: GraphifyInstallCommandPreview[];
}

// Minimal structural fetch type so tests can inject a fake and core never depends
// on DOM lib types. Node 18+ global fetch satisfies it.
export type GraphifyFetchLike = (
  url: string,
  init?: { signal?: AbortSignal },
) => Promise<{ ok: boolean; status: number; json(): Promise<unknown> }>;

export interface FetchLatestGraphifyVersionInput {
  fetchImpl?: GraphifyFetchLike;
  timeoutMs?: number;
}

export interface GraphifyLatestVersionResult {
  version: string | null;
  error: string | null;
}

export interface CheckGraphifyUpdateInput {
  commandRunner: GraphifyCommandRunner;
  config: Pick<GraphifyRuntimeConfig, 'runtimeMode' | 'managedRuntimePath' | 'customExecutablePath'>;
  fetchImpl?: GraphifyFetchLike;
  timeoutMs?: number;
}

export interface GraphifyUpdateCheck {
  installedVersion: string | null;
  latestVersion: string | null;
  updateAvailable: boolean;
  checkedAt: string;
  source: 'pypi';
  error: string | null;
}

const GRAPHIFY_PACKAGE = 'graphifyy';
const GRAPHIFY_CLI = 'graphify';
const GRAPHIFY_PYPI_JSON_URL = `https://pypi.org/pypi/${GRAPHIFY_PACKAGE}/json`;
const DEFAULT_LATEST_VERSION_TIMEOUT_MS = 8000;

export function resolveGraphifyCommandForRuntimeConfig(
  config: Pick<GraphifyRuntimeConfig, 'runtimeMode' | 'managedRuntimePath' | 'customExecutablePath'>,
): string {
  if (config.runtimeMode === 'path') {
    return config.customExecutablePath ?? GRAPHIFY_CLI;
  }

  return getManagedGraphifyPath(config.managedRuntimePath);
}

export async function detectGraphifyRuntime(
  input: DetectGraphifyRuntimeInput,
): Promise<GraphifyRuntimeStatus> {
  const pythonCommand = input.pythonCommand ?? 'python';
  const uvCommand = input.uvCommand ?? 'uv';
  const pipxCommand = input.pipxCommand ?? 'pipx';
  const graphifyCommand = input.graphifyCommand ?? GRAPHIFY_CLI;

  const [python, uv, pipx, graphify] = await Promise.all([
    detectTool(input.commandRunner, pythonCommand, ['--version'], parsePythonVersion, 'Python was not detected.'),
    detectTool(input.commandRunner, uvCommand, ['--version'], parseUvVersion, 'uv was not detected.'),
    detectTool(input.commandRunner, pipxCommand, ['--version'], parseGenericVersion, 'pipx was not detected.'),
    detectTool(
      input.commandRunner,
      graphifyCommand,
      ['--version'],
      parseGraphifyVersion,
      'Graphify CLI was not detected.',
    ),
  ]);

  return {
    python,
    uv,
    pipx,
    graphify: {
      ...graphify,
      command: graphifyCommand,
    },
  };
}

export function planGraphifyInstall(input: PlanGraphifyInstallInput): GraphifyInstallPlan {
  const runtimePath = getGraphifyExtensionPaths(input.vaultRoot).runtime;
  const extras = normalizeExtras(input.extras ?? []);
  const selectedInstaller = selectInstaller(input.availableTools);
  const basePlan = {
    runtimeMode: input.runtimeMode,
    developerMode: input.runtimeMode === 'localSource',
    packageName: GRAPHIFY_PACKAGE,
    cliCommand: GRAPHIFY_CLI,
    runtimePath,
    selectedInstaller,
  } satisfies Omit<GraphifyInstallPlan, 'commands'>;

  if (input.runtimeMode === 'localSource') {
    const localSourcePath = normalizeOptionalPath(input.localSourcePath);
    return {
      ...basePlan,
      localSourcePath,
      localSourceExists: null,
      commands: localSourcePath && selectedInstaller
        ? buildLocalSourceCommands(selectedInstaller, runtimePath, localSourcePath, extras)
        : [],
    };
  }

  return {
    ...basePlan,
    commands: selectedInstaller
      ? buildManagedCommands(selectedInstaller, runtimePath, extras)
      : [],
  };
}

/**
 * Plan the commands that upgrade the Graphify package in place. Only the Vault-managed
 * runtime is upgradeable from Vault: PATH installs belong to whatever package manager
 * created them, and developer checkouts update through git, so both return an
 * unsupported plan with a human-readable reason instead of guessing commands.
 */
export function planGraphifyUpdate(input: PlanGraphifyUpdateInput): GraphifyUpdatePlan {
  const runtimePath = getGraphifyExtensionPaths(input.vaultRoot).runtime;
  const extras = normalizeExtras(input.extras ?? []);
  const selectedInstaller = selectInstaller(input.availableTools);
  const basePlan = {
    runtimeMode: input.runtimeMode,
    packageName: GRAPHIFY_PACKAGE,
    cliCommand: GRAPHIFY_CLI,
    runtimePath,
    selectedInstaller,
  } satisfies Omit<GraphifyUpdatePlan, 'supported' | 'reason' | 'commands'>;

  if (input.runtimeMode === 'path') {
    return {
      ...basePlan,
      supported: false,
      reason: 'Vault only updates the managed Graphify runtime. Update the PATH installation with the package manager that installed it (for example `uv tool upgrade graphifyy` or `pipx upgrade graphifyy`).',
      commands: [],
    };
  }

  if (input.runtimeMode === 'localSource') {
    return {
      ...basePlan,
      supported: false,
      reason: 'Developer source mode uses a local Graphify checkout. Update it with git and reinstall the editable checkout from Settings.',
      commands: [],
    };
  }

  if (!selectedInstaller) {
    return {
      ...basePlan,
      supported: false,
      reason: 'No supported installer (uv, pipx, or Python) was detected.',
      commands: [],
    };
  }

  return {
    ...basePlan,
    supported: true,
    reason: null,
    commands: buildManagedUpdateCommands(selectedInstaller, runtimePath, extras),
  };
}

/**
 * Fetch the newest published graphifyy version from the PyPI JSON API. Network failure,
 * timeout, or a malformed payload degrade to `{ version: null, error }` — callers treat
 * a failed check as "unknown", never as "up to date".
 */
export async function fetchLatestGraphifyVersion(
  input: FetchLatestGraphifyVersionInput = {},
): Promise<GraphifyLatestVersionResult> {
  const fetchImpl = input.fetchImpl ?? (globalThis as { fetch?: GraphifyFetchLike }).fetch;
  if (!fetchImpl) {
    return { version: null, error: 'fetch is not available in this runtime.' };
  }

  const controller = new AbortController();
  const timeoutMs = input.timeoutMs ?? DEFAULT_LATEST_VERSION_TIMEOUT_MS;
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetchImpl(GRAPHIFY_PYPI_JSON_URL, { signal: controller.signal });
    if (!response.ok) {
      return { version: null, error: `PyPI responded with HTTP ${response.status}.` };
    }
    const payload = await response.json() as { info?: { version?: unknown } } | null;
    const version = typeof payload?.info?.version === 'string' ? payload.info.version.trim() : '';
    return version
      ? { version, error: null }
      : { version: null, error: 'PyPI response did not include a latest version.' };
  } catch (error) {
    const aborted = error instanceof Error && error.name === 'AbortError';
    return {
      version: null,
      error: aborted
        ? `PyPI version check timed out after ${timeoutMs}ms.`
        : error instanceof Error ? error.message : String(error),
    };
  } finally {
    clearTimeout(timeout);
  }
}

/**
 * Compare dotted numeric versions ("0.8.18" vs "0.9.17"). Missing segments count as 0;
 * non-numeric segments count as 0 so a malformed version never crashes the check.
 * Returns <0 when a is older, 0 when equal, >0 when a is newer.
 */
export function compareGraphifyVersions(a: string | null, b: string | null): number {
  const left = parseVersionSegments(a);
  const right = parseVersionSegments(b);
  const length = Math.max(left.length, right.length);
  for (let index = 0; index < length; index += 1) {
    const diff = (left[index] ?? 0) - (right[index] ?? 0);
    if (diff !== 0) {
      return diff < 0 ? -1 : 1;
    }
  }
  return 0;
}

/**
 * One-call update check: detect the installed CLI version through the injected command
 * runner, fetch the latest PyPI version, and report whether an upgrade is available.
 */
export async function checkGraphifyUpdate(input: CheckGraphifyUpdateInput): Promise<GraphifyUpdateCheck> {
  const command = resolveGraphifyCommandForRuntimeConfig(input.config);
  const detected = await detectTool(
    input.commandRunner,
    command,
    ['--version'],
    parseGraphifyVersion,
    'Graphify CLI was not detected.',
  );
  const latest = await fetchLatestGraphifyVersion({
    fetchImpl: input.fetchImpl,
    timeoutMs: input.timeoutMs,
  });

  const installedVersion = detected.available ? detected.version : null;
  const updateAvailable = Boolean(
    installedVersion
    && latest.version
    && compareGraphifyVersions(installedVersion, latest.version) < 0,
  );

  return {
    installedVersion,
    latestVersion: latest.version,
    updateAvailable,
    checkedAt: now(),
    source: 'pypi',
    error: detected.available ? latest.error : detected.reason ?? 'Graphify CLI was not detected.',
  };
}

export function parseGraphifyVersionOutput(output: string): string | null {
  return parseGraphifyVersion(output);
}

async function detectTool(
  commandRunner: GraphifyCommandRunner,
  command: string,
  args: string[],
  parseVersion: (output: string) => string | null,
  missingReason: string,
): Promise<GraphifyDetectedTool> {
  try {
    const result = await commandRunner(command, args);
    if (result.exitCode !== 0) {
      return {
        available: false,
        version: null,
        reason: missingReason,
      };
    }

    return {
      available: true,
      version: parseVersion(`${result.stdout ?? ''}\n${result.stderr ?? ''}`),
    };
  } catch {
    return {
      available: false,
      version: null,
      reason: missingReason,
    };
  }
}

function selectInstaller(tools: GraphifyAvailableTools): GraphifyInstaller | null {
  if (tools.uv) {
    return 'uv';
  }
  if (tools.pipx) {
    return 'pipx';
  }
  if (tools.python) {
    return 'pythonVenv';
  }
  return null;
}

function buildManagedCommands(
  installer: GraphifyInstaller,
  runtimePath: string,
  extras: string[],
): GraphifyInstallCommandPreview[] {
  const packageSpec = buildPackageSpec(GRAPHIFY_PACKAGE, extras);
  const pythonPath = getManagedPythonPath(runtimePath);

  if (installer === 'uv') {
    return [
      commandPreview(
        'Create managed Graphify virtual environment',
        'uv',
        ['venv', runtimePath],
      ),
      commandPreview(
        'Install Graphify into managed runtime',
        'uv',
        ['pip', 'install', '--python', pythonPath, packageSpec],
      ),
    ];
  }

  if (installer === 'pipx') {
    return [
      commandPreview(
        'Install Graphify with pipx',
        'pipx',
        ['install', packageSpec],
        getPipxEnvironment(runtimePath),
      ),
    ];
  }

  return [
    commandPreview(
      'Create managed Graphify virtual environment',
      'python',
      ['-m', 'venv', runtimePath],
    ),
    commandPreview(
      'Install Graphify into managed runtime',
      pythonPath,
      ['-m', 'pip', 'install', packageSpec],
    ),
  ];
}

function buildManagedUpdateCommands(
  installer: GraphifyInstaller,
  runtimePath: string,
  extras: string[],
): GraphifyInstallCommandPreview[] {
  const packageSpec = buildPackageSpec(GRAPHIFY_PACKAGE, extras);
  const pythonPath = getManagedPythonPath(runtimePath);

  if (installer === 'uv') {
    return [
      commandPreview(
        'Upgrade Graphify in managed runtime',
        'uv',
        ['pip', 'install', '--python', pythonPath, '--upgrade', packageSpec],
      ),
    ];
  }

  if (installer === 'pipx') {
    // `pipx upgrade` cannot change extras, so extras installs are force-reinstalled.
    return extras.length > 0
      ? [
          commandPreview(
            'Reinstall Graphify with pipx (extras pinned)',
            'pipx',
            ['install', '--force', packageSpec],
            getPipxEnvironment(runtimePath),
          ),
        ]
      : [
          commandPreview(
            'Upgrade Graphify with pipx',
            'pipx',
            ['upgrade', GRAPHIFY_PACKAGE],
            getPipxEnvironment(runtimePath),
          ),
        ];
  }

  return [
    commandPreview(
      'Upgrade Graphify in managed runtime',
      pythonPath,
      ['-m', 'pip', 'install', '--upgrade', packageSpec],
    ),
  ];
}

function buildLocalSourceCommands(
  installer: GraphifyInstaller,
  runtimePath: string,
  localSourcePath: string,
  extras: string[],
): GraphifyInstallCommandPreview[] {
  const sourceSpec = buildPackageSpec(localSourcePath, extras);
  const pythonPath = getManagedPythonPath(runtimePath);

  if (installer === 'uv') {
    return [
      commandPreview(
        'Install Graphify editable checkout into managed runtime',
        'uv',
        ['pip', 'install', '--python', pythonPath, '--editable', sourceSpec],
      ),
    ];
  }

  if (installer === 'pipx') {
    return [
      commandPreview(
        'Install Graphify editable checkout with pipx',
        'pipx',
        ['install', '--editable', sourceSpec],
        getPipxEnvironment(runtimePath),
      ),
    ];
  }

  return [
    commandPreview(
      'Create managed Graphify virtual environment',
      'python',
      ['-m', 'venv', runtimePath],
    ),
    commandPreview(
      'Install Graphify editable checkout into managed runtime',
      pythonPath,
      ['-m', 'pip', 'install', '--editable', sourceSpec],
    ),
  ];
}

function commandPreview(
  label: string,
  command: string,
  args: string[],
  env?: Record<string, string>,
): GraphifyInstallCommandPreview {
  return {
    label,
    command,
    args,
    ...(env ? { env } : {}),
    preview: formatPowerShellCommandPreview(command, args, env),
  };
}

function buildPackageSpec(packageNameOrPath: string, extras: string[]): string {
  if (extras.length === 0) {
    return packageNameOrPath;
  }
  return `${packageNameOrPath}[${extras.join(',')}]`;
}

function normalizeExtras(extras: string[]): string[] {
  return Array.from(new Set(
    extras
      .map((extra) => extra.trim())
      .filter(Boolean),
  ));
}

function normalizeOptionalPath(pathValue: string | null | undefined): string | null {
  if (!pathValue?.trim()) {
    return null;
  }
  return resolve(pathValue.trim());
}

function getManagedPythonPath(runtimePath: string): string {
  return resolve(runtimePath, 'Scripts', 'python.exe');
}

function getManagedGraphifyPath(runtimePath: string): string {
  return resolve(runtimePath, 'Scripts', 'graphify.exe');
}

function getPipxEnvironment(runtimePath: string): Record<string, string> {
  return {
    PIPX_HOME: resolve(runtimePath, 'pipx'),
    PIPX_BIN_DIR: resolve(runtimePath, 'bin'),
  };
}

function formatEnvironmentPreview(env: Record<string, string> | undefined): string[] {
  if (!env) {
    return [];
  }

  return Object.entries(env).map(([key, value]) => `$env:${key}=${value}`);
}

function formatPowerShellCommandPreview(
  command: string,
  args: string[],
  env: Record<string, string> | undefined,
): string {
  const commandPreview = quotePreviewArg(command);
  const executablePreview = commandPreview.startsWith('"')
    ? `& ${commandPreview}`
    : commandPreview;
  return [
    ...formatEnvironmentPreview(env).map(quotePreviewArg),
    executablePreview,
    ...args.map(quotePreviewArg),
  ].join(' ');
}

function quotePreviewArg(value: string): string {
  if (value.startsWith('$env:')) {
    const [key, envValue] = value.split('=', 2);
    return `${key}=${quotePreviewArg(envValue ?? '')};`;
  }
  if (!/[\s[\]\\/:;]/.test(value)) {
    return value;
  }
  return `"${value.replace(/"/g, '\\"')}"`;
}

function parsePythonVersion(output: string): string | null {
  return parseVersion(output, /Python\s+(\d+(?:\.\d+)+)/i);
}

function parseUvVersion(output: string): string | null {
  return parseVersion(output, /uv\s+(\d+(?:\.\d+)+)/i);
}

function parseGraphifyVersion(output: string): string | null {
  return parseVersion(output, /graphify(?:\s+version)?\s+(\d+(?:\.\d+)+)/i);
}

function parseGenericVersion(output: string): string | null {
  return parseVersion(output, /(\d+(?:\.\d+)+)/);
}

function parseVersion(output: string, pattern: RegExp): string | null {
  return output.match(pattern)?.[1] ?? null;
}

function parseVersionSegments(version: string | null): number[] {
  if (!version?.trim()) {
    return [];
  }
  return version
    .trim()
    .split('.')
    .map((segment) => {
      const numeric = Number.parseInt(segment, 10);
      return Number.isFinite(numeric) ? numeric : 0;
    });
}
