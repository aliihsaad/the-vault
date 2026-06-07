import { useCallback, useEffect, useMemo, useState } from 'react';

import type {
  SparkBrainArtifactName,
  SparkExtensionActionType,
  SparkExtensionSnapshot,
  SparkProviderCredentialState,
  SparkSessionFrame,
  SparkVoiceReadiness,
  SparkVoiceStatus,
  SparkViewArtifactAction,
} from '@the-vault/core';

import {
  buildSparkBrainModel,
  buildSparkSkillsModel,
  buildToggleSparkSkillAction,
  fetchSparkSettingsSnapshot,
  performSparkSettingsAction,
  type SparkBrainModel,
  type SparkSettingsApi,
  type SparkSkillsModel,
} from '../spark-settings-view-model.js';
import {
  createBrowserAudioPlayer,
  createSparkVoiceClient,
  type SparkVoiceClient,
  type SparkVoicePlaybackState,
} from '../spark/spark-voice-client.js';
import { createEmptySparkSessionFrame } from '../spark/spark-session-frame-renderer.js';

/** Honest, control-page-level status derived from the extension snapshot. */
export type SparkControlStatus = 'idle' | 'initialising' | 'ready' | 'error';

export interface SparkControlStatusModel {
  status: SparkControlStatus;
  label: string;
  detail: string;
  className: string;
}

export type SparkControlCapabilityKey = 'skills' | 'packs' | 'artifacts' | 'providers';

export interface SparkControlCapabilityModel {
  key: SparkControlCapabilityKey;
  label: string;
  value: number;
}

export type SparkControlReadinessKey = 'provider' | 'voice-runtime';

export interface SparkControlReadinessItemModel {
  key: SparkControlReadinessKey;
  label: string;
  ready: boolean;
  detail: string;
}

export interface SparkControlStartSessionModel {
  disabled: boolean;
  label: string;
  tooltip: string;
}

export type SparkVoiceSessionMode = 'push-to-talk' | 'always-listening' | 'text-only';

export interface SparkControlSessionStatusModel {
  status: SparkVoiceStatus;
  label: string;
  detail: string;
  className: string;
}

export interface SparkControlStartSessionOptions {
  readiness: SparkVoiceReadiness | null;
  sessionActive: boolean;
  bridgeAvailable?: boolean;
}

export interface SparkVoiceCapture {
  start: () => Promise<void>;
  stop: () => void;
}

export type SparkSessionPanelId = 'transcript' | 'tool-calls' | 'visualizer' | 'canvas';

export interface SparkSessionPanelModel {
  id: SparkSessionPanelId;
  title: string;
  emptyLabel: string;
}

const CONTROL_STATUS_LABELS: Record<SparkControlStatus, string> = {
  idle: 'Idle',
  initialising: 'Initialising',
  ready: 'Ready',
  error: 'Error',
};

const SESSION_STATUS_LABELS: Record<SparkVoiceStatus, string> = {
  idle: 'Idle',
  listening: 'Listening',
  thinking: 'Thinking',
  speaking: 'Speaking',
  error: 'Error',
};

function mapInstallStateToControlStatus(
  installState: SparkExtensionSnapshot['status']['installState'],
): SparkControlStatus {
  switch (installState) {
    case 'ready':
      return 'ready';
    case 'bootstrapping':
      return 'initialising';
    case 'failed':
    case 'degraded':
      return 'error';
    default:
      return 'idle';
  }
}

export function buildSparkControlStatusModel(
  snapshot: SparkExtensionSnapshot | null,
): SparkControlStatusModel {
  if (!snapshot) {
    return {
      status: 'idle',
      label: CONTROL_STATUS_LABELS.idle,
      detail: 'Spark snapshot is not available yet.',
      className: 'spark-control-status-idle',
    };
  }

  const status = mapInstallStateToControlStatus(snapshot.status.installState);
  return {
    status,
    label: CONTROL_STATUS_LABELS[status],
    detail: snapshot.status.message,
    className: `spark-control-status-${status}`,
  };
}

export function countConfiguredSparkProviders(snapshot: SparkExtensionSnapshot | null): number {
  if (!snapshot) {
    return 0;
  }

  const configured: SparkProviderCredentialState = 'configured';
  return snapshot.providerHealth.providers.filter(
    (provider) => provider.credentialState === configured,
  ).length;
}

