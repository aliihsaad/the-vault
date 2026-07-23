import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type {
  ProjectLifecycleTransitionResult,
  TransitionProjectLifecycleInput,
} from '@the-vault/core';

type PublicLifecycleTypesCompile =
  TransitionProjectLifecycleInput['nextState'] extends ProjectLifecycleTransitionResult['project']['lifecycleState']
    ? true
    : false;

const publicLifecycleTypesCompile: PublicLifecycleTypesCompile = true;

const operationChannels = [
  ['createOpenLoop', 'vault:createOpenLoop'],
  ['getDedicatedOpenLoop', 'vault:getDedicatedOpenLoop'],
  ['listDedicatedOpenLoops', 'vault:listDedicatedOpenLoops'],
  ['countDedicatedOpenLoops', 'vault:countDedicatedOpenLoops'],
  ['addLoopEvidence', 'vault:addLoopEvidence'],
  ['evaluateProjectGate', 'vault:evaluateProjectGate'],
  ['transitionProjectLifecycle', 'vault:transitionProjectLifecycle'],
  ['requestLoopSnooze', 'vault:requestLoopSnooze'],
  ['decideLoopSnooze', 'vault:decideLoopSnooze'],
  ['resolveOpenLoop', 'vault:resolveOpenLoop'],
  ['recoverOpenLoop', 'vault:recoverOpenLoop'],
  ['classifyProject', 'vault:classifyProject'],
  ['convertProjectType', 'vault:convertProjectType'],
  ['inventoryLegacyLoopCandidates', 'vault:inventoryLegacyLoopCandidates'],
  ['getOpenLoopShadowTelemetry', 'vault:getOpenLoopShadowTelemetry'],
] as const;

function readSource(relativeUrl: string): string {
  return readFileSync(new URL(relativeUrl, import.meta.url), 'utf8');
}

describe('Open-Loops v2 desktop IPC contract', () => {
  it('imports lifecycle contracts from the public Core entry point', () => {
    expect(publicLifecycleTypesCompile).toBe(true);
  });

  it('keeps preload, renderer types, and main-process handlers aligned', () => {
    const preloadSource = readSource('../electron/preload.ts');
    const typesSource = readSource('./types.d.ts');
    const mainSource = readSource('../electron/main.ts');

    for (const [method, channel] of operationChannels) {
      expect(preloadSource).toContain(`${method}: (`);
      expect(preloadSource).toContain(`ipcRenderer.invoke('${channel}'`);
      expect(typesSource).toContain(`${method}: (`);
      expect(mainSource).toContain(`ipcMain.handle('${channel}'`);
    }
  });

  it('passes governed admission metadata from the task UI to Core', () => {
    const viewSource = readSource('./components/VaultAgentView.tsx');
    expect(viewSource).toContain("workIntent: 'normal_work'");
    expect(viewSource).toContain("actor: { actorUid: 'desktop', actorKind: 'service', roles: [] }");
    expect(viewSource).toContain('idempotencyKey:');
  });
});
