import { describe, expect, it } from 'vitest';
import {
  markLocalWorkbenchRunCompleted,
  markLocalWorkbenchRunLaunched,
  upsertLocalWorkbenchRun,
} from './services/local-workbench-runs.service.js';
import type { LocalWorkbenchRecentRun } from './types/index.js';

const baseRun: LocalWorkbenchRecentRun = {
  runId: 'run-1',
  project: 'the-vault',
  title: 'Tighten local agents',
  adapterType: 'codex_local',
  workspacePath: String.raw`C:\Users\Mini\Desktop\Projects\the-vault`,
  contextPackPath: String.raw`C:\Users\Mini\Vault\.workbench-runs\run-1\context-pack.md`,
  createdAt: '2026-05-18T07:00:00.000Z',
  updatedAt: '2026-05-18T07:00:00.000Z',
  status: 'prepared',
  prompt: 'Make Local Agents useful.',
  displayCommand: 'codex exec -',
};

describe('local workbench run registry', () => {
  it('tracks prepared, launched, and completed local agent runs', () => {
    const preparedRuns = upsertLocalWorkbenchRun([], baseRun);

    expect(preparedRuns).toHaveLength(1);
    expect(preparedRuns[0].status).toBe('prepared');

    const launchedRuns = markLocalWorkbenchRunLaunched(
      preparedRuns,
      'run-1',
      '2026-05-18T07:05:00.000Z',
      4421,
    );

    expect(launchedRuns[0]).toMatchObject({
      status: 'launched',
      launchedAt: '2026-05-18T07:05:00.000Z',
      terminalPid: 4421,
      updatedAt: '2026-05-18T07:05:00.000Z',
    });

    const completedRuns = markLocalWorkbenchRunCompleted(
      launchedRuns,
      'run-1',
      '2026-05-18T07:15:00.000Z',
      'vm_result',
      'Implemented and verified.',
    );

    expect(completedRuns[0]).toMatchObject({
      status: 'completed',
      completedAt: '2026-05-18T07:15:00.000Z',
      resultMemoryUid: 'vm_result',
      resultSummary: 'Implemented and verified.',
      updatedAt: '2026-05-18T07:15:00.000Z',
    });
  });
});
