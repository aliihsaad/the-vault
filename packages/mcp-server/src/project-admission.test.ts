import { describe, expect, it, vi } from 'vitest';

import type { Project } from '@the-vault/core';
import { requireTypedProjectForAgentWrite } from './project-admission.js';

function project(overrides: Partial<Project> = {}): Project {
  return {
    id: 1,
    name: 'the-vault',
    slug: 'the-vault',
    description: 'Local-first memory system',
    projectUid: 'vp_test',
    projectType: 'work_project',
    lifecycleState: 'shadow',
    authorizationPolicyId: null,
    evidencePolicyId: null,
    classificationVersion: 1,
    classifiedByActorUid: null,
    classifiedAt: null,
    version: 1,
    canonicalRoot: 'C:/repo/the-vault',
    repositoryUrl: null,
    defaultBranch: null,
    ownerActorUid: null,
    ownerRole: null,
    memoryPurpose: null,
    typeConfig: {},
    createdAt: '2026-07-24T00:00:00.000Z',
    updatedAt: '2026-07-24T00:00:00.000Z',
    ...overrides,
  };
}

describe('requireTypedProjectForAgentWrite', () => {
  it.each(['work_project', 'brain_context'] as const)(
    'allows an existing %s project',
    (projectType) => {
      const existing = project({ projectType });
      const getProject = vi.fn(() => existing);

      expect(requireTypedProjectForAgentWrite({ getProject }, existing.name)).toBe(existing);
      expect(getProject).toHaveBeenCalledWith(existing.name);
    },
  );

  it('requires agents to create a missing project with an explicit type', () => {
    expect(() => requireTypedProjectForAgentWrite({ getProject: () => null }, 'new-project'))
      .toThrow(
        'Call vault_create_project first and explicitly choose project_type "work_project" or "brain_context".',
      );
  });

  it('rejects legacy unclassified projects until they are classified', () => {
    const existing = project({ name: 'legacy-project', projectType: 'unclassified' });

    expect(() => requireTypedProjectForAgentWrite({ getProject: () => existing }, existing.name))
      .toThrow('Classify it as "work_project" or "brain_context" before an agent writes to it.');
  });
});
