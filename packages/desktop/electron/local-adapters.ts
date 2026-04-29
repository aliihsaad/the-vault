import { randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import { access, constants as fsConstants, readFile, stat } from 'node:fs/promises';
import { homedir } from 'node:os';
import { basename, delimiter, isAbsolute, join, resolve } from 'node:path';
import {
  isUnknownSessionError,
  parseLocalAdapterExecution,
  type LocalAdapterTokenCounts,
} from './local-adapter-parsers.js';

export type LocalAdapterType = 'claude_local' | 'codex_local';

export type LocalAdapterConfig = {
  type: LocalAdapterType;
  cwd: string;
  command?: string;
  env?: Record<string, string>;
  model?: string;
  effort?: string;
  chrome?: boolean;
  maxTurns?: number | null;
};

type NormalizedLocalAdapterConfig = Omit<LocalAdapterConfig, 'command' | 'env' | 'model' | 'effort' | 'chrome' | 'maxTurns'> & {
  command: string;
  env: Record<string, string>;
  model: string;
  effort: string;
  chrome: boolean;
  maxTurns: number | null;
};

export type LocalAdapterDefinitionSummary = {
  type: LocalAdapterType;
  label: string;
  description: string;
  defaultCommand: string;
};

export type LocalAdapterModelSummary = {
  id: string;
  name: string;
  source: 'builtin' | 'fetched';
};

export type LocalAdapterCheck = {
  code: string;
  status: 'pass' | 'warn' | 'fail';
  level: 'info' | 'warn' | 'error';
  message: string;
  detail?: string;
  hint?: string;
};

export type LocalAdapterTestResult = {
  adapterType: LocalAdapterType;
  recognized: boolean;
  canProceed: boolean;
  authMode: string | null;
  command: string;
  resolvedCommand: string | null;
  cwd: string;
  manualCommand: string;
  checks: LocalAdapterCheck[];
  models: LocalAdapterModelSummary[];
  configFingerprint: string;
  testedAt: string;
  probe: {
    skipped: boolean;
    exitCode: number | null;
    timedOut: boolean;
    summary: string;
    stdout: string;
    stderr: string;
  };
};

export type LocalAdapterExecutionInput = {
  prompt: string;
  memoryContext?: string;
  taskKey?: string;
};

export type LocalAdapterRuntimeSession = {
  adapterType: LocalAdapterType;
  sessionId: string;
  sessionParams: Record<string, unknown> | null;
  sessionDisplayId: string | null;
  cwd: string;
  model: string | null;
  promptBundleVersion: string | null;
  updatedAt: string;
};

export type LocalAdapterExecutionResult = {
  adapterType: LocalAdapterType;
  command: string;
  resolvedCommand: string;
  cwd: string;
  model: string | null;
  effort: string | null;
  durationMs: number;
  exitCode: number | null;
  output: string;
  stdout: string;
  stderr: string;
  sessionId: string | null;
  sessionParams: Record<string, unknown> | null;
  sessionDisplayId: string | null;
  metadata: {
    provider: string;
    biller: string;
    reusedSession: boolean;
    rotatedSession: boolean;
    resumeAttempted: boolean;
    resumeFailed: boolean;
    promptBundleVersion: string | null;
    sessionScope: 'none' | 'adapter' | 'task';
    taskKey: string | null;
    tokenCounts: LocalAdapterTokenCounts | null;
    cost: null;
  };
};

type ProbeRunResult = {
  exitCode: number | null;
  stdout: string;
  stderr: string;
  timedOut: boolean;
  errorMessage?: string;
};

type AuthDetection = {
  mode: string | null;
  checks: LocalAdapterCheck[];
};

type AdapterDefinition = LocalAdapterDefinitionSummary & {
  expectedCommandBasename: string;
  testEnvironment: (config: LocalAdapterConfig) => Promise<LocalAdapterTestResult>;
  listModels: (config: LocalAdapterConfig) => Promise<LocalAdapterModelSummary[]>;
  detectModel?: (config: LocalAdapterConfig) => Promise<string | null>;
  execute: (
    config: LocalAdapterConfig,
    input: LocalAdapterExecutionInput,
    previousSession?: LocalAdapterRuntimeSession | null,
  ) => Promise<LocalAdapterExecutionResult>;
};

const OPENAI_MODELS_URL = 'https://api.openai.com/v1/models';
const MODEL_CACHE_TTL_MS = 60_000;
const LOCAL_ADAPTER_PROMPT_BUNDLE_VERSION = 'vault-chat-v1';
const CLAUDE_NATIVE_AUTH_FILES = [
  join(homedir(), '.claude', '.credentials.json'),
  join(homedir(), '.claude', '.claude.json'),
  join(homedir(), '.claude.json'),
];
const CLAUDE_SETTINGS_PATHS = [
  join(homedir(), '.claude', 'settings.json'),
  join(homedir(), '.claude.json'),
];
const CODEX_NATIVE_AUTH_FILES = [
  join(homedir(), '.codex', 'auth.json'),
  join(homedir(), '.codex', 'config.toml'),
];
const CODEX_CONFIG_PATH = join(homedir(), '.codex', 'config.toml');

const CLAUDE_MODELS: LocalAdapterModelSummary[] = [
  { id: 'sonnet', name: 'Claude Sonnet', source: 'builtin' },
  { id: 'opus', name: 'Claude Opus', source: 'builtin' },
  { id: 'haiku', name: 'Claude Haiku', source: 'builtin' },
  { id: 'claude-sonnet-4-5', name: 'Claude Sonnet 4.5', source: 'builtin' },
  { id: 'claude-opus-4-1', name: 'Claude Opus 4.1', source: 'builtin' },
];

const CLAUDE_BEDROCK_MODELS: LocalAdapterModelSummary[] = [
  { id: 'anthropic.claude-3-7-sonnet-20250219-v1:0', name: 'Claude 3.7 Sonnet (Bedrock)', source: 'builtin' },
  { id: 'anthropic.claude-3-5-haiku-20241022-v1:0', name: 'Claude 3.5 Haiku (Bedrock)', source: 'builtin' },
  { id: 'anthropic.claude-opus-4-1-20250805-v1:0', name: 'Claude Opus 4.1 (Bedrock)', source: 'builtin' },
];

const CODEX_FALLBACK_MODELS: LocalAdapterModelSummary[] = [
  { id: 'gpt-5.4', name: 'GPT-5.4', source: 'builtin' },
  { id: 'gpt-5.4-mini', name: 'GPT-5.4 Mini', source: 'builtin' },
  { id: 'gpt-5.3-codex', name: 'GPT-5.3 Codex', source: 'builtin' },
  { id: 'gpt-5.2-codex', name: 'GPT-5.2 Codex', source: 'builtin' },
  { id: 'gpt-5.1-codex-max', name: 'GPT-5.1 Codex Max', source: 'builtin' },
];

const modelCache = new Map<string, { expiresAt: number; models: LocalAdapterModelSummary[] }>();

const adapterRegistry: Record<LocalAdapterType, AdapterDefinition> = {
  claude_local: {
    type: 'claude_local',
    label: 'Claude Code',
    description: 'Native Claude Code CLI with explicit environment testing.',
    defaultCommand: 'claude',
    expectedCommandBasename: 'claude',
    testEnvironment: testClaudeEnvironment,
    listModels: getClaudeModels,
    detectModel: detectClaudeModel,
    execute: executeClaudePrompt,
  },
  codex_local: {
    type: 'codex_local',
    label: 'Codex CLI',
    description: 'Native Codex CLI with explicit environment testing.',
    defaultCommand: 'codex',
    expectedCommandBasename: 'codex',
    testEnvironment: testCodexEnvironment,
    listModels: getCodexModels,
    detectModel: detectCodexModel,
    execute: executeCodexPrompt,
  },
};

export function getSupportedLocalAdapters(): LocalAdapterDefinitionSummary[] {
  return Object.values(adapterRegistry).map(({ type, label, description, defaultCommand }) => ({
    type,
    label,
    description,
    defaultCommand,
  }));
}

export async function getLocalAdapterModels(config: LocalAdapterConfig): Promise<LocalAdapterModelSummary[]> {
  const definition = getAdapterDefinition(config.type);
  return definition.listModels(config);
}

export async function testLocalAdapterEnvironment(config: LocalAdapterConfig): Promise<LocalAdapterTestResult> {
  const definition = getAdapterDefinition(config.type);
  return definition.testEnvironment(config);
}

export async function detectLocalAdapterModel(config: LocalAdapterConfig): Promise<string | null> {
  const definition = getAdapterDefinition(config.type);
  if (!definition.detectModel) {
    return null;
  }

  return definition.detectModel(config);
}

export async function executeLocalAdapter(
  config: LocalAdapterConfig,
  input: LocalAdapterExecutionInput,
  previousSession?: LocalAdapterRuntimeSession | null,
): Promise<LocalAdapterExecutionResult> {
  const definition = getAdapterDefinition(config.type);
  return definition.execute(config, input, previousSession);
}

export function getLocalAdapterConfigFingerprint(config: LocalAdapterConfig): string {
  const normalizedConfig = normalizeConfig(config, getAdapterDefinition(config.type).defaultCommand);
  return buildConfigFingerprint(normalizedConfig);
}

function getAdapterDefinition(type: LocalAdapterType): AdapterDefinition {
  const definition = adapterRegistry[type];
  if (!definition) {
    throw new Error(`Unsupported local adapter type: ${type}`);
  }

  return definition;
}

async function testClaudeEnvironment(config: LocalAdapterConfig): Promise<LocalAdapterTestResult> {
  return runAdapterEnvironmentTest(config, {
    definition: getAdapterDefinition('claude_local'),
    detectAuth: detectClaudeAuth,
    buildProbeSpec,
    buildArgs: (nextConfig) => {
      const args = ['--print', '-', '--output-format', 'stream-json', '--verbose'];

      if (nextConfig.model?.trim()) {
        args.push('--model', nextConfig.model.trim());
      }

      if (nextConfig.effort?.trim()) {
        args.push('--effort', nextConfig.effort.trim());
      }

      if (nextConfig.chrome) {
        args.push('--chrome');
      }

      return args;
    },
  });
}

async function testCodexEnvironment(config: LocalAdapterConfig): Promise<LocalAdapterTestResult> {
  return runAdapterEnvironmentTest(config, {
    definition: getAdapterDefinition('codex_local'),
    detectAuth: detectCodexAuth,
    buildProbeSpec,
    buildArgs: (nextConfig) => {
      const args = ['exec'];

      if (nextConfig.model?.trim()) {
        args.push('--model', nextConfig.model.trim());
      }

      if (nextConfig.effort?.trim()) {
        args.push('--config', `model_reasoning_effort="${nextConfig.effort.trim()}"`);
      }

      args.push('--json', '--skip-git-repo-check', '-');

      return args;
    },
  });
}

async function executeClaudePrompt(
  config: LocalAdapterConfig,
  input: LocalAdapterExecutionInput,
  previousSession?: LocalAdapterRuntimeSession | null,
): Promise<LocalAdapterExecutionResult> {
  return runAdapterExecution(config, input, {
    definition: getAdapterDefinition('claude_local'),
    buildCommand: (nextConfig, resumeSession) => {
      const args = resumeSession?.sessionId
        ? ['--resume', resumeSession.sessionId, '--print', '-']
        : ['--session-id', randomUUID(), '--print', '-'];

      if (nextConfig.model) {
        args.push('--model', nextConfig.model);
      }

      if (nextConfig.effort) {
        args.push('--effort', nextConfig.effort);
      }

      if (nextConfig.chrome) {
        args.push('--chrome');
      }

      return {
        args,
        plannedSessionId: resumeSession?.sessionId || args[1] || null,
        plannedSessionParams: resumeSession?.sessionId
          ? resumeSession.sessionParams
          : {
              sessionId: args[1],
              cwd: nextConfig.cwd,
              promptBundleKey: LOCAL_ADAPTER_PROMPT_BUNDLE_VERSION,
            },
        plannedSessionDisplayId: resumeSession?.sessionDisplayId || args[1] || null,
        promptBundleVersion: LOCAL_ADAPTER_PROMPT_BUNDLE_VERSION,
        resumeAttempted: Boolean(resumeSession?.sessionId),
      };
    },
    previousSession,
  });
}

async function executeCodexPrompt(
  config: LocalAdapterConfig,
  input: LocalAdapterExecutionInput,
  previousSession?: LocalAdapterRuntimeSession | null,
): Promise<LocalAdapterExecutionResult> {
  return runAdapterExecution(config, input, {
    definition: getAdapterDefinition('codex_local'),
    buildCommand: (nextConfig, resumeSession) => {
      const args = resumeSession?.sessionId ? ['exec', 'resume'] : ['exec'];
      const isResume = Boolean(resumeSession?.sessionId);

      args.push('--json');

      if (nextConfig.model) {
        args.push('--model', nextConfig.model);
      }

      if (nextConfig.effort) {
        args.push('--config', `model_reasoning_effort="${nextConfig.effort}"`);
      }

      args.push('--skip-git-repo-check');

      if (!isResume) {
        args.push('--color', 'never');
      }

      if (resumeSession?.sessionId) {
        args.push(resumeSession.sessionId);
      }

      args.push('-');

      return {
        args,
        plannedSessionId: resumeSession?.sessionId || null,
        plannedSessionParams: resumeSession?.sessionParams || null,
        plannedSessionDisplayId: resumeSession?.sessionDisplayId || resumeSession?.sessionId || null,
        promptBundleVersion: null,
        resumeAttempted: Boolean(resumeSession?.sessionId),
      };
    },
    previousSession,
  });
}

async function getClaudeModels(config: LocalAdapterConfig): Promise<LocalAdapterModelSummary[]> {
  const mergedEnv = mergeEnvironment(config.env);
  return isClaudeBedrockMode(mergedEnv) ? CLAUDE_BEDROCK_MODELS : CLAUDE_MODELS;
}

async function getCodexModels(config: LocalAdapterConfig): Promise<LocalAdapterModelSummary[]> {
  const mergedEnv = mergeEnvironment(config.env);
  const apiKey = mergedEnv.OPENAI_API_KEY?.trim();

  if (!apiKey) {
    return CODEX_FALLBACK_MODELS;
  }

  const cached = modelCache.get(apiKey);
  if (cached && cached.expiresAt > Date.now()) {
    return cached.models;
  }

  try {
    const response = await fetch(OPENAI_MODELS_URL, {
      headers: {
        Authorization: `Bearer ${apiKey}`,
        Accept: 'application/json',
      },
    });

    if (!response.ok) {
      throw new Error(`OpenAI model list failed (${response.status})`);
    }

    const payload = await response.json() as { data?: Array<{ id: string }> };
    const fetchedModels = (payload.data || [])
      .filter((item) => item.id)
      .map((item) => ({
        id: item.id,
        name: item.id,
        source: 'fetched' as const,
      }));

    const merged = mergeModelLists(CODEX_FALLBACK_MODELS, fetchedModels);
    modelCache.set(apiKey, { expiresAt: Date.now() + MODEL_CACHE_TTL_MS, models: merged });
    return merged;
  } catch {
    return CODEX_FALLBACK_MODELS;
  }
}

async function detectClaudeModel(config: LocalAdapterConfig): Promise<string | null> {
  void config;

  for (const filePath of CLAUDE_SETTINGS_PATHS) {
    try {
      const rawValue = await readFile(filePath, 'utf8');
      const parsed = JSON.parse(rawValue) as { model?: unknown };
      if (typeof parsed.model === 'string' && parsed.model.trim()) {
        return parsed.model.trim();
      }
    } catch {
      continue;
    }
  }

  return null;
}

async function detectCodexModel(config: LocalAdapterConfig): Promise<string | null> {
  void config;

  try {
    const rawValue = await readFile(CODEX_CONFIG_PATH, 'utf8');
    const match = rawValue.match(/^\s*model\s*=\s*["']([^"']+)["']\s*$/m);
    return match?.[1]?.trim() || null;
  } catch {
    return null;
  }
}

async function runAdapterEnvironmentTest(
  config: LocalAdapterConfig,
  options: {
    definition: AdapterDefinition;
    detectAuth: (env: NodeJS.ProcessEnv) => Promise<AuthDetection>;
    buildProbeSpec: (cwd: string, command: string, args: string[]) => string;
    buildArgs: (config: NormalizedLocalAdapterConfig) => string[];
  },
): Promise<LocalAdapterTestResult> {
  const checks: LocalAdapterCheck[] = [];
  const normalizedConfig = normalizeConfig(config, options.definition.defaultCommand);
  const mergedEnv = mergeEnvironment(normalizedConfig.env);
  const fingerprint = buildConfigFingerprint(normalizedConfig);
  const commandBasename = getCommandBasename(normalizedConfig.command);

  const cwdResult = await validateAbsoluteDirectory(normalizedConfig.cwd);
  checks.push(cwdResult.check);

  const commandResolution = await resolveExecutable(normalizedConfig.command, mergedEnv);
  checks.push(commandResolution.check);

  const authDetection = await options.detectAuth(mergedEnv);
  checks.push(...authDetection.checks);

  const probeArgs = options.buildArgs(normalizedConfig);
  if (normalizedConfig.maxTurns && normalizedConfig.maxTurns > 0) {
    checks.push({
      code: 'option_max_turns_not_applied',
      status: 'warn',
      level: 'warn',
      message: 'This CLI version does not expose a verified max-turns probe flag, so that option was not applied.',
    });
  }

  const manualCommand = cwdResult.cwd
    ? `cd /d "${cwdResult.cwd}" && ${options.buildProbeSpec(cwdResult.cwd, normalizedConfig.command, probeArgs)}`
    : options.buildProbeSpec(normalizedConfig.cwd, normalizedConfig.command, probeArgs);

  if (!cwdResult.ok || !commandResolution.ok) {
    return finalizeResult({
      adapterType: normalizedConfig.type,
      authMode: authDetection.mode,
      command: normalizedConfig.command,
      resolvedCommand: commandResolution.resolvedCommand,
      cwd: cwdResult.cwd || normalizedConfig.cwd,
      manualCommand,
      checks,
      models: await options.definition.listModels(normalizedConfig),
      configFingerprint: fingerprint,
      probe: {
        skipped: true,
        exitCode: null,
        timedOut: false,
        summary: '',
        stdout: '',
        stderr: '',
      },
    });
  }

  if (commandBasename !== options.definition.expectedCommandBasename) {
    checks.push({
      code: 'probe_skipped_custom_command',
      status: 'pass',
      level: 'info',
      message: 'Custom command detected. Native hello probe was skipped to avoid making assumptions about wrapper behavior.',
      detail: `Configured command basename: ${commandBasename}`,
    });

    return finalizeResult({
      adapterType: normalizedConfig.type,
      authMode: authDetection.mode,
      command: normalizedConfig.command,
      resolvedCommand: commandResolution.resolvedCommand,
      cwd: cwdResult.cwd || normalizedConfig.cwd,
      manualCommand,
      checks,
      models: await options.definition.listModels(normalizedConfig),
      configFingerprint: fingerprint,
      probe: {
        skipped: true,
        exitCode: null,
        timedOut: false,
        summary: '',
        stdout: '',
        stderr: '',
      },
    });
  }

  const probeResult = await runProbe({
    command: commandResolution.resolvedCommand || normalizedConfig.command,
    args: probeArgs,
    cwd: cwdResult.cwd || normalizedConfig.cwd,
    env: mergedEnv,
    stdin: 'Respond with hello.\n',
    timeoutMs: 45_000,
  });

  const probeSummary = summarizeProbeOutput(probeResult.stdout, probeResult.stderr);
  checks.push(...classifyProbeResult(normalizedConfig.type, probeResult, probeSummary));

  return finalizeResult({
    adapterType: normalizedConfig.type,
    authMode: authDetection.mode,
    command: normalizedConfig.command,
    resolvedCommand: commandResolution.resolvedCommand,
    cwd: cwdResult.cwd || normalizedConfig.cwd,
    manualCommand,
    checks,
    models: await options.definition.listModels(normalizedConfig),
    configFingerprint: fingerprint,
    probe: {
      skipped: false,
      exitCode: probeResult.exitCode,
      timedOut: probeResult.timedOut,
      summary: probeSummary,
      stdout: truncateText(probeResult.stdout, 4_000),
      stderr: truncateText(probeResult.stderr, 4_000),
    },
  });
}

async function runAdapterExecution(
  config: LocalAdapterConfig,
  input: LocalAdapterExecutionInput,
  options: {
    definition: AdapterDefinition;
    buildCommand: (
      config: NormalizedLocalAdapterConfig,
      previousSession: LocalAdapterRuntimeSession | null,
    ) => {
      args: string[];
      plannedSessionId: string | null;
      plannedSessionParams: Record<string, unknown> | null;
      plannedSessionDisplayId: string | null;
      promptBundleVersion: string | null;
      resumeAttempted: boolean;
    };
    previousSession?: LocalAdapterRuntimeSession | null;
  },
): Promise<LocalAdapterExecutionResult> {
  const normalizedConfig = normalizeConfig(config, options.definition.defaultCommand);
  const mergedEnv = mergeEnvironment({
    ...normalizedConfig.env,
    NO_COLOR: '1',
  });

  const cwdResult = await validateAbsoluteDirectory(normalizedConfig.cwd);
  if (!cwdResult.ok || !cwdResult.cwd) {
    throw new Error(cwdResult.check.message);
  }

  const commandResolution = await resolveExecutable(normalizedConfig.command, mergedEnv);
  if (!commandResolution.ok || !commandResolution.resolvedCommand) {
    throw new Error(commandResolution.check.message);
  }

  const startedAt = Date.now();
  const prompt = composeExecutionPrompt(input);
  const resumeSession = getCompatibleSession(normalizedConfig, options.previousSession || null);
  let commandSpec = options.buildCommand(normalizedConfig, resumeSession);
  let probeResult = await runProbe({
    command: commandResolution.resolvedCommand,
    args: commandSpec.args,
    cwd: cwdResult.cwd,
    env: mergedEnv,
    stdin: prompt,
    timeoutMs: 180_000,
  });
  let resumeFailed = false;

  if (commandSpec.resumeAttempted && isMissingSessionOutput(options.definition.type, probeResult)) {
    resumeFailed = true;
    commandSpec = options.buildCommand(normalizedConfig, null);
    probeResult = await runProbe({
      command: commandResolution.resolvedCommand,
      args: commandSpec.args,
      cwd: cwdResult.cwd,
      env: mergedEnv,
      stdin: prompt,
      timeoutMs: 180_000,
    });
  }

  if (probeResult.timedOut) {
    throw new Error('The local adapter timed out while generating a response.');
  }

  if (probeResult.errorMessage) {
    throw new Error(probeResult.errorMessage);
  }

  if (probeResult.exitCode !== 0) {
    const failureOutput = [probeResult.stderr, probeResult.stdout].filter(Boolean).join('\n').trim();
    throw new Error(failureOutput || `The local adapter exited with code ${probeResult.exitCode}.`);
  }

  const parsedExecution = parseLocalAdapterExecution(
    options.definition.type,
    probeResult.stdout,
    probeResult.stderr,
    commandSpec.plannedSessionId,
    commandSpec.plannedSessionParams,
  );
  const effectiveSessionId = parsedExecution.sessionId || commandSpec.plannedSessionId || null;
  const effectiveSessionParams = parsedExecution.sessionParams || commandSpec.plannedSessionParams || null;
  const effectiveSessionDisplayId =
    parsedExecution.sessionDisplayId ||
    commandSpec.plannedSessionDisplayId ||
    effectiveSessionId;
  const output = parsedExecution.output;
  const reusedSession = Boolean(
    resumeSession?.sessionId &&
    effectiveSessionId &&
    resumeSession.sessionId === effectiveSessionId &&
    !resumeFailed,
  );
  const rotatedSession = Boolean(
    resumeSession?.sessionId &&
    effectiveSessionId &&
    resumeSession.sessionId !== effectiveSessionId,
  );

  return {
    adapterType: normalizedConfig.type,
    command: normalizedConfig.command,
    resolvedCommand: commandResolution.resolvedCommand,
    cwd: cwdResult.cwd,
    model: normalizedConfig.model || null,
    effort: normalizedConfig.effort || null,
    durationMs: Date.now() - startedAt,
    exitCode: probeResult.exitCode,
    output,
    stdout: truncateText(probeResult.stdout, 12_000),
    stderr: truncateText(probeResult.stderr, 8_000),
    sessionId: effectiveSessionId,
    sessionParams: effectiveSessionParams,
    sessionDisplayId: effectiveSessionDisplayId,
    metadata: {
      provider: normalizedConfig.type === 'claude_local' ? 'claude-code' : 'codex',
      biller: normalizedConfig.type === 'claude_local' ? 'anthropic-or-bedrock' : 'openai-or-codex-login',
      reusedSession,
      rotatedSession,
      resumeAttempted: Boolean(commandSpec.resumeAttempted || resumeFailed),
      resumeFailed,
      promptBundleVersion: commandSpec.promptBundleVersion,
      sessionScope: 'none',
      taskKey: input.taskKey?.trim() || null,
      tokenCounts: parsedExecution.tokenCounts,
      cost: null,
    },
  };
}

function buildProbeSpec(cwd: string, command: string, args: string[]): string {
  void cwd;
  return [quoteShellArg(command), ...args.map(quoteShellArg)].join(' ');
}

function composeExecutionPrompt(input: LocalAdapterExecutionInput): string {
  const blocks: string[] = [];

  if (input.memoryContext?.trim()) {
    blocks.push([
      'You are the active Vault agent backend.',
      'Use the following recalled Vault memory as working context when it is relevant.',
      '',
      input.memoryContext.trim(),
    ].join('\n'));
  }

  blocks.push(input.prompt.trim());

  return `${blocks.join('\n\n')}\n`;
}

function normalizeConfig(config: LocalAdapterConfig, defaultCommand: string): NormalizedLocalAdapterConfig {
  return {
    ...config,
    cwd: String(config.cwd || '').trim(),
    command: String(config.command || defaultCommand).trim() || defaultCommand,
    env: config.env || {},
    model: config.model?.trim() || '',
    effort: config.effort?.trim() || '',
    chrome: Boolean(config.chrome),
    maxTurns: config.maxTurns ?? null,
  };
}

function mergeEnvironment(overrides?: Record<string, string>): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...process.env };

  for (const [key, value] of Object.entries(overrides || {})) {
    env[key] = value;
  }

  const pathKey = Object.keys(env).find((key) => key.toUpperCase() === 'PATH') || 'PATH';
  const pathValue = env[pathKey] || env.PATH || process.env.PATH || process.env.Path || '';

  env[pathKey] = pathValue;
  env.PATH = pathValue;

  return env;
}

