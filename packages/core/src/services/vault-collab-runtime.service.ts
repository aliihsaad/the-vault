import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { VaultCollabRuntimeConfig } from '../types/vault-collab.js';

export const VAULT_COLLAB_REPOSITORY_URL = 'https://github.com/aliihsaad/vault-collab';

export interface VaultCollabDetectedPath {
  available: boolean;
  path: string | null;
}

export interface VaultCollabPackageInfo {
  available: boolean;
  path: string | null;
  name: string | null;
  version: string | null;
}

export interface VaultCollabRuntimeStatus {
  runtimeMode: VaultCollabRuntimeConfig['runtimeMode'];
  configured: boolean;
  ready: boolean;
  sourceRoot: VaultCollabDetectedPath;
  cli: VaultCollabDetectedPath;
  mcpServer: VaultCollabDetectedPath;
  database: VaultCollabDetectedPath;
  packageInfo: VaultCollabPackageInfo;
  message: string;
}

export interface VaultCollabInstallPlan {
  runtimeMode: VaultCollabRuntimeConfig['runtimeMode'];
  ready: boolean;
  repositoryUrl: string;
  commands: string[];
  notes: string[];
  cliPath: string | null;
  databasePath: string;
}

export function resolveVaultCollabCliPath(config: VaultCollabRuntimeConfig): string | null {
  if (config.runtimeMode === 'path') {
    return config.customCliPath;
  }
  if (config.runtimeMode === 'managed') {
    return null;
  }

  const sourceRoot = getVaultCollabSourceRoot(config);
  return sourceRoot ? join(sourceRoot, 'dist', 'cli.js') : null;
}

export function resolveVaultCollabMcpServerPath(config: VaultCollabRuntimeConfig): string | null {
  if (config.runtimeMode === 'managed') {
    return null;
  }

  const sourceRoot = getVaultCollabSourceRoot(config);
  return sourceRoot ? join(sourceRoot, 'dist', 'mcp', 'server.js') : null;
}

export function detectVaultCollabRuntime(config: VaultCollabRuntimeConfig): VaultCollabRuntimeStatus {
  const sourceRoot = getVaultCollabSourceRoot(config);
  const cliPath = resolveVaultCollabCliPath(config);
  const mcpServerPath = resolveVaultCollabMcpServerPath(config);
  const packageInfo = readVaultCollabPackageInfo(sourceRoot);
  const databaseAvailable = existsSync(config.databasePath);
  const managedNpmRuntime = config.runtimeMode === 'managed';
  const cliAvailable = managedNpmRuntime ? databaseAvailable : Boolean(cliPath && existsSync(cliPath));
  const sourceAvailable = Boolean(sourceRoot && existsSync(sourceRoot));
  const configured = managedNpmRuntime ? Boolean(config.databasePath) : Boolean(cliPath && config.databasePath);
  const ready = managedNpmRuntime ? databaseAvailable : configured && cliAvailable;

  return {
    runtimeMode: config.runtimeMode,
    configured,
    ready,
    sourceRoot: {
      available: sourceAvailable,
      path: sourceRoot,
    },
    cli: {
      available: cliAvailable,
      path: cliPath,
    },
    mcpServer: {
      available: Boolean(mcpServerPath && existsSync(mcpServerPath)),
      path: mcpServerPath,
    },
    database: {
      available: databaseAvailable,
      path: config.databasePath,
    },
    packageInfo,
    message: buildVaultCollabStatusMessage({
      configured,
      ready,
      sourceAvailable,
      cliAvailable,
      databaseAvailable,
      runtimeMode: config.runtimeMode,
    }),
  };
}

