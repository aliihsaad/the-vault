import { describe, expect, it } from 'vitest';

import {
  buildVaultCollabDashboardViewModel,
  buildSessionHudModel,
  formatVaultCollabShortUid,
  getVaultCollabAgentsTabCount,
  getVaultCollabOfficeSessionStatuses,
} from './vault-collab-view-model.js';
import type { VaultCollabDashboardSnapshot } from '@the-vault/core';

const now = new Date('2026-05-30T00:20:00.000Z');
const defaultDelivery = {
  mode: 'manual_poll' as const,
  wakeable: false,
  lastAckEventId: null,
  lastAckAt: null,
};

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

type SessionSnapshot = VaultCollabDashboardSnapshot['sessions'][number];
type HandoffSnapshot = VaultCollabDashboardSnapshot['handoffs'][number];
type LaunchRequestSnapshot = VaultCollabDashboardSnapshot['launchRequests'][number];
type EventSnapshot = VaultCollabDashboardSnapshot['events'][number];
type DiscussionThreadSnapshot = HandoffSnapshot['discussionThreads'][number];
type RoleProfileSnapshot = NonNullable<VaultCollabDashboardSnapshot['roleProfiles']>[number];

const canonicalRoleProfileIds = [
  'coordinator',
  'explorer',
  'planner',
  'architect',
  'implementer',
  'reviewer',
  'qa-evaluator',
  'security-reviewer',
  'documentation-agent',
  'runtime-loop-operator',
  'release-agent',
  'pattern-mining-agent',
  'loop-resolver',
];

function session(overrides: Partial<SessionSnapshot> & { sessionUid: string }): SessionSnapshot {
  const { sessionUid, ...rest } = overrides;
  return {
    sessionUid,
    displayName: 'Codex worker',
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
    delivery: defaultDelivery,
    lastHeartbeatAt: now.toISOString(),
    heartbeatAgeMs: 15000,
    createdAt: now.toISOString(),
    updatedAt: now.toISOString(),
    disconnectedAt: null,
    adapterType: 'native',
    lastSnapshot: null,
    snapshotReportedAt: null,
    ...rest,
  } as SessionSnapshot;
}

function handoff(overrides: Partial<HandoffSnapshot> & { handoffUid: string }): HandoffSnapshot {
  const { handoffUid, ...rest } = overrides;
  return {
    handoffUid,
    vaultMemoryUid: null,
    shortPrompt: 'Implement dashboard work.',
    sourceProject: 'the-vault',
    targetProject: 'the-vault',
    relatedProjects: [],
    relatedFiles: [],
    sourceSessionUid: null,
    suggestedSessionUid: null,
    suggestedClientType: null,
    queueKey: 'default',
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
    ...rest,
  };
}

function launchRequest(
  overrides: Partial<LaunchRequestSnapshot> & { launchRequestUid: string },
): LaunchRequestSnapshot {
  const { launchRequestUid, ...rest } = overrides;
  return {
    launchRequestUid,
    provider: 'codex',
    model: 'gpt-5-codex',
    effortLevel: 'medium',
    project: 'the-vault',
    workspacePath: 'C:/workspace/the-vault',
    role: 'dashboard implementer',
    initialInstructions: 'Start a dashboard worker.',
    permissionMode: 'workspace-write',
    commandPreview: 'codex -C C:/workspace/the-vault',
    requestedCapabilities: [],
    approvalPolicyVersion: null,
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
    updatedAt: '2026-05-30T00:10:00.000Z',
    approvedAt: null,
    rejectedAt: null,
    startedAt: null,
    completedAt: null,
    ...rest,
  };
}

function discussionThread(overrides: Partial<DiscussionThreadSnapshot> & { threadUid: string }): DiscussionThreadSnapshot {
  const { threadUid, ...rest } = overrides;
  return {
    threadUid,
    handoffUid: 'vc_handoff_discussion_1234567890',
    project: 'the-vault',
    title: 'Review thread',
    status: 'open',
    createdBySessionUid: 'vc_sess_reviewer_1234567890',
    createdAt: '2026-05-30T00:11:00.000Z',
    updatedAt: '2026-05-30T00:12:00.000Z',
    resolvedAt: null,
    messageCount: 2,
    lastMessageAt: '2026-05-30T00:12:00.000Z',
    latestMessages: [],
    ...rest,
  };
}

function event(overrides: Partial<EventSnapshot> & { eventId: number; eventType: string }): EventSnapshot {
  const { eventId, eventType, ...rest } = overrides;
  return {
    eventId,
    handoffUid: null,
    sessionUid: null,
    eventType,
    payload: {},
    createdAt: '2026-05-30T00:11:00.000Z',
    ...rest,
  };
}

function roleProfile(overrides: Partial<RoleProfileSnapshot> & { roleProfileId: string }): RoleProfileSnapshot {
  const { roleProfileId, ...rest } = overrides;
  return {
    roleProfileId,
    displayName: roleProfileId
      .split('-')
      .map((part) => `${part.slice(0, 1).toUpperCase()}${part.slice(1)}`)
      .join(' '),
    purpose: `Own ${roleProfileId} work.`,
    lifecycleStage: 'coordination',
    defaultMutation: 'read_only',
    capabilitySet: ['vault_collab_read'],
    triggerLabels: [roleProfileId],
    suggestedNextRoleProfileIds: [],
    skills: {
      primary: [],
      secondary: [],
    },
    ...rest,
  };
}