async function validateAbsoluteDirectory(rawCwd: string): Promise<{ ok: boolean; cwd: string | null; check: LocalAdapterCheck }> {
  if (!rawCwd) {
    return {
      ok: false,
      cwd: null,
      check: {
        code: 'cwd_missing',
        status: 'fail',
        level: 'error',
        message: 'Working directory is required.',
        hint: 'Choose an absolute project directory before running the environment test.',
      },
    };
  }

  if (!isAbsolute(rawCwd)) {
    return {
      ok: false,
      cwd: null,
      check: {
        code: 'cwd_not_absolute',
        status: 'fail',
        level: 'error',
        message: 'Working directory must be an absolute path.',
        detail: rawCwd,
      },
    };
  }

  const resolvedCwd = resolve(rawCwd);

  try {
    const cwdStats = await stat(resolvedCwd);
    if (!cwdStats.isDirectory()) {
      return {
        ok: false,
        cwd: resolvedCwd,
        check: {
          code: 'cwd_not_directory',
          status: 'fail',
          level: 'error',
          message: 'Working directory path exists but is not a directory.',
          detail: resolvedCwd,
        },
      };
    }
  } catch {
    return {
      ok: false,
      cwd: resolvedCwd,
      check: {
        code: 'cwd_missing',
        status: 'fail',
        level: 'error',
        message: 'Working directory does not exist.',
        detail: resolvedCwd,
      },
    };
  }

  return {
    ok: true,
    cwd: resolvedCwd,
    check: {
      code: 'cwd_valid',
      status: 'pass',
      level: 'info',
      message: 'Working directory is valid.',
      detail: resolvedCwd,
    },
  };
}