export function buildSparkControlCapabilities(
  snapshot: SparkExtensionSnapshot | null,
): SparkControlCapabilityModel[] {
  return [
    { key: 'skills', label: 'Skills', value: snapshot?.counts.skills ?? 0 },
    { key: 'packs', label: 'Packs', value: snapshot?.counts.installedPacks ?? 0 },
    { key: 'artifacts', label: 'Brain artifacts', value: snapshot?.counts.brainArtifacts ?? 0 },
    { key: 'providers', label: 'Configured providers', value: countConfiguredSparkProviders(snapshot) },
  ];
}

export function buildSparkControlReadiness(
  snapshot: SparkExtensionSnapshot | null,
  voiceReadiness: SparkVoiceReadiness | null = null,
): SparkControlReadinessItemModel[] {
  const providerConfigured = countConfiguredSparkProviders(snapshot) > 0;
  const missingRoles = voiceReadiness?.missing ?? [];
  const voiceRuntimeReady = Boolean(voiceReadiness?.ready);

  return [
    {
      key: 'provider',
      label: 'Provider configured',
      ready: providerConfigured,
      detail: providerConfigured
        ? 'At least one provider has stored credentials.'
        : 'Configure a provider in Settings → Extensions → Spark (S2).',
    },
    {
      key: 'voice-runtime',
      label: 'Voice runtime wired',
      ready: voiceRuntimeReady,
      detail: voiceRuntimeReady
        ? 'STT, LLM, and TTS providers are ready.'
        : voiceReadiness
          ? `Missing configured provider for ${formatSparkRoleList(missingRoles)}.`
          : 'Waiting for voice readiness from the S3 runtime.',
    },
  ];
}

export function buildSparkControlStartSession(
  options: SparkControlStartSessionOptions = {
    readiness: null,
    sessionActive: false,
    bridgeAvailable: false,
  },
): SparkControlStartSessionModel {
  if (options.sessionActive) {
    return {
      disabled: false,
      label: 'Stop session',
      tooltip: 'Stop the active Spark voice session.',
    };
  }

  if (!options.bridgeAvailable && !options.readiness) {
    return {
      disabled: true,
      label: 'Start session',
      tooltip: 'Spark voice bridge is unavailable.',
    };
  }

  if (!options.readiness?.ready) {
    return {
      disabled: true,
      label: 'Start session',
      tooltip: options.readiness
        ? `Configure ${formatSparkRoleList(options.readiness.missing)} providers before starting.`
        : 'Waiting for voice readiness.',
    };
  }

  return {
    disabled: false,
    label: 'Start session',
    tooltip: 'Start a live Spark voice session.',
  };
}

export function buildSparkControlSessionStatusModel(
  status: SparkVoiceStatus,
): SparkControlSessionStatusModel {
  return {
    status,
    label: SESSION_STATUS_LABELS[status],
    detail: status === 'idle'
      ? 'No live session is running.'
      : `Spark is ${SESSION_STATUS_LABELS[status].toLowerCase()}.`,
    className: `spark-session-status-${status}`,
  };
}

function formatSparkRoleList(roles: readonly string[]): string {
  if (roles.length === 0) {
    return 'STT, LLM, and TTS';
  }

  if (roles.length === 1) {
    return roles[0];
  }

  if (roles.length === 2) {
    return `${roles[0]} and ${roles[1]}`;
  }

  return `${roles.slice(0, -1).join(', ')}, and ${roles.at(-1)}`;
}

export function buildSparkSessionPanels(): SparkSessionPanelModel[] {
  return [
    { id: 'transcript', title: 'Transcript', emptyLabel: 'Waiting for session...' },
    { id: 'tool-calls', title: 'Tool-call log', emptyLabel: 'No tool calls yet' },
    { id: 'visualizer', title: 'Voice visualizer', emptyLabel: 'Audio inactive' },
    { id: 'canvas', title: 'Canvas', emptyLabel: 'Canvas is empty' },
  ];
}

export function buildViewSparkArtifactAction(
  artifactName: SparkBrainArtifactName,
): SparkViewArtifactAction {
  return {
    type: 'view-artifact',
    artifactName,
  };
}