function phaseSevenSessionFields(
  overrides: Partial<Record<string, unknown>> = {},
): Partial<SessionSnapshot> {
  const sessionUid = typeof overrides.sessionUid === 'string'
    ? overrides.sessionUid
    : 'vc_sess_hud_1234567890';

  return {
    adapterType: 'adapter_backed',
    snapshotReportedAt: '2026-05-30T00:18:00.000Z',
    lastSnapshot: {
      schemaVersion: 'vault_collab.session.v1',
      adapterId: 'adapter-main',
      sessionUid,
      project: 'the-vault',
      workspace: {
        path: 'C:/workspace/the-vault',
        projectKey: 'the-vault',
      },
      state: 'idle',
      context: {
        provider: 'openai',
        model: 'gpt-5-codex',
        tokensUsed: 86000,
        tokensRemaining: 14000,
        compactionRisk: 'high',
      },
      active_handoffs: [
        {
          handoffUid: 'vc_handoff_known_1234567890',
          status: 'claimed',
          progressNote: 'Snapshot progress',
          claimedAt: '2026-05-30T00:10:00.000Z',
        },
        {
          handoffUid: 'vc_handoff_unknown_1234567890',
          status: 'blocked',
          progressNote: null,
          claimedAt: null,
        },
      ],
      progress: {
        currentTask: 'Implement HUD cards',
        percentComplete: 42,
        blockers: ['Awaiting QA'],
      },
      cost: {
        estimatedUSD: 1.25,
        tokensTotal: 100000,
      },
      risk: {
        level: 'critical',
        reasons: ['Context nearly full'],
      },
      tool_grants: [
        { toolName: 'shell_command', scope: 'workspace_write', grantedAt: '2026-05-30T00:09:00.000Z' },
        { toolName: 'vault_collab_update_handoff', scope: 'coordination_write', grantedAt: null },
      ],
      capabilities: {
        canMutateHandoffs: false,
        canPublishHandoffs: true,
        canSendMessages: true,
        adapterType: 'adapter_backed',
      },
      sync_cursor: {
        lastEventId: 42,
        lastHeartbeatAt: '2026-05-30T00:17:00.000Z',
      },
      ...(overrides.lastSnapshot as Record<string, unknown> | undefined),
    },
    ...overrides,
  } as unknown as Partial<SessionSnapshot>;
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
        session({
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
          delivery: defaultDelivery,
          lastHeartbeatAt: now.toISOString(),
          heartbeatAgeMs: 30000,
          createdAt: now.toISOString(),
          updatedAt: now.toISOString(),
          disconnectedAt: null,
        }),
        session({
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
          delivery: defaultDelivery,
          lastHeartbeatAt: now.toISOString(),
          heartbeatAgeMs: 90000,
          createdAt: now.toISOString(),
          updatedAt: now.toISOString(),
          disconnectedAt: null,
        }),
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

  it('describes session delivery state and exposes roster actions conservatively', () => {
    const model = buildVaultCollabDashboardViewModel(snapshot({
      sessions: [
        session({
          sessionUid: 'vc_sess_dashboard',
          displayName: 'The Vault dashboard',
          clientType: 'other',
          project: 'the-vault',
          workspacePath: 'C:/workspace/the-vault',
          status: 'idle',
          effectiveStatus: 'idle',
          connectionState: 'fresh',
          statusDetail: null,
          capabilities: { sessionAdmin: true },
          agentUid: null,
          agentName: null,
          agentDisplayName: null,
          agentRole: null,
          currentHandoffUid: null,
          delivery: {
            mode: 'manual_poll',
            wakeable: false,
            lastAckEventId: null,
            lastAckAt: null,
          },
          lastHeartbeatAt: now.toISOString(),
          heartbeatAgeMs: 20000,
          createdAt: now.toISOString(),
          updatedAt: now.toISOString(),
          disconnectedAt: null,
        }),
        session({
          sessionUid: 'vc_sess_stale_1234567890',
          displayName: 'Old Codex dashboard',
          clientType: 'codex',
          project: 'the-vault',
          workspacePath: 'C:/workspace/the-vault',
          status: 'idle',
          effectiveStatus: 'idle',
          connectionState: 'stale',
          statusDetail: 'Waiting for attention.',
          capabilities: {},
          agentUid: null,
          agentName: null,
          agentDisplayName: null,
          agentRole: null,
          currentHandoffUid: null,
          delivery: {
            mode: 'manual_poll',
            wakeable: false,
            lastAckEventId: null,
            lastAckAt: null,
          },
          lastHeartbeatAt: new Date(now.getTime() - 20 * 60_000).toISOString(),
          heartbeatAgeMs: 20 * 60_000,
          createdAt: now.toISOString(),
          updatedAt: now.toISOString(),
          disconnectedAt: null,
        }),
        session({
          sessionUid: 'vc_sess_managed_1234567890',
          displayName: 'Managed receiver',
          clientType: 'codex',
          project: 'Vault Collab',
          workspacePath: 'C:/workspace/vault-collab',
          status: 'working',
          effectiveStatus: 'working',
          connectionState: 'fresh',
          statusDetail: null,
          capabilities: {},
          agentUid: null,
          agentName: null,
          agentDisplayName: null,
          agentRole: null,
          currentHandoffUid: null,
          delivery: {
            mode: 'managed_process',
            wakeable: true,
            lastAckEventId: 12,
            lastAckAt: '2026-05-30T00:18:00.000Z',
          },
          lastHeartbeatAt: now.toISOString(),
          heartbeatAgeMs: 20000,
          createdAt: now.toISOString(),
          updatedAt: now.toISOString(),
          disconnectedAt: null,
        }),
      ],
    }), now, null, { dashboardSessionUid: 'vc_sess_dashboard' });

    const ownRow = model.sessionGroups.flatMap((group) => group.sessions).find((session) => session.uid === 'vc_sess_dashboard');
    const staleRow = model.sessionGroups.flatMap((group) => group.sessions).find((session) => session.uid === 'vc_sess_stale_1234567890');
    const managedRow = model.sessionGroups.flatMap((group) => group.sessions).find((session) => session.uid === 'vc_sess_managed_1234567890');

    expect(ownRow).toEqual(expect.objectContaining({
      deliveryLabel: 'Manual attention',
      deliveryDetail: 'Stores pings only; target must poll or run a watcher.',
      lastAckLabel: 'no ack yet',
      canRename: true,
      canClose: false,
      canPing: false,
    }));
    expect(staleRow).toEqual(expect.objectContaining({
      deliveryLabel: 'Manual attention',
      canRename: false,
      canClose: true,
      canPing: true,
    }));
    expect(managedRow).toEqual(expect.objectContaining({
      deliveryLabel: 'Wakeable managed',
      deliveryDetail: 'Ping can be picked up by the managed receiver; wait for ack.',
      lastAckLabel: 'ack 2m ago',
      canClose: false,
      canPing: true,
    }));
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
              latestMessages: [],
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

  it('does not auto-select a handoff when no handoff uid is selected', () => {
    const model = buildVaultCollabDashboardViewModel(snapshot({
      handoffs: [
        handoff({ handoffUid: 'vc_handoff_available_1234567890', status: 'available', shortPrompt: 'Available work.' }),
        handoff({ handoffUid: 'vc_handoff_claimed_1234567890', status: 'claimed', shortPrompt: 'Claimed work.' }),
      ],
    }), now);

    expect(model.selectedHandoff).toBeNull();
    expect(model.cockpit.selectedHandoff).toBeNull();
    expect(model.cockpit.conversation).toEqual([]);
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
          launchRequestUid: 'vc_launch_approved_1234567890',
          provider: 'codex',
          model: 'gpt-5-codex',
          effortLevel: 'medium',
          project: 'the-vault',
          workspacePath: 'C:/workspace/the-vault',
          role: 'brokered worker',
          initialInstructions: 'Launch after approval.',
          permissionMode: 'workspace-write',
          commandPreview: 'codex -C C:/workspace/the-vault',
          requestedCapabilities: [],
          approvalPolicyVersion: null,
          approvalSnapshot: null,
          status: 'approved',
          statusDetail: 'Approved for broker pickup.',
          requestedBySessionUid: 'vc_sess_requester_1234567890',
          approvedBySessionUid: 'vc_sess_approver_1234567890',
          rejectedBySessionUid: null,
          brokerSessionUid: null,
          launchedSessionUid: null,
          metadata: {},
          createdAt: '2026-05-30T00:07:00.000Z',
          updatedAt: '2026-05-30T00:17:00.000Z',
          approvedAt: '2026-05-30T00:17:00.000Z',
          rejectedAt: null,
          startedAt: null,
          completedAt: null,
        },
        {
          launchRequestUid: 'vc_launch_launching_1234567890',
          provider: 'codex',
          model: 'gpt-5-codex',
          effortLevel: null,
          project: 'the-vault',
          workspacePath: 'C:/workspace/the-vault',
          role: 'brokered worker',
          initialInstructions: 'Attach registered session.',
          permissionMode: 'workspace-write',
          commandPreview: null,
          requestedCapabilities: [],
          approvalPolicyVersion: null,
          approvalSnapshot: null,
          status: 'launching',
          statusDetail: 'Broker accepted request.',
          requestedBySessionUid: 'vc_sess_requester_1234567890',
          approvedBySessionUid: 'vc_sess_approver_1234567890',
          rejectedBySessionUid: null,
          brokerSessionUid: 'vc_sess_broker_1234567890',
          launchedSessionUid: null,
          metadata: {},
          createdAt: '2026-05-30T00:08:00.000Z',
          updatedAt: '2026-05-30T00:16:00.000Z',
          approvedAt: '2026-05-30T00:12:00.000Z',
          rejectedAt: null,
          startedAt: '2026-05-30T00:16:00.000Z',
          completedAt: null,
        },
        {
          launchRequestUid: 'vc_launch_stopped_1234567890',
          provider: 'codex',
          model: 'gpt-5-codex',
          effortLevel: null,
          project: 'the-vault',
          workspacePath: 'C:/workspace/the-vault',
          role: 'smoke worker',
          initialInstructions: 'Smoke test stop behavior.',
          permissionMode: 'workspace-write',
          commandPreview: null,
          requestedCapabilities: [],
          approvalPolicyVersion: null,
          approvalSnapshot: null,
          status: 'stopped',
          statusDetail: 'Managed Codex worker stopped from The Vault.',
          requestedBySessionUid: 'vc_sess_requester_1234567890',
          approvedBySessionUid: 'vc_sess_approver_1234567890',
          rejectedBySessionUid: null,
          brokerSessionUid: 'vc_sess_broker_1234567890',
          launchedSessionUid: 'vc_sess_worker_1234567890',
          metadata: {},
          createdAt: '2026-05-30T00:04:00.000Z',
          updatedAt: '2026-05-30T00:13:00.000Z',
          approvedAt: '2026-05-30T00:05:00.000Z',
          rejectedAt: null,
          startedAt: '2026-05-30T00:06:00.000Z',
          completedAt: '2026-05-30T00:13:00.000Z',
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
        launchRequests: 5,
        activeLaunchRequests: 2,
        requestedLaunchRequests: 1,
        approvedLaunchRequests: 1,
        launchingLaunchRequests: 1,
        stoppedLaunchRequests: 1,
        failedLaunchRequests: 1,
        launchRequestsByStatus: {
          ...snapshot().counts.launchRequestsByStatus,
          requested: 1,
          approved: 1,
          launching: 1,
          stopped: 1,
          failed: 1,
        },
      },
    }), now, null, {
      approvedLaunchCommands: {
        vc_launch_approved_1234567890: 'codex --no-alt-screen -C C:/workspace/the-vault "Launch after approval."',
      },
    });

    expect(model.statusItems).toContain('2 active launches');
    expect(model.launchRequestRows).toHaveLength(3);
    expect(model.launchRequestRows.map((row) => row.uid)).not.toContain('vc_launch_stopped_1234567890');
    expect(model.launchRequestRows.map((row) => row.uid)).not.toContain('vc_launch_failed_1234567890');
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
      attention: false,
    });
    expect(model.launchRequestRows[0].actions.map((action) => action.action)).toEqual([
      'approve',
      'reject',
      'cancel',
    ]);
    expect(model.launchRequestRows[1].actions.map((action) => action.action)).toEqual([
      'mark_launching',
      'cancel',
      'fail',
    ]);
    expect(model.launchRequestRows[1].actions[0]).toMatchObject({
      label: 'Launch',
      reason: 'Open a PowerShell launch window for this approved request.',
    });
    expect(model.launchRequestRows[0].approvedLaunchCommand).toBeNull();
    expect(model.launchRequestRows[1].approvedLaunchCommand).toBe('codex --no-alt-screen -C C:/workspace/the-vault "Launch after approval."');
    expect(model.launchRequestRows[2].actions.map((action) => action.action)).toEqual([
      'mark_running',
      'fail',
    ]);
    expect(model.launchRequestRows[2].actorLabel).toBe('handled by vc_sess_...');
  });

  it('builds Needs You from launch approvals, blocked handoffs, and blocked agents', () => {
    const model = buildVaultCollabDashboardViewModel(snapshot({
      sessions: [
        session({
          sessionUid: 'vc_sess_blocked_1234567890',
          displayName: 'Blocked implementer',
          effectiveStatus: 'blocked',
          status: 'blocked',
          statusDetail: 'Needs package install approval.',
          agentRole: 'implementer',
        }),
        session({
          sessionUid: 'vc_sess_healthy_1234567890',
          displayName: 'Healthy reviewer',
          effectiveStatus: 'working',
          status: 'working',
          agentRole: 'reviewer',
        }),
      ],
      handoffs: [
        handoff({
          handoffUid: 'vc_handoff_blocked_1234567890',
          shortPrompt: 'Blocked handoff.',
          status: 'blocked',
          progressNote: 'Waiting on user confirmation.',
        }),
        handoff({
          handoffUid: 'vc_handoff_awaiting_1234567890',
          shortPrompt: 'Awaiting user handoff.',
          status: 'awaiting_user',
          progressNote: 'Should we proceed?',
        }),
        handoff({
          handoffUid: 'vc_handoff_available_1234567890',
          shortPrompt: 'Available handoff.',
          status: 'available',
        }),
      ],
      launchRequests: [
        launchRequest({
          launchRequestUid: 'vc_launch_requested_1234567890',
          role: 'smoke tester',
          status: 'requested',
          updatedAt: '2026-05-30T00:18:00.000Z',
        }),
        launchRequest({
          launchRequestUid: 'vc_launch_approved_1234567890',
          role: 'designer',
          status: 'approved',
          statusDetail: 'Approved; copy command is ready.',
          approvedAt: '2026-05-30T00:17:00.000Z',
          updatedAt: '2026-05-30T00:17:00.000Z',
        }),
      ],
    }), now);

    expect(model.cockpit.needsYou.map((item) => [item.kind, item.id])).toEqual([
      ['launch_approval', 'vc_launch_requested_1234567890'],
      ['launch_approval', 'vc_launch_approved_1234567890'],
      ['handoff_blocked', 'vc_handoff_blocked_1234567890'],
      ['handoff_awaiting_user', 'vc_handoff_awaiting_1234567890'],
      ['agent_blocked', 'vc_sess_blocked_1234567890'],
    ]);
    expect(model.cockpit.needsYou[0]).toMatchObject({
      title: 'smoke tester / gpt-5-codex',
      subtitle: 'requested / the-vault',
    });
    expect(model.cockpit.needsYou[0].actions[0]).toEqual(expect.objectContaining({ action: 'approve', label: 'Approve' }));
    expect(buildVaultCollabDashboardViewModel(snapshot(), now).cockpit.needsYou).toEqual([]);
  });

  it('groups live roster agents by role and excludes stale, disconnected, and duplicate sessions', () => {
    const model = buildVaultCollabDashboardViewModel(snapshot({
      sessions: [
        session({
          sessionUid: 'vc_sess_impl_1234567890',
          displayName: 'Codex implementer',
          agentRole: 'implementer',
          effectiveStatus: 'working',
          currentHandoffUid: 'vc_handoff_impl',
        }),
        session({
          sessionUid: 'vc_sess_impl_1234567890',
          displayName: 'Codex implementer duplicate',
          agentRole: 'implementer',
          effectiveStatus: 'working',
          currentHandoffUid: 'vc_handoff_impl',
        }),
        session({
          sessionUid: 'vc_sess_review_1234567890',
          displayName: 'Claude reviewer',
          clientType: 'claude-code',
          capabilities: { role: 'reviewer' },
          effectiveStatus: 'idle',
        }),
        session({
          sessionUid: 'vc_sess_stale_1234567890',
          displayName: 'Stale worker',
          agentRole: 'implementer',
          connectionState: 'stale',
        }),
        session({
          sessionUid: 'vc_sess_closed_1234567890',
          displayName: 'Closed worker',
          agentRole: 'reviewer',
          connectionState: 'disconnected',
          effectiveStatus: 'disconnected',
          status: 'disconnected',
        }),
      ],
    }), now);

    expect(model.cockpit.roster).toEqual([
      expect.objectContaining({
        role: 'implementer',
        roleDisplayName: 'Implementer',
        agents: [
          expect.objectContaining({
            sessionUid: 'vc_sess_impl_1234567890',
            displayName: 'Codex implementer',
            status: 'working',
            currentHandoffUid: 'vc_handoff_impl',
            freshness: 'fresh',
          }),
        ],
      }),
      expect.objectContaining({
        role: 'reviewer',
        roleDisplayName: 'Reviewer',
        agents: [
          expect.objectContaining({
            sessionUid: 'vc_sess_review_1234567890',
            displayName: 'Claude reviewer',
            status: 'idle',
            freshness: 'fresh',
          }),
        ],
      }),
    ]);
  });

  it('builds role offices from role profile data and resolves legacy role strings', () => {
    const model = buildVaultCollabDashboardViewModel(snapshot({
      roleProfiles: [
        {
          roleProfileId: 'implementer',
          displayName: 'Implementer',
          purpose: 'Execute approved changes.',
          lifecycleStage: 'implementation',
          defaultMutation: 'workspace_write',
          capabilitySet: ['edit_files', 'run_tests'],
          triggerLabels: ['implementation', 'feature'],
          suggestedNextRoleProfileIds: ['reviewer'],
          skills: {
            primary: ['tdd-workflow'],
            secondary: ['coding-standards'],
          },
        },
        {
          roleProfileId: 'runtime-loop-operator',
          displayName: 'Runtime Loop Operator',
          purpose: 'Supervise live coordination health.',
          lifecycleStage: 'operations',
          defaultMutation: 'coordination_write',
          capabilitySet: ['vault_collab_read', 'vault_collab_write'],
          triggerLabels: ['runtime', 'stale'],
          suggestedNextRoleProfileIds: ['coordinator'],
          skills: {
            primary: ['agent-introspection-debugging'],
            secondary: ['continuous-agent-loop'],
          },
        },
        {
          roleProfileId: 'loop-resolver',
          displayName: 'Loop Resolver',
          purpose: 'Close already-complete open loops with evidence.',
          lifecycleStage: 'operations',
          defaultMutation: 'read_only',
          capabilitySet: ['resolve_loop'],
          triggerLabels: ['loop', 'cleanup'],
          suggestedNextRoleProfileIds: ['coordinator'],
          skills: {
            primary: ['verification-loop'],
            secondary: ['autonomous-loops'],
          },
        },
      ],
      roleProfileAliases: [
        { alias: 'sweeper', roleProfileId: 'runtime-loop-operator' },
      ],
      sessions: [
        session({
          sessionUid: 'vc_sess_impl_1234567890',
          displayName: 'Codex implementer',
          role: 'implementer',
          roleProfileId: 'implementer',
          effectiveStatus: 'working',
        }),
        session({
          sessionUid: 'vc_sess_sweeper_1234567890',
          displayName: 'Legacy sweeper',
          role: 'sweeper',
          roleProfileId: null,
          effectiveStatus: 'idle',
        }),
      ],
      handoffs: [
        handoff({
          handoffUid: 'vc_handoff_review_1234567890',
          shortPrompt: 'Route implementation to review.',
          suggestedRoleProfileId: 'implementer',
          queueKey: 'implementation',
          labels: ['feature'],
        }),
        handoff({
          handoffUid: 'vc_handoff_loop_1234567890',
          shortPrompt: 'Close completed loop.',
          suggestedRoleProfileId: 'loop-resolver',
          queueKey: 'loop',
          labels: ['cleanup'],
        }),
      ],
    }), now, 'vc_handoff_loop_1234567890', {
      selectedRoleProfileId: 'runtime-loop-operator',
    });

    expect(model.cockpit.roster.map((office) => office.roleProfileId)).toEqual([
      'implementer',
      'runtime-loop-operator',
      'loop-resolver',
    ]);
    expect(model.cockpit.roster[1]).toEqual(expect.objectContaining({
      roleProfileId: 'runtime-loop-operator',
      roleDisplayName: 'Runtime Loop Operator',
      role: 'runtime-loop-operator',
      isWatchdog: false,
    }));
    expect(model.cockpit.roster[1].agents[0]).toEqual(expect.objectContaining({
      rawRole: 'sweeper',
      roleProfileId: 'runtime-loop-operator',
      roleDisplayName: 'Runtime Loop Operator',
      roleLabel: 'Runtime Loop Operator / sweeper',
    }));
    expect(model.cockpit.roster[2]).toEqual(expect.objectContaining({
      roleProfileId: 'loop-resolver',
      isWatchdog: true,
    }));
    expect(model.cockpit.roster[2].handoffs[0]).toEqual(expect.objectContaining({
      uid: 'vc_handoff_loop_1234567890',
      routeHintLabel: 'Loop Resolver office',
    }));
    expect(model.cockpit.selectedRoleProfile).toEqual(expect.objectContaining({
      roleProfileId: 'runtime-loop-operator',
      displayName: 'Runtime Loop Operator',
      mutationLabel: 'coordination write',
      capabilities: ['vault collab read', 'vault collab write'],
      triggerLabels: ['runtime', 'stale'],
      suggestedNextRoleLabels: ['Coordinator'],
      primarySkillNames: ['agent-introspection-debugging'],
      secondarySkillNames: ['continuous-agent-loop'],
    }));
    expect(model.selectedHandoff?.meta).toEqual(expect.arrayContaining([
      expect.objectContaining({ label: 'Suggested office', value: 'Loop Resolver' }),
    ]));
  });

  it('builds fixed officeGroups from all canonical role profiles even when no sessions are live', () => {
    const model = buildVaultCollabDashboardViewModel(snapshot({
      roleProfiles: canonicalRoleProfileIds.map((roleProfileId) => roleProfile({ roleProfileId })),
      sessions: [],
    }), now);
    const cockpit = model.cockpit as typeof model.cockpit & {
      officeGroups?: Array<{
        roleProfileId: string;
        label: string;
        stateLabel: string;
        agents: unknown[];
      }>;
    };

    expect(cockpit.officeGroups?.map((office) => office.roleProfileId)).toEqual(canonicalRoleProfileIds);
    expect(cockpit.officeGroups?.map((office) => [office.label, office.stateLabel, office.agents.length])).toEqual(
      canonicalRoleProfileIds.map((roleProfileId) => [
        roleProfileId
          .split('-')
          .map((part) => `${part.slice(0, 1).toUpperCase()}${part.slice(1)}`)
          .join(' '),
        'idle',
        0,
      ]),
    );
  });

  it('routes qa-reviewer sessions into the canonical QA evaluator office', () => {
    const model = buildVaultCollabDashboardViewModel(snapshot({
      roleProfiles: [
        roleProfile({ roleProfileId: 'qa-evaluator', displayName: 'QA Evaluator' }),
      ],
      roleProfileAliases: [
        { alias: 'qa-reviewer', roleProfileId: 'qa-evaluator' },
      ],
      sessions: [
        session({
          sessionUid: 'vc_sess_qa_profile_1234567890',
          displayName: 'Codex QA profile',
          role: 'qa',
          roleProfileId: 'qa-reviewer',
          effectiveStatus: 'working',
        }),
        session({
          sessionUid: 'vc_sess_qa_role_1234567890',
          displayName: 'Codex QA role',
          role: 'qa-reviewer',
          roleProfileId: null,
          effectiveStatus: 'idle',
        }),
      ],
    }), now);

    expect(model.cockpit.officeGroups).toHaveLength(1);
    expect(model.cockpit.officeGroups[0]).toEqual(expect.objectContaining({
      roleProfileId: 'qa-evaluator',
      roleDisplayName: 'QA Evaluator',
      stateLabel: '2 live',
    }));
    expect(model.cockpit.officeGroups[0].agents).toEqual([
      expect.objectContaining({
        sessionUid: 'vc_sess_qa_profile_1234567890',
        rawRole: 'qa',
        roleProfileId: 'qa-evaluator',
        roleDisplayName: 'QA Evaluator',
      }),
      expect.objectContaining({
        sessionUid: 'vc_sess_qa_role_1234567890',
        rawRole: 'qa-reviewer',
        roleProfileId: 'qa-evaluator',
        roleDisplayName: 'QA Evaluator',
        roleLabel: 'QA Evaluator / qa-reviewer',
      }),
    ]);
    expect(model.cockpit.officeGroups.map((office) => office.label)).not.toContain('Qa Reviewer');
  });

  it('routes launched implementation worker roles into the canonical implementer office', () => {
    const model = buildVaultCollabDashboardViewModel(snapshot({
      roleProfiles: [
        roleProfile({
          roleProfileId: 'implementer',
          displayName: 'Implementer',
          lifecycleStage: 'implementation',
          triggerLabels: ['implementation', 'feature', 'build'],
        }),
      ],
      sessions: [
        session({
          sessionUid: 'vc_sess_launch_worker_1234567890',
          displayName: 'Codex launched worker',
          role: 'implementation-worker',
          roleProfileId: null,
          effectiveStatus: 'working',
        }),
        session({
          sessionUid: 'vc_sess_future_feature_worker_1234567890',
          displayName: 'Codex future feature worker',
          role: 'feature-worker',
          roleProfileId: null,
          effectiveStatus: 'idle',
        }),
        session({
          sessionUid: 'vc_sess_future_phase_worker_1234567890',
          displayName: 'Codex Phase 7 implementation',
          role: 'phase-7-implementation',
          roleProfileId: null,
          effectiveStatus: 'idle',
        }),
        session({
          sessionUid: 'vc_sess_phase_worker_1234567890',
          displayName: 'Codex Phase 6 QA fail fixer',
          role: 'phase-6-implementer',
          roleProfileId: 'phase-6-implementer',
          effectiveStatus: 'working',
        }),
      ],
    }), now);

    expect(model.cockpit.officeGroups.map((office) => office.label)).toEqual(['Implementer']);
    expect(model.cockpit.officeGroups[0]).toEqual(expect.objectContaining({
      roleProfileId: 'implementer',
      stateLabel: '4 live',
    }));
    expect(model.cockpit.officeGroups[0].agents).toEqual([
      expect.objectContaining({
        sessionUid: 'vc_sess_launch_worker_1234567890',
        rawRole: 'implementation-worker',
        roleProfileId: 'implementer',
        roleDisplayName: 'Implementer',
        roleLabel: 'Implementer / implementation-worker',
      }),
      expect.objectContaining({
        sessionUid: 'vc_sess_future_feature_worker_1234567890',
        rawRole: 'feature-worker',
        roleProfileId: 'implementer',
        roleDisplayName: 'Implementer',
        roleLabel: 'Implementer / feature-worker',
      }),
      expect.objectContaining({
        sessionUid: 'vc_sess_future_phase_worker_1234567890',
        rawRole: 'phase-7-implementation',
        roleProfileId: 'implementer',
        roleDisplayName: 'Implementer',
        roleLabel: 'Implementer / phase-7-implementation',
      }),
      expect.objectContaining({
        sessionUid: 'vc_sess_phase_worker_1234567890',
        rawRole: 'phase-6-implementer',
        roleProfileId: 'implementer',
        roleDisplayName: 'Implementer',
        roleLabel: 'Implementer / phase-6-implementer',
      }),
    ]);
  });

  it('does not create ad hoc office cards for unrecognized roles when canonical offices exist', () => {
    const model = buildVaultCollabDashboardViewModel(snapshot({
      roleProfiles: [
        roleProfile({ roleProfileId: 'implementer', displayName: 'Implementer' }),
      ],
      sessions: [
        session({
          sessionUid: 'vc_sess_unknown_worker_1234567890',
          displayName: 'Codex Custom Investigator',
          role: 'custom-investigator',
          roleProfileId: 'custom-investigator',
          effectiveStatus: 'working',
        }),
      ],
    }), now);

    expect(model.cockpit.officeGroups.map((office) => office.label)).toEqual(['Implementer', 'Other']);
    expect(model.cockpit.officeGroups.map((office) => office.label)).not.toContain('Custom Investigator');
    expect(model.cockpit.officeGroups[1]).toEqual(expect.objectContaining({
      role: 'other',
      roleProfileId: null,
      stateLabel: '1 live',
    }));
    expect(model.cockpit.officeGroups[1].agents[0]).toEqual(expect.objectContaining({
      sessionUid: 'vc_sess_unknown_worker_1234567890',
      rawRole: 'custom-investigator',
      roleProfileId: null,
      roleDisplayName: 'Other',
      roleLabel: 'Custom Investigator',
    }));
  });

  it('builds an eventFeed filtered by event type prefix with newest policy events first', () => {
    const model = buildVaultCollabDashboardViewModel(snapshot({
      events: [
        event({
          eventId: 11,
          eventType: 'session.registered',
          sessionUid: 'vc_sess_start_1234567890',
          payload: { displayName: 'Phase 6 worker' },
          createdAt: '2026-05-30T00:12:00.000Z',
        }),
        event({
          eventId: 12,
          eventType: 'policy.violation',
          sessionUid: 'vc_sess_policy_1234567890',
          payload: { policyPackName: 'approval-gates', action: 'deny', reason: 'owner token missing' },
          createdAt: '2026-05-30T00:16:00.000Z',
        }),
        event({
          eventId: 13,
          eventType: 'handoff.claimed',
          handoffUid: 'vc_handoff_policy_1234567890',
          sessionUid: 'vc_sess_policy_1234567890',
          payload: { queueKey: 'phase-6' },
          createdAt: '2026-05-30T00:17:00.000Z',
        }),
        event({
          eventId: 14,
          eventType: 'policy.approved',
          sessionUid: 'vc_sess_policy_1234567890',
          payload: { policyPackName: 'core-safety', trigger: 'handoff.claim' },
          createdAt: '2026-05-30T00:18:00.000Z',
        }),
      ],
    }), now, null, { eventTypePrefix: 'policy.' } as unknown as Parameters<typeof buildVaultCollabDashboardViewModel>[3]);
    const cockpit = model.cockpit as typeof model.cockpit & {
      eventFeed?: {
        selectedPrefix: string;
        prefixes: string[];
        visibleEvents: Array<{
          type: string;
          sessionLabel: string;
          summary: string;
        }>;
      };
    };

    expect(cockpit.eventFeed?.prefixes).toEqual([
      'session.',
      'handoff.',
      'policy.',
      'security.',
      'tool.',
      'loop.',
    ]);
    expect(cockpit.eventFeed?.selectedPrefix).toBe('policy.');
    expect(cockpit.eventFeed?.visibleEvents.map((eventRow) => [
      eventRow.type,
      eventRow.sessionLabel,
      eventRow.summary,
    ])).toEqual([
      ['policy.approved', 'vc_sess_po...', 'core-safety / handoff.claim'],
      ['policy.violation', 'vc_sess_po...', 'approval-gates / deny / owner token missing'],
    ]);
  });

  it('builds a policyPanel from snapshot policy packs and recent policy events', () => {
    const model = buildVaultCollabDashboardViewModel(snapshot({
      events: [
        event({
          eventId: 21,
          eventType: 'policy.violation',
          payload: { policyPackName: 'approval-gates', action: 'deny', reason: 'missing owner token' },
          createdAt: '2026-05-30T00:14:00.000Z',
        }),
        event({
          eventId: 22,
          eventType: 'tool.after',
          payload: { toolName: 'vault_collab_claim_handoff' },
          createdAt: '2026-05-30T00:15:00.000Z',
        }),
        event({
          eventId: 23,
          eventType: 'policy.approved',
          payload: { policyPackName: 'core-safety', trigger: 'handoff.resolve' },
          createdAt: '2026-05-30T00:17:00.000Z',
        }),
      ],
      policyPacks: [
        {
          uid: 'policy_core_safety',
          name: 'core-safety',
          version: '1.0.0',
          active: true,
          builtIn: true,
          ruleCount: 4,
          updatedAt: '2026-05-30T00:00:00.000Z',
        },
        {
          uid: 'policy_rate_limiting',
          name: 'rate-limiting',
          version: '1.0.0',
          active: false,
          builtIn: true,
          ruleCount: 2,
          updatedAt: '2026-05-30T00:00:00.000Z',
        },
      ],
    } as unknown as Partial<VaultCollabDashboardSnapshot>), now);
    const cockpit = model.cockpit as typeof model.cockpit & {
      policyPanel?: {
        packs: Array<{
          uid: string;
          name: string;
          active: boolean;
          builtInBadge: string | null;
          toggleAction: 'activate' | 'deactivate';
        }>;
        recentEvents: Array<{
          type: string;
          summary: string;
        }>;
      };
    };

    expect(cockpit.policyPanel?.packs).toEqual([
      {
        uid: 'policy_core_safety',
        name: 'core-safety',
        active: true,
        builtInBadge: 'built in',
        toggleAction: 'deactivate',
      },
      {
        uid: 'policy_rate_limiting',
        name: 'rate-limiting',
        active: false,
        builtInBadge: 'built in',
        toggleAction: 'activate',
      },
    ]);
    expect(cockpit.policyPanel?.recentEvents.map((eventRow) => [eventRow.type, eventRow.summary])).toEqual([
      ['policy.approved', 'core-safety / handoff.resolve'],
      ['policy.violation', 'approval-gates / deny / missing owner token'],
    ]);
  });

  it('shows coordinator admin sessions while excluding dashboard action brokers from the cockpit roster', () => {
    const model = buildVaultCollabDashboardViewModel(snapshot({
      roleProfiles: [
        roleProfile({ roleProfileId: 'coordinator', displayName: 'Coordinator' }),
      ],
      sessions: [
        session({
          sessionUid: 'vc_sess_coordinator_1234567890',
          displayName: 'Codex Coordinator',
          capabilities: { sessionAdmin: true },
          role: 'coordinator',
          roleProfileId: 'coordinator',
        }),
        session({
          sessionUid: 'vc_sess_actions_1234567890',
          displayName: 'The Vault dashboard',
          capabilities: { dashboardActions: true, sessionAdmin: true },
          agentRole: 'broker',
        }),
      ],
    }), now);

    expect(model.cockpit.roster.flatMap((office) => office.agents)).toEqual([
      expect.objectContaining({
        sessionUid: 'vc_sess_coordinator_1234567890',
        displayName: 'Codex Coordinator',
        roleProfileId: 'coordinator',
        roleDisplayName: 'Coordinator',
      }),
    ]);
  });

  it('derives a normalized HUD model for snapshot-backed roster agents', () => {
    const model = buildVaultCollabDashboardViewModel(snapshot({
      sessions: [
        session({
          sessionUid: 'vc_sess_hud_1234567890',
          displayName: 'Snapshot Codex',
          effectiveStatus: 'working',
          currentHandoffUid: 'vc_handoff_known_1234567890',
          ...phaseSevenSessionFields({ sessionUid: 'vc_sess_hud_1234567890' }),
        }),
      ],
      handoffs: [
        handoff({
          handoffUid: 'vc_handoff_known_1234567890',
          status: 'in_progress',
          progressNote: 'Canonical progress',
        }),
      ],
    }), now);

    const agent = model.cockpit.officeGroups[0].agents[0];

    expect(agent.hud).toEqual(expect.objectContaining({
      hasSnapshot: true,
      adapter: expect.objectContaining({
        label: 'ADAPTER',
        tone: 'adapter',
      }),
      lifecycleStatus: expect.objectContaining({
        label: 'working',
      }),
      reportedState: expect.objectContaining({
        label: 'idle',
        available: true,
      }),
      context: expect.objectContaining({
        providerLabel: 'openai',
        modelLabel: 'gpt-5-codex',
        tokenGauge: expect.objectContaining({
          available: true,
          used: 86000,
          remaining: 14000,
          total: 100000,
          percentUsed: 86,
        }),
        compactionRisk: expect.objectContaining({
          level: 'high',
          className: 'vault-collab-risk-high',
        }),
      }),
      progress: expect.objectContaining({
        taskLabel: 'Implement HUD cards',
        percent: 42,
        percentLabel: '42%',
        blockers: ['Awaiting QA'],
      }),
      cost: expect.objectContaining({
        label: '$1.25 est.',
        available: true,
      }),
      risk: expect.objectContaining({
        level: 'critical',
        className: 'vault-collab-risk-critical',
        reasons: ['Context nearly full'],
      }),
      activeHandoffs: [
        expect.objectContaining({
          uid: 'vc_handoff_known_1234567890',
          statusLabel: 'in progress',
          progressNote: 'Canonical progress',
          canOpen: true,
        }),
        expect.objectContaining({
          uid: 'vc_handoff_unknown_1234567890',
          statusLabel: 'blocked',
          canOpen: false,
        }),
      ],
      toolGrants: [
        { toolName: 'shell_command', scope: 'workspace_write', grantedLabel: '2026-05-30T00:09:00.000Z' },
        { toolName: 'vault_collab_update_handoff', scope: 'coordination_write', grantedLabel: null },
      ],
      sync: expect.objectContaining({
        label: 'snapshot 2m ago',
        stale: false,
        source: 'snapshot',
      }),
    }));
  });

  it('builds null-safe HUD defaults without breaking legacy session fields', () => {
    const hud = buildSessionHudModel(
      session({
        sessionUid: 'vc_sess_legacy_hud_1234567890',
        displayName: 'Legacy HUD row',
        clientType: 'codex',
        effectiveStatus: 'idle',
        lastHeartbeatAt: '2026-05-30T00:10:00.000Z',
        heartbeatAgeMs: 10 * 60_000,
        ...phaseSevenSessionFields({
          adapterType: 'instruction_backed',
          snapshotReportedAt: null,
          lastSnapshot: {
            context: {
              provider: null,
              model: null,
              tokensUsed: null,
              tokensRemaining: null,
              compactionRisk: 'unknown',
            },
            progress: {
              currentTask: null,
              percentComplete: null,
              blockers: [],
            },
            cost: {
              estimatedUSD: null,
              tokensTotal: null,
            },
            risk: {
              level: 'unknown',
              reasons: [],
            },
            active_handoffs: [],
            tool_grants: [],
            sync_cursor: {
              lastEventId: null,
              lastHeartbeatAt: null,
            },
          },
        }),
      }),
      new Map(),
      now,
    );

    expect(hud).toEqual(expect.objectContaining({
      hasSnapshot: true,
      adapter: expect.objectContaining({ label: 'INSTRUCTION' }),
      context: expect.objectContaining({
        providerLabel: 'Codex',
        modelLabel: 'model unknown',
        tokenGauge: expect.objectContaining({
          available: false,
          percentUsed: null,
          label: 'tokens unavailable',
        }),
        compactionRisk: expect.objectContaining({
          level: 'unknown',
          className: 'vault-collab-risk-unknown',
        }),
      }),
      progress: expect.objectContaining({
        taskLabel: 'No task reported',
        percent: null,
        percentLabel: 'progress unknown',
      }),
      cost: expect.objectContaining({
        label: 'cost unknown',
        available: false,
      }),
      risk: expect.objectContaining({
        level: 'unknown',
        reasons: [],
      }),
      activeHandoffs: [],
      toolGrants: [],
      sync: expect.objectContaining({
        label: 'heartbeat 10m ago',
        source: 'heartbeat',
      }),
    }));
  });

  it('uses active-only Offices status options and counts only visible active agents by default', () => {
    expect(getVaultCollabOfficeSessionStatuses(false)).toEqual([
      'idle',
      'working',
      'blocked',
      'awaiting_user',
      'awaiting_verification',
    ]);
    expect(getVaultCollabOfficeSessionStatuses(true)).toEqual([
      'idle',
      'working',
      'blocked',
      'awaiting_user',
      'awaiting_verification',
      'complete',
      'disconnected',
    ]);

    const model = buildVaultCollabDashboardViewModel(snapshot({
      roleProfiles: [
        roleProfile({ roleProfileId: 'implementer', displayName: 'Implementer' }),
      ],
      sessions: [
        session({
          sessionUid: 'vc_sess_active_office_1234567890',
          displayName: 'Active worker',
          effectiveStatus: 'working',
          status: 'working',
        }),
        session({
          sessionUid: 'vc_sess_complete_office_1234567890',
          displayName: 'Complete worker',
          effectiveStatus: 'complete',
          status: 'complete',
          connectionState: 'fresh',
        }),
        session({
          sessionUid: 'vc_sess_disconnected_office_1234567890',
          displayName: 'Disconnected worker',
          effectiveStatus: 'disconnected',
          status: 'disconnected',
          connectionState: 'disconnected',
          disconnectedAt: '2026-05-30T00:10:00.000Z',
        }),
      ],
    }), now);

    expect(model.cockpit.officeGroups.flatMap((group) => group.agents).map((agent) => agent.sessionUid)).toEqual([
      'vc_sess_active_office_1234567890',
    ]);
    expect(getVaultCollabAgentsTabCount(model.cockpit.officeGroups)).toBe(1);
  });

  it('groups handoffs into fixed work columns', () => {
    const longPrompt = 'TEAM LEADER role: own the remaining Vault Collab polish fixes with enough detail to overflow a card if it is rendered in full.';
    const model = buildVaultCollabDashboardViewModel(snapshot({
      handoffs: [
        handoff({ handoffUid: 'vc_handoff_resolved_1234567890', status: 'resolved', shortPrompt: 'Resolved work.' }),
        handoff({ handoffUid: 'vc_handoff_claimed_1234567890', status: 'claimed', shortPrompt: 'Claimed work.' }),
        handoff({ handoffUid: 'vc_handoff_in_progress_1234567890', status: 'in_progress', shortPrompt: 'In progress work.' }),
        handoff({ handoffUid: 'vc_handoff_available_1234567890', status: 'available', shortPrompt: longPrompt }),
        handoff({ handoffUid: 'vc_handoff_verification_1234567890', status: 'verification_needed', shortPrompt: 'Verify work.' }),
        handoff({ handoffUid: 'vc_handoff_blocked_1234567890', status: 'blocked', shortPrompt: 'Blocked work.' }),
        handoff({ handoffUid: 'vc_handoff_awaiting_1234567890', status: 'awaiting_user', shortPrompt: 'Awaiting work.' }),
      ],
    }), now);

    expect(model.cockpit.work.map((column) => [column.state, column.label, column.cards.map((card) => card.uid)])).toEqual([
      ['available', 'Available', ['vc_handoff_available_1234567890']],
      ['claimed', 'Claimed', ['vc_handoff_claimed_1234567890']],
      ['in_progress', 'In progress', ['vc_handoff_in_progress_1234567890']],
      ['verification_needed', 'Needs verification', ['vc_handoff_verification_1234567890']],
      ['resolved', 'Resolved', ['vc_handoff_resolved_1234567890']],
    ]);
    expect(model.cockpit.work[0].cards[0]).toEqual(expect.objectContaining({
      title: 'TEAM LEADER role',
      prompt: longPrompt,
      promptPreview: longPrompt,
    }));
  });

  it('merges discussion summaries and key events into a newest-first conversation stream', () => {
    const selectedHandoffUid = 'vc_handoff_selected_1234567890';
    const model = buildVaultCollabDashboardViewModel(snapshot({
      handoffs: [
        handoff({
          handoffUid: selectedHandoffUid,
          shortPrompt: 'Selected handoff.',
          discussionThreads: [
            discussionThread({
              threadUid: 'vc_thread_selected_1234567890',
              handoffUid: selectedHandoffUid,
              title: 'Verification notes',
              messageCount: 3,
              lastMessageAt: '2026-05-30T00:16:00.000Z',
              latestMessages: [
                {
                  messageUid: 'vc_msg_selected_1234567890',
                  threadUid: 'vc_thread_selected_1234567890',
                  sessionUid: 'vc_sess_worker_1234567890',
                  agentUid: null,
                  messageType: 'decision',
                  body: 'Ready for manual verification.',
                  createdAt: '2026-05-30T00:16:00.000Z',
                },
              ],
            }),
          ],
        }),
      ],
      events: [
        event({
          eventId: 11,
          handoffUid: selectedHandoffUid,
          sessionUid: 'vc_sess_worker_1234567890',
          eventType: 'handoff.claimed',
          payload: { handoffUid: selectedHandoffUid },
          createdAt: '2026-05-30T00:14:00.000Z',
        }),
        event({
          eventId: 12,
          handoffUid: selectedHandoffUid,
          sessionUid: 'vc_sess_worker_1234567890',
          eventType: 'handoff.resolved',
          payload: { summary: 'All gates passed.' },
          createdAt: '2026-05-30T00:18:00.000Z',
        }),
        event({
          eventId: 13,
          handoffUid: 'vc_handoff_other_1234567890',
          eventType: 'handoff.claimed',
          payload: {},
          createdAt: '2026-05-30T00:19:00.000Z',
        }),
        event({
          eventId: 14,
          handoffUid: selectedHandoffUid,
          sessionUid: 'vc_sess_worker_1234567890',
          eventType: 'session.pinged',
          payload: { message: 'wake worker' },
          createdAt: '2026-05-30T00:19:00.000Z',
        }),
      ],
    }), now, selectedHandoffUid);

    expect(model.cockpit.conversation.map((entry) => [entry.kind, entry.id, entry.body])).toEqual([
      ['event', 'event:12', 'summary: All gates passed.'],
      ['message', 'message:vc_msg_selected_1234567890', 'Verification notes (decision): Ready for manual verification.'],
      ['event', 'event:11', `handoffUid: ${selectedHandoffUid}`],
    ]);
  });

  it('handles legacy discussion thread snapshots without latest messages', () => {
    const selectedHandoffUid = 'vc_handoff_selected_1234567890';
    const legacyThread = discussionThread({
      threadUid: 'vc_thread_empty_1234567890',
      handoffUid: selectedHandoffUid,
      title: 'Empty review thread',
      messageCount: 0,
      lastMessageAt: null,
    });
    delete (legacyThread as { latestMessages?: unknown }).latestMessages;

    const model = buildVaultCollabDashboardViewModel(snapshot({
      handoffs: [
        handoff({
          handoffUid: selectedHandoffUid,
          shortPrompt: 'Selected handoff.',
          discussionThreads: [legacyThread],
        }),
      ],
    }), now, selectedHandoffUid);

    expect(model.selectedHandoff?.discussionThreads[0]).toEqual(expect.objectContaining({
      uid: 'vc_thread_empty_1234567890',
      summary: 'no messages yet / created by vc_sess_re... / 0 messages',
    }));
    expect(model.cockpit.conversation.map((entry) => [entry.kind, entry.id, entry.body])).toEqual([
      ['message', 'thread:vc_thread_empty_1234567890', 'Empty review thread / 0 messages / no messages yet'],
    ]);
  });

  it('handles discussion message previews without a body', () => {
    const selectedHandoffUid = 'vc_handoff_selected_1234567890';
    const messageWithoutBody = {
      messageUid: 'vc_msg_without_body_1234567890',
      threadUid: 'vc_thread_selected_1234567890',
      sessionUid: 'vc_sess_worker_1234567890',
      agentUid: null,
      messageType: 'note',
      body: undefined,
      createdAt: '2026-05-30T00:16:00.000Z',
    } as unknown as DiscussionThreadSnapshot['latestMessages'][number];

    const model = buildVaultCollabDashboardViewModel(snapshot({
      handoffs: [
        handoff({
          handoffUid: selectedHandoffUid,
          shortPrompt: 'Selected handoff.',
          discussionThreads: [
            discussionThread({
              threadUid: 'vc_thread_selected_1234567890',
              handoffUid: selectedHandoffUid,
              title: 'Bodyless thread',
              messageCount: 1,
              lastMessageAt: '2026-05-30T00:16:00.000Z',
              latestMessages: [messageWithoutBody],
            }),
          ],
        }),
      ],
    }), now, selectedHandoffUid);

    expect(model.selectedHandoff?.discussionThreads[0].summary).toBe(
      'last message 4m ago / latest:  / created by vc_sess_re... / 1 message',
    );
    expect(model.cockpit.conversation.map((entry) => [entry.kind, entry.id, entry.body])).toEqual([
      ['message', 'message:vc_msg_without_body_1234567890', 'Bodyless thread: '],
    ]);
  });

  it('shortens long Vault Collab identifiers consistently', () => {
    expect(formatVaultCollabShortUid('vc_handoff_0772c645-c3ef-4d4a-bf0c-7c0fa035cfe8')).toBe('vc_handoff...');
    expect(formatVaultCollabShortUid('vm_short')).toBe('vm_short');
  });
});