async function resolveExecutable(
  rawCommand: string,
  env: NodeJS.ProcessEnv,
): Promise<{ ok: boolean; resolvedCommand: string | null; check: LocalAdapterCheck }> {
  const command = rawCommand.trim();

  if (!command) {
    return {
      ok: false,
      resolvedCommand: null,
      check: {
        code: 'command_missing',
        status: 'fail',
        level: 'error',
        message: 'Adapter command is required.',
      },
    };
  }

  try {
    const resolvedCommand = await resolveCommandPath(command, env);
    if (!resolvedCommand) {
      return {
        ok: false,
        resolvedCommand: null,
        check: {
          code: 'command_not_found',
          status: 'fail',
          level: 'error',
          message: 'Command could not be resolved from the current PATH.',
          detail: command,
        },
      };
    }

    return {
      ok: true,
      resolvedCommand,
      check: {
        code: 'command_resolved',
        status: 'pass',
        level: 'info',
        message: 'Command resolved successfully.',
        detail: resolvedCommand,
      },
    };
  } catch (error) {
    return {
      ok: false,
      resolvedCommand: null,
      check: {
        code: 'command_resolution_failed',
        status: 'fail',
        level: 'error',
        message: 'Command resolution failed.',
        detail: error instanceof Error ? error.message : String(error),
      },
    };
  }
}