export interface SparkControlViewModel {
  snapshot: SparkExtensionSnapshot | null;
  loading: boolean;
  error: string | null;
  actionError: string | null;
  pendingAction: SparkExtensionActionType | null;
  actionPendingSkillId: string | null;
  actionPendingArtifactName: SparkBrainArtifactName | null;
  statusModel: SparkControlStatusModel;
  capabilities: SparkControlCapabilityModel[];
  readiness: SparkControlReadinessItemModel[];
  startSession: SparkControlStartSessionModel;
  sessionPanels: SparkSessionPanelModel[];
  sessionFrame: SparkSessionFrame;
  sessionStatusModel: SparkControlSessionStatusModel;
  sessionActive: boolean;
  sessionMode: SparkVoiceSessionMode;
  textMessage: string;
  voiceError: string | null;
  playback: SparkVoicePlaybackState;
  skills: SparkSkillsModel;
  brain: SparkBrainModel;
  refresh: () => Promise<void>;
  startVoiceSession: () => Promise<void>;
  stopVoiceSession: () => Promise<void>;
  sendTextMessage: (text?: string) => Promise<void>;
  startPushToTalk: () => Promise<void>;
  stopPushToTalk: () => void;
  setSessionMode: (mode: SparkVoiceSessionMode) => void;
  setTextMessage: (message: string) => void;
  stopPlayback: () => void;
  toggleSkill: (skillId: string) => Promise<void>;
  viewArtifact: (artifactName: SparkBrainArtifactName) => Promise<void>;
}

