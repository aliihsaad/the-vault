/**
 * Host voice-runtime factory (S3). Binds the S2 credential store
 * (`getActiveProviderForRole`) to the S3 transport adapters and brain-gated
 * tools, producing a ready-to-drive `SparkVoiceSession`. This is the seam the
 * Electron main process wires: it injects the real `fetch`, the renderer-backed
 * audio sink, the IPC `emit`, and the brain skill rows + executor.
 *
 * Kept in core (not desktop) so it is fully unit-testable with a fake credential
 * store and fake fetch — no Electron, no network.
 */

import type { SparkSkillRow } from '../../types/spark-extension.js';
import type { SparkProviderRole } from '../../types/spark-provider.js';
import type { SparkProviderCredentialStore } from '../spark-provider-credentials.js';
import { createSparkVoiceSession, type SparkAudioOutput, type SparkVoiceSession } from './spark-voice-session.js';
import {
  createSparkLlmAdapter,
  createSparkSttAdapter,
  createSparkTtsAdapter,
  type SparkFetch,
} from './spark-voice-transports.js';
import {
  buildVoiceToolsFromSkillRows,
  createSparkToolDispatcher,
  type SparkSkillExecutor,
  type SparkVoiceTool,
} from './spark-voice-tools.js';
import type { SparkVoiceEvent } from '../../types/spark-voice.js';
import {
  createSparkRealtimeSession,
  type SparkRealtimeSession,
  type SparkRealtimeSessionDeps,
  type SparkRealtimeSocket,
  type SparkRealtimeToolResult,
} from './spark-realtime-session.js';
import type { SparkRealtimeToolDefinition } from './spark-realtime-messages.js';

/** Credential surface the voice runtime needs (subset of the S2 store). */
export type SparkVoiceCredentialSource = Pick<
  SparkProviderCredentialStore,
  'getActiveProviderForRole' | 'getProviderCredentialState'
>;

export interface SparkVoiceRuntimeOptions {
  credentials: SparkVoiceCredentialSource;
  fetchImpl: SparkFetch;
  audioOutput: SparkAudioOutput;
  emit: (event: SparkVoiceEvent) => void;
  /** Fixed host-native tools (e.g. read-only Vault recall) merged ahead of brain tools. */
  tools?: SparkVoiceTool[];
  /** Brain skills to expose as tools (from skillRegistry.discover()). */
  skillRows?: SparkSkillRow[];
  /** Executes a brain skill by id; wires into the brain runtime in the host. */
  executeSkill?: SparkSkillExecutor;
  recallContext?: (query: string) => Promise<string | null> | string | null;
  systemPrompt?: string;
  now?: () => number;
  idGen?: () => string;
}

/** Build a host VoiceSession from the active per-role provider configuration. */
export function createSparkVoiceRuntimeSession(options: SparkVoiceRuntimeOptions): SparkVoiceSession {
  const { credentials, fetchImpl } = options;
  const stt = createSparkSttAdapter(credentials.getActiveProviderForRole('STT'), fetchImpl, options.now);
  const llm = createSparkLlmAdapter(credentials.getActiveProviderForRole('LLM'), fetchImpl, options.now);
  const tts = createSparkTtsAdapter(credentials.getActiveProviderForRole('TTS'), fetchImpl, options.now);

  const brainTools =
    options.skillRows && options.executeSkill
      ? buildVoiceToolsFromSkillRows(options.skillRows, options.executeSkill)
      : [];
  const tools = [...(options.tools ?? []), ...brainTools];
  const toolDispatcher = createSparkToolDispatcher(tools, options.now);

  return createSparkVoiceSession({
    stt,
    llm,
    tts,
    toolDispatcher,
    audioOutput: options.audioOutput,
    emit: options.emit,
    recallContext: options.recallContext,
    systemPrompt: options.systemPrompt,
    now: options.now,
    idGen: options.idGen,
  });
}

