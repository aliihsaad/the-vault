import { describe, expect, it } from 'vitest';

import {
  buildVaultCollabDashboardViewModel,
  formatVaultCollabShortUid,
} from './vault-collab-view-model.js';
import type { VaultCollabDashboardSnapshot } from '@the-vault/core';

const now = new Date('2026-05-30T00:20:00.000Z');

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
    launchRequests: [],
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
        failed: 0,
      },
    },
    ...overrides,
  };
}

describe('Vault Collab dashboard view model', () => {
  it('summarizes readiness and attention into a single operations bar', () => {
    const model = buildVaultCollabDashboardViewModel(snapshot({
      counts: {
        ...snapshot().counts,
        activeSessions: 3,
        openHandoffs: 12,
        permissionNeeded: 2,
        permissionNeededSessions: 1,
        permissionNeededHandoffs: 1,
        staleSessions: 1,
      },
    }), now);

    expect(model.statusLabel).toBe('Ready');
    expect(model.attentionLabel).toBe('2 need attention');
    expect(model.statusItems).toEqual([
      'Ready',
      'Last refreshed just now',
      '2 need attention',
      '3 active sessions',
      '12 open handoffs',
      '1 stale',
    ]);
  });

  it('groups sessions by operational attention before ordinary activity', () => {
    const model = buildVaultCollabDashboardViewModel(snapshot({
      sessions: [
        {
          sessionUid: 'vc_sess_idle_1234567890',
          displayName: 'Idle Codex',
          clientType: 'codex',
          project: 'the-vault',
          workspacePath: 'C:/workspace/the-vault',
          status: 'idle',
          effectiveStatus: 'idle',
          connectionState: 'fresh',
          statusDetail: null,
          capabilities: {},
          agentUid: null,
          agentName: null,
          agentDisplayName: null,
          agentRole: null,
          currentHandoffUid: null,
          lastHeartbeatAt: now.toISOString(),
          heartbeatAgeMs: 30000,
          createdAt: now.toISOString(),
          updatedAt: now.toISOString(),
          disconnectedAt: null,
        },
        {
          sessionUid: 'vc_sess_attention_1234567890',
          displayName: 'Claude reviewer',
          clientType: 'claude-code',
          project: 'Vault Collab',
          workspacePath: 'C:/workspace/vault-collab',
          status: 'awaiting_user',
          effectiveStatus: 'awaiting_user',
          connectionState: 'fresh',
          statusDetail: 'Allow npm run test?',
          capabilities: {},
          agentUid: 'agent-abcdef123456',
          agentName: 'reviewer-agent',
          agentDisplayName: 'Review Agent',
          agentRole: 'code_review',
          currentHandoffUid: 'vc_handoff_attention',
          lastHeartbeatAt: now.toISOString(),
          heartbeatAgeMs: 90000,
          createdAt: now.toISOString(),
          updatedAt: now.toISOString(),
          disconnectedAt: null,
        },
      ],
    }), now);

    expect(model.sessionGroups.map((group) => group.label)).toEqual(['Needs attention', 'Idle']);
    expect(model.sessionGroups[0].sessions[0]).toMatchObject({
      displayName: 'Review Agent',
      attention: true,
      statusLabel: 'awaiting user',
      connectionLabel: 'fresh',
      secondary: 'Claude Code / Vault Collab / Claude reviewer / agent-abcd...',
    });
  });

  it('builds queue rows, selected detail, and owned handoff actions without exposing full raw ids by default', () => {
    const model = buildVaultCollabDashboardViewModel(snapshot({
      handoffs: [
        {
          handoffUid: 'vc_handoff_0772c645-c3ef-4d4a-bf0c-7c0fa035cfe8',
          vaultMemoryUid: 'vm_Fh2C9fLIM4Yff1JO',
          shortPrompt: 'Fix Vault Collab weak points and report dashboard DTO improvements.',
          sourceProject: 'the-vault',
          targetProject: 'Vault Collab',
          relatedProjects: ['the-vault', 'Vault Collab'],
          relatedFiles: ['src/mcp/tools.ts'],
          sourceSessionUid: 'vc_sess_source_1234567890',
          suggestedSessionUid: null,
          suggestedClientType: 'codex',
          queueKey: 'weak-points',
          labels: ['weak-point', 'mcp-schema', 'ui-contract', 'live-smoke'],
          queuePosition: 1,
          dependsOnHandoffUid: 'vc_handoff_dependency_1234567890',
          status: 'awaiting_user',
          priority: 'high',
          urgent: false,
          claimedBySessionUid: 'vc_sess_claimed_1234567890',
          leaseExpiresAt: null,
          progressNote: 'Approve elevated test run?',
          resolutionSummary: null,
          reopenReason: null,
          createdAt: '2026-05-30T00:10:00.000Z',
          updatedAt: '2026-05-30T00:15:00.000Z',
          resolvedAt: null,
          staleAt: null,
          discussionThreads: [
            {
              threadUid: 'vc_thread_1234567890',
              handoffUid: 'vc_handoff_0772c645-c3ef-4d4a-bf0c-7c0fa035cfe8',
              project: 'Vault Collab',
              title: 'Review concerns',
              status: 'open',
              createdBySessionUid: 'vc_sess_source_1234567890',
              createdAt: '2026-05-30T00:11:00.000Z',
              updatedAt: '2026-05-30T00:12:00.000Z',
              resolvedAt: null,
              messageCount: 2,
              lastMessageAt: '2026-05-30T00:12:00.000Z',
            },
          ],
        },
      ],
    }), now, 'vc_handoff_0772c645-c3ef-4d4a-bf0c-7c0fa035cfe8', {
      dashboardSessionUid: 'vc_sess_claimed_1234567890',
    });

    expect(model.handoffRows[0]).toMatchObject({
      uid: 'vc_handoff_0772c645-c3ef-4d4a-bf0c-7c0fa035cfe8',
      shortUid: 'vc_handoff...',
      statusLabel: 'awaiting user',
      attention: true,
      queueLabel: 'weak-points #1',
      ownerLabel: 'vc_sess_cl...',
      dependencyLabel: 'blocked by vc_hando...',
      extraLabel: '+1 label',
      threadLabel: '1 thread',
    });
    expect(model.selectedHandoff?.meta).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ label: 'Priority', value: 'high' }),
        expect.objectContaining({ label: 'Queue', value: 'weak-points #1' }),
        expect.objectContaining({ label: 'Claimed by', value: 'vc_sess_claimed_1234567890' }),
        expect.objectContaining({ label: 'Vault memory', value: 'vm_Fh2C9fLIM4Yff1JO' }),
      ]),
    );
    expect(model.selectedHandoff?.actions.map((action) => action.action)).toEqual([
      'update_in_progress',
      'update_blocked',
      'update_verification_needed',
      'release',
      'resolve',
    ]);
    expect(model.selectedHandoff?.discussionAction).toEqual(expect.objectContaining({
      action: 'reply',
      disabled: false,
    }));
  });

  it('offers claim for available handoffs and create-thread for handoffs without discussions', () => {
    const model = buildVaultCollabDashboardViewModel(snapshot({
      handoffs: [
        {
          handoffUid: 'vc_handoff_available_1234567890',
          vaultMemoryUid: null,
          shortPrompt: 'Pick up dashboard work.',
          sourceProject: 'Vault Collab',
          targetProject: 'the-vault',
          relatedProjects: [],
          relatedFiles: [],
          sourceSessionUid: null,
          suggestedSessionUid: null,
          suggestedClientType: null,
          queueKey: 'dashboard',
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
          createdAt: '2026-05-30T00:10:00.000Z',
          updatedAt: '2026-05-30T00:10:00.000Z',
          resolvedAt: null,
          staleAt: null,
          discussionThreads: [],
        },
      ],
    }), now, 'vc_handoff_available_1234567890');

    expect(model.selectedHandoff?.actions).toEqual([
      expect.objectContaining({ action: 'claim', disabled: false }),
    ]);
    expect(model.selectedHandoff?.discussionAction).toEqual(expect.objectContaining({
      action: 'create_thread',
      disabled: false,
    }));
  });

  it('builds read-only launch request rows separately from handoffs', () => {
    const model = buildVaultCollabDashboardViewModel(snapshot({
      launchRequests: [
        {
          launchRequestUid: 'vc_launch_0772c645-c3ef-4d4a-bf0c-7c0fa035cfe8',
          provider: 'codex',
          model: 'gpt-5-codex',
          effortLevel: 'high',
          project: 'the-vault',
          workspacePath: 'C:/workspace/the-vault',
          role: 'dashboard implementer',
          initialInstructions: 'Add the launch request lane.',
          permissionMode: 'workspace-write',
          commandPreview: 'codex --project the-vault',
          requestedCapabilities: ['code_editing', 'shell_tests'],
          approvalPolicyVersion: 'v2.0',
          approvalSnapshot: null,
          status: 'requested',
          statusDetail: null,
          requestedBySessionUid: 'vc_sess_requester_1234567890',
          approvedBySessionUid: null,
          rejectedBySessionUid: null,
          brokerSessionUid: null,
          launchedSessionUid: null,
          metadata: {},
          createdAt: '2026-05-30T00:10:00.000Z',
          updatedAt: '2026-05-30T00:18:00.000Z',
          approvedAt: null,
          rejectedAt: null,
          startedAt: null,
          completedAt: null,
        },
        {
          launchRequestUid: 'vc_launch_failed_1234567890',
          provider: 'claude-code',
          model: 'claude-opus',
          effortLevel: null,
          project: 'Vault Collab',
          workspacePath: 'C:/workspace/vault-collab',
          role: null,
          initialInstructions: 'Review the contract.',
          permissionMode: 'read-only',
          commandPreview: null,
          requestedCapabilities: [],
          approvalPolicyVersion: null,
          approvalSnapshot: null,
          status: 'failed',
          statusDetail: 'Broker failed before launch.',
          requestedBySessionUid: 'vc_sess_requester_1234567890',
          approvedBySessionUid: 'vc_sess_approver_1234567890',
          rejectedBySessionUid: null,
          brokerSessionUid: 'vc_sess_broker_1234567890',
          launchedSessionUid: null,
          metadata: {},
          createdAt: '2026-05-30T00:05:00.000Z',
          updatedAt: '2026-05-30T00:12:00.000Z',
          approvedAt: '2026-05-30T00:06:00.000Z',
          rejectedAt: null,
          startedAt: null,
          completedAt: '2026-05-30T00:12:00.000Z',
        },
      ],
      counts: {
        ...snapshot().counts,
        launchRequests: 2,
        activeLaunchRequests: 1,
        requestedLaunchRequests: 1,
        failedLaunchRequests: 1,
        launchRequestsByStatus: {
          ...snapshot().counts.launchRequestsByStatus,
          requested: 1,
          failed: 1,
        },
      },
    }), now);

    expect(model.statusItems).toContain('1 active launches');
    expect(model.launchRequestRows).toHaveLength(2);
    expect(model.handoffRows).toHaveLength(0);
    expect(model.launchRequestRows[0]).toMatchObject({
      uid: 'vc_launch_0772c645-c3ef-4d4a-bf0c-7c0fa035cfe8',
      shortUid: 'vc_launch_...',
      title: 'dashboard implementer / gpt-5-codex',
      statusLabel: 'requested',
      badgeClass: 'badge-task-pending',
      railClass: 'queue-status-rail-pending',
      providerLabel: 'Codex',
      routeLabel: 'the-vault',
      actorLabel: 'by vc_sess_...',
      commandPreview: 'codex --project the-vault',
      capabilityLabel: '2 caps',
      attention: true,
    });
    expect(model.launchRequestRows[0].actions.map((action) => action.action)).toEqual([
      'approve',
      'reject',
      'cancel',
    ]);
    expect(model.launchRequestRows[1]).toMatchObject({
      statusLabel: 'failed',
      badgeClass: 'badge-task-fail',
      railClass: 'queue-status-rail-failed',
      attention: false,
      detail: 'Broker failed before launch.',
    });
  });

  it('shortens long Vault Collab identifiers consistently', () => {
    expect(formatVaultCollabShortUid('vc_handoff_0772c645-c3ef-4d4a-bf0c-7c0fa035cfe8')).toBe('vc_handoff...');
    expect(formatVaultCollabShortUid('vm_short')).toBe('vm_short');
  });
});
