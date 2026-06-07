import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

const sparkIpcMethods = [
  {
    method: 'getSnapshot',
    channel: 'spark:getSnapshot',
  },
  {
    method: 'executeAction',
    channel: 'spark:executeAction',
  },
];

function readSource(relativeUrl: string): string {
  return readFileSync(new URL(relativeUrl, import.meta.url), 'utf8');
}

describe('Spark settings Wave 1 IPC contract', () => {
  it('declares a dedicated window.sparkApi bridge', () => {
    const typesSource = readSource('./types.d.ts');

    expect(typesSource).toContain('interface SparkAPI');
    expect(typesSource).toContain('sparkApi: SparkAPI');
    expect(typesSource).toContain('getSnapshot: () => Promise<VaultResponse<SparkExtensionSnapshot>>');
    expect(typesSource).toContain('executeAction: (input: SparkExtensionAction) => Promise<VaultResponse<SparkExtensionActionResult>>');
    expect(typesSource).not.toContain('getSparkProviderSecret');
  });

  it('bridges Spark methods through dedicated preload IPC channels', () => {
    const preloadSource = readSource('../electron/preload.ts');

    expect(preloadSource).toContain("contextBridge.exposeInMainWorld('sparkApi'");
    for (const { method, channel } of sparkIpcMethods) {
      expect(preloadSource).toContain(`${method}: (`);
      expect(preloadSource).toContain(`ipcRenderer.invoke('${channel}'`);
    }
    expect(preloadSource).not.toContain('spark:getProviderSecret');
  });

  it('registers main-process Spark IPC handlers without provider secret reads', () => {
    const mainSource = readSource('../electron/main.ts');

    expect(mainSource).toContain('new SparkExtensionSettingsService({');
    expect(mainSource).toContain('vaultRoot: vault.getVaultRoot()');
    for (const { channel } of sparkIpcMethods) {
      expect(mainSource).toContain(`ipcMain.handle('${channel}'`);
    }
    expect(mainSource).not.toContain('spark:getProviderSecret');
    expect(mainSource).not.toContain('getSparkProviderSecret');
  });
});

const sparkCredentialChannels = [
  { method: 'setProviderCredential', channel: 'spark:setProviderCredential' },
  { method: 'getProviderCredentialState', channel: 'spark:getProviderCredentialState' },
  { method: 'setRoleAssignment', channel: 'spark:setRoleAssignment' },
  { method: 'getRoleAssignments', channel: 'spark:getRoleAssignments' },
];

describe('Spark S2 provider credential IPC contract', () => {
  it('declares dedicated credential methods on the SparkAPI bridge (state only, no key getter)', () => {
    const typesSource = readSource('./types.d.ts');

    for (const { method } of sparkCredentialChannels) {
      expect(typesSource).toContain(`${method}: (`);
    }
    // The renderer never gets a way to read a stored key back.
    expect(typesSource).not.toContain('getProviderCredential:');
    expect(typesSource).not.toContain('getProviderKey');
  });

  it('bridges credential channels through dedicated preload IPC invokes', () => {
    const preloadSource = readSource('../electron/preload.ts');

    for (const { method, channel } of sparkCredentialChannels) {
      expect(preloadSource).toContain(`${method}: (`);
      expect(preloadSource).toContain(`ipcRenderer.invoke('${channel}'`);
    }
  });

  it('registers credential channels in main and wires provider health into the adapter', () => {
    const mainSource = readSource('../electron/main.ts');

    for (const { channel } of sparkCredentialChannels) {
      expect(mainSource).toContain(`ipcMain.handle('${channel}'`);
    }
    // Credential store is constructed and its health summary feeds the snapshot.
    expect(mainSource).toContain('createSparkProviderCredentialStore');
    expect(mainSource).toContain('getProviderHealth');
    // Keys must never flow through the generic executeAction surface.
    expect(mainSource).not.toContain('spark:getProviderKey');
    expect(mainSource).not.toContain('getSparkProviderKey');
  });
});
