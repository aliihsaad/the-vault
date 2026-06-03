import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

const phase6IpcMethods = [
  {
    method: 'listVaultCollabEventTypes',
    channel: 'vault:listVaultCollabEventTypes',
  },
  {
    method: 'activateVaultCollabPolicyPack',
    channel: 'vault:activateVaultCollabPolicyPack',
  },
  {
    method: 'deactivateVaultCollabPolicyPack',
    channel: 'vault:deactivateVaultCollabPolicyPack',
  },
];

function readSource(relativeUrl: string): string {
  return readFileSync(new URL(relativeUrl, import.meta.url), 'utf8');
}

describe('Vault Collab Phase 6 IPC contract', () => {
  it('declares policy and event-registry methods on window.vaultAPI', () => {
    const typesSource = readSource('./types.d.ts');

    for (const { method } of phase6IpcMethods) {
      expect(typesSource).toContain(`${method}: (`);
    }
  });

  it('bridges policy and event-registry methods through preload IPC', () => {
    const preloadSource = readSource('../electron/preload.ts');

    for (const { method, channel } of phase6IpcMethods) {
      expect(preloadSource).toContain(`${method}: (`);
      expect(preloadSource).toContain(`ipcRenderer.invoke('${channel}'`);
    }
  });

  it('registers main-process IPC handlers for policy and event-registry methods', () => {
    const mainSource = readSource('../electron/main.ts');

    for (const { channel } of phase6IpcMethods) {
      expect(mainSource).toContain(`ipcMain.handle('${channel}'`);
    }
  });
});