export interface SparkRealtimeRuntimeOptions {
  credentials: SparkVoiceCredentialSource;
  fetchImpl: SparkRealtimeSessionDeps['fetchImpl'];
  createSocket: (url: string) => SparkRealtimeSocket;
  emit: (event: SparkVoiceEvent) => void;
  playAudio: (base64Pcm: string, mimeType: string) => void;
  instructions?: string;
  tools?: SparkRealtimeToolDefinition[];
  dispatchTool?: (name: string, args: string) => Promise<SparkRealtimeToolResult>;
  now?: () => number;
  idGen?: () => string;
}

/**
 * Build a realtime VoiceSession from the Realtime-role provider (e.g. FreeLLMAPI):
 * resolves baseUrl/model/voice from the active provider and the key host-side via
 * `getKey()`, then binds them to the realtime socket pipeline. The socket factory
 * and mint fetch are injected by the host (Node WebSocket + fetch).
 */
export function createSparkRealtimeRuntimeSession(
  options: SparkRealtimeRuntimeOptions,
): SparkRealtimeSession {
  const active = options.credentials.getActiveProviderForRole('Realtime');
  return createSparkRealtimeSession({
    fetchImpl: options.fetchImpl,
    createSocket: options.createSocket,
    baseUrl: active.baseUrl ?? '',
    apiKey: active.getKey(),
    model: active.model ?? undefined,
    voice: active.voiceId ?? undefined,
    instructions: options.instructions,
    tools: options.tools,
    dispatchTool: options.dispatchTool,
    emit: options.emit,
    playAudio: options.playAudio,
    now: options.now,
    idGen: options.idGen,
  });
}

export interface SparkVoiceRoleReadiness {
  role: SparkProviderRole;
  providerId: string;
  configured: boolean;
}

/** Which pipeline a live session will use. */
export type SparkVoiceMode = 'realtime' | 'classic' | 'none';

export interface SparkVoiceReadiness {
  /** True when a session can start in either the realtime or classic pipeline. */
  ready: boolean;
  /** The pipeline that will run: realtime (preferred) > classic > none. */
  mode: SparkVoiceMode;
  roles: SparkVoiceRoleReadiness[];
  /** Roles that still need a configured provider before a session can start. */
  missing: SparkProviderRole[];
}

/** Roles the classic STT→LLM→TTS pipeline needs before it can run. */
const REQUIRED_CLASSIC_ROLES: SparkProviderRole[] = ['STT', 'LLM', 'TTS'];

/** True when the Realtime-role provider has stored credentials (single-socket pipeline). */
export function isSparkRealtimeConfigured(credentials: SparkVoiceCredentialSource): boolean {
  const active = credentials.getActiveProviderForRole('Realtime');
  return credentials.getProviderCredentialState(active.providerId).configured;
}

/**
 * Compute voice readiness from the active per-role assignment + credential
 * state. A configured Realtime provider (e.g. FreeLLMAPI) makes the session
 * realtime-ready on its own; otherwise the classic STT→LLM→TTS roles must all be
 * configured. Honest: a role backed by an unconfigured provider is reported
 * missing, never silently defaulted into "ready".
 */
export function buildSparkVoiceReadiness(
  credentials: SparkVoiceCredentialSource,
): SparkVoiceReadiness {
  const realtimeActive = credentials.getActiveProviderForRole('Realtime');
  const realtimeReady = credentials.getProviderCredentialState(realtimeActive.providerId).configured;

  const classicRoles = REQUIRED_CLASSIC_ROLES.map((role) => {
    const active = credentials.getActiveProviderForRole(role);
    const state = credentials.getProviderCredentialState(active.providerId);
    return { role, providerId: active.providerId, configured: state.configured };
  });
  const classicMissing = classicRoles.filter((r) => !r.configured).map((r) => r.role);
  const classicReady = classicMissing.length === 0;

  const roles: SparkVoiceRoleReadiness[] = [
    { role: 'Realtime', providerId: realtimeActive.providerId, configured: realtimeReady },
    ...classicRoles,
  ];
  const mode: SparkVoiceMode = realtimeReady ? 'realtime' : classicReady ? 'classic' : 'none';

  return {
    ready: realtimeReady || classicReady,
    mode,
    roles,
    // When realtime is ready nothing is missing; otherwise surface the classic gaps.
    missing: realtimeReady ? [] : classicMissing,
  };
}
