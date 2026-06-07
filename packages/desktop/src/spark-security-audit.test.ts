import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

function readSource(relativeUrl: string): string {
  return readFileSync(new URL(relativeUrl, import.meta.url), 'utf8');
}

/**
 * S5 security audit: provider API keys live only in the Electron main process
 * (encrypted secret store). The renderer may write a key in and read credential
 * *state* back, but no IPC channel may ever hand a raw key to the renderer.
 */
describe('Spark credential IPC boundary (S5 security audit)', () => {
  it('exposes only a key-writing setter and a state reader in preload', () => {
    const preload = readSource('../electron/preload.ts');
    // The write path (renderer -> main) and the state read are allowed.
    expect(preload).toContain("'spark:setProviderCredential'");
    expect(preload).toContain("'spark:getProviderCredentialState'");
    // No channel may read a raw key back out to the renderer.
    expect(preload).not.toContain('getProviderCredential(');
    expect(preload).not.toContain('spark:getProviderCredential"');
    expect(preload).not.toContain("spark:getProviderCredential'");
    expect(preload).not.toContain('getKeyForProvider');
    expect(preload).not.toContain('getActiveProviderForRole');
  });

  it('keeps raw-key resolvers host-only in the credential store contract', () => {
    const store = readSource('../../core/src/services/spark-provider-credentials.ts');
    // The resolvers exist for the host, explicitly marked HOST-ONLY.
    expect(store).toContain('getKeyForProvider');
    expect(store).toContain('HOST-ONLY');
    // State views are documented as never returning the key.
    expect(store).toContain('never the key');
  });
});