async function resolveCommandPath(command: string, env: NodeJS.ProcessEnv): Promise<string | null> {
  const directCandidates = hasPathSeparator(command)
    ? await expandExecutableCandidates(isAbsolute(command) ? command : resolve(command), env)
    : [];

  for (const candidate of directCandidates) {
    if (await isExecutableFile(candidate)) {
      return candidate;
    }
  }

  if (hasPathSeparator(command)) {
    return null;
  }

  const pathEntries = (env.PATH || '').split(delimiter).filter(Boolean);
  for (const pathEntry of pathEntries) {
    const expandedCandidates = await expandExecutableCandidates(join(pathEntry, command), env);
    for (const candidate of expandedCandidates) {
      if (await isExecutableFile(candidate)) {
        return candidate;
      }
    }
  }

  return null;
}

async function expandExecutableCandidates(basePath: string, env: NodeJS.ProcessEnv): Promise<string[]> {
  const candidates: string[] = [];

  if (process.platform === 'win32' && !/\.[^\\/.]+$/.test(basePath)) {
    const pathExt = (env.PATHEXT || '.EXE;.CMD;.BAT;.COM')
      .split(';')
      .filter(Boolean)
      .map((value) => value.toLowerCase());

    for (const ext of pathExt) {
      candidates.push(`${basePath}${ext}`);
    }
  }

  candidates.push(basePath);

  return candidates;
}