export function useSparkControlViewModel(
  sparkApi: SparkSettingsApi | null = getWindowSparkApi(),
  providedVoiceClient?: SparkVoiceClient | null,
  providedVoiceCapture?: SparkVoiceCapture | null,
): SparkControlViewModel {
  const ownsVoiceClient = providedVoiceClient === undefined;
  const ownsVoiceCapture = providedVoiceCapture === undefined;
  const [voiceClient] = useState<SparkVoiceClient | null>(() => (
    providedVoiceClient === undefined ? getWindowSparkVoiceClient() : providedVoiceClient
  ));
  const [voiceCapture, setVoiceCapture] = useState<SparkVoiceCapture | null>(() => (
    providedVoiceCapture === undefined ? null : providedVoiceCapture
  ));
  const [pcmCapture, setPcmCapture] = useState<SparkVoiceCapture | null>(null);
  const [snapshot, setSnapshot] = useState<SparkExtensionSnapshot | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [pendingAction, setPendingAction] = useState<SparkExtensionActionType | null>(null);
  const [actionPendingSkillId, setActionPendingSkillId] = useState<string | null>(null);
  const [actionPendingArtifactName, setActionPendingArtifactName] = useState<SparkBrainArtifactName | null>(null);
  const [voiceReadiness, setVoiceReadiness] = useState<SparkVoiceReadiness | null>(null);
  const [voiceError, setVoiceError] = useState<string | null>(null);
  const [sessionFrame, setSessionFrame] = useState<SparkSessionFrame>(() => createEmptySparkSessionFrame());
  const [sessionStatus, setSessionStatus] = useState<SparkVoiceStatus>('idle');
  const [sessionMode, setSessionModeState] = useState<SparkVoiceSessionMode>('push-to-talk');
  const [textMessage, setTextMessage] = useState('');
  const [playback, setPlayback] = useState<SparkVoicePlaybackState>({ playing: false, mimeType: null });

  const refresh = useCallback(async () => {
    if (!sparkApi) {
      setSnapshot(null);
      setError('Spark control bridge is unavailable.');
      setLoading(false);
      return;
    }

    setLoading(true);
    setError(null);

    const result = await fetchSparkSettingsSnapshot(sparkApi);
    setSnapshot(result.snapshot);
    setError(result.error);
    setLoading(false);
  }, [sparkApi]);

  const refreshVoiceReadiness = useCallback(async () => {
    if (!voiceClient) {
      setVoiceReadiness(null);
      setVoiceError('Spark voice bridge is unavailable.');
      return;
    }

    const result = await voiceClient.getReadiness();
    if (result.success && result.data) {
      setVoiceReadiness(result.data);
      setVoiceError(null);
    } else {
      setVoiceReadiness(null);
      setVoiceError(result.error ?? 'Spark voice readiness is unavailable.');
    }
  }, [voiceClient]);

  const toggleSkill = useCallback(async (skillId: string) => {
    if (!sparkApi) {
      setActionError('Spark control bridge is unavailable.');
      return;
    }

    const skill = (snapshot?.skills ?? []).find((entry) => entry.skillId === skillId);
    if (!skill) {
      setActionError('Spark skill is not available in the current snapshot.');
      return;
    }

    setPendingAction('toggle-skill');
    setActionPendingSkillId(skill.skillId);
    setActionError(null);

    const result = await performSparkSettingsAction(
      sparkApi,
      buildToggleSparkSkillAction(skill.skillId, !skill.enabled),
    );
    if (result.snapshot) {
      setSnapshot(result.snapshot);
    } else if (!result.error && result.result?.ok) {
      await refresh();
    }

    setActionError(result.error ?? (result.result && !result.result.ok ? result.result.message : null));
    setPendingAction(null);
    setActionPendingSkillId(null);
  }, [refresh, snapshot, sparkApi]);

  const viewArtifact = useCallback(async (artifactName: SparkBrainArtifactName) => {
    if (!sparkApi) {
      setActionError('Spark control bridge is unavailable.');
      return;
    }

    setPendingAction('view-artifact');
    setActionPendingArtifactName(artifactName);
    setActionError(null);

    const result = await performSparkSettingsAction(sparkApi, buildViewSparkArtifactAction(artifactName));
    if (result.snapshot) {
      setSnapshot(result.snapshot);
    }

    setActionError(result.error ?? (result.result && !result.result.ok ? result.result.message : null));
    setPendingAction(null);
    setActionPendingArtifactName(null);
  }, [sparkApi]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useEffect(() => {
    void refreshVoiceReadiness();
  }, [refreshVoiceReadiness]);

  useEffect(() => {
    if (!voiceClient) {
      return undefined;
    }

    setSessionFrame(voiceClient.getFrame());
    setPlayback(voiceClient.getPlaybackState());

    const unsubscribeFrame = voiceClient.subscribe((frame, lastEvent) => {
      setSessionFrame(frame);
      if (lastEvent.kind === 'status') {
        setSessionStatus(lastEvent.status);
      }
      if (lastEvent.kind === 'error') {
        setSessionStatus('error');
        setVoiceError(lastEvent.message);
      }
    });
    const unsubscribePlayback = voiceClient.subscribePlayback(setPlayback);

    return () => {
      unsubscribeFrame();
      unsubscribePlayback();
    };
  }, [voiceClient]);

  useEffect(() => () => {
    if (ownsVoiceCapture) {
      voiceCapture?.stop();
    }
    pcmCapture?.stop();
    if (ownsVoiceClient) {
      voiceClient?.dispose();
    }
  }, [ownsVoiceCapture, ownsVoiceClient, pcmCapture, voiceCapture, voiceClient]);

  const sessionActive = sessionStatus !== 'idle' && sessionStatus !== 'error';

  const getOrCreateVoiceCapture = useCallback(async (): Promise<SparkVoiceCapture | null> => {
    if (voiceCapture) {
      return voiceCapture;
    }

    if (providedVoiceCapture !== undefined) {
      return providedVoiceCapture;
    }

    if (typeof window === 'undefined' || !window.sparkVoiceApi) {
      return null;
    }

    const module = await import('../spark/spark-voice-capture.js');
    const capture = module.createSparkVoiceCapture({ api: window.sparkVoiceApi });
    setVoiceCapture(capture);
    return capture;
  }, [providedVoiceCapture, voiceCapture]);

  const getOrCreatePcmCapture = useCallback(async (): Promise<SparkVoiceCapture | null> => {
    if (pcmCapture) {
      return pcmCapture;
    }
    if (typeof window === 'undefined' || !window.sparkVoiceApi) {
      return null;
    }
    const module = await import('../spark/spark-pcm-capture.js');
    const capture = module.createSparkPcmCapture({ api: window.sparkVoiceApi });
    setPcmCapture(capture);
    return capture;
  }, [pcmCapture]);

  const startVoiceSession = useCallback(async () => {
    if (!voiceClient) {
      setVoiceError('Spark voice bridge is unavailable.');
      return;
    }

    setVoiceError(null);
    const result = await voiceClient.start();
    if (!result.success) {
      setSessionStatus('error');
      setVoiceError(result.error ?? 'Spark voice session failed to start.');
      return;
    }

    if (result.data) {
      setVoiceReadiness(result.data);
    }
    setSessionStatus('listening');

    // Realtime (FreeLLMAPI) streams mic PCM continuously — the server does VAD —
    // regardless of the push-to-talk/always-listening UI mode. Classic only
    // captures in always-listening (or per-press in push-to-talk).
    const mode = result.data?.mode ?? voiceReadiness?.mode;
    try {
      if (mode === 'realtime') {
        await (await getOrCreatePcmCapture())?.start();
      } else if (sessionMode === 'always-listening') {
        await (await getOrCreateVoiceCapture())?.start();
      }
    } catch (captureError) {
      setVoiceError(captureError instanceof Error ? captureError.message : 'Microphone capture failed.');
    }
  }, [getOrCreatePcmCapture, getOrCreateVoiceCapture, sessionMode, voiceClient, voiceReadiness]);

  const stopVoiceSession = useCallback(async () => {
    voiceCapture?.stop();
    pcmCapture?.stop();
    if (!voiceClient) {
      setSessionStatus('idle');
      return;
    }

    const result = await voiceClient.stop();
    setSessionStatus(result.success ? 'idle' : 'error');
    if (!result.success) {
      setVoiceError(result.error ?? 'Spark voice session failed to stop.');
    }
  }, [pcmCapture, voiceCapture, voiceClient]);

  const sendTextMessage = useCallback(async (message = textMessage) => {
    const trimmed = message.trim();
    if (!trimmed || !voiceClient) {
      return;
    }

    setVoiceError(null);
    const result = await voiceClient.sendText(trimmed);
    if (result.success) {
      setTextMessage('');
      setSessionStatus(result.data?.status ?? 'thinking');
    } else {
      setSessionStatus('error');
      setVoiceError(result.error ?? 'Spark text turn failed.');
    }
  }, [textMessage, voiceClient]);

  const startPushToTalk = useCallback(async () => {
    if (sessionMode !== 'push-to-talk' || !sessionActive) {
      return;
    }

    try {
      await (await getOrCreateVoiceCapture())?.start();
    } catch (captureError) {
      setVoiceError(captureError instanceof Error ? captureError.message : 'Microphone capture failed.');
    }
  }, [getOrCreateVoiceCapture, sessionActive, sessionMode]);

  const stopPushToTalk = useCallback(() => {
    voiceCapture?.stop();
  }, [voiceCapture]);

  const setSessionMode = useCallback((mode: SparkVoiceSessionMode) => {
    setSessionModeState(mode);
    if (mode !== 'always-listening') {
      voiceCapture?.stop();
    }
  }, [voiceCapture]);

  const stopPlayback = useCallback(() => {
    voiceClient?.stopPlayback();
  }, [voiceClient]);

  const statusModel = useMemo(() => buildSparkControlStatusModel(snapshot), [snapshot]);
  const capabilities = useMemo(() => buildSparkControlCapabilities(snapshot), [snapshot]);
  const readiness = useMemo(() => buildSparkControlReadiness(snapshot, voiceReadiness), [snapshot, voiceReadiness]);
  const startSession = useMemo(() => buildSparkControlStartSession({
    readiness: voiceReadiness,
    sessionActive,
    bridgeAvailable: Boolean(voiceClient),
  }), [sessionActive, voiceClient, voiceReadiness]);
  const sessionPanels = useMemo(() => buildSparkSessionPanels(), []);
  const sessionStatusModel = useMemo(() => buildSparkControlSessionStatusModel(sessionStatus), [sessionStatus]);
  const skills = useMemo(() => buildSparkSkillsModel(snapshot), [snapshot]);
  const brain = useMemo(() => buildSparkBrainModel(snapshot), [snapshot]);

  return {
    snapshot,
    loading,
    error,
    actionError,
    pendingAction,
    actionPendingSkillId,
    actionPendingArtifactName,
    statusModel,
    capabilities,
    readiness,
    startSession,
    sessionPanels,
    sessionFrame,
    sessionStatusModel,
    sessionActive,
    sessionMode,
    textMessage,
    voiceError,
    playback,
    skills,
    brain,
    refresh,
    startVoiceSession,
    stopVoiceSession,
    sendTextMessage,
    startPushToTalk,
    stopPushToTalk,
    setSessionMode,
    setTextMessage,
    stopPlayback,
    toggleSkill,
    viewArtifact,
  };
}

function getWindowSparkApi(): SparkSettingsApi | null {
  if (typeof window === 'undefined' || !window.sparkApi) {
    return null;
  }

  return window.sparkApi;
}

function getWindowSparkVoiceClient(): SparkVoiceClient | null {
  if (typeof window === 'undefined' || !window.sparkVoiceApi) {
    return null;
  }

  return createSparkVoiceClient({
    api: window.sparkVoiceApi,
    player: createBrowserAudioPlayer(),
  });
}
