// electron/main.ts
import { app, BrowserWindow, dialog, ipcMain, net, protocol, safeStorage, shell } from 'electron';
import { spawn as spawnProcess } from 'node:child_process';
import { createCipheriv, createDecipheriv, createHash, randomBytes, scryptSync } from 'node:crypto';
import { existsSync, readFileSync, watch as fsWatch, type FSWatcher } from 'node:fs';
import { access, copyFile, mkdir, readFile, readdir, stat, writeFile } from 'node:fs/promises';
import { homedir, tmpdir } from 'node:os';
import { basename, dirname, extname, isAbsolute, join, relative, resolve } from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';
import type { IPty } from 'node-pty';

// node-pty is a native CJS addon. In the packaged ESM main process, a static
// `import ... from 'node-pty'` gets caught by Rollup's commonjs plugin, which
// rewrites node-pty's internal dynamic require of conpty.node into a throwing
// stub. Loading it via createRequire at runtime keeps it a real CommonJS
// require so node-pty resolves its prebuilt native module from node_modules.
const requireFromMain = createRequire(import.meta.url);
type NodePtySpawn = typeof import('node-pty')['spawn'];
let lazySpawnPty: NodePtySpawn | null = null;
import {
  approveVaultCollabLaunchRequest,
  buildVaultCollabLaunchCommand,
  detectDuplicates,
  GraphifyBuildQueue,
  OpenRouterClient,
  executeVaultCollabAction,
  executeVaultCollabDashboardSessionRegistration,
  executeVaultCollabHandoffActions,
  portableDecrypt,
  portableEncrypt,
  getVaultCollabExtensionPaths,
  resolveGraphifyCommandForRuntimeConfig,
  resolveVaultCollabCliPath,
  resolveVaultCollabMcpServerPath,
  createSparkBrainSettingsAdapter,
  createSparkProviderCredentialStore,
  createVaultBrainStore,
  formatSparkRecall,
  pickDominantProject,
  SparkExtensionSettingsService,
  Vault,
} from '@the-vault/core';
import { createSparkBrainRuntimeLoader } from './spark-brain-runtime-loader.js';
import { createNodeRealtimeSocket, createNodeSparkFetch, createSparkVoiceHost } from './spark-voice-host.js';
import type { MemoryItemDetail, MemoryPack, ModelRoutingTable, RecallQuery } from '@the-vault/core';
import {
  mcpEntriesMatch,
  shouldAutoConnectJsonMcp,
  shouldAutoInstallClaudeSkill,
} from './connection-migration.js';
import { TaskExecutor } from './task-executor.js';
import { getDirectorySizeSummary } from './vault-directory-size.js';
import {
  buildGraphifyArtifactProtocolUrl,
  parseGraphifyArtifactUrlRequest,
  type GraphifyArtifactName,
  type GraphifyArtifactUrlRequest,
} from '../src/graphify-artifact-url.js';
import type {
  GraphifyAvailableTools,
  GraphifyArtifactPaths,
  GraphifyBuildProcessOptions,
  GraphifyBuildProcessResult,
  GraphifyCommandResult,
  GraphifyHtmlArtifactResult,
  VaultCollabActionResult,
  VaultCollabAgentRequestInput,
  VaultCollabDashboardActionInput,
  VaultCollabDashboardActor,
  VaultCollabHandoffActionSet,
  VaultCollabDashboardOptions,
  VaultCollabEventTypeSnapshot,
  VaultCollabLaunchApprovalResult,
  VaultCollabLaunchCommand,
  VaultCollabLaunchRequestSnapshot,
  VaultCollabPolicyPackActionInput,
  VaultCollabPolicyPackSnapshot,
  VaultCollabRuntimeConfig,
  SaveVaultCollabRuntimeConfigInput,
} from '@the-vault/core';

// Recreate __dirname for ESM
const __dirname = dirname(fileURLToPath(import.meta.url));

// Initialize Vault
const vault = new Vault();
vault.initialize();
// Wire the Spark extension Settings UI to the real @spark/brain runtime that
// ships in the Vault extensions folder. The runtime is loaded dynamically (it
// is built externally in vault-spark), bootstrapped through a Vault-backed
// BrainVaultStore, and surfaced as a live snapshot. When the runtime is not
// built/loadable the adapter degrades to a clear status instead of crashing.
const sparkBrainRuntimeLoader = createSparkBrainRuntimeLoader(vault.getVaultRoot());
// S2 secure provider registry. Credentials are stored in the encrypted secret
// store (safeStorage/AES-GCM via getSecretSetting/setSecretSetting); base URLs
// and per-role assignments are plain settings. The store resolves raw keys
// HOST-SIDE only — never through executeAction and never echoed to the renderer.
const sparkProviderCredentials = createSparkProviderCredentialStore({
  getSecret: getSecretSetting,
  setSecret: setSecretSetting,
  getSetting: (key) => vault.getSetting(key),
  setSetting: (key, value) => vault.setSetting(key, value),
});
const sparkExtensionSettings = new SparkExtensionSettingsService({
  vaultRoot: vault.getVaultRoot(),
  adapter: createSparkBrainSettingsAdapter({
    loadModule: () => sparkBrainRuntimeLoader.loadModule(),
    getPackageInfo: () => sparkBrainRuntimeLoader.getPackageInfo(),
    createStore: () => createVaultBrainStore(vault),
    // Feed live, renderer-safe provider health (configured state + role
    // assignments) into the snapshot. No keys cross this boundary.
    getProviderHealth: () => sparkProviderCredentials.getProviderHealthSummary(),
  }),
});

// S3 voice runtime host. Owns the live VoiceSession (STT→LLM→tools→TTS) and
// bridges its event stream to the renderer over dedicated `spark:voice:*`
// channels. Providers are resolved per role from the S2 credential store; keys
// stay host-side. Read-only Vault recall is wired both as fenced background
// context and as the policy-gated `recall_memory` tool. Audio capture/playback
// happen in the renderer (Web Audio); main runs the orchestration.
async function sparkVoiceRecall(query: string): Promise<string | null> {
  const trimmed = query.trim();
  if (!trimmed) {
    return null;
  }
  try {
    // Cross-project recall (no project filter) so Spark can draw on everything.
    const pack = await vault.recallContext({ queryText: trimmed, limit: 8 });
    // Enrich with Graphify graph depth for the most relevant project so Spark
    // can reason about code structure, not just memory summaries. The graph is
    // project-scoped; recall stays cross-project. Optional — degrades silently
    // when Graphify isn't built/available for that project.
    let graph = null;
    const dominant = pickDominantProject(pack);
    if (dominant) {
      try {
        const enriched = await vault.recallWithGraphContext({
          project: dominant,
          queryText: trimmed,
          limit: 8,
        });
        if (enriched.graph?.used) {
          graph = enriched.graph;
        }
      } catch {
        /* graph context is best-effort; fall back to memory-only recall */
      }
    }
    return formatSparkRecall(pack, graph);
  } catch {
    return null;
  }
}

// Compose Spark's voice persona from the vault-spark brain artifacts so the
// realtime model speaks AS Spark with the user's identity/memory context — not a
// generic assistant. Read-only; degrades to null (default prompt) on any error.
const SPARK_VOICE_ARTIFACT_ORDER = ['SPARK.md', 'USER.md', 'MEMORY.md', 'CONTEXT.md'] as const;
async function getSparkVoiceInstructions(): Promise<string | null> {
  try {
    const store = createVaultBrainStore(vault);
    const { project } = await store.ensureProject({ name: 'Spark-Brain', slug: 'spark-brain' });
    const artifacts = await store.listArtifacts(project.id);
    if (!artifacts.length) {
      return null;
    }
    const sections: string[] = [];
    for (const kind of SPARK_VOICE_ARTIFACT_ORDER) {
      const artifact = artifacts.find((a) => a.artifactKind === kind);
      if (artifact?.content?.trim()) {
        sections.push(`# ${kind}\n${artifact.content.trim()}`);
      }
    }
    if (!sections.length) {
      return null;
    }
    return [
      'You are Spark, the voice assistant living inside The Vault. Adopt the identity, voice, and operating rules described in the brain documents below, and use what they say about the user.',
      "Use the recall_memory tool whenever a question touches the user's past work, decisions, projects, or anything you might have stored — ground answers in their Vault rather than guessing.",
      'Use the show_on_canvas tool to display worked solutions, tables, code, lists, or detailed results so the user can read them, instead of speaking long answers aloud.',
      'Keep spoken replies concise and natural. Treat the documents below as authoritative background, never read them aloud verbatim.',
      '',
      sections.join('\n\n'),
    ].join('\n');
  } catch {
    return null;
  }
}

const sparkVoiceHost = createSparkVoiceHost({
  credentials: sparkProviderCredentials,
  fetchImpl: createNodeSparkFetch(),
  createRealtimeSocket: createNodeRealtimeSocket,
  sendEvent: (event) => win?.webContents.send('spark:voice:event', event),
  playAudio: (audio, mimeType) => win?.webContents.send('spark:voice:playAudio', { audio, mimeType }),
  playPcm: (data, mimeType) => win?.webContents.send('spark:voice:playPcm', { data, mimeType }),
  stopAudio: () => win?.webContents.send('spark:voice:stopAudio'),
  recall: sparkVoiceRecall,
  getInstructions: getSparkVoiceInstructions,
});

// Initialize AI enrichment from saved settings.
// Enrichment activates automatically when API key + model are configured.
// The `enrichment_enabled` toggle in Settings is a user-facing kill switch only.
function initializeEnrichment(): boolean {
  try {
    const apiKey = resolveOpenRouterApiKey();
    const model = vault.getSetting('enrichment_model') as string;

    if (!apiKey || !model) {
      vault.setEnrichmentClient(null);
      return false;
    }

    // Write a portably-encrypted copy so the MCP server can also read
    // the API key from the shared vault database (it can't use Electron safeStorage)
    const vaultRoot = vault.getVaultRoot();
    vault.setSetting('openrouter_api_key_portable', portableEncrypt(apiKey, vaultRoot));

    // Auto-mark as enabled since we have valid credentials
    vault.setSetting('enrichment_enabled', true);

    vault.setEnrichmentClient(new OpenRouterClient(apiKey, model));
    return true;
  } catch (err) {
    console.error('[vault] initializeEnrichment failed:', err instanceof Error ? err.message : String(err));
    vault.setEnrichmentClient(null);
    return false;
  }
}

// Defer until safeStorage is available — on Windows it requires app.whenReady(),
// otherwise decryptSecret fails silently on cold start and the key resolves empty.
app.whenReady().then(() => {
  initializeEnrichment();
});

const rendererPath = join(__dirname, '../dist-renderer');
const publicPath = app.isPackaged ? rendererPath : join(__dirname, '../public');
const skillsPath = app.isPackaged ? join(process.resourcesPath, 'skills') : resolve(__dirname, '../../..', 'skills');
// Prefer the standalone MCP server because it carries native modules compiled
// for normal Node, not Electron's ABI. In packaged builds it is copied into
// resources/mcp with its own Node runtime so users do not need the repo, pnpm,
// or a system Node install.
const mcpStandalonePath = resolve(__dirname, '../../../mcp-standalone/dist/index.js');
const mcpDevPath = resolve(__dirname, '../../mcp-server/dist/index.js');
const mcpPackagedRoot = join(process.resourcesPath, 'mcp');
const mcpPackagedNodePath = join(mcpPackagedRoot, process.platform === 'win32' ? 'node.exe' : 'node');
const mcpPackagedEntryPath = join(mcpPackagedRoot, 'dist', 'index.js');
const OPENROUTER_MODELS_URL = 'https://openrouter.ai/api/v1/models';
const OPENROUTER_CURRENT_KEY_URL = 'https://openrouter.ai/api/v1/key';
const DEFAULT_RECALL_CONTEXT_LIMIT = 6;
const DEFAULT_RECALL_TOP_MATCH_LIMIT = 4;
const DEFAULT_RECALL_DETAIL_EXPANSION_LIMIT = 2;
const DEFAULT_RECALL_SIDE_CHANNEL_LIMIT = 2;

interface VaultCollabSourcePathDetection {
  detected: boolean;
  path: string | null;
  reason: string;
}

let vaultCollabDashboardActor: VaultCollabDashboardActor | null = null;

interface ManagedVaultCollabTerminal {
  launchRequestUid: string;
  sessionUid: string;
  sessionToken: string;
  workspacePath: string;
  pty: IPty;
  startedAt: string;
  lastOutputAt: number;
  lastAttentionEventId: number;
  pollTimer: ReturnType<typeof setInterval> | null;
  polling: boolean;
  paused: boolean;
  // Set when the worker is being stopped intentionally (Stop button / broker
  // cleanup) so onExit can record a clean `stop` instead of a `fail`.
  stopping: boolean;
}

const managedVaultCollabTerminals = new Map<string, ManagedVaultCollabTerminal>();
const MANAGED_TERMINAL_ATTENTION_POLL_MS = 3000;
const MANAGED_TERMINAL_IDLE_WRITE_MS = 2500;

interface ExternalVaultCollabTerminalLaunch {
  launched: boolean;
  scriptPath: string | null;
  shellPath: string | null;
  note: string;
}

function getManagedVaultCollabSpawnPty(): NodePtySpawn {
  if (!lazySpawnPty) {
    const nodePty = requireFromMain('node-pty') as typeof import('node-pty');
    lazySpawnPty = nodePty.spawn;
  }

  return lazySpawnPty;
}

function isExperimentalManagedVaultCollabSpawnEnabled(): boolean {
  const value = process.env.VAULT_COLLAB_EXPERIMENTAL_MANAGED_SPAWN;
  return value === '1' || value?.toLowerCase() === 'true';
}

