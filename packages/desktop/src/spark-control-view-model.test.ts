import { describe, expect, it } from 'vitest';

import {
  buildSparkControlCapabilities,
  buildSparkControlReadiness,
  buildSparkControlStartSession,
  buildSparkControlStatusModel,
  buildSparkSessionPanels,
  countConfiguredSparkProviders,
} from './view-models/spark-control-view-model.js';
import type { SparkExtensionSnapshot, SparkVoiceReadiness } from '@the-vault/core';

describe('spark control view model', () => {
  it('maps a missing snapshot to an honest idle status', () => {
    expect(buildSparkControlStatusModel(null)).toEqual({
      status: 'idle',
      label: 'Idle',
      detail: 'Spark snapshot is not available yet.',
      className: 'spark-control-status-idle',
    });
  });

  it('maps install state into the control status badge', () => {
    expect(buildSparkControlStatusModel(makeSnapshot({ status: statusWith('ready', 'Spark ready.') })))
      .toMatchObject({ status: 'ready', label: 'Ready', detail: 'Spark ready.' });

    expect(buildSparkControlStatusModel(makeSnapshot({ status: statusWith('bootstrapping', 'Spark booting.') })))
      .toMatchObject({ status: 'initialising', label: 'Initialising', detail: 'Spark booting.' });

    expect(buildSparkControlStatusModel(makeSnapshot({ status: statusWith('failed', 'Spark failed.') })))
      .toMatchObject({ status: 'error', label: 'Error', detail: 'Spark failed.' });

    expect(buildSparkControlStatusModel(makeSnapshot({ status: statusWith('degraded', 'Spark degraded.') })))
      .toMatchObject({ status: 'error', label: 'Error' });

    expect(buildSparkControlStatusModel(makeSnapshot({ status: statusWith('missing', 'Not connected.') })))
      .toMatchObject({ status: 'idle', label: 'Idle' });

    expect(buildSparkControlStatusModel(makeSnapshot({ status: statusWith('installable', 'Installable.') })))
      .toMatchObject({ status: 'idle' });
  });

  it('counts only providers with stored credentials', () => {
    expect(countConfiguredSparkProviders(null)).toBe(0);
    expect(countConfiguredSparkProviders(makeSnapshot())).toBe(0);
    expect(countConfiguredSparkProviders(makeSnapshot({ providerHealth: providerHealthWith(['configured', 'missing', 'configured', 'invalid']) }))).toBe(2);
  });

  it('builds the capabilities strip from snapshot counts and configured providers', () => {
    const capabilities = buildSparkControlCapabilities(makeSnapshot({
      counts: {
        skills: 13,
        enabledSkills: 11,
        installedPacks: 2,
        pendingApprovals: 0,
        brainArtifacts: 6,
        staleBrainArtifacts: 1,
        ledgerSuggestions: 0,
        pendingLedgerSuggestions: 0,
      },
      providerHealth: providerHealthWith(['configured']),
    }));

    expect(capabilities).toEqual([
      { key: 'skills', label: 'Skills', value: 13 },
      { key: 'packs', label: 'Packs', value: 2 },
      { key: 'artifacts', label: 'Brain artifacts', value: 6 },
      { key: 'providers', label: 'Configured providers', value: 1 },
    ]);
  });

  it('falls back to zero counts when no snapshot is available', () => {
    expect(buildSparkControlCapabilities(null).map((item) => item.value)).toEqual([0, 0, 0, 0]);
  });

  it('reports voice-runtime readiness from the live S3 readiness result', () => {
    const notReady = buildSparkControlReadiness(makeSnapshot());
    expect(notReady).toEqual([
      {
        key: 'provider',
        label: 'Provider configured',
        ready: false,
        detail: 'Configure a provider in Settings → Extensions → Spark (S2).',
      },
      {
        key: 'voice-runtime',
        label: 'Voice runtime wired',
        ready: false,
        detail: 'Waiting for voice readiness from the S3 runtime.',
      },
    ]);

    const providerReady = buildSparkControlReadiness(
      makeSnapshot({ providerHealth: providerHealthWith(['configured', 'configured', 'configured']) }),
      readyVoiceReadiness(),
    );
    expect(providerReady[0]).toMatchObject({ key: 'provider', ready: true });
    expect(providerReady[1]).toEqual({
      key: 'voice-runtime',
      label: 'Voice runtime wired',
      ready: true,
      detail: 'STT, LLM, and TTS providers are ready.',
    });

    const missingTts = buildSparkControlReadiness(
      makeSnapshot({ providerHealth: providerHealthWith(['configured', 'configured']) }),
      { ready: false, roles: [], missing: ['TTS'] },
    );
    expect(missingTts[1]).toMatchObject({
      key: 'voice-runtime',
      ready: false,
      detail: 'Missing configured provider for TTS.',
    });
  });

  it('enables Start session only when the live voice readiness is ready', () => {
    expect(buildSparkControlStartSession({ readiness: readyVoiceReadiness(), sessionActive: false })).toEqual({
      disabled: false,
      label: 'Start session',
      tooltip: 'Start a live Spark voice session.',
    });

    expect(buildSparkControlStartSession({ readiness: readyVoiceReadiness(), sessionActive: true })).toEqual({
      disabled: false,
      label: 'Stop session',
      tooltip: 'Stop the active Spark voice session.',
    });

    expect(buildSparkControlStartSession({ readiness: { ready: false, roles: [], missing: ['STT', 'TTS'] }, sessionActive: false })).toEqual({
      disabled: true,
      label: 'Start session',
      tooltip: 'Configure STT and TTS providers before starting.',
    });
  });

  it('defines the four inert session-frame panels with correct empty states', () => {
    expect(buildSparkSessionPanels()).toEqual([
      { id: 'transcript', title: 'Transcript', emptyLabel: 'Waiting for session...' },
      { id: 'tool-calls', title: 'Tool-call log', emptyLabel: 'No tool calls yet' },
      { id: 'visualizer', title: 'Voice visualizer', emptyLabel: 'Audio inactive' },
      { id: 'canvas', title: 'Canvas', emptyLabel: 'Canvas is empty' },
    ]);
  });
});

