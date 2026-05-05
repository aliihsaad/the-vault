// electron/main.ts
import { app, BrowserWindow, ipcMain, safeStorage } from 'electron';
import { createCipheriv, createDecipheriv, createHash, randomBytes, scryptSync } from 'node:crypto';
import { existsSync } from 'node:fs';
import { access, copyFile, mkdir, readFile, readdir, stat, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { basename, dirname, extname, isAbsolute, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { detectDuplicates, OpenRouterClient, portableDecrypt, portableEncrypt, Vault } from '@the-vault/core';
import type { MemoryItemDetail, MemoryPack, ModelRoutingTable, RecallQuery } from '@the-vault/core';
import {
  detectLocalAdapterModel,
  executeLocalAdapter,
  getLocalAdapterConfigFingerprint,
  getLocalAdapterModels,
  getSupportedLocalAdapters,
  testLocalAdapterEnvironment,
} from './local-adapters.js';
import type { LocalAdapterRuntimeSession, LocalAdapterType } from './local-adapters.js';
import { TaskExecutor } from './task-executor.js';

// Recreate __dirname for ESM
const __dirname = dirname(fileURLToPath(import.meta.url));

// Initialize Vault
const vault = new Vault();
vault.initialize();

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

type StoredLocalAdapterConfig = {
  enabled?: boolean;
  type?: string;
  cwd?: string;
  command?: string;
  model?: string;
  effort?: string;
  chrome?: boolean;
  maxTurns?: number | null;
};

type StoredLocalAdapterRuntimeState = Partial<Record<LocalAdapterType, LocalAdapterRuntimeSession | null>>;
type StoredLocalAdapterTaskSessions = Partial<Record<LocalAdapterType, Record<string, LocalAdapterRuntimeSession>>>;

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

function parseStoredEnvOverride(): Record<string, string> {
  const rawValue = getSecretSetting('local_adapter_env_override');

  if (!rawValue.trim()) {
    return {};
  }

  const parsed = JSON.parse(rawValue) as Record<string, unknown>;
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('Saved local adapter environment override is not a valid JSON object.');
  }

  return Object.fromEntries(
    Object.entries(parsed).map(([key, value]) => [key, String(value)]),
  );
}

function getResolvedLocalAdapterConfig() {
  const storedConfig = (vault.getSetting('local_adapter_config') || {}) as StoredLocalAdapterConfig;
  const lastTest = (vault.getSetting('local_adapter_last_test') || null) as { canProceed?: boolean; configFingerprint?: string } | null;

  if (!storedConfig.enabled) {
    throw new Error('No enabled local adapter is configured. Enable and test a local adapter in Settings first.');
  }

  if (!storedConfig.type || (storedConfig.type !== 'claude_local' && storedConfig.type !== 'codex_local')) {
    throw new Error('Saved local adapter type is invalid.');
  }

  const resolvedConfig = {
    type: storedConfig.type,
    cwd: String(storedConfig.cwd || process.cwd()),
    command: String(storedConfig.command || ''),
    model: String(storedConfig.model || ''),
    effort: String(storedConfig.effort || ''),
    chrome: Boolean(storedConfig.chrome),
    maxTurns: typeof storedConfig.maxTurns === 'number' ? storedConfig.maxTurns : null,
    env: parseStoredEnvOverride(),
  } as const;

  const fingerprint = getLocalAdapterConfigFingerprint(resolvedConfig);
  if (!lastTest?.canProceed || lastTest.configFingerprint !== fingerprint) {
    throw new Error('The saved local adapter config has not been tested in its current form. Run `Test now` again in Settings.');
  }

  return resolvedConfig;
}

function getStoredLocalAdapterRuntimeState(): StoredLocalAdapterRuntimeState {
  const rawValue = vault.getSetting('local_adapter_runtime_state');
  if (!rawValue || typeof rawValue !== 'object' || Array.isArray(rawValue)) {
    return {};
  }

  const result: StoredLocalAdapterRuntimeState = {};
  for (const [key, value] of Object.entries(rawValue as Record<string, unknown>)) {
    if ((key !== 'claude_local' && key !== 'codex_local') || !value || typeof value !== 'object' || Array.isArray(value)) {
      continue;
    }

    const record = value as Record<string, unknown>;
    if (
      typeof record.sessionId !== 'string' ||
      typeof record.cwd !== 'string' ||
      typeof record.updatedAt !== 'string'
    ) {
      continue;
    }

    result[key] = {
      adapterType: key,
      sessionId: record.sessionId,
      sessionParams: record.sessionParams && typeof record.sessionParams === 'object' && !Array.isArray(record.sessionParams)
        ? record.sessionParams as Record<string, unknown>
        : null,
      sessionDisplayId: typeof record.sessionDisplayId === 'string' ? record.sessionDisplayId : null,
      cwd: record.cwd,
      model: typeof record.model === 'string' ? record.model : null,
      promptBundleVersion: typeof record.promptBundleVersion === 'string' ? record.promptBundleVersion : null,
      updatedAt: record.updatedAt,
    };
  }

  return result;
}

function setStoredLocalAdapterRuntimeState(nextState: StoredLocalAdapterRuntimeState): void {
  vault.setSetting('local_adapter_runtime_state', nextState);
}

function getStoredLocalAdapterTaskSessions(): StoredLocalAdapterTaskSessions {
  const rawValue = vault.getSetting('local_adapter_task_sessions');
  if (!rawValue || typeof rawValue !== 'object' || Array.isArray(rawValue)) {
    return {};
  }

  const result: StoredLocalAdapterTaskSessions = {};
  for (const [adapterType, entries] of Object.entries(rawValue as Record<string, unknown>)) {
    if ((adapterType !== 'claude_local' && adapterType !== 'codex_local') || !entries || typeof entries !== 'object' || Array.isArray(entries)) {
      continue;
    }

    const normalizedEntries: Record<string, LocalAdapterRuntimeSession> = {};
    for (const [taskKey, value] of Object.entries(entries as Record<string, unknown>)) {
      if (!taskKey.trim() || !value || typeof value !== 'object' || Array.isArray(value)) {
        continue;
      }

      const record = value as Record<string, unknown>;
      if (
        typeof record.sessionId !== 'string' ||
        typeof record.cwd !== 'string' ||
        typeof record.updatedAt !== 'string'
      ) {
        continue;
      }

      normalizedEntries[taskKey] = {
        adapterType,
        sessionId: record.sessionId,
        sessionParams: record.sessionParams && typeof record.sessionParams === 'object' && !Array.isArray(record.sessionParams)
          ? record.sessionParams as Record<string, unknown>
          : null,
        sessionDisplayId: typeof record.sessionDisplayId === 'string' ? record.sessionDisplayId : null,
        cwd: record.cwd,
        model: typeof record.model === 'string' ? record.model : null,
        promptBundleVersion: typeof record.promptBundleVersion === 'string' ? record.promptBundleVersion : null,
        updatedAt: record.updatedAt,
      };
    }

    if (Object.keys(normalizedEntries).length > 0) {
      result[adapterType] = normalizedEntries;
    }
  }

  return result;
}

function setStoredLocalAdapterTaskSessions(nextState: StoredLocalAdapterTaskSessions): void {
  vault.setSetting('local_adapter_task_sessions', nextState);
}

function updateStoredLocalAdapterSession(
  adapterType: LocalAdapterType,
  session: LocalAdapterRuntimeSession | null,
): StoredLocalAdapterRuntimeState {
  const nextState = {
    ...getStoredLocalAdapterRuntimeState(),
  };

  if (session) {
    nextState[adapterType] = session;
  } else {
    delete nextState[adapterType];
  }

  setStoredLocalAdapterRuntimeState(nextState);
  return nextState;
}

function normalizeTaskKey(taskKey: unknown): string {
  return typeof taskKey === 'string' ? taskKey.trim() : '';
}

function updateStoredLocalAdapterTaskSession(
  adapterType: LocalAdapterType,
  taskKey: string,
  session: LocalAdapterRuntimeSession | null,
): StoredLocalAdapterTaskSessions {
  const normalizedTaskKey = normalizeTaskKey(taskKey);
  const nextState = {
    ...getStoredLocalAdapterTaskSessions(),
  };

  if (!normalizedTaskKey) {
    return nextState;
  }

  const adapterSessions = {
    ...(nextState[adapterType] || {}),
  };

  if (session) {
    adapterSessions[normalizedTaskKey] = session;
  } else {
    delete adapterSessions[normalizedTaskKey];
  }

  if (Object.keys(adapterSessions).length > 0) {
    nextState[adapterType] = adapterSessions;
  } else {
    delete nextState[adapterType];
  }

  setStoredLocalAdapterTaskSessions(nextState);
  return nextState;
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
  createWindow();

  // IPC Handlers — Expose Vault methods
  
  ipcMain.handle('vault:status', () => {
    return {
      initialized: vault.isInitialized(),
      root: vault.getVaultRoot(),
      workspaceRoot: process.cwd(),
      projects: vault.listProjects(),
      appVersion: app.getVersion(),
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

  ipcMain.handle('vault:getSupportedLocalAdapters', () => {
    try {
      return { success: true, data: getSupportedLocalAdapters() };
    } catch (e: any) {
      return { success: false, error: e.message };
    }
  });

  ipcMain.handle('vault:getLocalAdapterModels', async (_, config) => {
    try {
      return { success: true, data: await getLocalAdapterModels(config) };
    } catch (e: any) {
      return { success: false, error: e.message };
    }
  });

  ipcMain.handle('vault:detectLocalAdapterModel', async (_, config) => {
    try {
      return { success: true, data: await detectLocalAdapterModel(config) };
    } catch (e: any) {
      return { success: false, error: e.message };
    }
  });

  ipcMain.handle('vault:testLocalAdapterEnvironment', async (_, config) => {
    try {
      return { success: true, data: await testLocalAdapterEnvironment(config) };
    } catch (e: any) {
      return { success: false, error: e.message };
    }
  });

  ipcMain.handle('vault:executeEnabledLocalAdapter', async (_, input) => {
    try {
      const resolvedConfig = getResolvedLocalAdapterConfig();
      const normalizedTaskKey = normalizeTaskKey(input?.taskKey);
      const runtimeState = getStoredLocalAdapterRuntimeState();
      const taskSessions = getStoredLocalAdapterTaskSessions();
      const taskSession = normalizedTaskKey
        ? taskSessions[resolvedConfig.type]?.[normalizedTaskKey] || null
        : null;
      const fallbackSession = runtimeState[resolvedConfig.type] || null;
      const previousSession = taskSession || fallbackSession;
      const result = await executeLocalAdapter(
        resolvedConfig,
        { ...input, taskKey: normalizedTaskKey || undefined },
        previousSession,
      );
      result.metadata.sessionScope = taskSession
        ? 'task'
        : fallbackSession
          ? 'adapter'
          : 'none';
      result.metadata.taskKey = normalizedTaskKey || null;

      const nextSession = result.sessionId
        ? {
            adapterType: result.adapterType,
            sessionId: result.sessionId,
            sessionParams: result.sessionParams,
            sessionDisplayId: result.sessionDisplayId,
            cwd: result.cwd,
            model: result.model,
            promptBundleVersion: result.metadata.promptBundleVersion,
            updatedAt: new Date().toISOString(),
          }
        : null;

      updateStoredLocalAdapterSession(result.adapterType, nextSession);
      if (normalizedTaskKey) {
        updateStoredLocalAdapterTaskSession(result.adapterType, normalizedTaskKey, nextSession);
      }

      return { success: true, data: result };
    } catch (e: any) {
      return { success: false, error: e.message };
    }
  });

  ipcMain.handle('vault:clearLocalAdapterSession', async (_, adapterType) => {
    try {
      if (adapterType !== 'claude_local' && adapterType !== 'codex_local') {
        throw new Error('Unsupported local adapter type.');
      }

      const nextState = updateStoredLocalAdapterSession(adapterType, null);
      return { success: true, data: nextState };
    } catch (e: any) {
      return { success: false, error: e.message };
    }
  });

  ipcMain.handle('vault:clearLocalAdapterTaskSession', async (_, adapterType, taskKey) => {
    try {
      if (adapterType !== 'claude_local' && adapterType !== 'codex_local') {
        throw new Error('Unsupported local adapter type.');
      }

      const normalizedTaskKey = normalizeTaskKey(taskKey);
      if (!normalizedTaskKey) {
        throw new Error('Task key is required.');
      }

      const nextState = updateStoredLocalAdapterTaskSession(adapterType, normalizedTaskKey, null);
      return { success: true, data: nextState };
    } catch (e: any) {
      return { success: false, error: e.message };
    }
  });

  // ==========================================================================
  // Connection setup handlers
  // ==========================================================================

  const claudeDesktopConfigPath = join(process.env.APPDATA || '', 'Claude', 'claude_desktop_config.json');
  const claudeCodeSettingsPath = join(homedir(), '.claude', 'settings.json');
  const claudeMdPath = join(homedir(), '.claude', 'CLAUDE.md');
  const codexConfigPath = join(homedir(), '.codex', 'config.toml');
  const claudeSkillPath = resolve(skillsPath, 'claude-vault-skill.md');
  const codexAgentsPath = join(homedir(), '.codex', 'AGENTS.md');
  const codexSkillPath = resolve(skillsPath, 'codex-vault-skill.md');

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
      return { exists: true, data: JSON.parse(content) };
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

  function mcpEntriesMatch(entry: any, launchConfig: McpLaunchConfig): boolean {
    return !!entry
      && entry.command === launchConfig.command
      && Array.isArray(entry.args)
      && JSON.stringify(entry.args) === JSON.stringify(launchConfig.args);
  }

  function hasCodexVaultEntry(content: string): boolean {
    return /\[mcp_servers(?:\."vault-memory"|\.vault-memory)\]/.test(content);
  }

  function removeCodexVaultEntry(content: string): string {
    return content
      .replace(/\n*\[mcp_servers(?:\."vault-memory"|\.vault-memory)\]\n[\s\S]*?(?=\n\[|$)/g, '\n')
      .replace(/\n{3,}/g, '\n\n')
      .trimEnd();
  }

  function hasCurrentCodexVaultEntry(content: string, launchConfig: McpLaunchConfig): boolean {
    return content.includes(buildCodexVaultEntry(launchConfig).trim());
  }

  function buildCodexVaultEntry(launchConfig: McpLaunchConfig): string {
    return [
      '[mcp_servers.vault-memory]',
      `command = ${JSON.stringify(launchConfig.command)}`,
      `args = [${launchConfig.args.map((arg) => JSON.stringify(arg)).join(', ')}]`,
      '',
    ].join('\n');
  }

  async function connectMcpToConfig(configPath: string, label: string): Promise<{ success: boolean; steps: ConnectStep[]; backupPath?: string }> {
    const steps: ConnectStep[] = [];
    const launchConfig = getMcpLaunchConfig();

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
    const existingEntry = config.mcpServers?.['vault-memory'];
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
      detail: existingEntry ? 'Entry exists but path differs — will update' : 'No existing vault-memory entry',
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
      config.mcpServers['vault-memory'] = {
        command: launchConfig.command,
        args: launchConfig.args,
      };

      await mkdir(dirname(configPath), { recursive: true });
      await writeFile(configPath, JSON.stringify(config, null, 2), 'utf8');
      steps.push({ id: 'write-config', label: 'Write MCP entry', status: 'success', detail: 'vault-memory entry written' });
    } catch (err: any) {
      steps.push({ id: 'write-config', label: 'Write MCP entry', status: 'fail', detail: err.message });
      steps.push({ id: 'verify', label: 'Verify config', status: 'skipped' });
      return { success: false, steps, backupPath };
    }

    // Step 6: Verify
    try {
      const verifyResult = await readJsonFile(configPath);
      if (mcpEntriesMatch(verifyResult.data?.mcpServers?.['vault-memory'], launchConfig)) {
        steps.push({ id: 'verify', label: 'Verify config', status: 'success', detail: 'Entry confirmed in config file' });
      } else {
        steps.push({ id: 'verify', label: 'Verify config', status: 'fail', detail: 'Entry not found after write' });
        return { success: false, steps, backupPath };
      }
    } catch (err: any) {
      steps.push({ id: 'verify', label: 'Verify config', status: 'fail', detail: err.message });
      return { success: false, steps, backupPath };
    }

    return { success: true, steps, backupPath };
  }

  async function connectMcpToCodexConfig(): Promise<{ success: boolean; steps: ConnectStep[]; backupPath?: string }> {
    const steps: ConnectStep[] = [];
    const launchConfig = getMcpLaunchConfig();

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

    if (hasCurrentCodexVaultEntry(configContent, launchConfig)) {
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
      detail: hasCodexVaultEntry(configContent) ? 'Entry exists but path differs — will update' : 'No existing vault-memory entry',
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
      const cleaned = removeCodexVaultEntry(configContent);
      const nextContent = `${cleaned.trimEnd()}${cleaned.trim() ? '\n\n' : ''}${buildCodexVaultEntry(launchConfig)}`;
      await mkdir(dirname(codexConfigPath), { recursive: true });
      await writeFile(codexConfigPath, nextContent, 'utf8');
      steps.push({ id: 'write-config', label: 'Write MCP entry', status: 'success', detail: 'vault-memory entry written to config.toml' });
    } catch (err: any) {
      steps.push({ id: 'write-config', label: 'Write MCP entry', status: 'fail', detail: err.message });
      steps.push({ id: 'verify', label: 'Verify config', status: 'skipped' });
      return { success: false, steps, backupPath };
    }

    try {
      const verifyContent = await readFile(codexConfigPath, 'utf8');
      if (hasCurrentCodexVaultEntry(verifyContent, launchConfig)) {
        steps.push({ id: 'verify', label: 'Verify config', status: 'success', detail: 'Entry confirmed in config.toml' });
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

      // Check Claude Desktop
      const desktopResult = await readJsonFile(claudeDesktopConfigPath);
      const desktopConfigured = mcpEntriesMatch(desktopResult.data?.mcpServers?.['vault-memory'], launchConfig);

      // Check Claude Code
      const codeResult = await readJsonFile(claudeCodeSettingsPath);
      const codeConfigured = mcpEntriesMatch(codeResult.data?.mcpServers?.['vault-memory'], launchConfig);

      // Check skill installation
      let claudeSkillInstalled = false;
      try {
        const claudeMdContent = await readFile(claudeMdPath, 'utf8');
        claudeSkillInstalled = claudeMdContent.includes('vault-memory') || claudeMdContent.includes('claude-vault-skill');
      } catch {
        // File doesn't exist — not installed
      }

      let codexSkillInstalled = false;
      try {
        const codexAgentsContent = await readFile(codexAgentsPath, 'utf8');
        codexSkillInstalled = codexAgentsContent.includes('codex-vault-skill') || codexAgentsContent.includes('Vault Memory Skill');
      } catch {
        // File doesn't exist — not installed
      }

      return {
        success: true,
        data: {
          claudeDesktop: { configured: desktopConfigured, configPath: claudeDesktopConfigPath },
          claudeCode: { configured: codeConfigured, configPath: claudeCodeSettingsPath },
          codex: {
            configured: await fileExists(codexConfigPath)
              ? hasCurrentCodexVaultEntry(await readFile(codexConfigPath, 'utf8'), launchConfig)
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
            codexInstalled: codexSkillInstalled,
            codexAgentsPath,
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

  async function installSkillReference(
    target: 'claude' | 'codex',
  ): Promise<{ success: boolean; steps: ConnectStep[] }> {
    const steps: ConnectStep[] = [];
    const skillPath = target === 'claude' ? claudeSkillPath : codexSkillPath;
    const instructionPath = target === 'claude' ? claudeMdPath : codexAgentsPath;
    const instructionLabel = target === 'claude' ? 'CLAUDE.md' : 'AGENTS.md';
    const referenceToken = target === 'claude' ? 'claude-vault-skill' : 'codex-vault-skill';
    const skillSection = target === 'claude'
      ? [
          '',
          '',
          '## Vault Memory Skill',
          '',
          `The Vault memory skill file is located at \`${claudeSkillPath}\`.`,
          'Reference this file when working with Vault memory tools (vault_save_memory, vault_recall_context, etc.).',
          'It teaches the agent when to recall, when to save, and how to structure memory items.',
          '',
        ].join('\n')
      : [
          '',
          '',
          '## Vault Memory Skill',
          '',
          `Codex should use the Vault memory skill at \`${codexSkillPath}\` when working in this repository.`,
          'Use Vault MCP when the `vault-memory` server is attached, and use the skill file as the operating guide for recall/save behavior.',
          'Keep the skill path stable so Codex setup prompts and future sessions can reference it directly.',
          '',
        ].join('\n');

    const skillExists = await fileExists(skillPath);
    if (!skillExists) {
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

  ipcMain.handle('vault:installSkillFile', async (_, target) => {
    try {
      const normalizedTarget = target === 'codex' ? 'codex' : 'claude';
      return { success: true, data: await installSkillReference(normalizedTarget) };
    } catch (e: any) {
      return { success: false, error: e.message };
    }
  });

  // --- Disconnect handlers ---

  async function disconnectMcpFromConfig(configPath: string, label: string): Promise<{ success: boolean; steps: ConnectStep[]; backupPath?: string }> {
    const steps: ConnectStep[] = [];

    // Step 1: Read config
    const configResult = await readJsonFile(configPath);
    if (!configResult.exists || !configResult.data) {
      steps.push({ id: 'read-config', label: `Read ${label} config`, status: 'fail', detail: configResult.error || 'Config file not found' });
      steps.push({ id: 'check-existing', label: 'Check vault-memory entry', status: 'skipped' });
      steps.push({ id: 'backup', label: 'Backup config', status: 'skipped' });
      steps.push({ id: 'remove-entry', label: 'Remove MCP entry', status: 'skipped' });
      steps.push({ id: 'verify', label: 'Verify removal', status: 'skipped' });
      return { success: false, steps };
    }
    steps.push({ id: 'read-config', label: `Read ${label} config`, status: 'success', detail: configPath });

    // Step 2: Check if vault-memory exists
    const config = configResult.data;
    if (!config.mcpServers?.['vault-memory']) {
      steps.push({ id: 'check-existing', label: 'Check vault-memory entry', status: 'success', detail: 'No vault-memory entry found — already disconnected' });
      steps.push({ id: 'backup', label: 'Backup config', status: 'skipped', detail: 'No changes needed' });
      steps.push({ id: 'remove-entry', label: 'Remove MCP entry', status: 'skipped', detail: 'No changes needed' });
      steps.push({ id: 'verify', label: 'Verify removal', status: 'success', detail: 'Already disconnected' });
      return { success: true, steps };
    }
    steps.push({ id: 'check-existing', label: 'Check vault-memory entry', status: 'success', detail: 'Entry found — will remove' });

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
      delete config.mcpServers['vault-memory'];
      // Clean up empty mcpServers object
      if (Object.keys(config.mcpServers).length === 0) {
        delete config.mcpServers;
      }
      await writeFile(configPath, JSON.stringify(config, null, 2), 'utf8');
      steps.push({ id: 'remove-entry', label: 'Remove MCP entry', status: 'success', detail: 'vault-memory entry removed' });
    } catch (err: any) {
      steps.push({ id: 'remove-entry', label: 'Remove MCP entry', status: 'fail', detail: err.message });
      steps.push({ id: 'verify', label: 'Verify removal', status: 'skipped' });
      return { success: false, steps, backupPath };
    }

    // Step 5: Verify
    try {
      const verifyResult = await readJsonFile(configPath);
      if (!verifyResult.data?.mcpServers?.['vault-memory']) {
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
      const normalizedTarget = target === 'codex' ? 'codex' : 'claude';
      return { success: true, data: await uninstallSkillReference(normalizedTarget) };
    } catch (e: any) {
      return { success: false, error: e.message };
    }
  });
});