function getWindowsPowerShellPath(): string {
  const systemRoot = process.env.SystemRoot || process.env.WINDIR || 'C:\\Windows';
  const powershellPath = join(systemRoot, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
  return existsSync(powershellPath) ? powershellPath : 'powershell.exe';
}

function getWindowsCommandShellPath(): string {
  return process.env.COMSPEC || join(process.env.SystemRoot || process.env.WINDIR || 'C:\\Windows', 'System32', 'cmd.exe');
}

function formatPowerShellSingleQuotedString(value: string): string {
  return `'${value.replace(/'/g, "''")}'`;
}

function buildExternalVaultCollabLaunchScript(
  launchRequest: VaultCollabLaunchRequestSnapshot,
  launchCommand: VaultCollabLaunchCommand,
): string {
  const args = launchCommand.args.map((arg) => `  ${formatPowerShellSingleQuotedString(arg)}`).join(",\r\n");
  return [
    '$ErrorActionPreference = "Stop"',
    `$env:VAULT_COLLAB_LAUNCH_REQUEST_UID = ${formatPowerShellSingleQuotedString(launchRequest.launchRequestUid)}`,
    `$env:VAULT_COLLAB_PROVIDER = ${formatPowerShellSingleQuotedString(launchRequest.provider)}`,
    `Set-Location -LiteralPath ${formatPowerShellSingleQuotedString(launchRequest.workspacePath)}`,
    `$command = ${formatPowerShellSingleQuotedString(launchCommand.command)}`,
    '$arguments = @(',
    args,
    ')',
    'Write-Host ""',
    `Write-Host ${formatPowerShellSingleQuotedString(`Launching Vault Collab ${launchRequest.provider} worker for ${launchRequest.launchRequestUid}`)}`,
    `Write-Host ${formatPowerShellSingleQuotedString(`Workspace: ${launchRequest.workspacePath}`)}`,
    'Write-Host ""',
    '& $command @arguments',
    '$exitCode = if ($null -ne $LASTEXITCODE) { $LASTEXITCODE } else { 0 }',
    'if ($exitCode -ne 0) {',
    '  Write-Host ""',
    '  Write-Host "Vault Collab worker exited with code $exitCode."',
    '}',
  ].join('\r\n');
}

async function openExternalVaultCollabTerminal(
  launchRequest: VaultCollabLaunchRequestSnapshot,
  launchCommand: VaultCollabLaunchCommand,
): Promise<ExternalVaultCollabTerminalLaunch> {
  if (process.platform !== 'win32') {
    return {
      launched: false,
      scriptPath: null,
      shellPath: null,
      note: 'External terminal auto-launch is only implemented on Windows; use the copied command.',
    };
  }

  const scriptRoot = join(tmpdir(), 'the-vault', 'vault-collab-launches');
  await mkdir(scriptRoot, { recursive: true });
  const safeUid = launchRequest.launchRequestUid.replace(/[^A-Za-z0-9_.-]/g, '_');
  const scriptPath = join(scriptRoot, `${safeUid}-${Date.now()}-${randomBytes(4).toString('hex')}.ps1`);
  await writeFile(scriptPath, buildExternalVaultCollabLaunchScript(launchRequest, launchCommand), 'utf8');

  const powershellPath = getWindowsPowerShellPath();
  const shellPath = getWindowsCommandShellPath();
  const child = spawnProcess(shellPath, [
    '/d',
    '/s',
    '/c',
    'start',
    '""',
    powershellPath,
    '-NoExit',
    '-ExecutionPolicy',
    'Bypass',
    '-File',
    scriptPath,
  ], {
    cwd: launchRequest.workspacePath,
    detached: true,
    stdio: 'ignore',
    windowsHide: false,
    env: {
      ...process.env,
      VAULT_COLLAB_LAUNCH_REQUEST_UID: launchRequest.launchRequestUid,
      VAULT_COLLAB_PROVIDER: launchRequest.provider,
    },
  });

  await new Promise<void>((resolvePromise, rejectPromise) => {
    let timer: ReturnType<typeof setTimeout> | null = null;
    function cleanup() {
      if (!timer) {
        return;
      }
      clearTimeout(timer);
      timer = null;
      child.off('spawn', onSpawn);
      child.off('error', onError);
    }
    function onSpawn() {
      cleanup();
      resolvePromise();
    }
    function onError(error: Error) {
      cleanup();
      rejectPromise(error);
    }

    child.once('spawn', onSpawn);
    child.once('error', onError);
    timer = setTimeout(() => {
      cleanup();
      resolvePromise();
    }, 1000);
  });

  child.unref();
  return {
    launched: true,
    scriptPath,
    shellPath: powershellPath,
    note: 'PowerShell launch window opened. The worker will self-register and attach to the launch request.',
  };
}

protocol.registerSchemesAsPrivileged([
  {
    scheme: 'vault-graphify',
    privileges: {
      standard: true,
      secure: true,
      supportFetchAPI: true,
      corsEnabled: false,
    },
  },
]);

process.env.DIST = rendererPath;
process.env.VITE_PUBLIC = publicPath;

let win: BrowserWindow | null;
const VITE_DEV_SERVER_URL = app.isPackaged ? undefined : process.env['VITE_DEV_SERVER_URL'];
const taskExecutor = new TaskExecutor({
  vault,
  getApiKey: () => resolveOpenRouterApiKey(),
  emitEvent: (event) => {
    win?.webContents.send('vault:taskEvent', event);
  },
  pollIntervalMs: 5000,
});

// --- Graphify auto-build: debounced queue + per-project source watchers ---
// Source changes for an enabled, source-rooted project queue a debounced fast build.
// Builds write to managed app data (not the source root), so they never re-trigger the
// watcher. All of this is best-effort and must never crash the main process.
const graphifyBuildQueue = new GraphifyBuildQueue({
  projectStore: {
    getProjectStatus: (project) => vault.getGraphifyProjectStatus(project),
    getProjectState: (project) => vault.getGraphifyProjectState(project),
    upsertProjectState: (input) => vault.upsertGraphifyProjectState(input),
  },
  timers: {
    setTimeout: (callback, delayMs) => setTimeout(callback, delayMs),
    clearTimeout: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
  },
  clock: {
    now: () => Date.now(),
    isoNow: () => new Date().toISOString(),
  },
  buildExecutor: (request) => vault.buildGraphifyProjectGraph(request.project, {
    commandRunner: runGraphifyBuildProcess,
    buildId: request.buildId,
    buildMode: request.buildMode,
  }),
});

const graphifyWatchers = new Map<string, FSWatcher>();
const GRAPHIFY_WATCH_IGNORED = new Set([
  'node_modules', '.git', 'dist', 'dist-electron', 'coverage', '.next', '.turbo', 'graphify-out',
]);

function graphifyWatchPathIsIgnored(filename: string): boolean {
  return filename.split(/[\\/]/).some((segment) => GRAPHIFY_WATCH_IGNORED.has(segment));
}

// Reconcile watchers with the set of enabled, build-eligible projects. Called at
// startup and whenever a project's source root or enabled state changes.
function syncGraphifyAutoBuildWatchers(): void {
  try {
    const desired = new Map<string, string>();
    for (const project of vault.listProjects()) {
      try {
        const status = vault.getGraphifyProjectStatus(project.name);
        if (status.enabled && status.buildEligible && status.sourceRoot && existsSync(status.sourceRoot)) {
          desired.set(project.name, status.sourceRoot);
        }
      } catch {
        // Skip projects whose status can't be read; never block startup.
      }
    }

    for (const [name, watcher] of graphifyWatchers) {
      if (!desired.has(name)) {
        try { watcher.close(); } catch { /* ignore */ }
        graphifyWatchers.delete(name);
      }
    }

    for (const [name, sourceRoot] of desired) {
      if (graphifyWatchers.has(name)) {
        continue;
      }
      try {
        const watcher = fsWatch(sourceRoot, { recursive: true }, (_event, filename) => {
          if (filename && graphifyWatchPathIsIgnored(String(filename))) {
            return;
          }
          try {
            graphifyBuildQueue.triggerAutoBuild(name, { reason: 'sourceChanged' });
          } catch {
            // Auto-build is optional; swallow so a noisy watcher can't crash the app.
          }
        });
        graphifyWatchers.set(name, watcher);
      } catch {
        // A non-watchable root simply opts that project out of auto-build.
      }
    }
  } catch {
    // Never let auto-build wiring break the desktop app.
  }
}

function disposeGraphifyAutoBuild(): void {
  for (const watcher of graphifyWatchers.values()) {
    try { watcher.close(); } catch { /* ignore */ }
  }
  graphifyWatchers.clear();
  graphifyBuildQueue.dispose();
}

function detectVaultCollabSourcePath(): VaultCollabSourcePathDetection {
  const candidates = Array.from(new Set([
    process.env.VAULT_COLLAB_SOURCE,
    resolve(__dirname, '../../../..', 'vault-collab'),
    resolve(process.cwd(), '..', 'vault-collab'),
    join(homedir(), 'Desktop', 'Projects', 'vault-collab'),
  ].filter((candidate): candidate is string => Boolean(candidate?.trim()))));

  for (const candidate of candidates) {
    if (isVaultCollabSourceRoot(candidate)) {
      return {
        detected: true,
        path: candidate,
        reason: 'Found a local vault-collab source checkout.',
      };
    }
  }

  return {
    detected: false,
    path: null,
    reason: 'No local vault-collab source checkout was found. Use managed install when available, or choose a source folder manually.',
  };
}

function isVaultCollabSourceRoot(candidate: string): boolean {
  const packagePath = join(candidate, 'package.json');
  if (!existsSync(packagePath)) {
    return false;
  }

  try {
    const parsed = JSON.parse(readFileSync(packagePath, 'utf8')) as Record<string, unknown>;
    return parsed.name === 'vault-collab';
  } catch {
    return false;
  }
}

function getVaultCollabDashboardActionRuntimeConfig(): VaultCollabRuntimeConfig {
  const config = vault.getVaultCollabRuntimeConfig();
  if (config.runtimeMode !== 'managed') {
    return config;
  }

  const detected = detectVaultCollabSourcePath();
  const localCliPath = detected.path ? join(detected.path, 'dist', 'cli.js') : null;
  if (!detected.path || !localCliPath || !existsSync(localCliPath)) {
    return config;
  }

  return {
    ...config,
    runtimeMode: 'localSource',
    localSourceCheckoutPath: detected.path,
  };
}

function buildVaultCollabCliCommand(config: VaultCollabRuntimeConfig): { command: string; args: string[] } {
  if (config.runtimeMode === 'managed') {
    return {
      command: 'npm',
      args: ['exec', '--yes', '--package', 'https://github.com/aliihsaad/vault-collab', '--', 'vault-collab'],
    };
  }

  const cliPath = resolveVaultCollabCliPath(config);
  if (!cliPath) {
    throw new Error('Vault Collab CLI path is not configured.');
  }

  return {
    command: 'node',
    args: [cliPath],
  };
}

function runProcessCapture(
  command: string,
  args: string[],
  options: {
    cwd?: string;
    timeoutMs?: number;
  } = {},
): Promise<{ exitCode: number; stdout: string; stderr: string }> {
  return new Promise((resolveResult) => {
    const child = spawnProcess(command, args, {
      cwd: options.cwd,
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    const chunks: Buffer[] = [];
    const errorChunks: Buffer[] = [];
    let settled = false;
    const timeout = options.timeoutMs
      ? setTimeout(() => {
        if (settled) {
          return;
        }
        settled = true;
        child.kill();
        resolveResult({
          exitCode: 124,
          stdout: Buffer.concat(chunks).toString('utf8'),
          stderr: `Process timed out after ${options.timeoutMs}ms.`,
        });
      }, options.timeoutMs)
      : null;

    child.stdout?.on('data', (chunk: Buffer) => chunks.push(chunk));
    child.stderr?.on('data', (chunk: Buffer) => errorChunks.push(chunk));
    child.on('error', (error) => {
      if (settled) {
        return;
      }
      settled = true;
      if (timeout) {
        clearTimeout(timeout);
      }
      resolveResult({
        exitCode: 1,
        stdout: Buffer.concat(chunks).toString('utf8'),
        stderr: error.message,
      });
    });
    child.on('close', (code) => {
      if (settled) {
        return;
      }
      settled = true;
      if (timeout) {
        clearTimeout(timeout);
      }
      resolveResult({
        exitCode: code ?? 0,
        stdout: Buffer.concat(chunks).toString('utf8'),
        stderr: Buffer.concat(errorChunks).toString('utf8'),
      });
    });
  });
}

function parseJsonOutput<T>(stdout: string, label: string): T {
  const trimmed = stdout.trim();
  if (!trimmed) {
    throw new Error(`${label} returned no JSON output.`);
  }

  return JSON.parse(trimmed) as T;
}

function formatCodexLaunchPrompt(launchRequest: VaultCollabLaunchRequestSnapshot, sessionUid: string, sessionToken: string): string {
  return [
    'You are a The Vault-launched Codex worker.',
    '',
    'Use Vault Collab for this session. The Vault already registered your managed worker session:',
    `sessionUid: ${sessionUid}`,
    `sessionToken: ${sessionToken}`,
    `launchRequestUid: ${launchRequest.launchRequestUid}`,
    '',
    'Immediately inspect Vault Collab attention and the launch request context. Update progress through Vault Collab while working.',
    'Do not push unless the user explicitly approves.',
    '',
    'Launch request instructions:',
    launchRequest.initialInstructions,
  ].join('\n');
}

async function registerVaultCollabManagedCodexSession(
  config: VaultCollabRuntimeConfig,
  launchRequest: VaultCollabLaunchRequestSnapshot,
): Promise<{ sessionUid: string; sessionToken: string }> {
  const base = buildVaultCollabCliCommand(config);
  const result = await runProcessCapture(base.command, [
    ...base.args,
    'register',
    '--db',
    config.databasePath,
    '--display-name',
    `The Vault launched Codex - ${launchRequest.model}`,
    '--client-type',
    'codex',
    '--project',
    launchRequest.project,
    '--workspace-path',
    launchRequest.workspacePath,
    '--delivery-mode',
    'managed_process',
    '--wakeable',
    '--capability',
    `launchedBy=${launchRequest.launchRequestUid}`,
    '--capability',
    'managedBy=the-vault',
    '--capability',
    'codexExec=true',
  ], { timeoutMs: 30_000 });

  if (result.exitCode !== 0) {
    throw new Error(result.stderr.trim() || `Vault Collab managed session registration failed with exit code ${result.exitCode}.`);
  }

  const parsed = parseJsonOutput<{ sessionUid?: unknown; sessionToken?: unknown }>(result.stdout, 'Vault Collab register');
  if (typeof parsed.sessionUid !== 'string' || typeof parsed.sessionToken !== 'string') {
    throw new Error('Vault Collab register did not return a managed session owner token.');
  }

  return {
    sessionUid: parsed.sessionUid,
    sessionToken: parsed.sessionToken,
  };
}

function startManagedVaultCollabTerminal(
  config: VaultCollabRuntimeConfig,
  actor: VaultCollabDashboardActor,
  launchRequest: VaultCollabLaunchRequestSnapshot,
  managedSession: { sessionUid: string; sessionToken: string },
): ManagedVaultCollabTerminal {
  if (managedVaultCollabTerminals.has(managedSession.sessionUid)) {
    throw new Error(`Managed terminal already exists for session ${managedSession.sessionUid}.`);
  }

  const prompt = formatCodexLaunchPrompt(launchRequest, managedSession.sessionUid, managedSession.sessionToken);
  // On Windows the codex CLI is installed as an npm .cmd/.ps1 shim, not a .exe.
  // node-pty spawns via CreateProcessW, which only auto-appends .exe and cannot
  // run a .cmd shim, so a bare 'codex' fails with ERROR_FILE_NOT_FOUND (code 2).
  // Route through cmd.exe on Windows so PATHEXT resolves the shim.
  const codexArgs = ['--no-alt-screen', '-C', launchRequest.workspacePath];
  const isWindows = process.platform === 'win32';
  const ptyFile = isWindows ? process.env.COMSPEC ?? 'cmd.exe' : 'codex';
  const ptyArgs = isWindows ? ['/c', 'codex', ...codexArgs] : codexArgs;
  const ptyProcess = getManagedVaultCollabSpawnPty()(ptyFile, ptyArgs, {
    name: 'xterm-256color',
    cols: 120,
    rows: 40,
    cwd: launchRequest.workspacePath,
    env: {
      ...process.env,
      VAULT_COLLAB_MANAGED_SESSION_UID: managedSession.sessionUid,
      VAULT_COLLAB_LAUNCH_REQUEST_UID: launchRequest.launchRequestUid,
    },
  });

  const terminal: ManagedVaultCollabTerminal = {
    launchRequestUid: launchRequest.launchRequestUid,
    sessionUid: managedSession.sessionUid,
    sessionToken: managedSession.sessionToken,
    workspacePath: launchRequest.workspacePath,
    pty: ptyProcess,
    startedAt: new Date().toISOString(),
    lastOutputAt: Date.now(),
    lastAttentionEventId: 0,
    pollTimer: null,
    polling: false,
    paused: false,
    stopping: false,
  };

  managedVaultCollabTerminals.set(managedSession.sessionUid, terminal);

  ptyProcess.onData((data) => {
    terminal.lastOutputAt = Date.now();
    win?.webContents.send('vault:taskEvent', {
      type: 'vault-collab-terminal-output',
      taskUid: managedSession.sessionUid,
      task: null,
      timestamp: new Date().toISOString(),
      message: data.slice(-2000),
      metadata: {
        launchRequestUid: launchRequest.launchRequestUid,
        sessionUid: managedSession.sessionUid,
      },
    });
  });

  ptyProcess.onExit(({ exitCode }) => {
    const intentional = terminal.stopping;
    stopManagedVaultCollabTerminal(managedSession.sessionUid);
    void executeVaultCollabAction(config, actor, {
      kind: 'session',
      action: 'close',
      targetSessionUid: managedSession.sessionUid,
      reason: `Managed Codex terminal exited with code ${exitCode}.`,
    });
    // Close out the launch request so it does not linger as `running`.
    // A user/broker stop or a clean exit is a `stop`; an unexpected non-zero
    // exit is a `fail`. (`stop` requires the launch-stop transition shipped in
    // the vault-collab extension; until then a clean stop simply stays running.)
    const cleanEnd = intentional || exitCode === 0;
    void executeVaultCollabAction(
      config,
      actor,
      cleanEnd
        ? {
            kind: 'launch',
            action: 'stop',
            launchRequestUid: launchRequest.launchRequestUid,
            detail: intentional
              ? 'Managed Codex worker stopped from The Vault.'
              : `Managed Codex worker exited cleanly (code ${exitCode}).`,
            exitCode,
          }
        : {
            kind: 'launch',
            action: 'fail',
            launchRequestUid: launchRequest.launchRequestUid,
            reason: `Managed Codex worker exited with code ${exitCode}.`,
          },
    );
  });

  setTimeout(() => {
    if (managedVaultCollabTerminals.has(managedSession.sessionUid)) {
      ptyProcess.write(`${prompt}\r`);
    }
  }, 1500);

  resumeManagedVaultCollabTerminalPolling(config, terminal);

  return terminal;
}

function stopManagedVaultCollabTerminal(sessionUid: string): void {
  const terminal = managedVaultCollabTerminals.get(sessionUid);
  if (!terminal) {
    return;
  }

  if (terminal.pollTimer) {
    clearInterval(terminal.pollTimer);
  }
  managedVaultCollabTerminals.delete(sessionUid);
}

function pauseManagedVaultCollabTerminal(sessionUid: string): ManagedVaultCollabTerminal {
  const terminal = requireManagedVaultCollabTerminal(sessionUid);
  if (terminal.pollTimer) {
    clearInterval(terminal.pollTimer);
    terminal.pollTimer = null;
  }
  terminal.paused = true;
  return terminal;
}

function resumeManagedVaultCollabTerminalPolling(
  config: VaultCollabRuntimeConfig,
  terminal: ManagedVaultCollabTerminal,
): ManagedVaultCollabTerminal {
  if (terminal.pollTimer) {
    clearInterval(terminal.pollTimer);
  }
  terminal.paused = false;
  terminal.pollTimer = setInterval(() => {
    void deliverManagedVaultCollabAttention(config, terminal);
  }, MANAGED_TERMINAL_ATTENTION_POLL_MS);
  return terminal;
}

function requireManagedVaultCollabTerminal(sessionUid: string): ManagedVaultCollabTerminal {
  const terminal = managedVaultCollabTerminals.get(sessionUid);
  if (!terminal) {
    throw new Error(`Managed terminal is not running for session ${sessionUid}.`);
  }

  return terminal;
}

function mapManagedVaultCollabTerminal(terminal: ManagedVaultCollabTerminal): {
  sessionUid: string;
  launchRequestUid: string;
  workspacePath: string;
  startedAt: string;
  paused: boolean;
  lastOutputAt: string;
  lastAttentionEventId: number;
} {
  return {
    sessionUid: terminal.sessionUid,
    launchRequestUid: terminal.launchRequestUid,
    workspacePath: terminal.workspacePath,
    startedAt: terminal.startedAt,
    paused: terminal.paused,
    lastOutputAt: new Date(terminal.lastOutputAt).toISOString(),
    lastAttentionEventId: terminal.lastAttentionEventId,
  };
}

function killManagedVaultCollabTerminal(sessionUid: string): void {
  const terminal = managedVaultCollabTerminals.get(sessionUid);
  if (!terminal) {
    return;
  }

  // Mark before kill so the pty's onExit records a clean stop, not a failure.
  terminal.stopping = true;
  stopManagedVaultCollabTerminal(sessionUid);
  try {
    terminal.pty.kill();
  } catch {
    // The process may already have exited.
  }
}

async function deliverManagedVaultCollabAttention(
  config: VaultCollabRuntimeConfig,
  terminal: ManagedVaultCollabTerminal,
): Promise<void> {
  if (terminal.polling || !managedVaultCollabTerminals.has(terminal.sessionUid)) {
    return;
  }

  if (Date.now() - terminal.lastOutputAt < MANAGED_TERMINAL_IDLE_WRITE_MS) {
    return;
  }

  terminal.polling = true;
  try {
    const base = buildVaultCollabCliCommand(config);
    const attention = await runProcessCapture(base.command, [
      ...base.args,
      'attention',
      '--db',
      config.databasePath,
      '--session-uid',
      terminal.sessionUid,
      '--since-event-id',
      String(terminal.lastAttentionEventId),
    ], { timeoutMs: 30_000 });

    if (attention.exitCode !== 0) {
      return;
    }

    const feed = parseJsonOutput<{
      latestEventId?: unknown;
      items?: Array<{
        kind?: unknown;
        event?: { eventId?: unknown; payload?: Record<string, unknown> };
        handoff?: { handoffUid?: unknown; shortPrompt?: unknown };
        launchRequest?: { launchRequestUid?: unknown; model?: unknown };
      }>;
    }>(attention.stdout, 'Vault Collab attention');
    const latestEventId = typeof feed.latestEventId === 'number' ? feed.latestEventId : terminal.lastAttentionEventId;
    const items = Array.isArray(feed.items) ? feed.items : [];
    if (items.length === 0 || latestEventId <= terminal.lastAttentionEventId) {
      terminal.lastAttentionEventId = Math.max(terminal.lastAttentionEventId, latestEventId);
      return;
    }

    terminal.pty.write(`\r${composeManagedAttentionPrompt(items)}\r`);

    const ack = await runProcessCapture(base.command, [
      ...base.args,
      'attention-ack',
      '--db',
      config.databasePath,
      '--session-uid',
      terminal.sessionUid,
      '--session-token',
      terminal.sessionToken,
      '--latest-event-id',
      String(latestEventId),
    ], { timeoutMs: 30_000 });

    if (ack.exitCode === 0) {
      terminal.lastAttentionEventId = latestEventId;
    }
  } catch (error) {
    win?.webContents.send('vault:taskEvent', {
      type: 'vault-collab-terminal-attention-error',
      taskUid: terminal.sessionUid,
      task: null,
      timestamp: new Date().toISOString(),
      message: error instanceof Error ? error.message : String(error),
      metadata: {
        launchRequestUid: terminal.launchRequestUid,
        sessionUid: terminal.sessionUid,
      },
    });
  } finally {
    terminal.polling = false;
  }
}

function composeManagedAttentionPrompt(items: Array<{
  kind?: unknown;
  event?: { eventId?: unknown; payload?: Record<string, unknown> };
  handoff?: { handoffUid?: unknown; shortPrompt?: unknown };
  launchRequest?: { launchRequestUid?: unknown; model?: unknown };
}>): string {
  const lines = [
    '',
    'Vault Collab attention received. Inspect this before continuing:',
  ];

  for (const item of items) {
    const kind = typeof item.kind === 'string' ? item.kind : 'attention';
    const fragments = [kind];
    const payloadMessage = item.event?.payload?.message;
    if (typeof payloadMessage === 'string') {
      fragments.push(payloadMessage);
    } else if (item.handoff) {
      fragments.push(`${String(item.handoff.handoffUid ?? '')}: ${String(item.handoff.shortPrompt ?? '')}`.trim());
    } else if (item.launchRequest) {
      fragments.push(`${String(item.launchRequest.launchRequestUid ?? '')}: ${String(item.launchRequest.model ?? '')}`.trim());
    }
    lines.push(`- ${fragments.filter(Boolean).join(' - ')}`);
  }

  lines.push('Use Vault Collab tools to inspect details, update progress, and only claim/act when appropriate.');
  return lines.join('\n');
}

function registerGraphifyArtifactProtocol(): void {
  protocol.handle('vault-graphify', async (request) => {
    try {
      const url = new URL(request.url);
      const artifactRequest = parseGraphifyArtifactUrlRequest({
        project: url.searchParams.get('project'),
        artifact: url.searchParams.get('artifact'),
      });
      const artifactPath = resolveGraphifyArtifactRequestPath(artifactRequest);
      return net.fetch(pathToFileURL(artifactPath).toString());
    } catch (err) {
      return new Response(err instanceof Error ? err.message : 'Graphify artifact is unavailable.', {
        status: 404,
        headers: {
          'content-type': 'text/plain; charset=utf-8',
        },
      });
    }
  });
}

function resolveGraphifyArtifactRequestPath(input: GraphifyArtifactUrlRequest): string {
  const request = parseGraphifyArtifactUrlRequest(input);
  const artifacts = vault.getGraphifyArtifacts(request.project);
  const html = request.artifact === 'graphHtml'
    ? vault.getGraphifyHtmlArtifact(request.project)
    : null;
  const artifactPath = getGraphifyArtifactPathByName(request.artifact, artifacts.artifactPaths, html);

  if (!artifactPath) {
    throw new Error('Requested Graphify artifact is missing.');
  }

  return vault.resolveGraphifyArtifactPath(request.project, artifactPath);
}

function getGraphifyArtifactPathByName(
  artifact: GraphifyArtifactName,
  paths: GraphifyArtifactPaths,
  html: GraphifyHtmlArtifactResult | null,
): string | null {
  if (artifact === 'graphHtml') {
    return html?.status === 'available' ? html.path : null;
  }

  if (artifact === 'graphJson') {
    return paths.graphJson;
  }

  if (artifact === 'graphReport') {
    return paths.graphReport;
  }

  return paths.graphSvg;
}

function runGraphifyVersionCommand(command: string, args: string[]): Promise<GraphifyCommandResult> {
  return runProcess(command, args, { timeoutMs: 8000 });
}

function runGraphifyBuildProcess(
  command: string,
  args: string[],
  options: GraphifyBuildProcessOptions,
): Promise<GraphifyBuildProcessResult> {
  return runProcess(command, args, {
    cwd: options.cwd,
    timeoutMs: 30 * 60 * 1000,
    env: options.env,
  });
}

function runProcess(
  command: string,
  args: string[],
  options: {
    cwd?: string;
    timeoutMs: number;
    env?: Record<string, string>;
  },
): Promise<GraphifyCommandResult> {
  return new Promise((resolveProcess) => {
    let stdout = '';
    let stderr = '';
    let settled = false;
  const child = spawnProcess(command, args, {
      cwd: options.cwd,
      shell: false,
      windowsHide: true,
      env: options.env ? { ...process.env, ...options.env } : process.env,
    });
    const timeout = setTimeout(() => {
      if (!settled) {
        stderr += `\nProcess timed out after ${options.timeoutMs}ms.`;
        child.kill();
      }
    }, options.timeoutMs);

    child.stdout?.on('data', (chunk) => {
      stdout += String(chunk);
    });
    child.stderr?.on('data', (chunk) => {
      stderr += String(chunk);
    });
    child.on('error', (err) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      resolveProcess({
        exitCode: 1,
        stdout,
        stderr: stderr || err.message,
      });
    });
    child.on('close', (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      resolveProcess({
        exitCode: code ?? 1,
        stdout,
        stderr,
      });
    });
  });
}

type EncryptedSettingValue =
  | {
      version: 1;
      scheme: 'electron-safe-storage';
      cipherText: string;
    }
  | {
      version: 1;
      scheme: 'aes-256-gcm';
      cipherText: string;
      iv: string;
      authTag: string;
    };

type OpenRouterModel = {
  id: string;
  name: string;
  contextLength: number | null;
  promptPrice: string | null;
  completionPrice: string | null;
};

type RecallMemoryContextInput = {
  queryText?: unknown;
  limit?: unknown;
  topMatchLimit?: unknown;
  detailExpansionLimit?: unknown;
  relatedLimit?: unknown;
  proactiveLimit?: unknown;
};

type RecallMemoryContextResult = {
  memoryContext: string;
  totalCandidates: number;
  topMatches: number;
  expandedDetails: number;
};

function createWindow() {
  win = new BrowserWindow({
    title: 'The Vault',
    icon: join(publicPath, 'vault-icon.png'),
    width: 1200,
    height: 800,
    minWidth: 720,
    minHeight: 560,
    resizable: true,
    maximizable: true,
    fullscreenable: true,
    titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : 'default',
    autoHideMenuBar: true, // Windows hide menu bar
    backgroundColor: '#020617', // Match dark OLED aesthetic (slate-950)
    webPreferences: {
      preload: join(__dirname, 'preload.mjs'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  // Grant microphone access for the Spark voice runtime. Without an explicit
  // handler Electron denies getUserMedia, so mic capture silently produces no
  // audio (the visualizer stays "Audio inactive" and no utterance ever reaches
  // STT). We grant only audio/media to the app's own renderer and deny the rest.
  const isMediaPermission = (permission: string): boolean =>
    permission === 'media' || permission === 'audioCapture' || permission === 'microphone';
  win.webContents.session.setPermissionRequestHandler((_wc, permission, callback) => {
    callback(isMediaPermission(permission));
  });
  win.webContents.session.setPermissionCheckHandler((_wc, permission) => isMediaPermission(permission));

  // Test active push message to Renderer-process.
  win.webContents.on('did-finish-load', () => {
    win?.webContents.send('main-process-message', (new Date).toLocaleString());
  });

  if (VITE_DEV_SERVER_URL) {
    win.loadURL(VITE_DEV_SERVER_URL);
    win.webContents.openDevTools();
  } else {
    win.loadFile(join(rendererPath, 'index.html'));
  }
}

function getFallbackSecretKey(): Buffer {
  const secretSeed = [
    app.getPath('userData'),
    process.env.USERNAME || '',
    process.env.COMPUTERNAME || '',
  ].join('|');

  const salt = createHash('sha256')
    .update('the-vault-settings-salt')
    .digest();

  return scryptSync(secretSeed, salt, 32);
}

function encryptSecret(value: string): EncryptedSettingValue | '' {
  if (!value) {
    return '';
  }

  if (safeStorage.isEncryptionAvailable()) {
    return {
      version: 1,
      scheme: 'electron-safe-storage',
      cipherText: safeStorage.encryptString(value).toString('base64'),
    };
  }

  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', getFallbackSecretKey(), iv);
  const cipherText = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()]);
  const authTag = cipher.getAuthTag();

  return {
    version: 1,
    scheme: 'aes-256-gcm',
    cipherText: cipherText.toString('base64'),
    iv: iv.toString('base64'),
    authTag: authTag.toString('base64'),
  };
}

function decryptSecret(value: unknown): string {
  if (!value) {
    return '';
  }

  if (typeof value === 'string') {
    return value;
  }

  if (
    typeof value !== 'object' ||
    value === null ||
    !('scheme' in value) ||
    !('cipherText' in value)
  ) {
    return '';
  }

  const encryptedValue = value as EncryptedSettingValue;

  try {
    if (encryptedValue.scheme === 'electron-safe-storage') {
      return safeStorage.decryptString(Buffer.from(encryptedValue.cipherText, 'base64'));
    }

    const decipher = createDecipheriv(
      'aes-256-gcm',
      getFallbackSecretKey(),
      Buffer.from(encryptedValue.iv, 'base64'),
    );
    decipher.setAuthTag(Buffer.from(encryptedValue.authTag, 'base64'));

    const plainText = Buffer.concat([
      decipher.update(Buffer.from(encryptedValue.cipherText, 'base64')),
      decipher.final(),
    ]);

    return plainText.toString('utf8');
  } catch (err) {
    console.error('[vault] decryptSecret failed:', err instanceof Error ? err.message : String(err));
    return '';
  }
}

/**
 * Resolve the OpenRouter API key with a fallback chain:
 *   1. VAULT_OPENROUTER_API_KEY env var
 *   2. electron-safe-storage / AES-GCM encrypted copy (openrouter_api_key)
 *   3. Portable AES-GCM encrypted copy (openrouter_api_key_portable)
 *
 * The portable blob is the cross-process share-line with the MCP server and
 * also the last-resort fallback if safeStorage can no longer decrypt (e.g.
 * DPAPI master key rotation on Windows).
 */
function resolveOpenRouterApiKey(): string {
  const envKey = (process.env.VAULT_OPENROUTER_API_KEY || '').trim();
  if (envKey) return envKey;

  const primary = getSecretSetting('openrouter_api_key').trim();
  if (primary) return primary;

  const portableBlob = vault.getSetting('openrouter_api_key_portable');
  if (portableBlob) {
    try {
      const portable = portableDecrypt(portableBlob, vault.getVaultRoot()).trim();
      if (portable) {
        console.warn('[vault] safeStorage decrypt failed or empty — using portable fallback for openrouter_api_key');
        return portable;
      }
    } catch (err) {
      console.error('[vault] portableDecrypt fallback failed:', err instanceof Error ? err.message : String(err));
    }
  }

  return '';
}

function getSecretSetting(key: string): string {
  const value = vault.getSetting(key);
  return decryptSecret(value);
}

function setSecretSetting(key: string, value: string): void {
  vault.setSetting(key, encryptSecret(value));

  // Mirror the OpenRouter key into the portable AES-GCM copy at save time,
  // so the fallback chain always has something to decrypt even if safeStorage
  // later fails (DPAPI rotation, packaging change, etc).
  if (key === 'openrouter_api_key' && value) {
    try {
      vault.setSetting(
        'openrouter_api_key_portable',
        portableEncrypt(value, vault.getVaultRoot()),
      );
    } catch (err) {
      console.error(
        '[vault] portable mirror failed:',
        err instanceof Error ? err.message : String(err),
      );
    }
  }
}

async function fetchOpenRouterJson<T>(url: string, apiKey: string): Promise<T> {
  const response = await fetch(url, {
    headers: {
      Authorization: `Bearer ${apiKey}`,
      Accept: 'application/json',
    },
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`OpenRouter request failed (${response.status}): ${errorText || response.statusText}`);
  }

  return response.json() as Promise<T>;
}

async function getOpenRouterModels(apiKey: string): Promise<OpenRouterModel[]> {
  const payload = await fetchOpenRouterJson<{
    data?: Array<{
      id: string;
      name?: string;
      context_length?: number;
      pricing?: {
        prompt?: string;
        completion?: string;
      };
      architecture?: {
        output_modalities?: string[];
      };
    }>;
  }>(OPENROUTER_MODELS_URL, apiKey);

  return (payload.data || [])
    .filter((model) => {
      const outputModalities = model.architecture?.output_modalities || ['text'];
      return outputModalities.includes('text');
    })
    .map((model) => ({
      id: model.id,
      name: model.name || model.id,
      contextLength: model.context_length ?? null,
      promptPrice: model.pricing?.prompt ?? null,
      completionPrice: model.pricing?.completion ?? null,
    }))
    .sort((left, right) => left.name.localeCompare(right.name));
}

async function testOpenRouterApiKey(apiKey: string): Promise<{
  label: string;
  limitRemaining: number | null;
  usage: number | null;
  isFreeTier: boolean;
}> {
  const payload = await fetchOpenRouterJson<{
    data?: {
      label?: string;
      limit_remaining?: number;
      usage?: number;
      is_free_tier?: boolean;
    };
  }>(OPENROUTER_CURRENT_KEY_URL, apiKey);

  return {
    label: payload.data?.label || 'Connected',
    limitRemaining: payload.data?.limit_remaining ?? null,
    usage: payload.data?.usage ?? null,
    isFreeTier: payload.data?.is_free_tier ?? false,
  };
}

async function executeVaultApiAgent(input: { prompt?: unknown; memoryContext?: unknown }): Promise<{
  provider: 'openrouter';
  model: string;
  durationMs: number;
  output: string;
  usage: {
    promptTokens: number;
    completionTokens: number;
  };
}> {
  const prompt = typeof input?.prompt === 'string' ? input.prompt.trim() : '';
  if (!prompt) {
    throw new Error('Prompt is required.');
  }

  const apiKey = resolveOpenRouterApiKey();
  const model = String(vault.getSetting('enrichment_model') || '').trim();
  const enrichmentEnabled = Boolean(vault.getSetting('enrichment_enabled'));

  if (!apiKey || !model) {
    throw new Error('Configure an OpenRouter API key and enrichment model in Settings first.');
  }

  if (!enrichmentEnabled) {
    throw new Error('Enable enrichment in Settings before using the Vault API backend.');
  }

  const memoryContext = typeof input?.memoryContext === 'string' ? input.memoryContext.trim() : '';
  const client = new OpenRouterClient(apiKey, model);
  const startedAt = Date.now();
  const result = await client.complete({
    systemPrompt: [
      'You are the Vault agent for a local-first memory system.',
      'Answer concisely and operationally.',
      'Use the provided Vault memory context when it is relevant.',
      'Do not invent tool calls or claim you changed files unless the user explicitly asked for analysis only.',
    ].join(' '),
    userPrompt: [
      memoryContext ? `Vault memory context:\n${memoryContext}` : '',
      `User request:\n${prompt}`,
    ].filter(Boolean).join('\n\n'),
    maxTokens: 700,
    temperature: 0.25,
    timeoutMs: 30000,
  });

  return {
    provider: 'openrouter',
    model: result.model || model,
    durationMs: Date.now() - startedAt,
    output: result.text,
    usage: result.usage,
  };
}

async function buildRecallMemoryContext(input: RecallMemoryContextInput): Promise<RecallMemoryContextResult> {
  const queryText = typeof input?.queryText === 'string' ? input.queryText.trim() : '';

  if (!queryText) {
    return {
      memoryContext: '',
      totalCandidates: 0,
      topMatches: 0,
      expandedDetails: 0,
    };
  }

  const recallSettings = getRecallPackingSettings();
  const recallQuery: RecallQuery = {
    queryText,
    limit: clampPositiveInteger(input?.limit, recallSettings.limit, 1, 12),
  };
  const topMatchLimit = clampPositiveInteger(input?.topMatchLimit, recallSettings.topMatchLimit, 1, 8);
  const detailExpansionLimit = clampPositiveInteger(input?.detailExpansionLimit, recallSettings.detailExpansionLimit, 0, 4);
  const relatedLimit = clampPositiveInteger(input?.relatedLimit, recallSettings.relatedLimit, 0, 4);
  const proactiveLimit = clampPositiveInteger(input?.proactiveLimit, recallSettings.proactiveLimit, 0, 4);

  const pack = await vault.recallContext(recallQuery);
  const topMatches = pack.topMatches.slice(0, topMatchLimit);

  if (topMatches.length === 0) {
    return {
      memoryContext: '',
      totalCandidates: pack.totalCandidates,
      topMatches: 0,
      expandedDetails: 0,
    };
  }

  const detailUids = topMatches
    .slice(0, detailExpansionLimit)
    .map((match) => match.item.itemUid);
  const detailEntries = await Promise.all(
    detailUids.map(async (uid) => {
      const detail = vault.getMemoryDetail(uid);
      return detail ? [uid, detail] as const : null;
    }),
  );

  const details = new Map<string, MemoryItemDetail>();
  for (const entry of detailEntries) {
    if (entry) {
      details.set(entry[0], entry[1]);
    }
  }

  return {
    memoryContext: formatCompactRecallContext(pack, details, {
      topMatchLimit,
      relatedLimit,
      proactiveLimit,
    }),
    totalCandidates: pack.totalCandidates,
    topMatches: topMatches.length,
    expandedDetails: details.size,
  };
}

function formatCompactRecallContext(
  pack: MemoryPack,
  details: Map<string, MemoryItemDetail>,
  limits: {
    topMatchLimit: number;
    relatedLimit: number;
    proactiveLimit: number;
  },
): string {
  const items = pack.topMatches.slice(0, limits.topMatchLimit);

  if (items.length === 0) {
    return '';
  }

  const related = pack.related.slice(0, limits.relatedLimit);
  const proactive = pack.proactive.slice(0, limits.proactiveLimit);
  const openLoops = (pack.openLoops || []).slice(0, 5);
  const detailSections = items
    .map((match) => details.get(match.item.itemUid))
    .filter((detail): detail is MemoryItemDetail => Boolean(detail))
    .map((detail) => {
      const nextSteps = detail.nextSteps.slice(0, 2).join(' | ');
      const relatedFiles = detail.relatedFiles.slice(0, 3).join(' | ');
      const contentSnippet = detail.content
        ? collapseText(detail.content, 220)
        : '';

      return [
        `- ${detail.title} [${detail.itemUid}]`,
        `  summary: ${collapseText(detail.summary, 180)}`,
        nextSteps ? `  next_steps: ${nextSteps}` : '',
        relatedFiles ? `  files: ${relatedFiles}` : '',
        contentSnippet ? `  detail: ${contentSnippet}` : '',
      ]
        .filter(Boolean)
        .join('\n');
    });

  return [
    'Vault recall snapshot:',
    pack.contextSummary ? `Summary: ${pack.contextSummary}` : '',
    `Candidates scanned: ${pack.totalCandidates}`,
    ...items.map((match) => {
      const reasonText = match.reasons.length > 0 ? ` | why: ${match.reasons.join(', ')}` : '';
      return `- ${match.item.title} [${match.item.project}] (${match.item.memoryType}, ${match.score.toFixed(1)}) :: ${collapseText(match.item.summary, 140)}${reasonText}`;
    }),
    related.length > 0 ? 'Related cues:' : '',
    ...related.map((item) => `- ${item.title} [${item.project}] :: ${collapseText(item.summary, 120)}`),
    proactive.length > 0 ? 'Proactive cues:' : '',
    ...proactive.map((item) => `- ${item.title} [${item.project}] :: ${collapseText(item.summary, 120)}`),
    openLoops.length > 0 ? 'Open loops (surface these to the user before answering — confirm if pending, resolve if done):' : '',
    ...openLoops.map((loop) => {
      const next = loop.nextSteps.slice(0, 1).join(' | ');
      const nextHint = next ? ` next: ${collapseText(next, 100)}` : '';
      return `- [${loop.bucket}] ${loop.title} [${loop.project}] (${loop.daysOpen}d, score ${loop.score}) :: ${collapseText(loop.summary, 110)} | uid: ${loop.itemUid}${nextHint}`;
    }),
    detailSections.length > 0 ? 'Expanded details:' : '',
    ...detailSections,
  ]
    .filter(Boolean)
    .join('\n');
}

function clampPositiveInteger(value: unknown, fallback: number, min: number, max: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return fallback;
  }

  return Math.max(min, Math.min(max, Math.floor(value)));
}

function getRecallPackingSettings(): {
  limit: number;
  topMatchLimit: number;
  detailExpansionLimit: number;
  relatedLimit: number;
  proactiveLimit: number;
} {
  return {
    limit: readNumberSetting('recall_compact_limit', DEFAULT_RECALL_CONTEXT_LIMIT),
    topMatchLimit: readNumberSetting('recall_top_match_limit', DEFAULT_RECALL_TOP_MATCH_LIMIT),
    detailExpansionLimit: readNumberSetting('recall_detail_expansion_limit', DEFAULT_RECALL_DETAIL_EXPANSION_LIMIT),
    relatedLimit: readNumberSetting('recall_related_limit', DEFAULT_RECALL_SIDE_CHANNEL_LIMIT),
    proactiveLimit: readNumberSetting('recall_proactive_limit', DEFAULT_RECALL_SIDE_CHANNEL_LIMIT),
  };
}

function readNumberSetting(key: string, fallback: number): number {
  const value = vault.getSetting(key);
  return typeof value === 'number' && Number.isFinite(value)
    ? value
    : fallback;
}

function collapseText(text: string, maxLength: number): string {
  const collapsed = text.replace(/\s+/g, ' ').trim();
  return collapsed.length > maxLength
    ? `${collapsed.slice(0, Math.max(maxLength - 3, 0)).trimEnd()}...`
    : collapsed;
}

type VaultStructureNode = {
  name: string;
  relativePath: string;
  nodeType: 'directory' | 'file';
  fileKind?: 'memory' | 'database' | 'log' | 'image' | 'other';
  size?: number | null;
  modifiedAt?: string | null;
  children?: VaultStructureNode[];
};

async function getVaultStructure(): Promise<{
  root: string;
  totalDirectories: number;
  totalFiles: number;
  memoryFiles: number;
  logFiles: number;
  nodes: VaultStructureNode[];
}> {
  const root = vault.getVaultRoot();
  const counters = {
    totalDirectories: 0,
    totalFiles: 0,
    memoryFiles: 0,
    logFiles: 0,
  };

  const nodes = await readVaultDirectory(root, '', counters, 0);
  return {
    root,
    ...counters,
    nodes,
  };
}

async function readVaultDirectory(
  absoluteDir: string,
  relativeDir: string,
  counters: { totalDirectories: number; totalFiles: number; memoryFiles: number; logFiles: number },
  depth: number,
): Promise<VaultStructureNode[]> {
  if (depth > 6) {
    return [];
  }

  const entries = await readdir(absoluteDir, { withFileTypes: true });
  const visibleEntries = entries
    .filter((entry) => !entry.name.startsWith('.'))
    .sort((left, right) => {
      if (left.isDirectory() !== right.isDirectory()) {
        return left.isDirectory() ? -1 : 1;
      }
      return left.name.localeCompare(right.name);
    });

  const nodes: VaultStructureNode[] = [];
  for (const entry of visibleEntries) {
    const absolutePath = join(absoluteDir, entry.name);
    const relativePath = relativeDir ? `${relativeDir}/${entry.name}` : entry.name;
    const entryStat = await stat(absolutePath);

    if (entry.isDirectory()) {
      counters.totalDirectories += 1;
      nodes.push({
        name: entry.name,
        relativePath,
        nodeType: 'directory',
        modifiedAt: entryStat.mtime.toISOString(),
        children: await readVaultDirectory(absolutePath, relativePath, counters, depth + 1),
      });
      continue;
    }

    const fileKind = getVaultFileKind(relativePath);
    counters.totalFiles += 1;
    if (fileKind === 'memory') {
      counters.memoryFiles += 1;
    }
    if (fileKind === 'log') {
      counters.logFiles += 1;
    }

    nodes.push({
      name: entry.name,
      relativePath,
      nodeType: 'file',
      fileKind,
      size: entryStat.size,
      modifiedAt: entryStat.mtime.toISOString(),
    });
  }

  return nodes;
}

function getVaultFileKind(relativePath: string): 'memory' | 'database' | 'log' | 'image' | 'other' {
  const normalized = relativePath.replace(/\\/g, '/').toLowerCase();
  if (isImageFilePath(normalized)) {
    return 'image';
  }
  if (normalized.endsWith('.md')) {
    return 'memory';
  }
  if (normalized.endsWith('.db') || normalized.endsWith('.sqlite') || normalized.endsWith('.sqlite3')) {
    return 'database';
  }
  if (normalized.includes('/logs/') || normalized.endsWith('.jsonl') || normalized.endsWith('.log')) {
    return 'log';
  }
  return 'other';
}

function resolveVaultFilePath(relativePathInput: unknown): { root: string; relativePath: string; absolutePath: string } {
  const inputValue = typeof relativePathInput === 'string' ? relativePathInput.trim() : '';
  if (!inputValue) {
    throw new Error('A vault-relative file path is required.');
  }

  const root = vault.getVaultRoot();
  const normalizedInput = inputValue.replace(/\\/g, '/');
  const absolutePath = isAbsolute(normalizedInput)
    ? resolve(normalizedInput)
    : resolve(root, normalizedInput.replace(/^\/+/, ''));
  const relativeToRoot = relative(root, absolutePath).replace(/\\/g, '/');

  if (!relativeToRoot || relativeToRoot.startsWith('..')) {
    throw new Error('Requested file path is outside the vault root.');
  }

  return {
    root,
    relativePath: relativeToRoot,
    absolutePath,
  };
}

async function readVaultFilePreview(relativePathInput: unknown): Promise<{
  root: string;
  relativePath: string;
  absolutePath: string;
  size: number;
  modifiedAt: string;
  content: string;
  truncated: boolean;
  mediaType: string | null;
  imageDataUrl: string | null;
  isBinary: boolean;
}> {
  const resolvedFile = resolveVaultFilePath(relativePathInput);
  const fileStat = await stat(resolvedFile.absolutePath);

  if (!fileStat.isFile()) {
    throw new Error('Selected vault path is not a file.');
  }

  const mediaType = getMediaTypeFromPath(resolvedFile.absolutePath);
  const fileKind = getVaultFileKind(resolvedFile.relativePath);
  const fileBuffer = await readFile(resolvedFile.absolutePath);
  const maxChars = 50000;

  if (mediaType?.startsWith('image/')) {
    return {
      root: resolvedFile.root,
      relativePath: resolvedFile.relativePath,
      absolutePath: resolvedFile.absolutePath,
      size: fileStat.size,
      modifiedAt: fileStat.mtime.toISOString(),
      content: '[Image preview available]',
      truncated: false,
      mediaType,
      imageDataUrl: `data:${mediaType};base64,${fileBuffer.toString('base64')}`,
      isBinary: true,
    };
  }

  if (fileKind === 'database') {
    return {
      root: resolvedFile.root,
      relativePath: resolvedFile.relativePath,
      absolutePath: resolvedFile.absolutePath,
      size: fileStat.size,
      modifiedAt: fileStat.mtime.toISOString(),
      content: '[Binary database preview unavailable]',
      truncated: false,
      mediaType,
      imageDataUrl: null,
      isBinary: true,
    };
  }

  const rawContent = fileBuffer.toString('utf8');
  return {
    root: resolvedFile.root,
    relativePath: resolvedFile.relativePath,
    absolutePath: resolvedFile.absolutePath,
    size: fileStat.size,
    modifiedAt: fileStat.mtime.toISOString(),
    content: rawContent.slice(0, maxChars),
    truncated: rawContent.length > maxChars,
    mediaType,
    imageDataUrl: null,
    isBinary: false,
  };
}

function isImageFilePath(filePath: string): boolean {
  return ['.png', '.jpg', '.jpeg', '.webp', '.gif', '.bmp', '.svg'].includes(extname(filePath).toLowerCase());
}

function getMediaTypeFromPath(filePath: string): string | null {
  switch (extname(filePath).toLowerCase()) {
    case '.png':
      return 'image/png';
    case '.jpg':
    case '.jpeg':
      return 'image/jpeg';
    case '.webp':
      return 'image/webp';
    case '.gif':
      return 'image/gif';
    case '.bmp':
      return 'image/bmp';
    case '.svg':
      return 'image/svg+xml';
    case '.md':
      return 'text/markdown';
    case '.json':
    case '.jsonl':
      return 'application/json';
    case '.txt':
    case '.log':
      return 'text/plain';
    default:
      return null;
  }
}

function resolveSkillFile(relativePathInput: unknown): { absolutePath: string; relativePath: string; filename: string } {
  const relativePathValue = typeof relativePathInput === 'string' ? relativePathInput.trim() : '';
  if (!relativePathValue) {
    throw new Error('Skill file path is required.');
  }

  const normalizedRelativePath = relativePathValue
    .replace(/\\/g, '/')
    .replace(/^skills\//, '');
  const absolutePath = resolve(skillsPath, normalizedRelativePath);
  const relativeToSkills = relative(skillsPath, absolutePath).replace(/\\/g, '/');

  if (!relativeToSkills || relativeToSkills.startsWith('..')) {
    throw new Error('Skill file path is outside the allowed skills directory.');
  }

  if (!relativeToSkills.endsWith('.md')) {
    throw new Error('Only Markdown skill files can be read from Settings.');
  }

  return {
    absolutePath,
    relativePath: `skills/${relativeToSkills}`,
    filename: basename(absolutePath),
  };
}

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    taskExecutor.stop();
    disposeGraphifyAutoBuild();
    vault.close();
    app.quit();
  }
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow();
  }
});