async function isExecutableFile(filePath: string): Promise<boolean> {
  try {
    const fileStats = await stat(filePath);
    if (!fileStats.isFile()) {
      return false;
    }

    if (process.platform === 'win32') {
      await access(filePath, fsConstants.F_OK);
      return true;
    }

    await access(filePath, fsConstants.X_OK);
    return true;
  } catch {
    return false;
  }
}

async function detectClaudeAuth(env: NodeJS.ProcessEnv): Promise<AuthDetection> {
  if (isClaudeBedrockMode(env)) {
    return {
      mode: 'bedrock',
      checks: [{
        code: 'auth_bedrock',
        status: 'pass',
        level: 'info',
        message: 'Bedrock authentication variables were detected.',
      }],
    };
  }

  if (env.ANTHROPIC_API_KEY?.trim()) {
    return {
      mode: 'api-key',
      checks: [{
        code: 'auth_api_key',
        status: 'pass',
        level: 'info',
        message: 'Anthropic API key detected in the merged environment.',
      }],
    };
  }

  const hasNativeAuth = await anyFileExists(CLAUDE_NATIVE_AUTH_FILES);
  if (hasNativeAuth) {
    return {
      mode: 'subscription-login',
      checks: [{
        code: 'auth_native_login',
        status: 'pass',
        level: 'info',
        message: 'Claude native login state detected.',
        detail: CLAUDE_NATIVE_AUTH_FILES.join('\n'),
      }],
    };
  }

  return {
    mode: 'subscription-login',
    checks: [{
      code: 'auth_login_required',
      status: 'warn',
      level: 'warn',
      message: 'Claude auth is not configured yet.',
      hint: 'Run `claude login` or set `ANTHROPIC_API_KEY` before testing again.',
    }],
  };
}

