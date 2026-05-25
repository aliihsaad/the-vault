import { resolve } from 'node:path';
import { getGraphifyExtensionPaths } from './graphify-paths.service.js';
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

const GRAPHIFY_PACKAGE = 'graphifyy';
const GRAPHIFY_CLI = 'graphify';

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
