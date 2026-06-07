import { describe, expect, it } from 'vitest';

import { createSparkBrainSettingsAdapter } from './services/spark-brain-adapter.js';
import { createVaultBrainStore } from './services/spark-brain-vault-store.js';
import { createSparkProviderCredentialStore } from './services/spark-provider-credentials.js';
import { FakeVaultHost } from './spark-brain-test-host.js';

const NOW = '2026-06-06T12:00:00.000Z';

function makeStore() {
  const secrets = new Map<string, string>();
  const settings = new Map<string, unknown>();
  return createSparkProviderCredentialStore({
    getSecret: (k) => secrets.get(k) ?? '',
    setSecret: (k, v) => void secrets.set(k, v),
    getSetting: (k) => settings.get(k),
    setSetting: (k, v) => void settings.set(k, v),
    now: () => NOW,
  });
}

describe('Spark Brain adapter providerHealth injection', () => {
  it('surfaces the injected provider health summary in the snapshot', async () => {
    const providerStore = makeStore();
    providerStore.setProviderCredential('freellmapi', 'vps-secret-key', 'https://vps.example.com/v1');

    const host = new FakeVaultHost();
    const store = createVaultBrainStore(host, { now: () => NOW });
    const adapter = createSparkBrainSettingsAdapter({
      loadModule: async () => null, // runtime not loaded -> empty snapshot path
      createStore: () => store,
      getPackageInfo: () => ({ available: false, version: null }),
      getProviderHealth: () => providerStore.getProviderHealthSummary(),
      now: () => NOW,
    });

    const snapshot = await adapter.getSnapshot();
    const freellmapi = snapshot.providerHealth.providers.find((p) => p.providerId === 'freellmapi');
    expect(freellmapi?.credentialState).toBe('configured');
    expect(snapshot.providerHealth.ready).toBeGreaterThanOrEqual(1);
    expect(snapshot.providerHealth.roleAssignments?.LLM).toBe('freellmapi');
    // The injected summary never carries the raw key.
    expect(JSON.stringify(snapshot.providerHealth)).not.toContain('vps-secret-key');
  });

  it('falls back to an empty provider health summary when no resolver is given', async () => {
    const host = new FakeVaultHost();
    const store = createVaultBrainStore(host, { now: () => NOW });
    const adapter = createSparkBrainSettingsAdapter({
      loadModule: async () => null,
      createStore: () => store,
      getPackageInfo: () => ({ available: false, version: null }),
      now: () => NOW,
    });

    const snapshot = await adapter.getSnapshot();
    expect(snapshot.providerHealth.providers).toHaveLength(0);
    expect(snapshot.providerHealth.ready).toBe(0);
  });
});