async function detectCodexAuth(env: NodeJS.ProcessEnv): Promise<AuthDetection> {
  if (env.OPENAI_API_KEY?.trim()) {
    return {
      mode: 'api-key',
      checks: [{
        code: 'auth_api_key',
        status: 'pass',
        level: 'info',
        message: 'OpenAI API key detected in the merged environment.',
      }],
    };
  }

  const hasNativeAuth = await anyFileExists(CODEX_NATIVE_AUTH_FILES);
  if (hasNativeAuth) {
    return {
      mode: 'native-login',
      checks: [{
        code: 'auth_native_login',
        status: 'pass',
        level: 'info',
        message: 'Codex native auth/config files detected.',
        detail: CODEX_NATIVE_AUTH_FILES.join('\n'),
      }],
    };
  }

  return {
    mode: null,
    checks: [{
      code: 'auth_login_required',
      status: 'warn',
      level: 'warn',
      message: 'Codex auth is not configured yet.',
      hint: 'Run `codex login` or set `OPENAI_API_KEY` before testing again.',
    }],
  };
}

function isClaudeBedrockMode(env: NodeJS.ProcessEnv): boolean {
  return Boolean(
    env.AWS_ACCESS_KEY_ID?.trim() &&
    env.AWS_SECRET_ACCESS_KEY?.trim() &&
    (env.AWS_REGION?.trim() || env.AWS_DEFAULT_REGION?.trim()),
  );
}

async function anyFileExists(paths: string[]): Promise<boolean> {
  for (const filePath of paths) {
    try {
      await access(filePath, fsConstants.F_OK);
      return true;
    } catch {
      continue;
    }
  }

  return false;
}

async function runProbe(options: {
  command: string;
  args: string[];
  cwd: string;
  env: NodeJS.ProcessEnv;
  stdin: string;
  timeoutMs: number;
}): Promise<ProbeRunResult> {
  return new Promise((resolvePromise) => {
    const spawnTarget = resolveSpawnTarget(options.command, options.args, options.env);
    const child = spawn(spawnTarget.command, spawnTarget.args, {
      cwd: options.cwd,
      env: options.env,
      stdio: 'pipe',
      windowsHide: true,
      shell: false,
    });

    let stdout = '';
    let stderr = '';
    let settled = false;
    let timedOut = false;

    const timeout = setTimeout(() => {
      timedOut = true;
      child.kill();
    }, options.timeoutMs);

    child.stdout.on('data', (chunk) => {
      stdout += chunk.toString();
    });

    child.stderr.on('data', (chunk) => {
      stderr += chunk.toString();
    });

    child.on('error', (error) => {
      if (settled) {
        return;
      }

      settled = true;
      clearTimeout(timeout);
      resolvePromise({
        exitCode: null,
        stdout,
        stderr,
        timedOut,
        errorMessage: error.message,
      });
    });

    child.on('close', (exitCode) => {
      if (settled) {
        return;
      }

      settled = true;
      clearTimeout(timeout);
      resolvePromise({
        exitCode,
        stdout,
        stderr,
        timedOut,
      });
    });

    child.stdin.write(options.stdin);
    child.stdin.end();
  });
}