app.whenReady().then(() => {
  registerGraphifyArtifactProtocol();
  syncGraphifyAutoBuildWatchers();
  createWindow();

  // IPC Handlers — Expose Vault methods

  ipcMain.handle('spark:getSnapshot', async () => {
    try {
      return { success: true, data: await sparkExtensionSettings.getSnapshot() };
    } catch (e: any) {
      return { success: false, error: e.message };
    }
  });

  ipcMain.handle('spark:executeAction', async (_, input) => {
    try {
      return { success: true, data: await sparkExtensionSettings.executeAction(input) };
    } catch (e: any) {
      return { success: false, error: e.message };
    }
  });

  // S2 provider credential channels. Dedicated to secret handling — keys are
  // written into the encrypted store and only credential STATE is returned.
  // These never flow through executeAction (which strips secrets).
  ipcMain.handle('spark:setProviderCredential', async (_, providerId, key, baseUrl) => {
    try {
      return {
        success: true,
        data: sparkProviderCredentials.setProviderCredential(providerId, key, baseUrl ?? undefined),
      };
    } catch (e: any) {
      return { success: false, error: e.message };
    }
  });

  ipcMain.handle('spark:getProviderCredentialState', async (_, providerId) => {
    try {
      return { success: true, data: sparkProviderCredentials.getProviderCredentialState(providerId) };
    } catch (e: any) {
      return { success: false, error: e.message };
    }
  });

  ipcMain.handle('spark:setRoleAssignment', async (_, role, providerId) => {
    try {
      return { success: true, data: sparkProviderCredentials.setRoleAssignment(role, providerId) };
    } catch (e: any) {
      return { success: false, error: e.message };
    }
  });

  ipcMain.handle('spark:getRoleAssignments', async () => {
    try {
      return { success: true, data: sparkProviderCredentials.getRoleAssignments() };
    } catch (e: any) {
      return { success: false, error: e.message };
    }
  });

  // S3 voice runtime channels. The host owns the VoiceSession; events flow back
  // to the renderer via win.webContents.send('spark:voice:event', ...).
  ipcMain.handle('spark:voice:getReadiness', async () => {
    try {
      return { success: true, data: sparkVoiceHost.getReadiness() };
    } catch (e: any) {
      return { success: false, error: e.message };
    }
  });

  ipcMain.handle('spark:voice:start', async () => {
    try {
      return { success: true, data: await sparkVoiceHost.start() };
    } catch (e: any) {
      return { success: false, error: e.message };
    }
  });

  ipcMain.handle('spark:voice:stop', async () => {
    try {
      sparkVoiceHost.stop();
      return { success: true, data: { status: sparkVoiceHost.getStatus() } };
    } catch (e: any) {
      return { success: false, error: e.message };
    }
  });

  ipcMain.handle('spark:voice:sendText', async (_, text: string) => {
    try {
      await sparkVoiceHost.sendText(String(text ?? ''));
      return { success: true, data: { status: sparkVoiceHost.getStatus() } };
    } catch (e: any) {
      return { success: false, error: e.message };
    }
  });

  ipcMain.handle('spark:voice:audioUtterance', async (_, payload: { data: ArrayBuffer | Uint8Array; mimeType: string }) => {
    try {
      const data = payload.data instanceof Uint8Array ? payload.data : new Uint8Array(payload.data);
      await sparkVoiceHost.pushAudioUtterance({ data, mimeType: payload.mimeType });
      return { success: true, data: { status: sparkVoiceHost.getStatus() } };
    } catch (e: any) {
      return { success: false, error: e.message };
    }
  });

  // Realtime mic PCM stream (base64 16kHz mono) — fire-and-forget uplink.
  ipcMain.on('spark:voice:pcm', (_, base64Pcm: string) => {
    if (typeof base64Pcm === 'string' && base64Pcm.length > 0) {
      sparkVoiceHost.pushPcmChunk(base64Pcm);
    }
  });

  // Fire-and-forget level/level/playback signals — use `.on` (no response).
  ipcMain.on('spark:voice:audioLevel', (_, level: number, ts?: number) => {
    sparkVoiceHost.pushAudioLevel(Number(level) || 0, ts);
  });

  ipcMain.on('spark:voice:playbackEnded', () => {
    sparkVoiceHost.notifyPlaybackEnded();
  });


  ipcMain.handle('vault:status', async () => {
    const vaultRoot = vault.getVaultRoot();
    let directorySize = null;

    try {
      directorySize = await getDirectorySizeSummary(vaultRoot);
    } catch (err) {
      console.warn('[vault] directory size unavailable:', err instanceof Error ? err.message : String(err));
    }

    return {
      initialized: vault.isInitialized(),
      root: vaultRoot,
      workspaceRoot: process.cwd(),
      projects: vault.listProjects(),
      appVersion: app.getVersion(),
      directorySize,
    };
  });

  ipcMain.handle('vault:getProjectsMomentum', () => {
    try {
      return { success: true, data: vault.getProjectsMomentum() };
    } catch (e: any) {
      return { success: false, error: e.message };
    }
  });

  ipcMain.handle('vault:getOpenLoops', (_, project?: string) => {
    try {
      const projectArg = typeof project === 'string' && project.trim().length > 0 ? project : undefined;
      return { success: true, data: vault.getOpenLoops(projectArg) };
    } catch (e: any) {
      return { success: false, error: e.message };
    }
  });

  ipcMain.handle('vault:createProject', (_, name, description) => {
    try {
      return { success: true, data: vault.createProject(String(name || '').trim(), typeof description === 'string' ? description : undefined) };
    } catch (e: any) {
      return { success: false, error: e.message };
    }
  });

  ipcMain.handle('vault:saveMemory', (_, input) => {
    try {
      return { success: true, data: vault.saveMemory(input) };
    } catch (e: any) {
      return { success: false, error: e.message };
    }
  });

  ipcMain.handle('vault:findMemory', (_, query) => {
    try {
      return { success: true, data: vault.findMemory(query) };
    } catch (e: any) {
      return { success: false, error: e.message };
    }
  });

  ipcMain.handle('vault:recallContext', async (_, query) => {
    try {
      return { success: true, data: await vault.recallContext(query) };
    } catch (e: any) {
      return { success: false, error: e.message };
    }
  });

  ipcMain.handle('vault:buildRecallMemoryContext', async (_, input) => {
    try {
      return { success: true, data: await buildRecallMemoryContext(input) };
    } catch (e: any) {
      return { success: false, error: e.message };
    }
  });

  ipcMain.handle('vault:listProjectWorkspaces', () => {
    try {
      return { success: true, data: vault.listProjectWorkspaces() };
    } catch (e: any) {
      return { success: false, error: e.message };
    }
  });

  ipcMain.handle('vault:getProjectWorkspace', (_, project) => {
    try {
      return { success: true, data: vault.getProjectWorkspace(String(project || '')) };
    } catch (e: any) {
      return { success: false, error: e.message };
    }
  });

  ipcMain.handle('vault:setProjectWorkspace', (_, input) => {
    try {
      return { success: true, data: vault.setProjectWorkspace(input) };
    } catch (e: any) {
      return { success: false, error: e.message };
    }
  });

  ipcMain.handle('vault:removeProjectWorkspace', (_, project) => {
    try {
      return { success: true, data: vault.removeProjectWorkspace(String(project || '')) };
    } catch (e: any) {
      return { success: false, error: e.message };
    }
  });

  ipcMain.handle('vault:validateWorkspacePath', (_, workspacePath) => {
    try {
      return { success: true, data: vault.validateWorkspacePath(String(workspacePath || '')) };
    } catch (e: any) {
      return { success: false, error: e.message };
    }
  });

  ipcMain.handle('vault:buildProjectContextPack', async (_, input) => {
    try {
      return { success: true, data: await vault.buildProjectContextPack(input) };
    } catch (e: any) {
      return { success: false, error: e.message };
    }
  });

  ipcMain.handle('vault:getLatest', (_, project, limit) => {
    try {
      return { success: true, data: vault.getLatest(project, limit) };
    } catch (e: any) {
      return { success: false, error: e.message };
    }
  });

  ipcMain.handle('vault:getMemoryDetail', (_, uid) => {
    try {
      return { success: true, data: vault.getMemoryDetail(uid) };
    } catch (e: any) {
      return { success: false, error: e.message };
    }
  });

  ipcMain.handle('vault:suggestSavePath', (_, project, memoryType, title) => {
    try {
      return { success: true, data: vault.suggestSavePath(project, memoryType, title) };
    } catch (e: any) {
      return { success: false, error: e.message };
    }
  });

  ipcMain.handle('vault:detectSimilarMemories', async (_, input) => {
    try {
      const project = typeof input?.project === 'string' ? input.project.trim() : '';
      const title = typeof input?.title === 'string' ? input.title.trim() : '';
      const subject = typeof input?.subject === 'string' ? input.subject.trim() : '';
      const summary = typeof input?.summary === 'string' ? input.summary.trim() : '';
      const limit = typeof input?.limit === 'number' ? Math.max(1, Math.min(20, input.limit)) : 6;
      const candidateLimit = Math.max(limit * 6, 40);
      const queryText = [title, subject, summary].filter(Boolean).join('\n');

      if (!queryText) {
        return { success: true, data: [] };
      }

      const matches = vault
        .findMemory({
          project: project || undefined,
          limit: candidateLimit,
        })
        .filter((item) => item.status !== 'archived');
      const duplicates = await detectDuplicates(
        queryText,
        matches.map((item) => ({
          itemUid: item.itemUid,
          summary: [item.title, item.subject, item.summary].filter(Boolean).join('\n'),
        })),
      );
      const matchMap = new Map(matches.map((item) => [item.itemUid, item]));

      return {
        success: true,
        data: duplicates
          .map((duplicate: { itemUid: string; similarity: number }) => {
            const item = matchMap.get(duplicate.itemUid);
            if (!item) {
              return null;
            }

            return {
              itemUid: item.itemUid,
              title: item.title,
              project: item.project,
              memoryType: item.memoryType,
              subject: item.subject,
              summary: item.summary,
              similarity: duplicate.similarity,
            };
          })
          .filter((item): item is {
            itemUid: string;
            title: string;
            project: string;
            memoryType: typeof matches[number]['memoryType'];
            subject: string;
            summary: string;
            similarity: number;
          } => item !== null)
          .slice(0, limit),
      };
    } catch (e: any) {
      return { success: false, error: e.message };
    }
  });

  ipcMain.handle('vault:updateMemory', (_, uid, updates) => {
    try {
      return { success: true, data: vault.updateMemory(uid, updates) };
    } catch (e: any) {
      return { success: false, error: e.message };
    }
  });

  ipcMain.handle('vault:promoteMemory', (_, uid) => {
    try {
      return { success: true, data: vault.promoteMemory(uid) };
    } catch (e: any) {
      return { success: false, error: e.message };
    }
  });

  ipcMain.handle('vault:archiveMemory', (_, uid) => {
    try {
      return { success: true, data: vault.archiveMemory(uid) };
    } catch (e: any) {
      return { success: false, error: e.message };
    }
  });

  ipcMain.handle('vault:resolveLoop', (_, input) => {
    try {
      return { success: true, data: vault.resolveLoop(input) };
    } catch (e: any) {
      return { success: false, error: e.message };
    }
  });

  ipcMain.handle('vault:listProjectProposals', (_, query) => {
    try {
      return { success: true, data: vault.listProjectProposals(query) };
    } catch (e: any) {
      return { success: false, error: e.message };
    }
  });

  ipcMain.handle('vault:executeProjectReview', async (_, projectName, options) => {
    try {
      const project = typeof projectName === 'string' ? projectName.trim() : '';
      if (!project) {
        return { success: false, error: 'Project name is required' };
      }

      const normalizedOptions = options && typeof options === 'object'
        ? {
            force: (options as { force?: unknown }).force === true,
            dryRun: (options as { dryRun?: unknown }).dryRun === true,
          }
        : undefined;

      return { success: true, data: await vault.executeProjectReview(project, normalizedOptions) };
    } catch (e: any) {
      return { success: false, error: e.message };
    }
  });

  ipcMain.handle('vault:decideProjectProposal', (_, input) => {
    try {
      return { success: true, data: vault.decideProjectProposal(input) };
    } catch (e: any) {
      return { success: false, error: e.message };
    }
  });

  ipcMain.handle('vault:mergeProject', (_, sourceName, targetName, options) => {
    try {
      return { success: true, data: vault.mergeProject(sourceName, targetName, options) };
    } catch (e: any) {
      return { success: false, error: e.message };
    }
  });

  ipcMain.handle('vault:addProjectRelationship', (_, input) => {
    try {
      return { success: true, data: vault.addProjectRelationship(input) };
    } catch (e: any) {
      return { success: false, error: e.message };
    }
  });

  ipcMain.handle('vault:confirmMemoryDelete', (_, uid) => {
    try {
      return { success: true, data: vault.confirmMemoryDelete(uid) };
    } catch (e: any) {
      return { success: false, error: e.message };
    }
  });

  ipcMain.handle('vault:createTask', (_, input) => {
    try {
      const task = vault.createTask(input);
      win?.webContents.send('vault:taskEvent', {
        type: 'task-created',
        taskUid: task.taskUid,
        task,
        timestamp: new Date().toISOString(),
        message: `Created task: ${task.title}`,
      });
      return { success: true, data: task };
    } catch (e: any) {
      return { success: false, error: e.message };
    }
  });

  ipcMain.handle('vault:findTasks', (_, query) => {
    try {
      return { success: true, data: vault.findTasks(query) };
    } catch (e: any) {
      return { success: false, error: e.message };
    }
  });

  ipcMain.handle('vault:getTask', (_, taskUid) => {
    try {
      return { success: true, data: vault.getTask(taskUid) };
    } catch (e: any) {
      return { success: false, error: e.message };
    }
  });

  ipcMain.handle('vault:cancelTask', (_, taskUid) => {
    try {
      const task = vault.cancelTask(taskUid);
      if (task) {
        win?.webContents.send('vault:taskEvent', {
          type: 'task-cancelled',
          taskUid: task.taskUid,
          task,
          timestamp: new Date().toISOString(),
          message: `Cancelled task: ${task.title}`,
        });
      }
      return { success: true, data: task };
    } catch (e: any) {
      return { success: false, error: e.message };
    }
  });

  ipcMain.handle('vault:getTaskQueueStats', () => {
    try {
      return { success: true, data: vault.getTaskQueueStats() };
    } catch (e: any) {
      return { success: false, error: e.message };
    }
  });

  ipcMain.handle('vault:getTaskExecutorStatus', () => {
    try {
      return {
        success: true,
        data: {
          ...taskExecutor.getStatus(),
          queue: vault.getTaskQueueStats(),
        },
      };
    } catch (e: any) {
      return { success: false, error: e.message };
    }
  });

  ipcMain.handle('vault:startTaskExecutor', () => {
    try {
      return {
        success: true,
        data: {
          ...taskExecutor.start(),
          queue: vault.getTaskQueueStats(),
        },
      };
    } catch (e: any) {
      return { success: false, error: e.message };
    }
  });

  ipcMain.handle('vault:stopTaskExecutor', () => {
    try {
      return {
        success: true,
        data: {
          ...taskExecutor.stop(),
          queue: vault.getTaskQueueStats(),
        },
      };
    } catch (e: any) {
      return { success: false, error: e.message };
    }
  });

  ipcMain.handle('vault:getRecentLogs', (_, limit, filters) => {
    try {
      return { success: true, data: vault.getRecentLogs(limit, filters) };
    } catch (e: any) {
      return { success: false, error: e.message };
    }
  });

  ipcMain.handle('vault:getAllSettings', () => {
    try {
      return { success: true, data: vault.getAllSettings() };
    } catch (e: any) {
      return { success: false, error: e.message };
    }
  });

  ipcMain.handle('vault:setSetting', (_, key, value) => {
    try {
      vault.setSetting(key, value);
      return { success: true, data: true };
    } catch (e: any) {
      return { success: false, error: e.message };
    }
  });

  ipcMain.handle('vault:getSecretSetting', (_, key) => {
    try {
      return { success: true, data: getSecretSetting(key) };
    } catch (e: any) {
      return { success: false, error: e.message };
    }
  });

  ipcMain.handle('vault:setSecretSetting', (_, key, value) => {
    try {
      setSecretSetting(key, value);
      return { success: true, data: true };
    } catch (e: any) {
      return { success: false, error: e.message };
    }
  });

  ipcMain.handle('vault:getModelRoutingTable', () => {
    try {
      return { success: true, data: vault.getModelRoutingTable() };
    } catch (e: any) {
      return { success: false, error: e.message };
    }
  });

  ipcMain.handle('vault:setModelRoutingTable', (_, overrides) => {
    try {
      vault.setModelRoutingTable((overrides || {}) as Partial<ModelRoutingTable>);
      return { success: true, data: vault.getModelRoutingTable() };
    } catch (e: any) {
      return { success: false, error: e.message };
    }
  });

  ipcMain.handle('vault:refreshEnrichment', () => {
    try {
      const active = initializeEnrichment();
      return { success: true, data: { enrichmentActive: active } };
    } catch (e: any) {
      return { success: false, error: e.message };
    }
  });

  ipcMain.handle('vault:getGraphifyRuntimeConfig', () => {
    try {
      return { success: true, data: vault.getGraphifyRuntimeConfig() };
    } catch (e: any) {
      return { success: false, error: e.message };
    }
  });

  ipcMain.handle('vault:saveGraphifyRuntimeConfig', (_, input) => {
    try {
      return { success: true, data: vault.saveGraphifyRuntimeConfig(input || {}) };
    } catch (e: any) {
      return { success: false, error: e.message };
    }
  });

  ipcMain.handle('vault:detectGraphifyRuntime', async () => {
    try {
      const config = vault.getGraphifyRuntimeConfig();
      return {
        success: true,
        data: await vault.detectGraphifyRuntime({
          commandRunner: runGraphifyVersionCommand,
          graphifyCommand: resolveGraphifyCommandForRuntimeConfig(config),
        }),
      };
    } catch (e: any) {
      return { success: false, error: e.message };
    }
  });

  ipcMain.handle('vault:planGraphifyInstall', (_, input) => {
    try {
      const raw = input && typeof input === 'object' ? input as Record<string, unknown> : {};
      const availableTools = raw.availableTools && typeof raw.availableTools === 'object'
        ? raw.availableTools as Partial<GraphifyAvailableTools>
        : {};
      const config = vault.getGraphifyRuntimeConfig();
      return {
        success: true,
        data: vault.planGraphifyInstall({
          runtimeMode: raw.runtimeMode === 'path' || raw.runtimeMode === 'localSource' || raw.runtimeMode === 'managed'
            ? raw.runtimeMode
            : config.runtimeMode,
          availableTools: {
            python: Boolean(availableTools.python),
            uv: Boolean(availableTools.uv),
            pipx: Boolean(availableTools.pipx),
          },
          extras: Array.isArray(raw.extras) ? raw.extras.map(String) : config.installExtras,
          localSourcePath: typeof raw.localSourcePath === 'string' ? raw.localSourcePath : config.localSourceCheckoutPath,
        }),
      };
    } catch (e: any) {
      return { success: false, error: e.message };
    }
  });

  ipcMain.handle('vault:getGraphifyProjectStatus', (_, project) => {
    try {
      return { success: true, data: vault.getGraphifyProjectStatus(String(project || '')) };
    } catch (e: any) {
      return { success: false, error: e.message };
    }
  });

  ipcMain.handle('vault:setGraphifyProjectSourceRoot', (_, project, sourceRoot) => {
    try {
      const data = vault.setGraphifyProjectSourceRoot(String(project || ''), String(sourceRoot || ''));
      syncGraphifyAutoBuildWatchers();
      return { success: true, data };
    } catch (e: any) {
      return { success: false, error: e.message };
    }
  });

  ipcMain.handle('vault:chooseGraphifyProjectSourceRoot', async (_, project) => {
    try {
      const projectName = String(project || '').trim();
      const selection = await dialog.showOpenDialog({
        title: 'Choose Graphify source folder',
        properties: ['openDirectory'],
      });
      if (selection.canceled || selection.filePaths.length === 0) {
        return { success: true, data: null };
      }

      const data = vault.setGraphifyProjectSourceRoot(projectName, selection.filePaths[0]);
      syncGraphifyAutoBuildWatchers();
      return {
        success: true,
        data,
      };
    } catch (e: any) {
      return { success: false, error: e.message };
    }
  });

  ipcMain.handle('vault:setGraphifyProjectEnabled', (_, project, enabled) => {
    try {
      const data = vault.setGraphifyProjectEnabled(String(project || ''), Boolean(enabled));
      syncGraphifyAutoBuildWatchers();
      return { success: true, data };
    } catch (e: any) {
      return { success: false, error: e.message };
    }
  });

  ipcMain.handle('vault:getGraphifyBuildHistory', (_, project, limit) => {
    try {
      return { success: true, data: vault.getGraphifyBuildHistory(String(project || ''), clampPositiveInteger(limit, 8, 1, 50)) };
    } catch (e: any) {
      return { success: false, error: e.message };
    }
  });

  ipcMain.handle('vault:getGraphifyArtifacts', (_, project) => {
    try {
      return { success: true, data: vault.getGraphifyArtifacts(String(project || '')) };
    } catch (e: any) {
      return { success: false, error: e.message };
    }
  });

  ipcMain.handle('vault:getGraphifyHtmlArtifact', (_, project) => {
    try {
      return { success: true, data: vault.getGraphifyHtmlArtifact(String(project || '')) };
    } catch (e: any) {
      return { success: false, error: e.message };
    }
  });

  ipcMain.handle('vault:readGraphifyArtifactReport', (_, project, options) => {
    try {
      return { success: true, data: vault.readGraphifyArtifactReport(String(project || ''), options || undefined) };
    } catch (e: any) {
      return { success: false, error: e.message };
    }
  });

  ipcMain.handle('vault:getGraphifyArtifactUrl', (_, input) => {
    try {
      const request = parseGraphifyArtifactUrlRequest(input);
      const artifactPath = resolveGraphifyArtifactRequestPath(request);
      return {
        success: true,
        data: {
          url: buildGraphifyArtifactProtocolUrl(request),
          artifactPath,
        },
      };
    } catch (e: any) {
      return { success: false, error: e.message };
    }
  });

  ipcMain.handle('vault:buildGraphifyProjectGraph', async (_, input) => {
    try {
      const raw = input && typeof input === 'object' ? input as Record<string, unknown> : {};
      const project = String(raw.project || '').trim();
      const buildMode = raw.buildMode === 'full' || raw.buildMode === 'semantic' || raw.buildMode === 'fast'
        ? raw.buildMode
        : undefined;
      return {
        success: true,
        data: await vault.buildGraphifyProjectGraph(project, {
          buildMode,
          commandRunner: runGraphifyBuildProcess,
        }),
      };
    } catch (e: any) {
      return { success: false, error: e.message };
    }
  });

  ipcMain.handle('vault:openGraphifyArtifactFolder', async (_, project) => {
    try {
      const artifacts = vault.getGraphifyArtifacts(String(project || ''));
      const folder = artifacts.artifactRoot;
      if (!existsSync(folder)) {
        throw new Error('Graphify artifact folder does not exist yet. Choose a source folder and build the project graph first.');
      }
      const result = await shell.openPath(folder);
      if (result) {
        throw new Error(result);
      }
      return { success: true, data: folder };
    } catch (e: any) {
      return { success: false, error: e.message };
    }
  });

  ipcMain.handle('vault:exportGraphifyArtifacts', async (_, project) => {
    try {
      const artifacts = vault.getGraphifyArtifacts(String(project || ''));
      if (!artifacts.available) {
        throw new Error(artifacts.errorMessage || 'Graphify artifacts are not available.');
      }

      const selection = await dialog.showOpenDialog({
        title: 'Choose export folder for Graphify artifacts',
        properties: ['openDirectory', 'createDirectory'],
      });
      if (selection.canceled || selection.filePaths.length === 0) {
        return { success: true, data: null };
      }

      const targetRoot = selection.filePaths[0];
      const copied: string[] = [];
      await mkdir(targetRoot, { recursive: true });
      for (const sourcePath of Object.values(artifacts.artifactPaths)) {
        if (!sourcePath) continue;
        const safeSource = vault.resolveGraphifyArtifactPath(String(project || ''), sourcePath);
        const targetPath = join(targetRoot, basename(safeSource));
        await copyFile(safeSource, targetPath);
        copied.push(targetPath);
      }

      return { success: true, data: { targetRoot, copied } };
    } catch (e: any) {
      return { success: false, error: e.message };
    }
  });

  ipcMain.handle('vault:getVaultCollabRuntimeConfig', () => {
    try {
      return { success: true, data: vault.getVaultCollabRuntimeConfig() };
    } catch (e: any) {
      return { success: false, error: e.message };
    }
  });

  ipcMain.handle('vault:saveVaultCollabRuntimeConfig', (_, input) => {
    try {
      return { success: true, data: vault.saveVaultCollabRuntimeConfig((input || {}) as SaveVaultCollabRuntimeConfigInput) };
    } catch (e: any) {
      return { success: false, error: e.message };
    }
  });

  ipcMain.handle('vault:resetVaultCollabRuntimeConfig', () => {
    try {
      return { success: true, data: vault.resetVaultCollabRuntimeConfig() };
    } catch (e: any) {
      return { success: false, error: e.message };
    }
  });

  ipcMain.handle('vault:detectVaultCollabRuntime', () => {
    try {
      return { success: true, data: vault.detectVaultCollabRuntime() };
    } catch (e: any) {
      return { success: false, error: e.message };
    }
  });

  ipcMain.handle('vault:planVaultCollabInstall', () => {
    try {
      return { success: true, data: vault.planVaultCollabInstall() };
    } catch (e: any) {
      return { success: false, error: e.message };
    }
  });

  ipcMain.handle('vault:getVaultCollabDashboardSnapshot', (_, options) => {
    try {
      const input = options && typeof options === 'object' ? options as VaultCollabDashboardOptions : undefined;
      return { success: true, data: vault.getVaultCollabDashboardSnapshot(input) };
    } catch (e: any) {
      return { success: false, error: e.message };
    }
  });

  async function ensureVaultCollabDashboardActor(): Promise<VaultCollabDashboardActor> {
    if (vaultCollabDashboardActor) {
      return vaultCollabDashboardActor;
    }

    const registration = await executeVaultCollabDashboardSessionRegistration(
      getVaultCollabDashboardActionRuntimeConfig(),
      {
        project: 'the-vault',
        workspacePath: resolve(__dirname, '../../..'),
      },
    );
    vaultCollabDashboardActor = registration.actor;
    return registration.actor;
  }

  function parseVaultCollabAgentRequestInput(input: unknown): VaultCollabAgentRequestInput {
    const raw = input && typeof input === 'object' ? input as Record<string, unknown> : {};
    const project = typeof raw.project === 'string' ? raw.project.trim() : '';
    const workspacePath = typeof raw.workspacePath === 'string' ? raw.workspacePath.trim() : '';
    const role = typeof raw.role === 'string' ? raw.role.trim() : '';
    const instructions = typeof raw.instructions === 'string' ? raw.instructions.trim() : '';
    const provider = raw.provider === 'codex' || raw.provider === 'claude-code'
      ? raw.provider
      : null;

    if (!project) {
      throw new Error('Agent project is required.');
    }
    if (!workspacePath) {
      throw new Error('Agent workspace path is required.');
    }
    if (!role) {
      throw new Error('Agent role is required.');
    }
    if (!provider) {
      throw new Error('Provider must be codex or claude-code.');
    }
    if (!instructions) {
      throw new Error('Agent instructions are required.');
    }

    return { role, provider, instructions, project, workspacePath };
  }

  function getVaultCollabAgentRequestModel(provider: VaultCollabAgentRequestInput['provider']): string {
    return provider === 'codex' ? 'gpt-5-codex' : 'claude-code';
  }

  function getVaultCollabAgentRequestCommandPreview(
    provider: VaultCollabAgentRequestInput['provider'],
    workspacePath: string,
  ): string {
    return provider === 'codex'
      ? `codex --no-alt-screen -C "${workspacePath}" "[launch instructions]"`
      : `claude --add-dir "${workspacePath}" -- "[launch instructions]"`;
  }

  const eventTypeTokenSafety = {
    forbiddenPayloadKeys: [
      'sessionToken',
      'session_token',
      'ownerToken',
      'owner_token',
      'claimToken',
      'claim_token',
      'actorSessionToken',
      'actor_session_token',
    ],
    rules: [
      'Never include owner tokens, session tokens, or claim tokens in event payloads.',
      'Payloads may include stable UIDs, project labels, statuses, counts, thresholds, and redacted argument-key metadata.',
      'Tool events must never include raw arguments, raw results, or exception text that contains owner-token values.',
    ],
  };

  function createVaultCollabEventTypeSnapshot(
    canonicalName: string,
    namespace: string,
    summary: string,
    payloadShape: Record<string, unknown>,
    attention: VaultCollabEventTypeSnapshot['attention'] = { scope: 'none', itemKind: null, roleProfileIds: [] },
    legacyAliases: string[] = [],
  ): VaultCollabEventTypeSnapshot {
    return {
      canonicalName,
      namespace,
      summary,
      payloadShape,
      tokenSafety: eventTypeTokenSafety,
      attention,
      legacyAliases,
    };
  }

  function listVaultCollabEventTypeFallbacks(): VaultCollabEventTypeSnapshot[] {
    return [
      createVaultCollabEventTypeSnapshot('session.registered', 'session', 'A provider-neutral session joined a project.', {
        clientType: 'ClientType',
        project: 'string',
      }),
      createVaultCollabEventTypeSnapshot('session.state_updated', 'session', 'A session status/detail changed.', {
        status: 'SessionStatus',
        detail: 'string | null',
      }),
      createVaultCollabEventTypeSnapshot('session.cleanup', 'session', 'Inactive session records were removed from the roster.', {
        actorSessionUid: 'vc_sess_*',
        statuses: 'SessionStatus[]',
        deletedSessionCount: 'number',
        deletedCursorCount: 'number',
        deletedDeliveryAttemptCount: 'number',
      }),
      createVaultCollabEventTypeSnapshot('session.pinged', 'session', 'A passive soft ping targets a session.', {
        actorSessionUid: 'vc_sess_* | null',
        message: 'string | null',
      }, { scope: 'session', itemKind: 'session_ping', roleProfileIds: [] }),
      createVaultCollabEventTypeSnapshot('handoff.published', 'handoff', 'A handoff was published to an inbox.', {
        sourceProject: 'string',
        targetProject: 'string',
        priority: 'HandoffPriority',
      }),
      createVaultCollabEventTypeSnapshot('handoff.claimed', 'handoff', 'A session claimed available work.', {
        claimedBySessionUid: 'vc_sess_*',
      }),
      createVaultCollabEventTypeSnapshot('handoff.updated', 'handoff', 'Claimed handoff progress/status changed.', {
        status: 'HandoffStatus',
        progressNote: 'string',
      }),
      createVaultCollabEventTypeSnapshot('handoff.resolved', 'handoff', 'A claimed handoff completed.', {
        summary: 'string',
      }),
      createVaultCollabEventTypeSnapshot('tool.call_before', 'tool', 'An MCP tool call is about to run.', {
        toolName: 'string',
        argumentKeys: 'string[]',
        redactedArgumentKeys: 'string[]',
      }),
      createVaultCollabEventTypeSnapshot('tool.call_failure', 'tool', 'An MCP tool call failed.', {
        toolName: 'string',
        errorClass: 'string',
      }, { scope: 'project_role', itemKind: 'tool_failure', roleProfileIds: ['coordinator', 'runtime-loop-operator'] }),
      createVaultCollabEventTypeSnapshot('security.finding', 'security', 'A deterministic security scan finding needs review.', {
        project: 'string',
        severity: 'low | medium | high | critical',
        findingSummary: 'token-safe summary',
      }, { scope: 'project_role', itemKind: 'security_finding', roleProfileIds: ['coordinator', 'security-reviewer'] }),
      createVaultCollabEventTypeSnapshot('policy.violation', 'policy', 'A policy rule denied, gated, or rate-limited an action.', {
        policyPackName: 'string',
        enforcement: 'deny | require_approval | rate_limit',
        reason: 'string',
      }, { scope: 'project_role', itemKind: 'policy_notice', roleProfileIds: ['coordinator', 'security-reviewer'] }),
      createVaultCollabEventTypeSnapshot('policy.approved', 'policy', 'A coordinator-approved policy-gated action was accepted.', {
        actionType: 'string',
        decision: 'approved',
      }),
      createVaultCollabEventTypeSnapshot('loop.stall_detected', 'loop', 'A claimed handoff has not received progress for the configured threshold.', {
        handoffUid: 'vc_handoff_*',
        stalledForMs: 'number',
      }, { scope: 'project_role', itemKind: 'loop_stall', roleProfileIds: ['coordinator', 'runtime-loop-operator'] }),
    ];
  }

  function parsePolicyPackActionInput(input: unknown): VaultCollabPolicyPackActionInput {
    const raw = input && typeof input === 'object' ? input as Record<string, unknown> : {};
    const uid = typeof raw.uid === 'string' ? raw.uid.trim() : '';
    const name = typeof raw.name === 'string' ? raw.name.trim() : '';

    if (!uid && !name) {
      throw new Error('Policy pack UID or name is required.');
    }

    return {
      ...(uid ? { uid } : {}),
      ...(name ? { name } : {}),
    };
  }

  function normalizePolicyPackSnapshot(
    value: unknown,
    input: VaultCollabPolicyPackActionInput,
    active: boolean,
  ): VaultCollabPolicyPackSnapshot {
    const record = value && typeof value === 'object' ? value as Record<string, unknown> : {};
    const uid = typeof record.uid === 'string' ? record.uid : input.uid;
    const name = typeof record.name === 'string' ? record.name : input.name;
    if (!uid || !name) {
      throw new Error('Vault Collab policy action did not return a policy pack identifier.');
    }

    const rules = Array.isArray(record.rules) ? record.rules : [];
    const ruleCount = typeof record.ruleCount === 'number'
      ? record.ruleCount
      : rules.length;
    const builtIn = typeof record.builtIn === 'boolean'
      ? record.builtIn
      : Boolean(record.isBuiltin);

    return {
      uid,
      name,
      version: typeof record.version === 'string' ? record.version : '',
      active: typeof record.active === 'boolean' ? record.active : active,
      builtIn,
      ruleCount,
      updatedAt: typeof record.updatedAt === 'string'
        ? record.updatedAt
        : typeof record.createdAt === 'string'
          ? record.createdAt
          : new Date().toISOString(),
    };
  }

  ipcMain.handle('vault:performVaultCollabDashboardAction', async (_, input) => {
    try {
      const actor = await ensureVaultCollabDashboardActor();
      const data = await executeVaultCollabAction(
        getVaultCollabDashboardActionRuntimeConfig(),
        actor,
        (input || {}) as VaultCollabDashboardActionInput,
      ) as VaultCollabActionResult;
      return { success: data.ok, data, error: data.error || undefined };
    } catch (e: any) {
      return { success: false, error: e.message };
    }
  });

  ipcMain.handle('vault:listVaultCollabEventTypes', () => {
    try {
      return { success: true, data: listVaultCollabEventTypeFallbacks() };
    } catch (e: any) {
      return { success: false, error: e.message };
    }
  });

  ipcMain.handle('vault:activateVaultCollabPolicyPack', async (_, input) => {
    try {
      const request = parsePolicyPackActionInput(input);
      const actor = await ensureVaultCollabDashboardActor();
      const data = await executeVaultCollabAction(
        getVaultCollabDashboardActionRuntimeConfig(),
        actor,
        { kind: 'policy', action: 'activate_policy_pack', ...request },
      ) as VaultCollabActionResult;
      if (!data.ok) {
        throw new Error(data.error || 'Vault Collab policy pack activation failed.');
      }

      return { success: true, data: normalizePolicyPackSnapshot(data.data, request, true) };
    } catch (e: any) {
      return { success: false, error: e.message };
    }
  });

  ipcMain.handle('vault:deactivateVaultCollabPolicyPack', async (_, input) => {
    try {
      const request = parsePolicyPackActionInput(input);
      const actor = await ensureVaultCollabDashboardActor();
      const data = await executeVaultCollabAction(
        getVaultCollabDashboardActionRuntimeConfig(),
        actor,
        { kind: 'policy', action: 'deactivate_policy_pack', ...request },
      ) as VaultCollabActionResult;
      if (!data.ok) {
        throw new Error(data.error || 'Vault Collab policy pack deactivation failed.');
      }

      return { success: true, data: normalizePolicyPackSnapshot(data.data, request, false) };
    } catch (e: any) {
      return { success: false, error: e.message };
    }
  });

  ipcMain.handle('vault:requestVaultCollabAgent', async (_, input) => {
    try {
      const request = parseVaultCollabAgentRequestInput(input);
      const config = getVaultCollabDashboardActionRuntimeConfig();
      const actor = await ensureVaultCollabDashboardActor();
      const data = await executeVaultCollabAction(
        config,
        actor,
        {
          kind: 'launch',
          action: 'request',
          provider: request.provider,
          model: getVaultCollabAgentRequestModel(request.provider),
          effortLevel: request.provider === 'codex' ? 'medium' : null,
          project: request.project,
          workspacePath: request.workspacePath,
          role: request.role,
          initialInstructions: request.instructions,
          permissionMode: 'workspace-write',
          commandPreview: getVaultCollabAgentRequestCommandPreview(request.provider, request.workspacePath),
          requestedCapabilities: ['vault_collab', 'code_editing'],
          approvalPolicyVersion: 'dashboard-request-agent-v1',
          metadata: { source: 'dashboard' },
        },
      ) as VaultCollabActionResult;
      return { success: data.ok, data, error: data.error || undefined };
    } catch (e: any) {
      return { success: false, error: e.message };
    }
  });

  ipcMain.handle('vault:approveVaultCollabLaunchRequest', async (_, launchRequestUid) => {
    try {
      if (typeof launchRequestUid !== 'string' || !launchRequestUid.trim()) {
        throw new Error('Launch request UID is required.');
      }

      const config = getVaultCollabDashboardActionRuntimeConfig();
      const actor = await ensureVaultCollabDashboardActor();
      const snapshot = vault.getVaultCollabDashboardSnapshot({
        launchRequestLimit: 100,
        sessionLimit: 5,
        handoffLimit: 5,
        eventLimit: 5,
      });
      const launchRequest = snapshot.launchRequests.find((request) => request.launchRequestUid === launchRequestUid);
      if (!launchRequest) {
        throw new Error(`Launch request not found: ${launchRequestUid}`);
      }
      if (launchRequest.status !== 'requested') {
        throw new Error(`Launch request must be requested before approval. Current status: ${launchRequest.status}`);
      }

      const data = await approveVaultCollabLaunchRequest(config, actor, launchRequest);
      return { success: data.ok, data: data as VaultCollabLaunchApprovalResult, error: data.error || undefined };
    } catch (e: any) {
      return { success: false, error: e.message };
    }
  });

  ipcMain.handle('vault:getVaultCollabHandoffActions', async (_, handoffUid) => {
    try {
      if (typeof handoffUid !== 'string' || !handoffUid.trim()) {
        throw new Error('Handoff UID is required.');
      }

      const actor = await ensureVaultCollabDashboardActor();
      const data = await executeVaultCollabHandoffActions(
        getVaultCollabDashboardActionRuntimeConfig(),
        actor,
        handoffUid,
      );
      return { success: data.ok, data: data.data as VaultCollabHandoffActionSet | null, error: data.error || undefined };
    } catch (e: any) {
      return { success: false, error: e.message };
    }
  });

  ipcMain.handle('vault:startVaultCollabLaunchRequest', async (_, launchRequestUid) => {
    try {
      if (typeof launchRequestUid !== 'string' || !launchRequestUid.trim()) {
        throw new Error('Launch request UID is required.');
      }

      const config = getVaultCollabDashboardActionRuntimeConfig();
      const actor = await ensureVaultCollabDashboardActor();
      const snapshot = vault.getVaultCollabDashboardSnapshot({
        launchRequestLimit: 100,
        sessionLimit: 5,
        handoffLimit: 5,
        eventLimit: 5,
      });
      const launchRequest = snapshot.launchRequests.find((request) => request.launchRequestUid === launchRequestUid);
      if (!launchRequest) {
        throw new Error(`Launch request not found: ${launchRequestUid}`);
      }
      if (launchRequest.status !== 'approved') {
        throw new Error(`Launch request must be approved before The Vault can start it. Current status: ${launchRequest.status}`);
      }
      if (!existsSync(launchRequest.workspacePath)) {
        throw new Error(`Launch workspace does not exist: ${launchRequest.workspacePath}`);
      }

      const launchCommand = buildVaultCollabLaunchCommand(launchRequest);
      if (!isExperimentalManagedVaultCollabSpawnEnabled()) {
        if (process.platform === 'win32') {
          const launching = await executeVaultCollabAction(config, actor, {
            kind: 'launch',
            action: 'mark_launching',
            launchRequestUid,
            detail: 'The Vault opened an external PowerShell launch window for this request.',
          });
          if (!launching.ok) {
            throw new Error(launching.error || 'Could not mark launch request launching.');
          }

          try {
            const externalLaunch = await openExternalVaultCollabTerminal(launchRequest, launchCommand);
            return {
              success: true,
              data: {
                launchRequestUid,
                launchedSessionUid: null,
                command: launchCommand.command,
                args: launchCommand.args,
                display: launchCommand.display,
                launchCommand,
                externalTerminalLaunched: externalLaunch.launched,
                externalTerminalScriptPath: externalLaunch.scriptPath,
                externalTerminalShellPath: externalLaunch.shellPath,
                statusDetail: externalLaunch.note,
              },
            };
          } catch (error) {
            await executeVaultCollabAction(config, actor, {
              kind: 'launch',
              action: 'fail',
              launchRequestUid,
              reason: error instanceof Error ? error.message : String(error),
            });
            throw error;
          }
        }

        return {
          success: true,
          data: {
            launchRequestUid,
            launchedSessionUid: null,
            command: launchCommand.command,
            args: launchCommand.args,
            display: launchCommand.display,
            launchCommand,
            externalTerminalLaunched: false,
            externalTerminalScriptPath: null,
            externalTerminalShellPath: null,
            statusDetail: 'External terminal auto-launch is only implemented on Windows; use the copied command.',
          },
        };
      }

      if (launchRequest.provider !== 'codex') {
        throw new Error(`The experimental managed launch broker currently supports Codex requests only. Provider was ${launchRequest.provider}.`);
      }

      const launching = await executeVaultCollabAction(config, actor, {
        kind: 'launch',
        action: 'mark_launching',
        launchRequestUid,
        detail: 'The Vault broker accepted the approved launch request.',
      });
      if (!launching.ok) {
        throw new Error(launching.error || 'Could not mark launch request launching.');
      }

      let managedSession: { sessionUid: string; sessionToken: string } | null = null;
      try {
        managedSession = await registerVaultCollabManagedCodexSession(config, launchRequest);
        startManagedVaultCollabTerminal(config, actor, launchRequest, managedSession);
        const running = await executeVaultCollabAction(config, actor, {
          kind: 'launch',
          action: 'mark_running',
          launchRequestUid,
          launchedSessionUid: managedSession.sessionUid,
          detail: 'The Vault started a managed Codex PTY and attached the wakeable session.',
        });
        if (!running.ok) {
          throw new Error(running.error || 'Could not mark launch request running.');
        }

        return {
          success: true,
          data: {
            launchRequestUid,
            launchedSessionUid: managedSession.sessionUid,
            command: 'codex',
            args: ['--no-alt-screen', '-C', launchRequest.workspacePath, '[prompt delivered over PTY]'],
            display: launchCommand.display,
            launchCommand,
            externalTerminalLaunched: false,
            externalTerminalScriptPath: null,
            externalTerminalShellPath: null,
            statusDetail: 'Experimental managed PTY started inside The Vault.',
          },
        };
      } catch (error) {
        if (managedSession) {
          killManagedVaultCollabTerminal(managedSession.sessionUid);
        }
        await executeVaultCollabAction(config, actor, {
          kind: 'launch',
          action: 'fail',
          launchRequestUid,
          reason: error instanceof Error ? error.message : String(error),
        });
        throw error;
      }
    } catch (e: any) {
      return { success: false, error: e.message };
    }
  });

  ipcMain.handle('vault:getVaultCollabManagedTerminals', () => {
    try {
      return {
        success: true,
        data: Array.from(managedVaultCollabTerminals.values()).map(mapManagedVaultCollabTerminal),
      };
    } catch (e: any) {
      return { success: false, error: e.message };
    }
  });

  ipcMain.handle('vault:controlVaultCollabManagedTerminal', async (_, input) => {
    try {
      const raw = input && typeof input === 'object' ? input as Record<string, unknown> : {};
      const sessionUid = typeof raw.sessionUid === 'string' ? raw.sessionUid.trim() : '';
      const action = raw.action;
      if (!sessionUid) {
        throw new Error('Managed session UID is required.');
      }

      if (action === 'pause') {
        return { success: true, data: mapManagedVaultCollabTerminal(pauseManagedVaultCollabTerminal(sessionUid)) };
      }

      if (action === 'resume') {
        const terminal = requireManagedVaultCollabTerminal(sessionUid);
        return {
          success: true,
          data: mapManagedVaultCollabTerminal(resumeManagedVaultCollabTerminalPolling(getVaultCollabDashboardActionRuntimeConfig(), terminal)),
        };
      }

      if (action === 'stop') {
        const actor = await ensureVaultCollabDashboardActor();
        killManagedVaultCollabTerminal(sessionUid);
        await executeVaultCollabAction(getVaultCollabDashboardActionRuntimeConfig(), actor, {
          kind: 'session',
          action: 'close',
          targetSessionUid: sessionUid,
          reason: 'Stopped from The Vault dashboard.',
        });
        return { success: true, data: null };
      }

      throw new Error(`Unsupported managed terminal action: ${String(action)}`);
    } catch (e: any) {
      return { success: false, error: e.message };
    }
  });

  ipcMain.handle('vault:detectVaultCollabSourcePath', () => {
    try {
      return { success: true, data: detectVaultCollabSourcePath() };
    } catch (e: any) {
      return { success: false, error: e.message };
    }
  });

  ipcMain.handle('vault:useDetectedVaultCollabSourcePath', () => {
    try {
      const detected = detectVaultCollabSourcePath();
      if (!detected.path) {
        throw new Error(detected.reason);
      }

      const data = vault.saveVaultCollabRuntimeConfig({
        runtimeMode: 'localSource',
        localSourceCheckoutPath: detected.path,
        databasePath: getVaultCollabExtensionPaths(vault.getVaultRoot()).database,
      });
      return { success: true, data };
    } catch (e: any) {
      return { success: false, error: e.message };
    }
  });

  ipcMain.handle('vault:chooseVaultCollabSourcePath', async () => {
    try {
      const selection = await dialog.showOpenDialog({
        title: 'Choose Vault Collab source folder',
        properties: ['openDirectory'],
      });
      if (selection.canceled || selection.filePaths.length === 0) {
        return { success: true, data: null };
      }

      const sourceRoot = selection.filePaths[0];
      const data = vault.saveVaultCollabRuntimeConfig({
        runtimeMode: 'localSource',
        localSourceCheckoutPath: sourceRoot,
        databasePath: getVaultCollabExtensionPaths(vault.getVaultRoot()).database,
      });
      return { success: true, data };
    } catch (e: any) {
      return { success: false, error: e.message };
    }
  });

  ipcMain.handle('vault:getOpenRouterModels', async (_, apiKey) => {
    try {
      return { success: true, data: await getOpenRouterModels(apiKey) };
    } catch (e: any) {
      return { success: false, error: e.message };
    }
  });

  ipcMain.handle('vault:testOpenRouterApiKey', async (_, apiKey) => {
    try {
      return { success: true, data: await testOpenRouterApiKey(apiKey) };
    } catch (e: any) {
      return { success: false, error: e.message };
    }
  });

  ipcMain.handle('vault:executeVaultApiAgent', async (_, input) => {
    try {
      return { success: true, data: await executeVaultApiAgent(input) };
    } catch (e: any) {
      return { success: false, error: e.message };
    }
  });

  ipcMain.handle('vault:readSkillFile', async (_, relativePathInput) => {
    try {
      const skillFile = resolveSkillFile(relativePathInput);
      const content = await readFile(skillFile.absolutePath, 'utf8');

      return {
        success: true,
        data: {
          path: skillFile.relativePath,
          filename: skillFile.filename,
          content,
        },
      };
    } catch (e: any) {
      return { success: false, error: e.message };
    }
  });

  ipcMain.handle('vault:getVaultStructure', async () => {
    try {
      return { success: true, data: await getVaultStructure() };
    } catch (e: any) {
      return { success: false, error: e.message };
    }
  });

  ipcMain.handle('vault:readVaultFilePreview', async (_, relativePathInput) => {
    try {
      return { success: true, data: await readVaultFilePreview(relativePathInput) };
    } catch (e: any) {
      return { success: false, error: e.message };
    }
  });

  // ==========================================================================
  // Connection setup handlers
  // ==========================================================================

  // Claude Desktop reads its MCP config from %APPDATA%/Claude/claude_desktop_config.json on Windows.
  // Use Electron's app.getPath rather than process.env.APPDATA — the env var can be unset in
  // some launch contexts (services, restricted shells), and getPath always resolves the right dir.
  const claudeDesktopConfigPath = join(app.getPath('appData'), 'Claude', 'claude_desktop_config.json');
  // Claude Code reads user-level MCP servers from ~/.claude.json (not ~/.claude/settings.json).
  // Writing to settings.json silently does nothing for MCP — the CLI only consumes mcpServers
  // out of ~/.claude.json (the same file `claude mcp add --scope user` writes to).
  const claudeCodeSettingsPath = join(homedir(), '.claude.json');
  const legacyClaudeCodeSettingsPath = join(homedir(), '.claude', 'settings.json');
  const claudeMdPath = join(homedir(), '.claude', 'CLAUDE.md');
  const claudeUserSkillDir = join(homedir(), '.claude', 'skills', 'vault-memory');
  const claudeUserSkillPath = join(claudeUserSkillDir, 'SKILL.md');
  const claudeCommandsDir = join(homedir(), '.claude', 'commands');
  const claudeVaultCollabCommandPath = join(claudeCommandsDir, 'vault-collab.md');
  const codexConfigPath = join(homedir(), '.codex', 'config.toml');
  const codexCommandsDir = join(homedir(), '.codex', 'commands');
  const codexVaultCollabCommandPath = join(codexCommandsDir, 'vault-collab.md');
  const claudeSkillPath = resolve(skillsPath, 'claude-vault-skill.md');
  const codexAgentsPath = join(homedir(), '.codex', 'AGENTS.md');
  const codexSkillPath = resolve(skillsPath, 'codex-vault-skill.md');
  // Vault Collab skills are separate, opt-in operating guides for the coordination
  // layer. Claude Code loads them from ~/.claude/skills/vault-collab/SKILL.md;
  // Codex reads them via a reference section appended to AGENTS.md.
  const claudeUserCollabSkillDir = join(homedir(), '.claude', 'skills', 'vault-collab');
  const claudeUserCollabSkillPath = join(claudeUserCollabSkillDir, 'SKILL.md');
  const claudeCollabSkillPath = resolve(skillsPath, 'claude-vault-collab-skill.md');
  const codexCollabSkillPath = resolve(skillsPath, 'codex-vault-collab-skill.md');

  async function fileExists(filePath: string): Promise<boolean> {
    try {
      await access(filePath);
      return true;
    } catch {
      return false;
    }
  }

  async function readJsonFile(filePath: string): Promise<{ exists: boolean; data: Record<string, any> | null; error?: string }> {
    try {
      const content = await readFile(filePath, 'utf8');
      return { exists: true, data: JSON.parse(stripUtf8Bom(content)) };
    } catch (err: any) {
      if (err.code === 'ENOENT') {
        return { exists: false, data: null };
      }
      if (err instanceof SyntaxError) {
        return { exists: true, data: null, error: `Invalid JSON: ${err.message}` };
      }
      throw err;
    }
  }

  function stripUtf8Bom(content: string): string {
    return content.charCodeAt(0) === 0xfeff ? content.slice(1) : content;
  }

  async function readTextFileIfExists(filePath: string): Promise<string | null> {
    try {
      return await readFile(filePath, 'utf8');
    } catch (err: any) {
      if (err.code === 'ENOENT') {
        return null;
      }
      throw err;
    }
  }

  type ConnectStep = { id: string; label: string; status: 'success' | 'fail' | 'skipped'; detail?: string };
  type McpLaunchConfig = {
    mode: 'packaged' | 'development';
    command: string;
    args: string[];
    requiredPaths: string[];
    displayPath: string;
  };

  function getMcpLaunchConfig(): McpLaunchConfig {
    if (app.isPackaged) {
      return {
        mode: 'packaged',
        command: mcpPackagedNodePath,
        args: [mcpPackagedEntryPath],
        requiredPaths: [mcpPackagedNodePath, mcpPackagedEntryPath],
        displayPath: mcpPackagedEntryPath,
      };
    }

    const entryPath = existsSync(mcpStandalonePath) ? mcpStandalonePath : mcpDevPath;
    return {
      mode: 'development',
      command: 'node',
      args: [entryPath],
      requiredPaths: [entryPath],
      displayPath: entryPath,
    };
  }

  function getVaultCollabMcpLaunchConfig(): McpLaunchConfig {
    const config = vault.getVaultCollabRuntimeConfig();
    const serverPath = resolveVaultCollabMcpServerPath(config);

    if (config.runtimeMode === 'managed') {
      return {
        mode: 'development',
        command: 'npm',
        args: [
          'exec',
          '--yes',
          '--package',
          'https://github.com/aliihsaad/vault-collab',
          '--',
          'vault-collab-mcp',
          '--db',
          config.databasePath,
        ],
        requiredPaths: [],
        displayPath: `vault-collab-mcp --db ${config.databasePath}`,
      };
    }

    return {
      mode: 'development',
      command: 'node',
      args: [serverPath || '', '--db', config.databasePath],
      requiredPaths: serverPath ? [serverPath] : ['Vault Collab MCP server path is not configured'],
      displayPath: serverPath || 'Vault Collab MCP server path is not configured',
    };
  }

  function getServerDisplayName(serverName: string): string {
    return serverName === 'vault-collab' ? 'Vault Collab MCP' : 'Vault memory MCP';
  }

  function escapeRegExp(value: string): string {
    return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }

  function buildVaultCollabCommandContent(): string {
    return [
      '---',
      'description: Register this session with Vault Collab, show active inbox state, and ask before claiming handoffs.',
      '---',
      '',
      '# Vault Collab',
      '',
      'Use Vault Collab MCP for this session.',
      '',
      '1. If `vault_collab_register_session` is unavailable, say that Vault Collab MCP is not connected and tell the user to run Vault Settings -> Client setup -> Connect Vault Collab MCP.',
      '2. If this session is not registered, call `vault_collab_register_session` with the current client type, project, workspace path, and capabilities.',
      '3. Report the current registered session state.',
      '4. Call `vault_collab_list_inbox` for the current project and related project context.',
      '5. Show available handoffs briefly and ask before calling `vault_collab_claim_handoff`.',
      '6. Do not claim, resolve, reopen, or execute risky work without user approval.',
      '',
    ].join('\n');
  }

  async function validateMcpRuntime(steps: ConnectStep[], launchConfig: McpLaunchConfig): Promise<boolean> {
    const missingPaths: string[] = [];
    for (const requiredPath of launchConfig.requiredPaths) {
      if (!(await fileExists(requiredPath))) {
        missingPaths.push(requiredPath);
      }
    }

    if (missingPaths.length > 0) {
      const hint = launchConfig.mode === 'packaged'
        ? 'The installed app is missing its bundled MCP runtime. Reinstall Vault or rebuild the installer with MCP resources.'
        : 'Run "pnpm build" or "pnpm setup:mcp" first.';
      steps.push({
        id: 'locate-mcp',
        label: 'Locate MCP runtime',
        status: 'fail',
        detail: `${hint} Missing: ${missingPaths.join(', ')}`,
      });
      return false;
    }

    steps.push({
      id: 'locate-mcp',
      label: 'Locate MCP runtime',
      status: 'success',
      detail: `${launchConfig.command} ${launchConfig.args.join(' ')}`,
    });
    return true;
  }

  function hasCodexVaultEntry(content: string): boolean {
    return hasCodexMcpEntry(content, 'vault-memory');
  }

  function removeCodexVaultEntry(content: string): string {
    return removeCodexMcpEntry(content, 'vault-memory');
  }

  function hasCodexMcpEntry(content: string, serverName: string): boolean {
    const escaped = escapeRegExp(serverName);
    return new RegExp(`\\[mcp_servers(?:\\."${escaped}"|\\.${escaped})\\]`).test(content);
  }

  function removeCodexMcpEntry(content: string, serverName: string): string {
    const escaped = escapeRegExp(serverName);
    return content
      .replace(new RegExp(`\\n*\\[mcp_servers(?:\\."${escaped}"|\\.${escaped})\\]\\n[\\s\\S]*?(?=\\n\\[|$)`, 'g'), '\n')
      .replace(/\n{3,}/g, '\n\n')
      .trimEnd();
  }

  function hasCurrentCodexVaultEntry(content: string, launchConfig: McpLaunchConfig): boolean {
    return hasCurrentCodexMcpEntry(content, 'vault-memory', launchConfig);
  }

  function buildCodexVaultEntry(launchConfig: McpLaunchConfig): string {
    return buildCodexMcpEntry('vault-memory', launchConfig);
  }

  function hasCurrentCodexMcpEntry(content: string, serverName: string, launchConfig: McpLaunchConfig): boolean {
    return content.includes(buildCodexMcpEntry(serverName, launchConfig).trim());
  }

  function buildCodexMcpEntry(serverName: string, launchConfig: McpLaunchConfig): string {
    return [
      `[mcp_servers.${serverName}]`,
      `command = ${JSON.stringify(launchConfig.command)}`,
      `args = [${launchConfig.args.map((arg) => JSON.stringify(arg)).join(', ')}]`,
      '',
    ].join('\n');
  }

  async function connectMcpToConfig(
    configPath: string,
    label: string,
    serverName = 'vault-memory',
    launchConfig = getMcpLaunchConfig(),
  ): Promise<{ success: boolean; steps: ConnectStep[]; backupPath?: string }> {
    const steps: ConnectStep[] = [];
    const displayName = getServerDisplayName(serverName);

    // Step 1: Locate MCP server
    const mcpExists = await validateMcpRuntime(steps, launchConfig);
    if (!mcpExists) {
      steps.push({ id: 'read-config', label: `Read ${label} config`, status: 'skipped' });
      steps.push({ id: 'check-existing', label: 'Check existing entry', status: 'skipped' });
      steps.push({ id: 'backup', label: 'Backup config', status: 'skipped' });
      steps.push({ id: 'write-config', label: 'Write MCP entry', status: 'skipped' });
      steps.push({ id: 'verify', label: 'Verify config', status: 'skipped' });
      return { success: false, steps };
    }

    // Step 2: Read existing config
    const configResult = await readJsonFile(configPath);
    if (configResult.error) {
      steps.push({ id: 'read-config', label: `Read ${label} config`, status: 'fail', detail: configResult.error });
      steps.push({ id: 'check-existing', label: 'Check existing entry', status: 'skipped' });
      steps.push({ id: 'backup', label: 'Backup config', status: 'skipped' });
      steps.push({ id: 'write-config', label: 'Write MCP entry', status: 'skipped' });
      steps.push({ id: 'verify', label: 'Verify config', status: 'skipped' });
      return { success: false, steps };
    }

    const config: Record<string, any> = configResult.data || {};
    steps.push({
      id: 'read-config',
      label: `Read ${label} config`,
      status: 'success',
      detail: configResult.exists ? configPath : `Will create: ${configPath}`,
    });

    // Step 3: Check if already configured
    const existingEntry = config.mcpServers?.[serverName];
    if (mcpEntriesMatch(existingEntry, launchConfig)) {
      steps.push({ id: 'check-existing', label: 'Check existing entry', status: 'success', detail: 'Already configured with correct path' });
      steps.push({ id: 'backup', label: 'Backup config', status: 'skipped', detail: 'No changes needed' });
      steps.push({ id: 'write-config', label: 'Write MCP entry', status: 'skipped', detail: 'No changes needed' });
      steps.push({ id: 'verify', label: 'Verify config', status: 'success', detail: 'Entry verified' });
      return { success: true, steps };
    }
    steps.push({
      id: 'check-existing',
      label: 'Check existing entry',
      status: 'success',
      detail: existingEntry ? 'Entry exists but path differs — will update' : `No existing ${serverName} entry`,
    });

    // Step 4: Backup
    let backupPath: string | undefined;
    if (configResult.exists) {
      try {
        backupPath = `${configPath}.vault-backup-${Date.now()}`;
        await copyFile(configPath, backupPath);
        steps.push({ id: 'backup', label: 'Backup config', status: 'success', detail: backupPath });
      } catch (err: any) {
        steps.push({ id: 'backup', label: 'Backup config', status: 'fail', detail: err.message });
        steps.push({ id: 'write-config', label: 'Write MCP entry', status: 'skipped' });
        steps.push({ id: 'verify', label: 'Verify config', status: 'skipped' });
        return { success: false, steps, backupPath };
      }
    } else {
      steps.push({ id: 'backup', label: 'Backup config', status: 'skipped', detail: 'No existing file to backup' });
    }

    // Step 5: Merge and write
    try {
      config.mcpServers = config.mcpServers || {};
      config.mcpServers[serverName] = {
        command: launchConfig.command,
        args: launchConfig.args,
      };

      await mkdir(dirname(configPath), { recursive: true });
      await writeFile(configPath, JSON.stringify(config, null, 2), 'utf8');
      steps.push({ id: 'write-config', label: 'Write MCP entry', status: 'success', detail: `${serverName} entry written` });
    } catch (err: any) {
      steps.push({ id: 'write-config', label: 'Write MCP entry', status: 'fail', detail: err.message });
      steps.push({ id: 'verify', label: 'Verify config', status: 'skipped' });
      return { success: false, steps, backupPath };
    }

    // Step 6: Verify
    try {
      const verifyResult = await readJsonFile(configPath);
      if (mcpEntriesMatch(verifyResult.data?.mcpServers?.[serverName], launchConfig)) {
        steps.push({ id: 'verify', label: 'Verify config', status: 'success', detail: 'Entry confirmed in config file' });
      } else {
        steps.push({ id: 'verify', label: 'Verify config', status: 'fail', detail: 'Entry not found after write' });
        return { success: false, steps, backupPath };
      }
    } catch (err: any) {
      steps.push({ id: 'verify', label: 'Verify config', status: 'fail', detail: err.message });
      return { success: false, steps, backupPath };
    }

    if (serverName === 'vault-collab') {
      steps.push({ id: 'next-step', label: 'Restart client', status: 'success', detail: `${displayName} will be available after the client restarts or reloads MCP servers.` });
    }
    return { success: true, steps, backupPath };
  }

  async function connectMcpToCodexConfig(
    serverName = 'vault-memory',
    launchConfig = getMcpLaunchConfig(),
  ): Promise<{ success: boolean; steps: ConnectStep[]; backupPath?: string }> {
    const steps: ConnectStep[] = [];
    const displayName = getServerDisplayName(serverName);

    const mcpExists = await validateMcpRuntime(steps, launchConfig);
    if (!mcpExists) {
      steps.push({ id: 'read-config', label: 'Read Codex config', status: 'skipped' });
      steps.push({ id: 'check-existing', label: 'Check existing entry', status: 'skipped' });
      steps.push({ id: 'backup', label: 'Backup config', status: 'skipped' });
      steps.push({ id: 'write-config', label: 'Write MCP entry', status: 'skipped' });
      steps.push({ id: 'verify', label: 'Verify config', status: 'skipped' });
      return { success: false, steps };
    }

    let configContent = '';
    let configExists = false;
    try {
      configContent = await readFile(codexConfigPath, 'utf8');
      configExists = true;
      steps.push({ id: 'read-config', label: 'Read Codex config', status: 'success', detail: codexConfigPath });
    } catch (err: any) {
      if (err.code === 'ENOENT') {
        steps.push({ id: 'read-config', label: 'Read Codex config', status: 'success', detail: `Will create: ${codexConfigPath}` });
      } else {
        steps.push({ id: 'read-config', label: 'Read Codex config', status: 'fail', detail: err.message });
        steps.push({ id: 'check-existing', label: 'Check existing entry', status: 'skipped' });
        steps.push({ id: 'backup', label: 'Backup config', status: 'skipped' });
        steps.push({ id: 'write-config', label: 'Write MCP entry', status: 'skipped' });
        steps.push({ id: 'verify', label: 'Verify config', status: 'skipped' });
        return { success: false, steps };
      }
    }

    if (hasCurrentCodexMcpEntry(configContent, serverName, launchConfig)) {
      steps.push({ id: 'check-existing', label: 'Check existing entry', status: 'success', detail: 'Already configured with correct path' });
      steps.push({ id: 'backup', label: 'Backup config', status: 'skipped', detail: 'No changes needed' });
      steps.push({ id: 'write-config', label: 'Write MCP entry', status: 'skipped', detail: 'No changes needed' });
      steps.push({ id: 'verify', label: 'Verify config', status: 'success', detail: 'Entry verified in config.toml' });
      return { success: true, steps };
    }
    steps.push({
      id: 'check-existing',
      label: 'Check existing entry',
      status: 'success',
      detail: hasCodexMcpEntry(configContent, serverName) ? 'Entry exists but path differs — will update' : `No existing ${serverName} entry`,
    });

    let backupPath: string | undefined;
    if (configExists) {
      try {
        backupPath = `${codexConfigPath}.vault-backup-${Date.now()}`;
        await copyFile(codexConfigPath, backupPath);
        steps.push({ id: 'backup', label: 'Backup config', status: 'success', detail: backupPath });
      } catch (err: any) {
        steps.push({ id: 'backup', label: 'Backup config', status: 'fail', detail: err.message });
        steps.push({ id: 'write-config', label: 'Write MCP entry', status: 'skipped' });
        steps.push({ id: 'verify', label: 'Verify config', status: 'skipped' });
        return { success: false, steps, backupPath };
      }
    } else {
      steps.push({ id: 'backup', label: 'Backup config', status: 'skipped', detail: 'No existing file to backup' });
    }

    try {
      const cleaned = removeCodexMcpEntry(configContent, serverName);
      const nextContent = `${cleaned.trimEnd()}${cleaned.trim() ? '\n\n' : ''}${buildCodexMcpEntry(serverName, launchConfig)}`;
      await mkdir(dirname(codexConfigPath), { recursive: true });
      await writeFile(codexConfigPath, nextContent, 'utf8');
      steps.push({ id: 'write-config', label: 'Write MCP entry', status: 'success', detail: `${serverName} entry written to config.toml` });
    } catch (err: any) {
      steps.push({ id: 'write-config', label: 'Write MCP entry', status: 'fail', detail: err.message });
      steps.push({ id: 'verify', label: 'Verify config', status: 'skipped' });
      return { success: false, steps, backupPath };
    }

    try {
      const verifyContent = await readFile(codexConfigPath, 'utf8');
      if (hasCurrentCodexMcpEntry(verifyContent, serverName, launchConfig)) {
        steps.push({ id: 'verify', label: 'Verify config', status: 'success', detail: 'Entry confirmed in config.toml' });
        if (serverName === 'vault-collab') {
          steps.push({ id: 'next-step', label: 'Restart client', status: 'success', detail: `${displayName} will be available after Codex restarts or reloads tool servers.` });
        }
        return { success: true, steps, backupPath };
      }

      steps.push({ id: 'verify', label: 'Verify config', status: 'fail', detail: 'Entry not found after write' });
      return { success: false, steps, backupPath };
    } catch (err: any) {
      steps.push({ id: 'verify', label: 'Verify config', status: 'fail', detail: err.message });
      return { success: false, steps, backupPath };
    }
  }

  ipcMain.handle('vault:checkConnectionStatus', async () => {
    try {
      const launchConfig = getMcpLaunchConfig();
      const vaultCollabLaunchConfig = getVaultCollabMcpLaunchConfig();

      // Check Claude Desktop
      const desktopResult = await readJsonFile(claudeDesktopConfigPath);
      const desktopConfigured = mcpEntriesMatch(desktopResult.data?.mcpServers?.['vault-memory'], launchConfig);
      const vaultCollabDesktopConfigured = mcpEntriesMatch(desktopResult.data?.mcpServers?.['vault-collab'], vaultCollabLaunchConfig);

      // Check Claude Code
      const codeResult = await readJsonFile(claudeCodeSettingsPath);
      const codeConfigured = mcpEntriesMatch(codeResult.data?.mcpServers?.['vault-memory'], launchConfig);
      const vaultCollabCodeConfigured = mcpEntriesMatch(codeResult.data?.mcpServers?.['vault-collab'], vaultCollabLaunchConfig);

      // Check the active Claude Code skill vector only. Legacy CLAUDE.md references
      // are migration signals, not proof that Claude Code will load the skill.
      const claudeSkillInstalled = await fileExists(claudeUserSkillPath);

      let codexSkillInstalled = false;
      let codexCollabSkillInstalled = false;
      try {
        const codexAgentsContent = await readFile(codexAgentsPath, 'utf8');
        codexSkillInstalled = codexAgentsContent.includes('codex-vault-skill') || codexAgentsContent.includes('Vault Memory Skill');
        codexCollabSkillInstalled = codexAgentsContent.includes('codex-vault-collab-skill') || codexAgentsContent.includes('Vault Collab Skill');
      } catch {
        // File doesn't exist — not installed
      }

      const claudeCollabSkillInstalled = await fileExists(claudeUserCollabSkillPath);

      const codexConfigContent = await readTextFileIfExists(codexConfigPath);

      return {
        success: true,
        data: {
          claudeDesktop: { configured: desktopConfigured, configPath: claudeDesktopConfigPath },
          claudeCode: { configured: codeConfigured, configPath: claudeCodeSettingsPath },
          codex: {
            configured: codexConfigContent !== null
              ? hasCurrentCodexVaultEntry(codexConfigContent, launchConfig)
              : false,
            configPath: codexConfigPath,
          },
          mcpRuntime: {
            mode: launchConfig.mode,
            command: launchConfig.command,
            args: launchConfig.args,
            displayPath: launchConfig.displayPath,
          },
          skill: {
            claudeInstalled: claudeSkillInstalled,
            claudeMdPath,
            claudeSkillPath: claudeUserSkillPath,
            codexInstalled: codexSkillInstalled,
            codexAgentsPath,
            collab: {
              claudeInstalled: claudeCollabSkillInstalled,
              claudeSkillPath: claudeUserCollabSkillPath,
              codexInstalled: codexCollabSkillInstalled,
              codexAgentsPath,
            },
          },
          vaultCollab: {
            claudeDesktop: { configured: vaultCollabDesktopConfigured, configPath: claudeDesktopConfigPath },
            claudeCode: { configured: vaultCollabCodeConfigured, configPath: claudeCodeSettingsPath },
            codex: {
              configured: codexConfigContent !== null
                ? hasCurrentCodexMcpEntry(codexConfigContent, 'vault-collab', vaultCollabLaunchConfig)
                : false,
              configPath: codexConfigPath,
            },
            mcpRuntime: {
              mode: vaultCollabLaunchConfig.mode,
              command: vaultCollabLaunchConfig.command,
              args: vaultCollabLaunchConfig.args,
              displayPath: vaultCollabLaunchConfig.displayPath,
            },
            command: {
              claudeInstalled: await fileExists(claudeVaultCollabCommandPath),
              claudeCommandPath: claudeVaultCollabCommandPath,
              codexSlashCommandSupported: false,
              codexLegacyCommandPresent: await fileExists(codexVaultCollabCommandPath),
              codexLegacyCommandPath: codexVaultCollabCommandPath,
            },
          },
        },
      };
    } catch (e: any) {
      return { success: false, error: e.message };
    }
  });

  ipcMain.handle('vault:connectClaudeDesktop', async () => {
    try {
      const result = await connectMcpToConfig(claudeDesktopConfigPath, 'Claude Desktop');
      return { success: true, data: result };
    } catch (e: any) {
      return { success: false, error: e.message };
    }
  });

  ipcMain.handle('vault:connectClaudeCode', async () => {
    try {
      const result = await connectMcpToConfig(claudeCodeSettingsPath, 'Claude Code');
      return { success: true, data: result };
    } catch (e: any) {
      return { success: false, error: e.message };
    }
  });

  ipcMain.handle('vault:connectCodex', async () => {
    try {
      const result = await connectMcpToCodexConfig();
      return { success: true, data: result };
    } catch (e: any) {
      return { success: false, error: e.message };
    }
  });

  ipcMain.handle('vault:connectVaultCollabClients', async () => {
    try {
      const result = await connectVaultCollabClients();
      return { success: true, data: result };
    } catch (e: any) {
      return { success: false, error: e.message };
    }
  });

  // Claude Code: install the actual skill file at ~/.claude/skills/vault-memory/SKILL.md.
  // The CLI only loads skills from that location — appending a doc reference to CLAUDE.md
  // (the previous behavior) made the install look successful while leaving the skill inert.
  async function installClaudeSkill(): Promise<{ success: boolean; steps: ConnectStep[] }> {
    const steps: ConnectStep[] = [];

    if (!(await fileExists(claudeSkillPath))) {
      steps.push({ id: 'locate-skill', label: 'Locate bundled skill', status: 'fail', detail: `Not found: ${claudeSkillPath}` });
      steps.push({ id: 'prepare-dir', label: 'Prepare skill directory', status: 'skipped' });
      steps.push({ id: 'write-skill', label: 'Write SKILL.md', status: 'skipped' });
      steps.push({ id: 'verify', label: 'Verify installation', status: 'skipped' });
      return { success: false, steps };
    }
    steps.push({ id: 'locate-skill', label: 'Locate bundled skill', status: 'success', detail: claudeSkillPath });

    let skillContent: string;
    try {
      skillContent = await readFile(claudeSkillPath, 'utf8');
    } catch (err: any) {
      steps.push({ id: 'prepare-dir', label: 'Prepare skill directory', status: 'fail', detail: err.message });
      steps.push({ id: 'write-skill', label: 'Write SKILL.md', status: 'skipped' });
      steps.push({ id: 'verify', label: 'Verify installation', status: 'skipped' });
      return { success: false, steps };
    }

    try {
      await mkdir(claudeUserSkillDir, { recursive: true });
      steps.push({ id: 'prepare-dir', label: 'Prepare skill directory', status: 'success', detail: claudeUserSkillDir });
    } catch (err: any) {
      steps.push({ id: 'prepare-dir', label: 'Prepare skill directory', status: 'fail', detail: err.message });
      steps.push({ id: 'write-skill', label: 'Write SKILL.md', status: 'skipped' });
      steps.push({ id: 'verify', label: 'Verify installation', status: 'skipped' });
      return { success: false, steps };
    }

    // If a SKILL.md is already present, back it up before overwriting so we don't blow away
    // hand-edited skills the user may have customised.
    if (await fileExists(claudeUserSkillPath)) {
      try {
        const existing = await readFile(claudeUserSkillPath, 'utf8');
        if (existing.trim() === skillContent.trim()) {
          steps.push({ id: 'write-skill', label: 'Write SKILL.md', status: 'skipped', detail: 'Already up-to-date' });
          steps.push({ id: 'verify', label: 'Verify installation', status: 'success', detail: claudeUserSkillPath });
          return { success: true, steps };
        }
        await copyFile(claudeUserSkillPath, `${claudeUserSkillPath}.vault-backup-${Date.now()}`);
      } catch {
        // Best-effort backup; don't fail the install if the backup write fails.
      }
    }

    try {
      await writeFile(claudeUserSkillPath, skillContent, 'utf8');
      steps.push({ id: 'write-skill', label: 'Write SKILL.md', status: 'success', detail: claudeUserSkillPath });
    } catch (err: any) {
      steps.push({ id: 'write-skill', label: 'Write SKILL.md', status: 'fail', detail: err.message });
      steps.push({ id: 'verify', label: 'Verify installation', status: 'skipped' });
      return { success: false, steps };
    }

    try {
      const written = await readFile(claudeUserSkillPath, 'utf8');
      if (written.trim() === skillContent.trim()) {
        steps.push({ id: 'verify', label: 'Verify installation', status: 'success', detail: 'SKILL.md confirmed on disk' });
        return { success: true, steps };
      }
      steps.push({ id: 'verify', label: 'Verify installation', status: 'fail', detail: 'Content mismatch after write' });
      return { success: false, steps };
    } catch (err: any) {
      steps.push({ id: 'verify', label: 'Verify installation', status: 'fail', detail: err.message });
      return { success: false, steps };
    }
  }

  // Codex: append a reference into ~/.codex/AGENTS.md. Codex actually reads AGENTS.md so this
  // is the right install vector for Codex (unlike Claude Code, which needs a real SKILL.md).
  async function installCodexSkillReference(): Promise<{ success: boolean; steps: ConnectStep[] }> {
    const steps: ConnectStep[] = [];
    const skillPath = codexSkillPath;
    const instructionPath = codexAgentsPath;
    const instructionLabel = 'AGENTS.md';
    const referenceToken = 'codex-vault-skill';
    const skillSection = [
      '',
      '',
      '## Vault Memory Skill',
      '',
      `Codex should use the Vault memory skill at \`${codexSkillPath}\` when working in this repository.`,
      'Use Vault MCP when the `vault-memory` server is attached, and use the skill file as the operating guide for recall/save behavior.',
      'Keep the skill path stable so Codex setup prompts and future sessions can reference it directly.',
      '',
    ].join('\n');

    if (!(await fileExists(skillPath))) {
      steps.push({ id: 'locate-skill', label: 'Locate skill file', status: 'fail', detail: `Not found: ${skillPath}` });
      steps.push({ id: 'read-instructions', label: `Read ${instructionLabel}`, status: 'skipped' });
      steps.push({ id: 'check-existing', label: 'Check existing reference', status: 'skipped' });
      steps.push({ id: 'append-reference', label: 'Add skill reference', status: 'skipped' });
      steps.push({ id: 'verify', label: 'Verify installation', status: 'skipped' });
      return { success: false, steps };
    }
    steps.push({ id: 'locate-skill', label: 'Locate skill file', status: 'success', detail: skillPath });

    let instructionContent = '';
    try {
      instructionContent = await readFile(instructionPath, 'utf8');
      steps.push({ id: 'read-instructions', label: `Read ${instructionLabel}`, status: 'success', detail: instructionPath });
    } catch (err: any) {
      if (err.code === 'ENOENT') {
        steps.push({ id: 'read-instructions', label: `Read ${instructionLabel}`, status: 'success', detail: `Will create: ${instructionPath}` });
      } else {
        steps.push({ id: 'read-instructions', label: `Read ${instructionLabel}`, status: 'fail', detail: err.message });
        steps.push({ id: 'check-existing', label: 'Check existing reference', status: 'skipped' });
        steps.push({ id: 'append-reference', label: 'Add skill reference', status: 'skipped' });
        steps.push({ id: 'verify', label: 'Verify installation', status: 'skipped' });
        return { success: false, steps };
      }
    }

    if (instructionContent.includes(referenceToken) || instructionContent.includes('## Vault Memory Skill')) {
      steps.push({ id: 'check-existing', label: 'Check existing reference', status: 'success', detail: 'Skill reference already present' });
      steps.push({ id: 'append-reference', label: 'Add skill reference', status: 'skipped', detail: 'No changes needed' });
      steps.push({ id: 'verify', label: 'Verify installation', status: 'success', detail: `Already installed in ${instructionLabel}` });
      return { success: true, steps };
    }
    steps.push({ id: 'check-existing', label: 'Check existing reference', status: 'success', detail: 'No existing reference found' });

    try {
      await mkdir(dirname(instructionPath), { recursive: true });
      await writeFile(instructionPath, instructionContent + skillSection, 'utf8');
      steps.push({ id: 'append-reference', label: 'Add skill reference', status: 'success', detail: `Appended Vault Memory Skill section to ${instructionLabel}` });
    } catch (err: any) {
      steps.push({ id: 'append-reference', label: 'Add skill reference', status: 'fail', detail: err.message });
      steps.push({ id: 'verify', label: 'Verify installation', status: 'skipped' });
      return { success: false, steps };
    }

    try {
      const verifyContent = await readFile(instructionPath, 'utf8');
      if (verifyContent.includes(referenceToken) || verifyContent.includes('## Vault Memory Skill')) {
        steps.push({ id: 'verify', label: 'Verify installation', status: 'success', detail: `Skill reference confirmed in ${instructionLabel}` });
        return { success: true, steps };
      }

      steps.push({ id: 'verify', label: 'Verify installation', status: 'fail', detail: 'Reference not found after write' });
      return { success: false, steps };
    } catch (err: any) {
      steps.push({ id: 'verify', label: 'Verify installation', status: 'fail', detail: err.message });
      return { success: false, steps };
    }
  }

  // Claude Code: install the Vault Collab skill at ~/.claude/skills/vault-collab/SKILL.md.
  // Mirrors installClaudeSkill but for the separate coordination-layer skill.
  async function installClaudeCollabSkill(): Promise<{ success: boolean; steps: ConnectStep[] }> {
    const steps: ConnectStep[] = [];

    if (!(await fileExists(claudeCollabSkillPath))) {
      steps.push({ id: 'locate-skill', label: 'Locate bundled skill', status: 'fail', detail: `Not found: ${claudeCollabSkillPath}` });
      steps.push({ id: 'prepare-dir', label: 'Prepare skill directory', status: 'skipped' });
      steps.push({ id: 'write-skill', label: 'Write SKILL.md', status: 'skipped' });
      steps.push({ id: 'verify', label: 'Verify installation', status: 'skipped' });
      return { success: false, steps };
    }
    steps.push({ id: 'locate-skill', label: 'Locate bundled skill', status: 'success', detail: claudeCollabSkillPath });

    let skillContent: string;
    try {
      skillContent = await readFile(claudeCollabSkillPath, 'utf8');
    } catch (err: any) {
      steps.push({ id: 'prepare-dir', label: 'Prepare skill directory', status: 'fail', detail: err.message });
      steps.push({ id: 'write-skill', label: 'Write SKILL.md', status: 'skipped' });
      steps.push({ id: 'verify', label: 'Verify installation', status: 'skipped' });
      return { success: false, steps };
    }

    try {
      await mkdir(claudeUserCollabSkillDir, { recursive: true });
      steps.push({ id: 'prepare-dir', label: 'Prepare skill directory', status: 'success', detail: claudeUserCollabSkillDir });
    } catch (err: any) {
      steps.push({ id: 'prepare-dir', label: 'Prepare skill directory', status: 'fail', detail: err.message });
      steps.push({ id: 'write-skill', label: 'Write SKILL.md', status: 'skipped' });
      steps.push({ id: 'verify', label: 'Verify installation', status: 'skipped' });
      return { success: false, steps };
    }

    // Back up an existing SKILL.md before overwriting so we don't blow away a customised skill.
    if (await fileExists(claudeUserCollabSkillPath)) {
      try {
        const existing = await readFile(claudeUserCollabSkillPath, 'utf8');
        if (existing.trim() === skillContent.trim()) {
          steps.push({ id: 'write-skill', label: 'Write SKILL.md', status: 'skipped', detail: 'Already up-to-date' });
          steps.push({ id: 'verify', label: 'Verify installation', status: 'success', detail: claudeUserCollabSkillPath });
          return { success: true, steps };
        }
        await copyFile(claudeUserCollabSkillPath, `${claudeUserCollabSkillPath}.vault-backup-${Date.now()}`);
      } catch {
        // Best-effort backup; don't fail the install if the backup write fails.
      }
    }

    try {
      await writeFile(claudeUserCollabSkillPath, skillContent, 'utf8');
      steps.push({ id: 'write-skill', label: 'Write SKILL.md', status: 'success', detail: claudeUserCollabSkillPath });
    } catch (err: any) {
      steps.push({ id: 'write-skill', label: 'Write SKILL.md', status: 'fail', detail: err.message });
      steps.push({ id: 'verify', label: 'Verify installation', status: 'skipped' });
      return { success: false, steps };
    }

    try {
      const written = await readFile(claudeUserCollabSkillPath, 'utf8');
      if (written.trim() === skillContent.trim()) {
        steps.push({ id: 'verify', label: 'Verify installation', status: 'success', detail: 'SKILL.md confirmed on disk' });
        return { success: true, steps };
      }
      steps.push({ id: 'verify', label: 'Verify installation', status: 'fail', detail: 'Content mismatch after write' });
      return { success: false, steps };
    } catch (err: any) {
      steps.push({ id: 'verify', label: 'Verify installation', status: 'fail', detail: err.message });
      return { success: false, steps };
    }
  }

  // Codex: append a "## Vault Collab Skill" reference into ~/.codex/AGENTS.md.
  async function installCodexCollabSkillReference(): Promise<{ success: boolean; steps: ConnectStep[] }> {
    const steps: ConnectStep[] = [];
    const skillPath = codexCollabSkillPath;
    const instructionPath = codexAgentsPath;
    const instructionLabel = 'AGENTS.md';
    const referenceToken = 'codex-vault-collab-skill';
    const skillSection = [
      '',
      '',
      '## Vault Collab Skill',
      '',
      `Codex should use the Vault Collab skill at \`${codexCollabSkillPath}\` when joining the Vault Collab coordination layer.`,
      'Use Vault Collab MCP tools only when the `vault-collab` server is attached, and read vault_collab_get_agent_guide as the authoritative live loop.',
      'Keep the skill path stable so Codex setup prompts and future sessions can reference it directly.',
      '',
    ].join('\n');

    if (!(await fileExists(skillPath))) {
      steps.push({ id: 'locate-skill', label: 'Locate skill file', status: 'fail', detail: `Not found: ${skillPath}` });
      steps.push({ id: 'read-instructions', label: `Read ${instructionLabel}`, status: 'skipped' });
      steps.push({ id: 'check-existing', label: 'Check existing reference', status: 'skipped' });
      steps.push({ id: 'append-reference', label: 'Add skill reference', status: 'skipped' });
      steps.push({ id: 'verify', label: 'Verify installation', status: 'skipped' });
      return { success: false, steps };
    }
    steps.push({ id: 'locate-skill', label: 'Locate skill file', status: 'success', detail: skillPath });

    let instructionContent = '';
    try {
      instructionContent = await readFile(instructionPath, 'utf8');
      steps.push({ id: 'read-instructions', label: `Read ${instructionLabel}`, status: 'success', detail: instructionPath });
    } catch (err: any) {
      if (err.code === 'ENOENT') {
        steps.push({ id: 'read-instructions', label: `Read ${instructionLabel}`, status: 'success', detail: `Will create: ${instructionPath}` });
      } else {
        steps.push({ id: 'read-instructions', label: `Read ${instructionLabel}`, status: 'fail', detail: err.message });
        steps.push({ id: 'check-existing', label: 'Check existing reference', status: 'skipped' });
        steps.push({ id: 'append-reference', label: 'Add skill reference', status: 'skipped' });
        steps.push({ id: 'verify', label: 'Verify installation', status: 'skipped' });
        return { success: false, steps };
      }
    }

    if (instructionContent.includes(referenceToken) || instructionContent.includes('## Vault Collab Skill')) {
      steps.push({ id: 'check-existing', label: 'Check existing reference', status: 'success', detail: 'Skill reference already present' });
      steps.push({ id: 'append-reference', label: 'Add skill reference', status: 'skipped', detail: 'No changes needed' });
      steps.push({ id: 'verify', label: 'Verify installation', status: 'success', detail: `Already installed in ${instructionLabel}` });
      return { success: true, steps };
    }
    steps.push({ id: 'check-existing', label: 'Check existing reference', status: 'success', detail: 'No existing reference found' });

    try {
      await mkdir(dirname(instructionPath), { recursive: true });
      await writeFile(instructionPath, instructionContent + skillSection, 'utf8');
      steps.push({ id: 'append-reference', label: 'Add skill reference', status: 'success', detail: `Appended Vault Collab Skill section to ${instructionLabel}` });
    } catch (err: any) {
      steps.push({ id: 'append-reference', label: 'Add skill reference', status: 'fail', detail: err.message });
      steps.push({ id: 'verify', label: 'Verify installation', status: 'skipped' });
      return { success: false, steps };
    }

    try {
      const verifyContent = await readFile(instructionPath, 'utf8');
      if (verifyContent.includes(referenceToken) || verifyContent.includes('## Vault Collab Skill')) {
        steps.push({ id: 'verify', label: 'Verify installation', status: 'success', detail: `Skill reference confirmed in ${instructionLabel}` });
        return { success: true, steps };
      }

      steps.push({ id: 'verify', label: 'Verify installation', status: 'fail', detail: 'Reference not found after write' });
      return { success: false, steps };
    } catch (err: any) {
      steps.push({ id: 'verify', label: 'Verify installation', status: 'fail', detail: err.message });
      return { success: false, steps };
    }
  }

  // Remove the Vault Collab skill: delete Claude's SKILL.md or strip the Codex AGENTS.md section.
  async function uninstallCollabSkill(
    target: 'claude' | 'codex',
  ): Promise<{ success: boolean; steps: ConnectStep[] }> {
    const steps: ConnectStep[] = [];

    if (target === 'claude') {
      if (await fileExists(claudeUserCollabSkillPath)) {
        try {
          const { unlink } = await import('node:fs/promises');
          await unlink(claudeUserCollabSkillPath);
          steps.push({ id: 'remove-skill-file', label: 'Remove SKILL.md', status: 'success', detail: claudeUserCollabSkillPath });
        } catch (err: any) {
          steps.push({ id: 'remove-skill-file', label: 'Remove SKILL.md', status: 'fail', detail: err.message });
          return { success: false, steps };
        }
      } else {
        steps.push({ id: 'remove-skill-file', label: 'Remove SKILL.md', status: 'skipped', detail: 'No SKILL.md found' });
      }
      steps.push({ id: 'verify', label: 'Verify removal', status: 'success', detail: 'Vault Collab skill removed' });
      return { success: true, steps };
    }

    const instructionPath = codexAgentsPath;
    const instructionLabel = 'AGENTS.md';
    let instructionContent = '';
    try {
      instructionContent = await readFile(instructionPath, 'utf8');
      steps.push({ id: 'read-instructions', label: `Read ${instructionLabel}`, status: 'success', detail: instructionPath });
    } catch (err: any) {
      if (err.code === 'ENOENT') {
        steps.push({ id: 'read-instructions', label: `Read ${instructionLabel}`, status: 'success', detail: 'File does not exist — nothing to remove' });
        steps.push({ id: 'remove-reference', label: 'Remove skill section', status: 'skipped' });
        steps.push({ id: 'verify', label: 'Verify removal', status: 'success', detail: 'Already uninstalled' });
        return { success: true, steps };
      }
      steps.push({ id: 'read-instructions', label: `Read ${instructionLabel}`, status: 'fail', detail: err.message });
      return { success: false, steps };
    }

    if (!instructionContent.includes('Vault Collab Skill')) {
      steps.push({ id: 'remove-reference', label: 'Remove skill section', status: 'skipped', detail: 'No skill reference found — already uninstalled' });
      steps.push({ id: 'verify', label: 'Verify removal', status: 'success', detail: 'Already uninstalled' });
      return { success: true, steps };
    }

    try {
      const cleaned = instructionContent.replace(/\n*## Vault Collab Skill\n[\s\S]*?(?=\n## |\s*$)/, '');
      await writeFile(instructionPath, cleaned.trimEnd() + '\n', 'utf8');
      steps.push({ id: 'remove-reference', label: 'Remove skill section', status: 'success', detail: `Vault Collab Skill section removed from ${instructionLabel}` });
    } catch (err: any) {
      steps.push({ id: 'remove-reference', label: 'Remove skill section', status: 'fail', detail: err.message });
      return { success: false, steps };
    }

    try {
      const verifyContent = await readFile(instructionPath, 'utf8');
      if (!verifyContent.includes('Vault Collab Skill')) {
        steps.push({ id: 'verify', label: 'Verify removal', status: 'success', detail: 'Skill reference confirmed removed' });
        return { success: true, steps };
      }
      steps.push({ id: 'verify', label: 'Verify removal', status: 'fail', detail: 'Reference still present after write' });
      return { success: false, steps };
    } catch (err: any) {
      steps.push({ id: 'verify', label: 'Verify removal', status: 'fail', detail: err.message });
      return { success: false, steps };
    }
  }

  async function installVaultCollabCommandFiles(): Promise<ConnectStep[]> {
    const steps: ConnectStep[] = [];
    const content = buildVaultCollabCommandContent();
    const targets = [
      { label: 'Claude Code /vault-collab command', dir: claudeCommandsDir, path: claudeVaultCollabCommandPath },
    ];

    for (const target of targets) {
      const targetId = target.label.toLowerCase().replace(/[^a-z0-9]+/g, '-');
      try {
        await mkdir(target.dir, { recursive: true });
        if (await fileExists(target.path)) {
          const existing = await readFile(target.path, 'utf8');
          if (existing.trim() === content.trim()) {
            steps.push({ id: `${targetId}-up-to-date`, label: target.label, status: 'success', detail: 'Already installed' });
            continue;
          }
          await copyFile(target.path, `${target.path}.vault-backup-${Date.now()}`);
        }
        await writeFile(target.path, content, 'utf8');
        steps.push({ id: `${targetId}-write`, label: target.label, status: 'success', detail: target.path });
      } catch (err: any) {
        steps.push({ id: `${targetId}-write`, label: target.label, status: 'fail', detail: err.message });
      }
    }

    steps.push({
      id: 'codex-slash-command-note',
      label: 'Codex shortcut',
      status: 'skipped',
      detail: 'Codex does not currently load personal unprefixed slash commands from ~/.codex/commands; use a normal prompt like "use vault collab" after MCP restart.',
    });

    return steps;
  }

  async function removeVaultCollabCommandFiles(): Promise<ConnectStep[]> {
    const steps: ConnectStep[] = [];
    const targets = [
      { label: 'Claude Code /vault-collab command', path: claudeVaultCollabCommandPath },
      { label: 'Legacy Codex /vault-collab command file', path: codexVaultCollabCommandPath },
    ];
    const { unlink } = await import('node:fs/promises');

    for (const target of targets) {
      const targetId = target.label.toLowerCase().replace(/[^a-z0-9]+/g, '-');
      if (!(await fileExists(target.path))) {
        steps.push({ id: `${targetId}-remove`, label: target.label, status: 'skipped', detail: 'Not installed' });
        continue;
      }

      try {
        await copyFile(target.path, `${target.path}.vault-backup-${Date.now()}`);
        await unlink(target.path);
        steps.push({ id: `${targetId}-remove`, label: target.label, status: 'success', detail: target.path });
      } catch (err: any) {
        steps.push({ id: `${targetId}-remove`, label: target.label, status: 'fail', detail: err.message });
      }
    }

    return steps;
  }

  async function connectVaultCollabClients(): Promise<{ success: boolean; steps: ConnectStep[]; backupPath?: string }> {
    const steps: ConnectStep[] = [];
    const backupPaths: string[] = [];
    const launchConfig = getVaultCollabMcpLaunchConfig();

    try {
      await mkdir(dirname(vault.getVaultCollabRuntimeConfig().databasePath), { recursive: true });
    } catch (err: any) {
      steps.push({ id: 'prepare-database-dir', label: 'Prepare Vault Collab database directory', status: 'fail', detail: err.message });
      return { success: false, steps };
    }
    steps.push({ id: 'prepare-database-dir', label: 'Prepare Vault Collab database directory', status: 'success', detail: vault.getVaultCollabRuntimeConfig().databasePath });

    const targets = [
      { label: 'Claude Desktop', run: () => connectMcpToConfig(claudeDesktopConfigPath, 'Claude Desktop', 'vault-collab', launchConfig) },
      { label: 'Claude Code', run: () => connectMcpToConfig(claudeCodeSettingsPath, 'Claude Code', 'vault-collab', launchConfig) },
      { label: 'Codex', run: () => connectMcpToCodexConfig('vault-collab', launchConfig) },
    ];

    for (const target of targets) {
      const result = await target.run();
      steps.push(...result.steps.map((step) => ({ ...step, id: `vault-collab-${target.label.toLowerCase().replace(/\s+/g, '-')}-${step.id}`, label: `${target.label}: ${step.label}` })));
      if (result.backupPath) {
        backupPaths.push(result.backupPath);
      }
    }

    steps.push(...await installVaultCollabCommandFiles());

    return {
      success: steps.every((step) => step.status !== 'fail'),
      steps,
      backupPath: backupPaths.join('; ') || undefined,
    };
  }

  function logAutoMigration(label: string, result: { success: boolean; steps: ConnectStep[]; backupPath?: string }): void {
    const changed = result.steps.some((step) => step.status === 'success' && (
      step.id === 'write-config'
      || step.id === 'write-skill'
      || step.id === 'append-reference'
    ));
    const failedStep = result.steps.find((step) => step.status === 'fail');

    if (result.success && changed) {
      console.info(`[vault] Auto-migrated ${label}${result.backupPath ? `; backup: ${result.backupPath}` : ''}`);
      return;
    }

    if (!result.success) {
      console.warn(`[vault] Auto-migration skipped for ${label}: ${failedStep?.detail || 'unknown failure'}`);
    }
  }

  async function runConnectionAutoMigration(): Promise<void> {
    try {
      const launchConfig = getMcpLaunchConfig();

      const desktopResult = await readJsonFile(claudeDesktopConfigPath);
      if (!desktopResult.error && shouldAutoConnectJsonMcp({ currentConfig: desktopResult.data, launchConfig })) {
        logAutoMigration('Claude Desktop MCP config', await connectMcpToConfig(claudeDesktopConfigPath, 'Claude Desktop'));
      }

      const codeResult = await readJsonFile(claudeCodeSettingsPath);
      const legacyCodeResult = await readJsonFile(legacyClaudeCodeSettingsPath);
      if (
        !codeResult.error
        && !legacyCodeResult.error
        && shouldAutoConnectJsonMcp({
          currentConfig: codeResult.data,
          legacyConfig: legacyCodeResult.data,
          launchConfig,
        })
      ) {
        logAutoMigration('Claude Code MCP config', await connectMcpToConfig(claudeCodeSettingsPath, 'Claude Code'));
      }

      const codexConfigContent = await readTextFileIfExists(codexConfigPath);
      if (
        codexConfigContent !== null
        && hasCodexVaultEntry(codexConfigContent)
        && !hasCurrentCodexVaultEntry(codexConfigContent, launchConfig)
      ) {
        logAutoMigration('Codex MCP config', await connectMcpToCodexConfig());
      }

      const bundledSkillContent = await readTextFileIfExists(claudeSkillPath);
      const installedSkillContent = await readTextFileIfExists(claudeUserSkillPath);
      const claudeInstructionsContent = await readTextFileIfExists(claudeMdPath);
      if (shouldAutoInstallClaudeSkill({ bundledSkillContent, installedSkillContent, claudeInstructionsContent })) {
        logAutoMigration('Claude Code Vault skill', await installClaudeSkill());
      }
    } catch (err) {
      console.warn('[vault] Connection auto-migration failed:', err instanceof Error ? err.message : String(err));
    }
  }

  void runConnectionAutoMigration();

  ipcMain.handle('vault:installSkillFile', async (_, target) => {
    try {
      let data;
      switch (target) {
        case 'codex':
          data = await installCodexSkillReference();
          break;
        case 'claude-collab':
          data = await installClaudeCollabSkill();
          break;
        case 'codex-collab':
          data = await installCodexCollabSkillReference();
          break;
        case 'claude':
        default:
          data = await installClaudeSkill();
          break;
      }
      return { success: true, data };
    } catch (e: any) {
      return { success: false, error: e.message };
    }
  });

  // --- Disconnect handlers ---

  async function disconnectMcpFromCodexConfig(serverName = 'vault-memory'): Promise<{ success: boolean; steps: ConnectStep[]; backupPath?: string }> {
    const steps: ConnectStep[] = [];

    let configContent = '';
    try {
      configContent = await readFile(codexConfigPath, 'utf8');
      steps.push({ id: 'read-config', label: 'Read Codex config', status: 'success', detail: codexConfigPath });
    } catch (err: any) {
      if (err.code === 'ENOENT') {
        steps.push({ id: 'read-config', label: 'Read Codex config', status: 'success', detail: 'File does not exist — nothing to remove' });
        steps.push({ id: 'check-existing', label: `Check ${serverName} entry`, status: 'skipped' });
        steps.push({ id: 'backup', label: 'Backup config', status: 'skipped' });
        steps.push({ id: 'remove-entry', label: 'Remove MCP entry', status: 'skipped' });
        steps.push({ id: 'verify', label: 'Verify removal', status: 'success', detail: 'Already disconnected' });
        return { success: true, steps };
      }

      steps.push({ id: 'read-config', label: 'Read Codex config', status: 'fail', detail: err.message });
      steps.push({ id: 'check-existing', label: `Check ${serverName} entry`, status: 'skipped' });
      steps.push({ id: 'backup', label: 'Backup config', status: 'skipped' });
      steps.push({ id: 'remove-entry', label: 'Remove MCP entry', status: 'skipped' });
      steps.push({ id: 'verify', label: 'Verify removal', status: 'skipped' });
      return { success: false, steps };
    }

    if (!hasCodexMcpEntry(configContent, serverName)) {
      steps.push({ id: 'check-existing', label: `Check ${serverName} entry`, status: 'success', detail: `No ${serverName} entry found — already disconnected` });
      steps.push({ id: 'backup', label: 'Backup config', status: 'skipped', detail: 'No changes needed' });
      steps.push({ id: 'remove-entry', label: 'Remove MCP entry', status: 'skipped', detail: 'No changes needed' });
      steps.push({ id: 'verify', label: 'Verify removal', status: 'success', detail: 'Already disconnected' });
      return { success: true, steps };
    }
    steps.push({ id: 'check-existing', label: `Check ${serverName} entry`, status: 'success', detail: 'Entry found — will remove' });

    let backupPath: string | undefined;
    try {
      backupPath = `${codexConfigPath}.vault-backup-${Date.now()}`;
      await copyFile(codexConfigPath, backupPath);
      steps.push({ id: 'backup', label: 'Backup config', status: 'success', detail: backupPath });
    } catch (err: any) {
      steps.push({ id: 'backup', label: 'Backup config', status: 'fail', detail: err.message });
      steps.push({ id: 'remove-entry', label: 'Remove MCP entry', status: 'skipped' });
      steps.push({ id: 'verify', label: 'Verify removal', status: 'skipped' });
      return { success: false, steps, backupPath };
    }

    try {
      const cleaned = removeCodexMcpEntry(configContent, serverName);
      await writeFile(codexConfigPath, cleaned ? `${cleaned}\n` : '', 'utf8');
      steps.push({ id: 'remove-entry', label: 'Remove MCP entry', status: 'success', detail: `${serverName} entry removed from config.toml` });
    } catch (err: any) {
      steps.push({ id: 'remove-entry', label: 'Remove MCP entry', status: 'fail', detail: err.message });
      steps.push({ id: 'verify', label: 'Verify removal', status: 'skipped' });
      return { success: false, steps, backupPath };
    }

    try {
      const verifyContent = await readFile(codexConfigPath, 'utf8');
      if (!hasCodexMcpEntry(verifyContent, serverName)) {
        steps.push({ id: 'verify', label: 'Verify removal', status: 'success', detail: 'Entry confirmed removed from config.toml' });
        return { success: true, steps, backupPath };
      }

      steps.push({ id: 'verify', label: 'Verify removal', status: 'fail', detail: 'Entry still present after write' });
      return { success: false, steps, backupPath };
    } catch (err: any) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
        steps.push({ id: 'verify', label: 'Verify removal', status: 'success', detail: 'Config file absent after removal' });
        return { success: true, steps, backupPath };
      }

      steps.push({ id: 'verify', label: 'Verify removal', status: 'fail', detail: err.message });
      return { success: false, steps, backupPath };
    }
  }

  async function disconnectMcpFromConfig(
    configPath: string,
    label: string,
    serverName = 'vault-memory',
  ): Promise<{ success: boolean; steps: ConnectStep[]; backupPath?: string }> {
    const steps: ConnectStep[] = [];

    // Step 1: Read config
    const configResult = await readJsonFile(configPath);
    if (!configResult.exists || !configResult.data) {
      const readStatus = configResult.error ? 'fail' : 'success';
      steps.push({ id: 'read-config', label: `Read ${label} config`, status: readStatus, detail: configResult.error || 'File does not exist — nothing to remove' });
      steps.push({ id: 'check-existing', label: `Check ${serverName} entry`, status: configResult.error ? 'skipped' : 'success', detail: configResult.error ? undefined : 'Already disconnected' });
      steps.push({ id: 'backup', label: 'Backup config', status: 'skipped' });
      steps.push({ id: 'remove-entry', label: 'Remove MCP entry', status: 'skipped' });
      steps.push({ id: 'verify', label: 'Verify removal', status: configResult.error ? 'skipped' : 'success', detail: configResult.error ? undefined : 'Already disconnected' });
      return { success: !configResult.error, steps };
    }
    steps.push({ id: 'read-config', label: `Read ${label} config`, status: 'success', detail: configPath });

    // Step 2: Check if vault-memory exists
    const config = configResult.data;
    if (!config.mcpServers?.[serverName]) {
      steps.push({ id: 'check-existing', label: `Check ${serverName} entry`, status: 'success', detail: `No ${serverName} entry found — already disconnected` });
      steps.push({ id: 'backup', label: 'Backup config', status: 'skipped', detail: 'No changes needed' });
      steps.push({ id: 'remove-entry', label: 'Remove MCP entry', status: 'skipped', detail: 'No changes needed' });
      steps.push({ id: 'verify', label: 'Verify removal', status: 'success', detail: 'Already disconnected' });
      return { success: true, steps };
    }
    steps.push({ id: 'check-existing', label: `Check ${serverName} entry`, status: 'success', detail: 'Entry found — will remove' });

    // Step 3: Backup
    let backupPath: string | undefined;
    try {
      backupPath = `${configPath}.vault-backup-${Date.now()}`;
      await copyFile(configPath, backupPath);
      steps.push({ id: 'backup', label: 'Backup config', status: 'success', detail: backupPath });
    } catch (err: any) {
      steps.push({ id: 'backup', label: 'Backup config', status: 'fail', detail: err.message });
      steps.push({ id: 'remove-entry', label: 'Remove MCP entry', status: 'skipped' });
      steps.push({ id: 'verify', label: 'Verify removal', status: 'skipped' });
      return { success: false, steps, backupPath };
    }

    // Step 4: Remove entry and write
    try {
      delete config.mcpServers[serverName];
      // Clean up empty mcpServers object
      if (Object.keys(config.mcpServers).length === 0) {
        delete config.mcpServers;
      }
      await writeFile(configPath, JSON.stringify(config, null, 2), 'utf8');
      steps.push({ id: 'remove-entry', label: 'Remove MCP entry', status: 'success', detail: `${serverName} entry removed` });
    } catch (err: any) {
      steps.push({ id: 'remove-entry', label: 'Remove MCP entry', status: 'fail', detail: err.message });
      steps.push({ id: 'verify', label: 'Verify removal', status: 'skipped' });
      return { success: false, steps, backupPath };
    }

    // Step 5: Verify
    try {
      const verifyResult = await readJsonFile(configPath);
      if (!verifyResult.data?.mcpServers?.[serverName]) {
        steps.push({ id: 'verify', label: 'Verify removal', status: 'success', detail: 'Entry confirmed removed from config' });
      } else {
        steps.push({ id: 'verify', label: 'Verify removal', status: 'fail', detail: 'Entry still present after write' });
        return { success: false, steps, backupPath };
      }
    } catch (err: any) {
      steps.push({ id: 'verify', label: 'Verify removal', status: 'fail', detail: err.message });
      return { success: false, steps, backupPath };
    }

    return { success: true, steps, backupPath };
  }

  async function disconnectVaultCollabClients(): Promise<{ success: boolean; steps: ConnectStep[]; backupPath?: string }> {
    const steps: ConnectStep[] = [];
    const backupPaths: string[] = [];
    const targets = [
      { label: 'Claude Desktop', run: () => disconnectMcpFromConfig(claudeDesktopConfigPath, 'Claude Desktop', 'vault-collab') },
      { label: 'Claude Code', run: () => disconnectMcpFromConfig(claudeCodeSettingsPath, 'Claude Code', 'vault-collab') },
      { label: 'Codex', run: () => disconnectMcpFromCodexConfig('vault-collab') },
    ];

    for (const target of targets) {
      const result = await target.run();
      steps.push(...result.steps.map((step) => ({
        ...step,
        id: `vault-collab-${target.label.toLowerCase().replace(/\s+/g, '-')}-${step.id}`,
        label: `${target.label}: ${step.label}`,
      })));
      if (result.backupPath) {
        backupPaths.push(result.backupPath);
      }
    }

    steps.push(...await removeVaultCollabCommandFiles());

    return {
      success: steps.every((step) => step.status !== 'fail'),
      steps,
      backupPath: backupPaths.join('; ') || undefined,
    };
  }

  ipcMain.handle('vault:disconnectVaultCollabClients', async () => {
    try {
      const result = await disconnectVaultCollabClients();
      return { success: true, data: result };
    } catch (e: any) {
      return { success: false, error: e.message };
    }
  });

  ipcMain.handle('vault:disconnectClaudeDesktop', async () => {
    try {
      const result = await disconnectMcpFromConfig(claudeDesktopConfigPath, 'Claude Desktop');
      return { success: true, data: result };
    } catch (e: any) {
      return { success: false, error: e.message };
    }
  });

  ipcMain.handle('vault:disconnectClaudeCode', async () => {
    try {
      const result = await disconnectMcpFromConfig(claudeCodeSettingsPath, 'Claude Code');
      return { success: true, data: result };
    } catch (e: any) {
      return { success: false, error: e.message };
    }
  });

  ipcMain.handle('vault:disconnectCodex', async () => {
    try {
      const steps: ConnectStep[] = [];

      let configContent = '';
      try {
        configContent = await readFile(codexConfigPath, 'utf8');
        steps.push({ id: 'read-config', label: 'Read Codex config', status: 'success', detail: codexConfigPath });
      } catch (err: any) {
        if (err.code === 'ENOENT') {
          steps.push({ id: 'read-config', label: 'Read Codex config', status: 'success', detail: 'File does not exist — nothing to remove' });
          steps.push({ id: 'check-existing', label: 'Check vault-memory entry', status: 'skipped' });
          steps.push({ id: 'backup', label: 'Backup config', status: 'skipped' });
          steps.push({ id: 'remove-entry', label: 'Remove MCP entry', status: 'skipped' });
          steps.push({ id: 'verify', label: 'Verify removal', status: 'success', detail: 'Already disconnected' });
          return { success: true, data: { success: true, steps } };
        }

        steps.push({ id: 'read-config', label: 'Read Codex config', status: 'fail', detail: err.message });
        steps.push({ id: 'check-existing', label: 'Check vault-memory entry', status: 'skipped' });
        steps.push({ id: 'backup', label: 'Backup config', status: 'skipped' });
        steps.push({ id: 'remove-entry', label: 'Remove MCP entry', status: 'skipped' });
        steps.push({ id: 'verify', label: 'Verify removal', status: 'skipped' });
        return { success: true, data: { success: false, steps } };
      }

      if (!hasCodexVaultEntry(configContent)) {
        steps.push({ id: 'check-existing', label: 'Check vault-memory entry', status: 'success', detail: 'No vault-memory entry found — already disconnected' });
        steps.push({ id: 'backup', label: 'Backup config', status: 'skipped', detail: 'No changes needed' });
        steps.push({ id: 'remove-entry', label: 'Remove MCP entry', status: 'skipped', detail: 'No changes needed' });
        steps.push({ id: 'verify', label: 'Verify removal', status: 'success', detail: 'Already disconnected' });
        return { success: true, data: { success: true, steps } };
      }
      steps.push({ id: 'check-existing', label: 'Check vault-memory entry', status: 'success', detail: 'Entry found — will remove' });

      let backupPath: string | undefined;
      try {
        backupPath = `${codexConfigPath}.vault-backup-${Date.now()}`;
        await copyFile(codexConfigPath, backupPath);
        steps.push({ id: 'backup', label: 'Backup config', status: 'success', detail: backupPath });
      } catch (err: any) {
        steps.push({ id: 'backup', label: 'Backup config', status: 'fail', detail: err.message });
        steps.push({ id: 'remove-entry', label: 'Remove MCP entry', status: 'skipped' });
        steps.push({ id: 'verify', label: 'Verify removal', status: 'skipped' });
        return { success: true, data: { success: false, steps, backupPath } };
      }

      try {
        const cleaned = removeCodexVaultEntry(configContent);
        await writeFile(codexConfigPath, cleaned ? `${cleaned}\n` : '', 'utf8');
        steps.push({ id: 'remove-entry', label: 'Remove MCP entry', status: 'success', detail: 'vault-memory entry removed from config.toml' });
      } catch (err: any) {
        steps.push({ id: 'remove-entry', label: 'Remove MCP entry', status: 'fail', detail: err.message });
        steps.push({ id: 'verify', label: 'Verify removal', status: 'skipped' });
        return { success: true, data: { success: false, steps, backupPath } };
      }

      try {
        const verifyContent = await readFile(codexConfigPath, 'utf8');
        if (!hasCodexVaultEntry(verifyContent)) {
          steps.push({ id: 'verify', label: 'Verify removal', status: 'success', detail: 'Entry confirmed removed from config.toml' });
          return { success: true, data: { success: true, steps, backupPath } };
        }

        steps.push({ id: 'verify', label: 'Verify removal', status: 'fail', detail: 'Entry still present after write' });
        return { success: true, data: { success: false, steps, backupPath } };
      } catch (err: any) {
        if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
          steps.push({ id: 'verify', label: 'Verify removal', status: 'success', detail: 'Config file absent after removal' });
          return { success: true, data: { success: true, steps, backupPath } };
        }

        steps.push({ id: 'verify', label: 'Verify removal', status: 'fail', detail: err.message });
        return { success: true, data: { success: false, steps, backupPath } };
      }
    } catch (e: any) {
      return { success: false, error: e.message };
    }
  });

  async function uninstallSkillReference(
    target: 'claude' | 'codex',
  ): Promise<{ success: boolean; steps: ConnectStep[] }> {
    const steps: ConnectStep[] = [];
    const instructionPath = target === 'claude' ? claudeMdPath : codexAgentsPath;
    const instructionLabel = target === 'claude' ? 'CLAUDE.md' : 'AGENTS.md';

    // Claude Code: also delete the active SKILL.md. Without this, the previous install path
    // (~/.claude/skills/vault-memory/SKILL.md) keeps the skill loaded after "uninstall."
    if (target === 'claude') {
      if (await fileExists(claudeUserSkillPath)) {
        try {
          const { unlink } = await import('node:fs/promises');
          await unlink(claudeUserSkillPath);
          steps.push({ id: 'remove-skill-file', label: 'Remove SKILL.md', status: 'success', detail: claudeUserSkillPath });
        } catch (err: any) {
          steps.push({ id: 'remove-skill-file', label: 'Remove SKILL.md', status: 'fail', detail: err.message });
        }
      } else {
        steps.push({ id: 'remove-skill-file', label: 'Remove SKILL.md', status: 'skipped', detail: 'No SKILL.md found' });
      }
    }

    let instructionContent = '';
    try {
      instructionContent = await readFile(instructionPath, 'utf8');
      steps.push({ id: 'read-instructions', label: `Read ${instructionLabel}`, status: 'success', detail: instructionPath });
    } catch (err: any) {
      if (err.code === 'ENOENT') {
        steps.push({ id: 'read-instructions', label: `Read ${instructionLabel}`, status: 'success', detail: 'File does not exist — nothing to remove' });
        steps.push({ id: 'check-existing', label: 'Check skill reference', status: 'skipped' });
        steps.push({ id: 'remove-reference', label: 'Remove skill section', status: 'skipped' });
        steps.push({ id: 'verify', label: 'Verify removal', status: 'success', detail: 'Already uninstalled' });
        return { success: true, steps };
      }

      steps.push({ id: 'read-instructions', label: `Read ${instructionLabel}`, status: 'fail', detail: err.message });
      steps.push({ id: 'check-existing', label: 'Check skill reference', status: 'skipped' });
      steps.push({ id: 'remove-reference', label: 'Remove skill section', status: 'skipped' });
      steps.push({ id: 'verify', label: 'Verify removal', status: 'skipped' });
      return { success: false, steps };
    }

    if (!instructionContent.includes('Vault Memory Skill')) {
      steps.push({ id: 'check-existing', label: 'Check skill reference', status: 'success', detail: 'No skill reference found — already uninstalled' });
      steps.push({ id: 'remove-reference', label: 'Remove skill section', status: 'skipped', detail: 'No changes needed' });
      steps.push({ id: 'verify', label: 'Verify removal', status: 'success', detail: 'Already uninstalled' });
      return { success: true, steps };
    }
    steps.push({ id: 'check-existing', label: 'Check skill reference', status: 'success', detail: 'Skill reference found — will remove' });

    try {
      const cleaned = instructionContent.replace(/\n*## Vault Memory Skill\n[\s\S]*?(?=\n## |\s*$)/, '');
      await writeFile(instructionPath, cleaned.trimEnd() + '\n', 'utf8');
      steps.push({ id: 'remove-reference', label: 'Remove skill section', status: 'success', detail: `Vault Memory Skill section removed from ${instructionLabel}` });
    } catch (err: any) {
      steps.push({ id: 'remove-reference', label: 'Remove skill section', status: 'fail', detail: err.message });
      steps.push({ id: 'verify', label: 'Verify removal', status: 'skipped' });
      return { success: false, steps };
    }

    try {
      const verifyContent = await readFile(instructionPath, 'utf8');
      if (!verifyContent.includes('Vault Memory Skill')) {
        steps.push({ id: 'verify', label: 'Verify removal', status: 'success', detail: 'Skill reference confirmed removed' });
        return { success: true, steps };
      }

      steps.push({ id: 'verify', label: 'Verify removal', status: 'fail', detail: 'Reference still present after write' });
      return { success: false, steps };
    } catch (err: any) {
      steps.push({ id: 'verify', label: 'Verify removal', status: 'fail', detail: err.message });
      return { success: false, steps };
    }
  }

  ipcMain.handle('vault:uninstallSkillFile', async (_, target) => {
    try {
      let data;
      switch (target) {
        case 'codex':
          data = await uninstallSkillReference('codex');
          break;
        case 'claude-collab':
          data = await uninstallCollabSkill('claude');
          break;
        case 'codex-collab':
          data = await uninstallCollabSkill('codex');
          break;
        case 'claude':
        default:
          data = await uninstallSkillReference('claude');
          break;
      }
      return { success: true, data };
    } catch (e: any) {
      return { success: false, error: e.message };
    }
  });
});
