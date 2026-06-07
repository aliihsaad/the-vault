import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

function readSource(relativeUrl: string): string {
  return readFileSync(new URL(relativeUrl, import.meta.url), 'utf8');
}

const voiceInvokeChannels = [
  { method: 'getReadiness', channel: 'spark:voice:getReadiness' },
  { method: 'start', channel: 'spark:voice:start' },
  { method: 'stop', channel: 'spark:voice:stop' },
  { method: 'sendText', channel: 'spark:voice:sendText' },
  { method: 'sendAudioUtterance', channel: 'spark:voice:audioUtterance' },
];

const voiceSendChannels = [
  { method: 'sendAudioLevel', channel: 'spark:voice:audioLevel' },
  { method: 'notifyPlaybackEnded', channel: 'spark:voice:playbackEnded' },
];

describe('Spark S3 voice IPC contract', () => {
  it('declares a dedicated window.sparkVoiceApi bridge in types', () => {
    const typesSource = readSource('./types.d.ts');
    expect(typesSource).toContain('interface SparkVoiceAPI');
    expect(typesSource).toContain('sparkVoiceApi: SparkVoiceAPI');
    expect(typesSource).toContain('onVoiceEvent:');
    expect(typesSource).toContain('onPlayAudio:');
    expect(typesSource).toContain('onStopAudio:');
  });

  it('bridges voice channels through dedicated preload IPC invokes/sends + event listeners', () => {
    const preload = readSource('../electron/preload.ts');
    expect(preload).toContain("contextBridge.exposeInMainWorld('sparkVoiceApi'");
    for (const { method, channel } of voiceInvokeChannels) {
      expect(preload).toContain(`${method}: (`);
      expect(preload).toContain(`ipcRenderer.invoke('${channel}'`);
    }
    for (const { method, channel } of voiceSendChannels) {
      expect(preload).toContain(`${method}: (`);
      expect(preload).toContain(`ipcRenderer.send('${channel}'`);
    }
    // Inbound host → renderer streams are subscribed, not polled.
    expect(preload).toContain("ipcRenderer.on('spark:voice:event'");
    expect(preload).toContain("ipcRenderer.on('spark:voice:playAudio'");
    expect(preload).toContain("ipcRenderer.on('spark:voice:stopAudio'");
  });

  it('registers main-process voice handlers and pushes events to the window', () => {
    const main = readSource('../electron/main.ts');
    expect(main).toContain('createSparkVoiceHost');
    expect(main).toContain('createNodeSparkFetch');
    for (const { channel } of voiceInvokeChannels) {
      expect(main).toContain(`ipcMain.handle('${channel}'`);
    }
    for (const { channel } of voiceSendChannels) {
      expect(main).toContain(`ipcMain.on('${channel}'`);
    }
    // Host events bridged back to the renderer.
    expect(main).toContain("win?.webContents.send('spark:voice:event'");
    expect(main).toContain("win?.webContents.send('spark:voice:playAudio'");
    // Recall is wired host-side (read-only) — keys never cross to the renderer.
    expect(main).toContain('recall: sparkVoiceRecall');
    expect(main).not.toContain('spark:voice:getKey');
  });

  it('the host module resolves providers from the S2 credential store and stays Electron-free', () => {
    const host = readSource('../electron/spark-voice-host.ts');
    expect(host).toContain('createSparkVoiceRuntimeSession');
    expect(host).toContain('buildSparkVoiceReadiness');
    expect(host).toContain('buildSparkHostTools');
    // No direct Electron import — side effects are injected.
    expect(host).not.toContain("from 'electron'");
  });
});
