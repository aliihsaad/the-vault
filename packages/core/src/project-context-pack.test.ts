import { describe, expect, it } from 'vitest';
import { buildProjectContextPack } from './services/project-context-pack.service.js';
import type { ActivityLogEntry, MemoryItem, MemoryPack, Project } from './types/index.js';

function memory(overrides: Partial<MemoryItem>): MemoryItem {
  return {
    id: 1,
    itemUid: overrides.itemUid ?? 'vm_test',
    title: overrides.title ?? 'Memory title',
    project: overrides.project ?? 'the-vault',
    sourceApp: 'codex',
    sourceSessionId: null,
    memoryType: overrides.memoryType ?? 'session',
    subject: overrides.subject ?? 'Subject',
    summary: overrides.summary ?? 'Summary',
    content: null,
    keywords: overrides.keywords ?? [],
    tags: overrides.tags ?? [],
    routineType: null,
    status: 'active',
    priority: 'normal',
    promoted: false,
    nextSteps: overrides.nextSteps ?? [],
    relatedItemIds: [],
    relatedFiles: overrides.relatedFiles ?? [],
    vaultPath: null,
    createdAt: '2026-05-17T00:00:00.000Z',
    updatedAt: '2026-05-17T00:00:00.000Z',
    lastAccessedAt: null,
    accessCount: 0,
    snoozedUntil: null,
    outcome: null,
  };
}

describe('project context pack service', () => {
  it('builds a stable markdown pack with description, recall, latest memories, and activity', async () => {
    const recalled = memory({
      itemUid: 'vm_recalled',
      title: 'Released v0.2.5 queue overview refresh',
      summary: 'Queue overview UI was clarified and released.',
      relatedFiles: ['packages/desktop/src/components/VaultAgentView.tsx'],
    });
    const latest = memory({
      itemUid: 'vm_latest',
      title: 'Local adapter execution path',
      summary: 'Claude and Codex can run from a configured cwd.',
    });
    const source = {
      recallContext: async (): Promise<MemoryPack> => ({
        summaries: [],
        decisions: [],
        plans: [],
        other: [],
        related: [],
        proactive: [],
        topMatches: [{ item: recalled, score: 42, reasons: ['same project'], signals: {} }],
        totalCandidates: 1,
        topScore: 42,
        openLoops: [],
      }),
      getLatest: (): MemoryItem[] => [latest],
      getRecentLogs: (): ActivityLogEntry[] => [{
        sourceClient: 'codex',
        project: 'the-vault',
        actionType: 'recall',
        message: 'Recall tested',
        timestamp: '2026-05-17T00:05:00.000Z',
      }],
      listProjects: (): Project[] => [{
        id: 1,
        name: 'the-vault',
        slug: 'the-vault',
        description: 'Local-first memory system.',
        projectUid: null,
        projectType: 'unclassified',
        lifecycleState: null,
        authorizationPolicyId: null,
        evidencePolicyId: null,
        classificationVersion: 0,
        classifiedByActorUid: null,
        classifiedAt: null,
        version: 0,
        canonicalRoot: null,
        repositoryUrl: null,
        defaultBranch: null,
        ownerActorUid: null,
        ownerRole: null,
        memoryPurpose: null,
        typeConfig: {},
        createdAt: '2026-05-01T00:00:00.000Z',
        updatedAt: '2026-05-01T00:00:00.000Z',
      }],
    };

    const pack = await buildProjectContextPack(source, {
      project: 'the-vault',
      title: 'Plan local Codex workbench',
      prompt: 'Use local clients better.',
      maxRecall: 3,
      maxLatest: 2,
      maxLogs: 2,
    });

    expect(pack.project).toBe('the-vault');
    expect(pack.markdown).toContain('Project context (the-vault)');
    expect(pack.markdown).toContain('Project description: Local-first memory system.');
    expect(pack.markdown).toContain('vm_recalled');
    expect(pack.markdown).toContain('vm_latest');
    expect(pack.markdown).toContain('Recall tested');
    expect(pack.sections.map((section) => section.kind)).toEqual(['description', 'recall', 'latest', 'activity']);
  });

  it('returns an empty pack when project is missing', async () => {
    const pack = await buildProjectContextPack({
      recallContext: async () => ({
        summaries: [],
        decisions: [],
        plans: [],
        other: [],
        related: [],
        proactive: [],
        topMatches: [],
        totalCandidates: 0,
        topScore: 0,
        openLoops: [],
      }),
      getLatest: () => [],
      getRecentLogs: () => [],
      listProjects: () => [],
    }, {
      project: '',
      title: 'No project',
      prompt: 'No project',
    });

    expect(pack.markdown).toBe('');
    expect(pack.sections).toEqual([]);
  });
});
