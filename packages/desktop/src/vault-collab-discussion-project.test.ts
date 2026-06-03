import { describe, expect, it } from 'vitest';

import type { VaultCollabDashboardSnapshot } from '@the-vault/core';
import { getDiscussionThreadProject } from './components/vault-collab/useVaultCollabActions.js';
import { buildVaultCollabDashboardViewModel } from './vault-collab-view-model.js';

const now = new Date('2026-06-03T23:20:00.000Z');

function snapshot(overrides: Partial<VaultCollabDashboardSnapshot> = {}): VaultCollabDashboardSnapshot {
  return {
    configured: true,
    ready: true,
    dataReady: true,
    databasePath: 'C:/Vault/extensions/vault-collab/vault-collab.db',
    message: 'Vault Collab is ready.',
    errorMessage: null,
    sessions: [],
    handoffs: [],
    policyPacks: [],
    launchRequests: [],
    deliveryAttempts: [],
    events: [],
    counts: {
      sessions: 0,
      activeSessions: 0,
      idleSessions: 0,
      staleSessions: 0,
      disconnectedSessions: 0,
      openHandoffs: 0,
      availableHandoffs: 0,
      urgentHandoffs: 0,
      permissionNeeded: 0,
      permissionNeededSessions: 0,
      permissionNeededHandoffs: 0,
      permissionRequestEvents: 0,
      attentionPingEvents: 0,
      launchRequests: 0,
      activeLaunchRequests: 0,
      requestedLaunchRequests: 0,
      approvedLaunchRequests: 0,
      launchingLaunchRequests: 0,
      runningLaunchRequests: 0,
      stoppedLaunchRequests: 0,
      failedLaunchRequests: 0,
      events: 0,
      sessionsByStatus: {
        idle: 0,
        working: 0,
        blocked: 0,
        awaiting_user: 0,
        awaiting_verification: 0,
        complete: 0,
        disconnected: 0,
      },
      handoffsByStatus: {
        available: 0,
        claimed: 0,
        in_progress: 0,
        blocked: 0,
        awaiting_user: 0,
        verification_needed: 0,
        resolved: 0,
        abandoned: 0,
        stale: 0,
      },
      launchRequestsByStatus: {
        requested: 0,
        approved: 0,
        rejected: 0,
        cancelled: 0,
        launching: 0,
        running: 0,
        stopped: 0,
        failed: 0,
      },
    },
    ...overrides,
  };
}

type HandoffSnapshot = VaultCollabDashboardSnapshot['handoffs'][number];

function handoff(overrides: Partial<HandoffSnapshot> & { handoffUid: string }): HandoffSnapshot {
  const { handoffUid, ...rest } = overrides;

  return {
    handoffUid,
    vaultMemoryUid: null,
    shortPrompt: 'Discuss cross-project work.',
    sourceProject: 'the-vault',
    targetProject: 'Vault Collab',
    relatedProjects: [],
    relatedFiles: [],
    sourceSessionUid: null,
    suggestedSessionUid: null,
    suggestedClientType: null,
    queueKey: 'phase-6',
    labels: [],
    queuePosition: 1000,
    dependsOnHandoffUid: null,
    status: 'available',
    priority: 'normal',
    urgent: false,
    claimedBySessionUid: null,
    leaseExpiresAt: null,
    progressNote: null,
    resolutionSummary: null,
    reopenReason: null,
    createdAt: '2026-06-03T23:10:00.000Z',
    updatedAt: '2026-06-03T23:10:00.000Z',
    resolvedAt: null,
    staleAt: null,
    discussionThreads: [],
    ...rest,
  };
}

describe('Vault Collab discussion project routing', () => {
  it('keeps the selected handoff target project available to actions', () => {
    const selectedHandoffUid = 'vc_handoff_cross_project_1234567890';
    const model = buildVaultCollabDashboardViewModel(snapshot({
      handoffs: [handoff({
        handoffUid: selectedHandoffUid,
        sourceProject: 'the-vault',
        targetProject: 'Vault Collab',
      })],
    }), now, selectedHandoffUid);

    expect(model.selectedHandoff).toMatchObject({
      sourceProject: 'the-vault',
      targetProject: 'Vault Collab',
    });
  });

  it('uses target project, then source project, then the legacy project fallback', () => {
    expect(getDiscussionThreadProject({
      sourceProject: 'the-vault',
      targetProject: 'Vault Collab',
    })).toBe('Vault Collab');
    expect(getDiscussionThreadProject({
      sourceProject: 'Source Project',
      targetProject: '  ',
    })).toBe('Source Project');
    expect(getDiscussionThreadProject({
      sourceProject: null,
      targetProject: null,
    })).toBe('the-vault');
  });
});
