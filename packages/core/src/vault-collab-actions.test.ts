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
});
