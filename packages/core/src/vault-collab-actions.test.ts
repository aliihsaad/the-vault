import { describe, expect, it } from 'vitest';

import {
  buildVaultCollabActionInvocation,
  buildVaultCollabDashboardSessionInvocation,
  buildVaultCollabHandoffActionsInvocation,
  executeVaultCollabAction,
  executeVaultCollabDashboardSessionRegistration,
  executeVaultCollabHandoffActions,
  redactVaultCollabActionInvocation,
} from './services/vault-collab-actions.service.js';
import type { VaultCollabRuntimeConfig } from './types/vault-collab.js';

const config: VaultCollabRuntimeConfig = {
  runtimeMode: 'localSource',
  managedRuntimePath: 'C:\\Vault\\extensions\\vault-collab\\runtime',
  localSourceCheckoutPath: 'C:\\Users\\Mini\\Desktop\\Projects\\vault-collab',
  customCliPath: null,
  databasePath: 'C:\\Users\\Mini\\Desktop\\Projects\\vault-collab\\vault-collab.db',
};

const actor = {
  sessionUid: 'vc_sess_dashboard',
  sessionToken: 'dashboard-secret-token',
};

describe('Vault Collab dashboard action invocation', () => {
  it('builds token-owned handoff action commands without exposing the token in display output', () => {
    const invocation = buildVaultCollabActionInvocation(config, actor, {
      kind: 'handoff',
      action: 'update',
      handoffUid: 'vc_handoff_123',
      status: 'blocked',
      progressNote: 'Waiting on localhost verification.',
    });

    expect(invocation.command).toBe('node');
    expect(invocation.args).toContain('dashboard-secret-token');
    expect(invocation.args).toEqual(expect.arrayContaining([
      'update',
      '--db',
      config.databasePath,
      '--handoff-uid',
      'vc_handoff_123',
      '--session-uid',
      'vc_sess_dashboard',
      '--session-token',
      'dashboard-secret-token',
      '--status',
      'blocked',
      '--progress-note',
      'Waiting on localhost verification.',
    ]));

    const redacted = redactVaultCollabActionInvocation(invocation);

    expect(JSON.stringify(redacted)).not.toContain('dashboard-secret-token');
    expect(redacted.args).toContain('[redacted]');
  });

  it('executes actions through a runner and redacts token-bearing invocation details', async () => {
    const result = await executeVaultCollabAction(
      config,
      actor,
      {
        kind: 'handoff',
        action: 'resolve',
        handoffUid: 'vc_handoff_123',
        summary: 'Resolved from dashboard.',
      },
      async (invocation) => ({
        exitCode: 0,
        stdout: JSON.stringify({
          handoffUid: 'vc_handoff_123',
          status: 'resolved',
          receivedToken: invocation.args.includes('dashboard-secret-token'),
        }),
        stderr: '',
      }),
    );

    expect(result.ok).toBe(true);
    expect(result.data).toEqual({
      handoffUid: 'vc_handoff_123',
      status: 'resolved',
      receivedToken: true,
    });
    expect(result.error).toBeNull();
    expect(JSON.stringify(result.invocation)).not.toContain('dashboard-secret-token');
  });

  it('registers a dashboard-owned session for renderer-safe actions', async () => {
    const invocation = buildVaultCollabDashboardSessionInvocation(config, {
      project: 'the-vault',
      workspacePath: 'C:\\Users\\Mini\\Desktop\\Projects\\the-vault',
    });

    expect(invocation.args).toEqual(expect.arrayContaining([
      'register',
      '--db',
      config.databasePath,
      '--display-name',
      'The Vault dashboard',
      '--client-type',
      'other',
      '--project',
      'the-vault',
      '--workspace-path',
      'C:\\Users\\Mini\\Desktop\\Projects\\the-vault',
      '--capability',
      'dashboardActions=true',
      '--capability',
      'launchApproval=true',
      '--capability',
      'launchBroker=true',
      '--capability',
      'sessionAdmin=true',
    ]));

    const result = await executeVaultCollabDashboardSessionRegistration(
      config,
      {
        project: 'the-vault',
        workspacePath: 'C:\\Users\\Mini\\Desktop\\Projects\\the-vault',
      },
      async () => ({
        exitCode: 0,
        stdout: JSON.stringify({
          sessionUid: 'vc_sess_dashboard',
          sessionToken: 'new-dashboard-token',
        }),
        stderr: '',
      }),
    );

    expect(result.actor).toEqual({
      sessionUid: 'vc_sess_dashboard',
      sessionToken: 'new-dashboard-token',
    });
    expect(JSON.stringify(result.publicResult)).not.toContain('new-dashboard-token');
  });

  it('builds handoff-linked discussion thread creation commands', () => {
    const invocation = buildVaultCollabActionInvocation(config, actor, {
      kind: 'discussion',
      action: 'create_thread',
      handoffUid: 'vc_handoff_123',
      project: 'the-vault',
      title: 'Dashboard reply',
    });

    expect(invocation.args).toEqual(expect.arrayContaining([
      'discussion-create',
      '--db',
      config.databasePath,
      '--handoff-uid',
      'vc_handoff_123',
      '--project',
      'the-vault',
      '--title',
      'Dashboard reply',
      '--session-uid',
      'vc_sess_dashboard',
      '--session-token',
      'dashboard-secret-token',
    ]));
  });

  it('fetches token-safe handoff affordances from the package API', async () => {
    const invocation = buildVaultCollabHandoffActionsInvocation(config, actor, 'vc_handoff_123');

    expect(invocation.args).toEqual(expect.arrayContaining([
      'handoff-actions',
      '--db',
      config.databasePath,
      '--handoff-uid',
      'vc_handoff_123',
      '--session-uid',
      'vc_sess_dashboard',
      '--session-token',
      'dashboard-secret-token',
    ]));

    const result = await executeVaultCollabHandoffActions(config, actor, 'vc_handoff_123', async () => ({
      exitCode: 0,
      stdout: JSON.stringify({
        handoff: { handoffUid: 'vc_handoff_123' },
        actingSessionUid: 'vc_sess_dashboard',
        actions: [
          {
            kind: 'claim',
            enabled: true,
            reason: 'Handoff is available.',
            toolName: 'vault_collab_claim_handoff',
            requiredCapability: null,
            requiresOwnerToken: true,
            requiresProgressNote: false,
            requiresQuestion: false,
            requiresReason: false,
            requiresSummary: false,
            requiresEvidenceVaultMemoryUid: false,
          },
        ],
      }),
      stderr: '',
    }));

    expect(result.ok).toBe(true);
    expect(result.data?.actions[0]).toEqual(expect.objectContaining({
      kind: 'claim',
      enabled: true,
    }));
    expect(JSON.stringify(result.invocation)).not.toContain('dashboard-secret-token');
  });

  it('builds session roster admin commands and redacts actor tokens', () => {
    const closeInvocation = buildVaultCollabActionInvocation(config, actor, {
      kind: 'session',
      action: 'close',
      targetSessionUid: 'vc_sess_stale',
      reason: 'Stale dashboard cleanup.',
    });

    expect(closeInvocation.args).toEqual(expect.arrayContaining([
      'session-close',
      '--db',
      config.databasePath,
      '--target-session-uid',
      'vc_sess_stale',
      '--actor-session-uid',
      'vc_sess_dashboard',
      '--actor-session-token',
      'dashboard-secret-token',
      '--reason',
      'Stale dashboard cleanup.',
    ]));

    const redactedClose = redactVaultCollabActionInvocation(closeInvocation);
    expect(JSON.stringify(redactedClose)).not.toContain('dashboard-secret-token');
    expect(redactedClose.args).toContain('[redacted]');

    const renameInvocation = buildVaultCollabActionInvocation(config, actor, {
      kind: 'session',
      action: 'rename',
      sessionUid: 'vc_sess_dashboard',
      displayName: 'The Vault dashboard - local',
    });

    expect(renameInvocation.args).toEqual(expect.arrayContaining([
      'session-rename',
      '--db',
      config.databasePath,
      '--session-uid',
      'vc_sess_dashboard',
      '--session-token',
      'dashboard-secret-token',
      '--display-name',
      'The Vault dashboard - local',
    ]));
  });

  it('builds handoff attention and recovery commands from action affordances', () => {
    const confirmationInvocation = buildVaultCollabActionInvocation(config, actor, {
      kind: 'handoff',
      action: 'request_user_confirmation',
      handoffUid: 'vc_handoff_123',
      question: 'Can I run the desktop smoke test?',
    });

    expect(confirmationInvocation.args).toEqual(expect.arrayContaining([
      'user-confirmation-request',
      '--db',
      config.databasePath,
      '--handoff-uid',
      'vc_handoff_123',
      '--session-uid',
      'vc_sess_dashboard',
      '--session-token',
      'dashboard-secret-token',
      '--question',
      'Can I run the desktop smoke test?',
    ]));

    const permissionInvocation = buildVaultCollabActionInvocation(config, actor, {
      kind: 'handoff',
      action: 'request_handoff_permission',
      handoffUid: 'vc_handoff_123',
      question: 'Approve cleanup of stale dashboard rows?',
    });

    expect(permissionInvocation.args).toEqual(expect.arrayContaining([
      'handoff-permission-request',
      '--db',
      config.databasePath,
      '--handoff-uid',
      'vc_handoff_123',
      '--session-uid',
      'vc_sess_dashboard',
      '--session-token',
      'dashboard-secret-token',
      '--question',
      'Approve cleanup of stale dashboard rows?',
    ]));

    const recoverInvocation = buildVaultCollabActionInvocation(config, actor, {
      kind: 'handoff',
      action: 'recover',
      handoffUid: 'vc_handoff_123',
      reason: 'Claim owner session is closed.',
      summary: 'Resolved after dashboard verification.',
      evidenceVaultMemoryUid: 'vm_evidence_123',
    });

    expect(recoverInvocation.args).toEqual(expect.arrayContaining([
      'recover',
      '--db',
      config.databasePath,
      '--handoff-uid',
      'vc_handoff_123',
      '--actor-session-uid',
      'vc_sess_dashboard',
      '--actor-session-token',
      'dashboard-secret-token',
      '--reason',
      'Claim owner session is closed.',
      '--summary',
      'Resolved after dashboard verification.',
      '--evidence-vault-memory-uid',
      'vm_evidence_123',
    ]));

    const redacted = redactVaultCollabActionInvocation(recoverInvocation);
    expect(JSON.stringify(redacted)).not.toContain('dashboard-secret-token');
  });

  it('builds ping commands without implying wake delivery', async () => {
    const invocation = buildVaultCollabActionInvocation(config, actor, {
      kind: 'session',
      action: 'ping',
      targetSessionUid: 'vc_sess_manual',
      message: 'Please check the dashboard QA handoff.',
    });

    expect(invocation.args).toEqual(expect.arrayContaining([
      'ping-session',
      '--db',
      config.databasePath,
      '--target-session-uid',
      'vc_sess_manual',
      '--actor-session-uid',
      'vc_sess_dashboard',
      '--message',
      'Please check the dashboard QA handoff.',
    ]));
    expect(invocation.args).not.toContain('dashboard-secret-token');

    const result = await executeVaultCollabAction(
      config,
      actor,
      {
        kind: 'session',
        action: 'ping',
        targetSessionUid: 'vc_sess_manual',
      },
      async () => ({
        exitCode: 0,
        stdout: JSON.stringify({
          targetSession: { sessionUid: 'vc_sess_manual' },
          delivery: {
            mode: 'manual_poll',
            wakeable: false,
            delivered: false,
            nextStep: 'Target session must poll attention manually or run a watcher.',
          },
        }),
        stderr: '',
      }),
    );

    expect(result.ok).toBe(true);
    expect(result.data).toEqual(expect.objectContaining({
      delivery: expect.objectContaining({
        mode: 'manual_poll',
        wakeable: false,
        nextStep: 'Target session must poll attention manually or run a watcher.',
      }),
    }));
  });

  it('builds launch broker lifecycle commands and redacts owner tokens', () => {
    const launchingInvocation = buildVaultCollabActionInvocation(config, actor, {
      kind: 'launch',
      action: 'mark_launching',
      launchRequestUid: 'vc_launch_123',
      detail: 'Broker accepted request.',
    });

    expect(launchingInvocation.args).toEqual(expect.arrayContaining([
      'launch-mark-launching',
      '--db',
      config.databasePath,
      '--launch-request-uid',
      'vc_launch_123',
      '--session-uid',
      'vc_sess_dashboard',
      '--session-token',
      'dashboard-secret-token',
      '--detail',
      'Broker accepted request.',
    ]));

    const runningInvocation = buildVaultCollabActionInvocation(config, actor, {
      kind: 'launch',
      action: 'mark_running',
      launchRequestUid: 'vc_launch_123',
      launchedSessionUid: 'vc_sess_launched',
      detail: 'Launched session registered.',
    });

    expect(runningInvocation.args).toEqual(expect.arrayContaining([
      'launch-mark-running',
      '--db',
      config.databasePath,
      '--launch-request-uid',
      'vc_launch_123',
      '--session-uid',
      'vc_sess_dashboard',
      '--session-token',
      'dashboard-secret-token',
      '--launched-session-uid',
      'vc_sess_launched',
      '--detail',
      'Launched session registered.',
    ]));

    const stopInvocation = buildVaultCollabActionInvocation(config, actor, {
      kind: 'launch',
      action: 'stop',
      launchRequestUid: 'vc_launch_123',
      detail: 'Managed worker stopped from dashboard.',
      exitCode: 0,
    });

    expect(stopInvocation.args).toEqual(expect.arrayContaining([
      'launch-stop',
      '--db',
      config.databasePath,
      '--launch-request-uid',
      'vc_launch_123',
      '--session-uid',
      'vc_sess_dashboard',
      '--session-token',
      'dashboard-secret-token',
      '--detail',
      'Managed worker stopped from dashboard.',
      '--exit-code',
      '0',
    ]));

    const failInvocation = buildVaultCollabActionInvocation(config, actor, {
      kind: 'launch',
      action: 'fail',
      launchRequestUid: 'vc_launch_123',
      reason: 'Codex executable was not found.',
    });

    expect(failInvocation.args).toEqual(expect.arrayContaining([
      'launch-fail',
      '--db',
      config.databasePath,
      '--launch-request-uid',
      'vc_launch_123',
      '--session-uid',
      'vc_sess_dashboard',
      '--session-token',
      'dashboard-secret-token',
      '--reason',
      'Codex executable was not found.',
    ]));
    expect(JSON.stringify(redactVaultCollabActionInvocation(runningInvocation))).not.toContain('dashboard-secret-token');
    expect(JSON.stringify(redactVaultCollabActionInvocation(stopInvocation))).not.toContain('dashboard-secret-token');
  });
});