export function planVaultCollabInstall(config: VaultCollabRuntimeConfig): VaultCollabInstallPlan {
  const sourceRoot = getVaultCollabSourceRoot(config);
  const cliPath = resolveVaultCollabCliPath(config);
  const status = detectVaultCollabRuntime(config);
  const commands: string[] = [];
  const notes: string[] = [];

  if (config.runtimeMode === 'localSource') {
    if (sourceRoot) {
      commands.push(`cd "${sourceRoot}"`);
      commands.push('npm install');
      commands.push('npm run build');
      commands.push(`node dist\\cli.js sessions --db "${config.databasePath}"`);
      notes.push('Local source mode is a developer shortcut for an already-cloned Vault Collab checkout.');
      notes.push(`Normal users should use managed mode, which installs from ${VAULT_COLLAB_REPOSITORY_URL}.`);
      notes.push('The final command initializes or checks the local SQLite database without mutating handoffs.');
    } else {
      notes.push(`Use managed mode to install from ${VAULT_COLLAB_REPOSITORY_URL}, or choose a local source folder for development.`);
    }
  } else if (config.runtimeMode === 'path') {
    if (cliPath) {
      commands.push(`node "${cliPath}" sessions --db "${config.databasePath}"`);
      notes.push('Path mode expects an already-built Vault Collab CLI file.');
    } else {
      notes.push('Set a custom CLI path before using path mode.');
    }
  } else {
    commands.push(buildManagedVaultCollabCheckCommand(config.databasePath));
    notes.push(`Managed install uses npm exec from ${VAULT_COLLAB_REPOSITORY_URL}; no source checkout is required.`);
    notes.push('The command opens or creates the local SQLite database and prints a JSON health check.');
    notes.push('Vault shows this command preview first and does not run it silently.');
  }

  if (!status.database.available) {
    notes.push('The database file is not present yet; Vault Collab creates it when the CLI or MCP server opens the configured path.');
  }

  return {
    runtimeMode: config.runtimeMode,
    ready: status.ready,
    repositoryUrl: VAULT_COLLAB_REPOSITORY_URL,
    commands,
    notes,
    cliPath,
    databasePath: config.databasePath,
  };
}

function buildManagedVaultCollabCheckCommand(databasePath: string): string {
  return [
    `$db = "${escapePowerShellDoubleQuotedString(databasePath)}"`,
    'New-Item -ItemType Directory -Force -Path (Split-Path $db) | Out-Null',
    `npm exec --yes --package ${VAULT_COLLAB_REPOSITORY_URL} -- vault-collab check --db $db`,
  ].join('; ');
}

function escapePowerShellDoubleQuotedString(value: string): string {
  return value.replace(/`/g, '``').replace(/"/g, '`"').replace(/\$/g, '`$');
}

function getVaultCollabSourceRoot(config: VaultCollabRuntimeConfig): string | null {
  if (config.runtimeMode === 'localSource') {
    return config.localSourceCheckoutPath;
  }
  return null;
}

function readVaultCollabPackageInfo(sourceRoot: string | null): VaultCollabPackageInfo {
  const packagePath = sourceRoot ? join(sourceRoot, 'package.json') : null;
  if (!packagePath || !existsSync(packagePath)) {
    return {
      available: false,
      path: packagePath,
      name: null,
      version: null,
    };
  }

  try {
    const parsed = JSON.parse(readFileSync(packagePath, 'utf8')) as Record<string, unknown>;
    return {
      available: true,
      path: packagePath,
      name: typeof parsed.name === 'string' ? parsed.name : null,
      version: typeof parsed.version === 'string' ? parsed.version : null,
    };
  } catch {
    return {
      available: false,
      path: packagePath,
      name: null,
      version: null,
    };
  }
}

function buildVaultCollabStatusMessage(input: {
  configured: boolean;
  ready: boolean;
  sourceAvailable: boolean;
  cliAvailable: boolean;
  databaseAvailable: boolean;
  runtimeMode: VaultCollabRuntimeConfig['runtimeMode'];
}): string {
  if (!input.configured) {
    return 'Vault Collab is not configured yet.';
  }

  if (input.runtimeMode === 'managed') {
    return input.databaseAvailable
      ? 'Vault Collab GitHub npm exec check passed and the configured database exists.'
      : 'Vault Collab uses the GitHub npm exec install check; run the preview command to create the local database.';
  }

  if (input.ready && input.databaseAvailable) {
    return 'Vault Collab is installed and the configured database exists.';
  }

  if (input.ready) {
    return 'Vault Collab CLI is installed; the database will be created when the configured path is opened.';
  }

  if (input.runtimeMode !== 'path' && !input.sourceAvailable) {
    return 'Vault Collab source folder is missing.';
  }

  if (!input.cliAvailable) {
    return 'Vault Collab CLI is missing. Run the install/build commands.';
  }

  return 'Vault Collab status is incomplete.';
}
