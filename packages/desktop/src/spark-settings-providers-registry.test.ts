import { describe, expect, it } from 'vitest';

import {
  buildSparkProviderCatalogRows,
  buildSparkProviderRegistryModel,
  buildSparkRoleAssignmentRows,
} from './spark-settings-view-model.js';
import type { SparkExtensionSnapshot } from '@the-vault/core';

describe('spark provider registry view model (S2)', () => {
  it('builds a catalog row per provider with honest configured + capability metadata', () => {
    const rows = buildSparkProviderCatalogRows(null);

    expect(rows.map((row) => row.providerId)).toEqual([
      'freellmapi',
      'deepgram',
      'elevenlabs',
      'openai',
      'gemini',
      'claude',
      'openrouter',
      'ollama',
    ]);

    const free = rows[0];
    expect(free).toMatchObject({
      providerId: 'freellmapi',
      name: 'FreeLLMAPI',
      isDefault: true,
      requiresBaseUrl: true,
      requiresKey: true,
      configured: false,
      rolesLabel: 'STT · LLM · Realtime · TTS',
    });

    const ollama = rows.find((row) => row.providerId === 'ollama')!;
    expect(ollama).toMatchObject({
      requiresKey: false, // authStyle 'none'
      requiresBaseUrl: true,
    });
  });

  it('marks providers configured from snapshot.providerHealth credential state', () => {
    const rows = buildSparkProviderCatalogRows(makeSnapshot({
      providerHealth: {
        activeProviderId: 'openai',
        activeProviderMode: 'classic',
        ready: 1,
        degraded: 0,
        unavailable: 0,
        unknown: 7,
        providers: [
          providerHealth('openai', 'configured', 'ready'),
          providerHealth('deepgram', 'missing', 'unknown'),
        ],
        roleAssignments: { STT: 'deepgram', LLM: 'openai', Realtime: 'freellmapi', TTS: 'freellmapi' },
      },
    }));

    const openai = rows.find((row) => row.providerId === 'openai')!;
    const deepgram = rows.find((row) => row.providerId === 'deepgram')!;
    expect(openai.configured).toBe(true);
    expect(openai.statusClassName).toBe('spark-provider-health-healthy');
    expect(deepgram.configured).toBe(false);
    expect(deepgram.statusClassName).toBe('spark-provider-health-unavailable');
  });

  it('builds one role-assignment row per role with provider options and selection', () => {
    const rows = buildSparkRoleAssignmentRows(null);

    expect(rows.map((row) => row.role)).toEqual(['STT', 'LLM', 'Realtime', 'TTS']);
    expect(rows.map((row) => row.label)).toEqual([
      'Speech-to-text',
      'Language model',
      'Realtime',
      'Text-to-speech',
    ]);
    // All roles default to FreeLLMAPI out of the box.
    expect(rows.every((row) => row.selectedProviderId === 'freellmapi')).toBe(true);

    const stt = rows[0];
    expect(stt.options.map((option) => option.providerId)).toEqual([
      'freellmapi',
      'deepgram',
      'openai',
      'gemini',
    ]);

    const llm = rows[1];
    expect(llm.options.map((option) => option.providerId)).toEqual([
      'freellmapi',
      'openai',
      'gemini',
      'claude',
      'openrouter',
      'ollama',
    ]);
  });

  it('honors stored role assignments from the snapshot', () => {
    const rows = buildSparkRoleAssignmentRows(makeSnapshot({
      providerHealth: {
        activeProviderId: 'openai',
        activeProviderMode: 'classic',
        ready: 0,
        degraded: 0,
        unavailable: 0,
        unknown: 8,
        providers: [],
        roleAssignments: { STT: 'deepgram', LLM: 'openai', Realtime: 'gemini', TTS: 'elevenlabs' },
      },
    }));

    expect(rows.find((row) => row.role === 'STT')!.selectedProviderId).toBe('deepgram');
    expect(rows.find((row) => row.role === 'LLM')!.selectedProviderId).toBe('openai');
    expect(rows.find((row) => row.role === 'TTS')!.selectedProviderId).toBe('elevenlabs');
  });

  it('summarizes configured providers in the registry model', () => {
    const model = buildSparkProviderRegistryModel(makeSnapshot({
      providerHealth: {
        activeProviderId: 'openai',
        activeProviderMode: 'classic',
        ready: 2,
        degraded: 0,
        unavailable: 0,
        unknown: 6,
        providers: [
          providerHealth('openai', 'configured', 'ready'),
          providerHealth('elevenlabs', 'configured', 'ready'),
        ],
        roleAssignments: { STT: 'freellmapi', LLM: 'openai', Realtime: 'freellmapi', TTS: 'elevenlabs' },
      },
    }));

    expect(model.catalogRows).toHaveLength(8);
    expect(model.roleAssignmentRows).toHaveLength(4);
    expect(model.configuredCount).toBe(2);
    expect(model.summaryLabel).toBe('2 of 8 providers configured');
  });

  it('never leaks a key value or key-getter through any registry shape', () => {
    // The registry carries only non-secret catalog metadata + configured booleans.
    // (authStyle: 'apikey' is a capability descriptor, not a credential.)
    const serialized = JSON.stringify(buildSparkProviderRegistryModel(makeSnapshot()));
    expect(serialized).not.toContain('getKey');
    expect(serialized).not.toContain('secret');
    expect(serialized).not.toMatch(/"(apiKey|key|credential)"\s*:/);
  });
});

function providerHealth(
  providerId: string,
  credentialState: SparkExtensionSnapshot['providerHealth']['providers'][number]['credentialState'],
  aggregateHealth: SparkExtensionSnapshot['providerHealth']['providers'][number]['aggregateHealth'],
): SparkExtensionSnapshot['providerHealth']['providers'][number] {
  return {
    providerId,
    displayName: providerId,
    enabled: credentialState === 'configured',
    credentialState,
    aggregateHealth,
    classic: { state: aggregateHealth, message: '', checkedAt: null },
    realtime: { state: aggregateHealth, message: '', checkedAt: null },
  };
}

function makeSnapshot(overrides: Partial<SparkExtensionSnapshot> = {}): SparkExtensionSnapshot {
  return {
    schemaVersion: 1,
    generatedAt: '2026-06-06T09:00:00.000Z',
    status: {
      installState: 'ready',
      enabled: true,
      source: 'managed',
      version: '0.1.0',
      brainProject: 'Spark Brain',
      activeProviderId: null,
      activeProviderMode: null,
      message: 'ready',
      installCommands: [],
      issues: [],
    },
    providerHealth: {
      activeProviderId: null,
      activeProviderMode: null,
      ready: 0,
      degraded: 0,
      unavailable: 0,
      unknown: 0,
      providers: [],
    },
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