function readyVoiceReadiness(): SparkVoiceReadiness {
  return {
    ready: true,
    missing: [],
    roles: [
      { role: 'STT', providerId: 'deepgram', configured: true },
      { role: 'LLM', providerId: 'openai', configured: true },
      { role: 'TTS', providerId: 'elevenlabs', configured: true },
    ],
  };
}

function statusWith(
  installState: SparkExtensionSnapshot['status']['installState'],
  message: string,
): SparkExtensionSnapshot['status'] {
  return {
    installState,
    enabled: installState === 'ready',
    source: 'managed',
    version: installState === 'ready' ? '0.1.0' : null,
    brainProject: 'Spark Brain',
    activeProviderId: null,
    activeProviderMode: null,
    message,
    installCommands: [],
    issues: [],
  };
}

function providerHealthWith(
  credentialStates: SparkExtensionSnapshot['providerHealth']['providers'][number]['credentialState'][],
): SparkExtensionSnapshot['providerHealth'] {
  return {
    activeProviderId: null,
    activeProviderMode: null,
    ready: 0,
    degraded: 0,
    unavailable: 0,
    unknown: credentialStates.length,
    providers: credentialStates.map((credentialState, index) => ({
      providerId: `provider-${index}`,
      displayName: `Provider ${index}`,
      enabled: true,
      credentialState,
      aggregateHealth: 'unknown',
      classic: { state: 'unknown', message: '', checkedAt: null, latencyMs: null, lastRedactedError: null },
      realtime: { state: 'unknown', message: '', checkedAt: null, latencyMs: null, lastRedactedError: null },
    })),
  };
}

function makeSnapshot(overrides: Partial<SparkExtensionSnapshot> = {}): SparkExtensionSnapshot {
  return {
    schemaVersion: 1,
    generatedAt: '2026-06-06T09:00:00.000Z',
    status: statusWith('missing', 'Spark Brain is not connected to The Vault settings yet.'),
    providerHealth: providerHealthWith([]),
    skillStatus: { total: 0, enabled: 0, disabled: 0, locked: 0, pendingApproval: 0 },
    skills: [],
    skillCatalog: [],
    pendingApprovals: [],
    capabilityPacks: [],
    evolutionSuggestions: [],
    packStatus: { total: 0, installed: 0, updateAvailable: 0 },
    approvals: { pending: 0, skillProposals: 0, evolutionSuggestions: 0 },
    brainArtifacts: { fresh: 0, stale: 0, missing: 0, latestGeneratedAt: null, artifacts: [] },
    ledgerSuggestions: { total: 0, pending: 0, approved: 0, rejected: 0, deferred: 0, superseded: 0 },
    counts: {
      skills: 0,
      enabledSkills: 0,
      installedPacks: 0,
      pendingApprovals: 0,
      brainArtifacts: 0,
      staleBrainArtifacts: 0,
      ledgerSuggestions: 0,
      pendingLedgerSuggestions: 0,
    },
    ...overrides,
  };
}