function resolveSpawnTarget(
  command: string,
  args: string[],
  env: NodeJS.ProcessEnv,
): { command: string; args: string[] } {
  if (process.platform !== 'win32') {
    return { command, args };
  }

  if (/\.(cmd|bat)$/i.test(command)) {
    const shell = resolveWindowsCmdShell(env);
    const commandLine = [quoteForCmd(command), ...args.map(quoteForCmd)].join(' ');
    return {
      command: shell,
      args: ['/d', '/s', '/c', commandLine],
    };
  }

  return { command, args };
}

function resolveWindowsCmdShell(env: NodeJS.ProcessEnv): string {
  const fallbackRoot = env.SystemRoot || process.env.SystemRoot || 'C:\\Windows';
  return join(fallbackRoot, 'System32', 'cmd.exe');
}

function quoteForCmd(arg: string): string {
  if (!arg.length) {
    return '""';
  }

  const escaped = arg.replace(/"/g, '""');
  return /[\s"&<>|^()]/.test(escaped) ? `"${escaped}"` : escaped;
}

function summarizeProbeOutput(stdout: string, stderr: string): string {
  const fragments: string[] = [];

  for (const line of `${stdout}\n${stderr}`.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed) {
      continue;
    }

    if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
      try {
        const parsed = JSON.parse(trimmed);
        collectStringFragments(parsed, fragments);
        continue;
      } catch {
        fragments.push(trimmed);
      }
    } else {
      fragments.push(trimmed);
    }
  }

  return truncateText(fragments.join(' '), 1_500);
}

function collectStringFragments(value: unknown, fragments: string[]): void {
  if (typeof value === 'string') {
    fragments.push(value);
    return;
  }

  if (Array.isArray(value)) {
    for (const item of value) {
      collectStringFragments(item, fragments);
    }
    return;
  }

  if (value && typeof value === 'object') {
    for (const nestedValue of Object.values(value)) {
      collectStringFragments(nestedValue, fragments);
    }
  }
}

function extractExecutionOutput(adapterType: LocalAdapterType, stdout: string, stderr: string): string {
  if (adapterType === 'claude_local') {
    const cleanedStdout = stripAnsi(stdout).trim();
    if (cleanedStdout) {
      return cleanedStdout;
    }
  }

  if (adapterType === 'codex_local') {
    const parsedOutput = parseCodexJsonLines(stdout);
    if (parsedOutput) {
      return parsedOutput;
    }

    const cleanedStdout = stripAnsi(stdout).trim();
    if (cleanedStdout) {
      return cleanedStdout;
    }
  }

  const cleanedFallback = stripAnsi([stdout, stderr].filter(Boolean).join('\n')).trim();
  return cleanedFallback || 'The local adapter completed without returning a printable response.';
}

function parseCodexJsonLines(stdout: string): string {
  const fragments: string[] = [];

  for (const parsed of parseJsonLines(stdout)) {
    collectAssistantText(parsed, fragments);
  }

  const joined = fragments.join('\n').trim();
  return joined ? stripAnsi(joined) : '';
}

function parseJsonLines(stdout: string): unknown[] {
  const parsedLines: unknown[] = [];

  for (const line of stdout.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || !(trimmed.startsWith('{') || trimmed.startsWith('['))) {
      continue;
    }

    try {
      parsedLines.push(JSON.parse(trimmed));
    } catch {
      continue;
    }
  }

  return parsedLines;
}

function collectAssistantText(value: unknown, fragments: string[]): void {
  if (!value || typeof value !== 'object') {
    return;
  }

  if (Array.isArray(value)) {
    for (const item of value) {
      collectAssistantText(item, fragments);
    }
    return;
  }

  const record = value as Record<string, unknown>;

  if (typeof record.output_text === 'string' && record.output_text.trim()) {
    fragments.push(record.output_text.trim());
  }

  if (typeof record.text === 'string' && shouldCaptureText(record)) {
    fragments.push(record.text.trim());
  }

  if (typeof record.message === 'string' && shouldCaptureText(record)) {
    fragments.push(record.message.trim());
  }

  if (typeof record.content === 'string' && shouldCaptureText(record)) {
    fragments.push(record.content.trim());
  }

  if (Array.isArray(record.content)) {
    for (const item of record.content) {
      collectAssistantText(item, fragments);
    }
  }

  for (const nestedValue of Object.values(record)) {
    if (nestedValue !== record.content && typeof nestedValue === 'object') {
      collectAssistantText(nestedValue, fragments);
    }
  }
}

function shouldCaptureText(record: Record<string, unknown>): boolean {
  const role = typeof record.role === 'string' ? record.role.toLowerCase() : '';
  const type = typeof record.type === 'string' ? record.type.toLowerCase() : '';

  if (role === 'assistant') {
    return true;
  }

  return /(assistant|message|response|output|final|content)/i.test(type);
}

