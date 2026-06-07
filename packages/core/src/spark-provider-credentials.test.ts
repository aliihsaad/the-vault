import { describe, expect, it } from 'vitest';

import {
  buildSparkProviderHealthSummary,
  createSparkProviderCredentialStore,
  type SparkProviderCredentialStoreDeps,
} from './services/spark-provider-credentials.js';
import { getDefaultRoleAssignments } from './services/spark-provider-catalog.js';

/**
 * In-memory deps simulating the main-process secret store. `secrets` stands in
 * for the safeStorage/AES-GCM encrypted setSecretSetting/getSecretSetting pair;
 * `settings` stands in for the plain Vault settings table.
 */
function makeDeps(): SparkProviderCredentialStoreDeps & {
  secrets: Map<string, string>;
  settings: Map<string, unknown>;
} {
  const secrets = new Map<string, string>();
  const settings = new Map<string, unknown>();
  return {
    secrets,
    settings,
    getSecret: (key) => secrets.get(key) ?? '',
    setSecret: (key, value) => {
      secrets.set(key, value);
    },
    getSetting: (key) => settings.get(key),
    setSetting: (key, value) => {
      settings.set(key, value);
    },
    now: () => '2026-06-06T12:00:00.000Z',
  };
}

const SECRET_KEY = 'sk-super-secret-deepgram-key-1234567890';

describe('Spark provider credential store', () => {
  it('round-trips a provider credential through the secret store', () => {
    const deps = makeDeps();
    const store = createSparkProviderCredentialStore(deps);

    store.setProviderCredential('deepgram', SECRET_KEY);

    // Encrypted-at-rest copy exists in the secret store.
    expect([...deps.secrets.values()].some((v) => v === SECRET_KEY)).toBe(true);
    // Host-side resolution returns the real key.
    expect(store.getKeyForProvider('deepgram')).toBe(SECRET_KEY);
    // Credential state reports configured but never the key.
    const state = store.getProviderCredentialState('deepgram');
    expect(state).toEqual({ providerId: 'deepgram', configured: true, baseUrl: null });
  });

  it('NEVER echoes the key in any renderer-facing return value', () => {
    const deps = makeDeps();
    const store = createSparkProviderCredentialStore(deps);
    store.setProviderCredential('openai', SECRET_KEY, 'https://api.openai.com/v1');

    const surfaces = [
      store.setProviderCredential('openai', SECRET_KEY),
      store.getProviderCredentialState('openai'),
      store.listCredentialStates(),
      store.getRoleAssignments(),
      store.getProviderHealthSummary(),
    ];
    for (const surface of surfaces) {
      expect(JSON.stringify(surface)).not.toContain(SECRET_KEY);
    }
  });

  it('persists the base URL as non-secret state', () => {
    const deps = makeDeps();
    const store = createSparkProviderCredentialStore(deps);
    store.setProviderCredential('freellmapi', SECRET_KEY, 'https://vps.example.com/v1');

    expect(store.getProviderCredentialState('freellmapi')).toEqual({
      providerId: 'freellmapi',
      configured: true,
      baseUrl: 'https://vps.example.com/v1',
    });
  });

  it('treats no-auth providers as configured once a base URL is set', () => {
    const deps = makeDeps();
    const store = createSparkProviderCredentialStore(deps);
    store.setProviderCredential('ollama', '', 'http://localhost:11434');
    expect(store.getProviderCredentialState('ollama').configured).toBe(true);
  });

  it('rejects unknown providers', () => {
    const store = createSparkProviderCredentialStore(makeDeps());
    expect(() => store.setProviderCredential('nope', SECRET_KEY)).toThrow();
  });

  it('defaults role assignments to FreeLLMAPI and persists valid changes', () => {
    const deps = makeDeps();
    const store = createSparkProviderCredentialStore(deps);
    expect(store.getRoleAssignments()).toEqual(getDefaultRoleAssignments());

    store.setRoleAssignment('STT', 'deepgram');
    expect(store.getRoleAssignments().STT).toBe('deepgram');

    // Re-reading from a fresh store backed by the same settings is restart-safe.
    const reopened = createSparkProviderCredentialStore(deps);
    expect(reopened.getRoleAssignments().STT).toBe('deepgram');
  });

  it('rejects role assignments the provider cannot fill', () => {
    const store = createSparkProviderCredentialStore(makeDeps());
    expect(() => store.setRoleAssignment('LLM', 'deepgram')).toThrow();
  });

  it('resolves the active provider for a role with a host-side getKey()', () => {
    const deps = makeDeps();
    const store = createSparkProviderCredentialStore(deps);
    store.setProviderCredential('deepgram', SECRET_KEY);
    store.setRoleAssignment('STT', 'deepgram');

    const active = store.getActiveProviderForRole('STT');
    expect(active.providerId).toBe('deepgram');
    expect(active.role).toBe('STT');
    expect(active.getKey()).toBe(SECRET_KEY);
  });

  it('builds a provider health summary that reflects configured providers + assignments', () => {
    const deps = makeDeps();
    const store = createSparkProviderCredentialStore(deps);
    store.setProviderCredential('freellmapi', SECRET_KEY, 'https://vps.example.com/v1');

    const summary = store.getProviderHealthSummary();
    const freellmapi = summary.providers.find((p) => p.providerId === 'freellmapi');
    expect(freellmapi?.credentialState).toBe('configured');
    expect(freellmapi?.aggregateHealth).toBe('ready');
    expect(summary.ready).toBeGreaterThanOrEqual(1);
    expect(summary.roleAssignments?.LLM).toBe('freellmapi');
    // Unconfigured providers are surfaced as unknown, not configured.
    const deepgram = summary.providers.find((p) => p.providerId === 'deepgram');
    expect(deepgram?.credentialState).toBe('missing');
  });
});

describe('buildSparkProviderHealthSummary (pure)', () => {
  it('counts ready vs unknown providers without leaking keys', () => {
    const summary = buildSparkProviderHealthSummary({
      credentialStates: [
        { providerId: 'freellmapi', configured: true, baseUrl: 'https://vps.example.com/v1' },
        { providerId: 'deepgram', configured: false, baseUrl: null },
      ],
      assignments: getDefaultRoleAssignments(),
      now: '2026-06-06T12:00:00.000Z',
    });

    // The summary always reflects the full catalog; only freellmapi is configured.
    expect(summary.providers.length).toBeGreaterThanOrEqual(2);
    expect(summary.ready).toBe(1);
    expect(summary.unknown).toBe(summary.providers.length - 1);
    expect(summary.activeProviderId).toBe('freellmapi');
    expect(JSON.stringify(summary)).not.toContain('sk-');
  });
});