function extractSessionId(adapterType: LocalAdapterType, stdout: string, stderr: string): string | null {
  const parsedSessionId = findSessionIdInJsonLines(stdout);
  if (parsedSessionId) {
    return parsedSessionId;
  }

  const combinedOutput = `${stdout}\n${stderr}`;
  const directMatch = combinedOutput.match(/\b[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\b/i);
  if (directMatch) {
    return directMatch[0];
  }

  if (adapterType === 'claude_local') {
    return null;
  }

  return null;
}

function findSessionIdInJsonLines(stdout: string): string | null {
  for (const parsed of parseJsonLines(stdout)) {
    const sessionId = findStructuredSessionId(parsed);
    if (sessionId) {
      return sessionId;
    }
  }

  return null;
}

function findStructuredSessionId(value: unknown): string | null {
  if (!value || typeof value !== 'object') {
    return null;
  }

  if (Array.isArray(value)) {
    for (const item of value) {
      const nestedMatch = findStructuredSessionId(item);
      if (nestedMatch) {
        return nestedMatch;
      }
    }
    return null;
  }

  const record = value as Record<string, unknown>;
  for (const [key, nestedValue] of Object.entries(record)) {
    if (typeof nestedValue === 'string' && /(session_?id|conversation_?id|thread_?id)/i.test(key)) {
      const match = nestedValue.match(/\b[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\b/i);
      if (match) {
        return match[0];
      }
    }

    if (nestedValue && typeof nestedValue === 'object') {
      const nestedMatch = findStructuredSessionId(nestedValue);
      if (nestedMatch) {
        return nestedMatch;
      }
    }
  }

  return null;
}

function getCompatibleSession(
  config: NormalizedLocalAdapterConfig,
  previousSession: LocalAdapterRuntimeSession | null,
): LocalAdapterRuntimeSession | null {
  if (!previousSession || previousSession.adapterType !== config.type) {
    return null;
  }

  if (resolve(previousSession.cwd) !== resolve(config.cwd)) {
    return null;
  }

  if (
    config.type === 'claude_local' &&
    readNonEmptyString(previousSession.sessionParams?.promptBundleKey) !== LOCAL_ADAPTER_PROMPT_BUNDLE_VERSION
  ) {
    return null;
  }

  return previousSession;
}

function readNonEmptyString(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null;
}

function isMissingSessionOutput(adapterType: LocalAdapterType, probe: ProbeRunResult): boolean {
  return isUnknownSessionError(adapterType, probe.stdout, probe.stderr);
}

function classifyProbeResult(
  adapterType: LocalAdapterType,
  probe: ProbeRunResult,
  summary: string,
): LocalAdapterCheck[] {
  const checks: LocalAdapterCheck[] = [];
  const combinedOutput = `${probe.errorMessage || ''}\n${probe.stderr}\n${probe.stdout}`;

  if (probe.timedOut) {
    checks.push({
      code: 'probe_timeout',
      status: 'warn',
      level: 'warn',
      message: 'The hello probe timed out before the CLI returned a result.',
      hint: adapterType === 'claude_local' ? 'Run `claude login` if Claude prompts for auth.' : 'Run `codex login` or set `OPENAI_API_KEY`, then try again.',
    });
    return checks;
  }

  if (probe.errorMessage) {
    checks.push({
      code: 'probe_spawn_failed',
      status: 'fail',
      level: 'error',
      message: 'The CLI process could not be started.',
      detail: probe.errorMessage,
    });
    return checks;
  }

  if (isAuthRequiredOutput(combinedOutput)) {
    checks.push({
      code: 'probe_auth_required',
      status: 'warn',
      level: 'warn',
      message: 'The CLI ran, but authentication is still required before the hello probe can complete.',
      detail: truncateText(combinedOutput, 1_200),
      hint: adapterType === 'claude_local' ? 'Run `claude login`.' : 'Run `codex login` or set `OPENAI_API_KEY`.',
    });
    return checks;
  }

  if (probe.exitCode === 0 && /\bhello\b/i.test(summary)) {
    checks.push({
      code: 'probe_hello_passed',
      status: 'pass',
      level: 'info',
      message: 'Hello probe succeeded.',
      detail: summary,
    });
    return checks;
  }

  if (probe.exitCode === 0) {
    checks.push({
      code: 'probe_unexpected_output',
      status: 'warn',
      level: 'warn',
      message: 'The CLI exited successfully, but the returned output did not clearly contain "hello".',
      detail: summary || truncateText(combinedOutput, 1_200),
    });
    return checks;
  }

  checks.push({
    code: 'probe_failed',
    status: 'fail',
    level: 'error',
    message: `The hello probe failed with exit code ${probe.exitCode ?? 'unknown'}.`,
    detail: truncateText(combinedOutput, 1_200),
  });

  return checks;
}

function isAuthRequiredOutput(output: string): boolean {
  return /login|required|authenticate|not authenticated|auth(?:orization)? failed|api key|OPENAI_API_KEY|ANTHROPIC_API_KEY/i.test(output);
}

function finalizeResult(result: Omit<LocalAdapterTestResult, 'recognized' | 'canProceed' | 'testedAt'>): LocalAdapterTestResult {
  const hasErrors = result.checks.some((check) => check.status === 'fail');
  const hasProbeOutcome = result.probe.skipped || result.checks.some((check) => check.code.startsWith('probe_'));
  const recognized = !hasErrors && hasProbeOutcome;

  return {
    ...result,
    recognized,
    canProceed: recognized,
    testedAt: new Date().toISOString(),
  };
}

function buildConfigFingerprint(config: LocalAdapterConfig): string {
  const envEntries = Object.entries(config.env || {}).sort(([leftKey], [rightKey]) => leftKey.localeCompare(rightKey));
  return JSON.stringify({
    type: config.type,
    cwd: resolve(config.cwd || '.'),
    command: config.command || '',
    env: envEntries,
    model: config.model || '',
    effort: config.effort || '',
    chrome: Boolean(config.chrome),
    maxTurns: config.maxTurns ?? null,
  });
}

function mergeModelLists(
  primary: LocalAdapterModelSummary[],
  secondary: LocalAdapterModelSummary[],
): LocalAdapterModelSummary[] {
  const merged = new Map<string, LocalAdapterModelSummary>();

  for (const model of [...primary, ...secondary]) {
    if (!merged.has(model.id)) {
      merged.set(model.id, model);
    }
  }

  return [...merged.values()].sort((left, right) => left.name.localeCompare(right.name));
}

function getCommandBasename(command: string): string {
  return basename(command).replace(/\.(cmd|exe|bat)$/i, '').toLowerCase();
}

function hasPathSeparator(value: string): boolean {
  return value.includes('/') || value.includes('\\');
}

function quoteShellArg(value: string): string {
  if (!/[\s"]/u.test(value)) {
    return value;
  }

  return `"${value.replace(/"/g, '\\"')}"`;
}

function stripAnsi(value: string): string {
  return value.replace(/\u001b\[[0-9;]*m/g, '');
}

function truncateText(value: string, maxLength: number): string {
  if (value.length <= maxLength) {
    return value;
  }

  return `${value.slice(0, maxLength - 1)}…`;
}
