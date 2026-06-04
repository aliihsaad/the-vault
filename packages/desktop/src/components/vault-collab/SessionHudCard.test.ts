import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { Roster } from './Roster.js';
import { RoleProfileModal } from './RoleProfileModal.js';
import {
  SessionHudCard,
  SessionRiskBadge,
  TokenGauge,
} from './SessionHudCard.js';
import type { VaultCollabRosterAgent } from '../../vault-collab-view-model.js';

function hudAgent(overrides: Partial<VaultCollabRosterAgent> = {}): VaultCollabRosterAgent {
  return {
    sessionUid: 'vc_sess_hud_1234567890',
    displayName: 'Snapshot Codex',
    clientType: 'codex',
    rawRole: 'implementer',
    roleProfileId: 'implementer',
    roleDisplayName: 'Implementer',
    roleLabel: 'Implementer',
    status: 'working',
    currentHandoffUid: 'vc_handoff_known_1234567890',
    freshness: 'fresh',
    hud: {
      hasSnapshot: true,
      adapter: {
        raw: 'adapter_backed',
        label: 'ADAPTER',
        tone: 'adapter',
      },
      lifecycleStatus: {
        label: 'working',
        badgeClass: 'badge-task-running',
      },
      reportedState: {
        label: 'idle',
        badgeClass: 'badge-task-pending',
        available: true,
      },
      context: {
        providerLabel: 'openai',
        modelLabel: 'gpt-5-codex',
        tokenGauge: {
          available: true,
          used: 86000,
          remaining: 14000,
          total: 100000,
          percentUsed: 86,
          label: '86,000 used / 14,000 left',
        },
        compactionRisk: {
          level: 'high',
          label: 'high',
          className: 'vault-collab-risk-high',
        },
      },
      progress: {
        taskLabel: 'Implement HUD cards',
        percent: 42,
        percentLabel: '42%',
        blockers: ['Awaiting QA'],
        available: true,
      },
      cost: {
        label: '$1.25 est.',
        available: true,
      },
      risk: {
        level: 'critical',
        label: 'critical',
        className: 'vault-collab-risk-critical',
        reasons: ['Context nearly full'],
      },
      activeHandoffs: [
        {
          uid: 'vc_handoff_known_1234567890',
          shortUid: 'vc_handoff...',
          statusLabel: 'in progress',
          progressNote: 'Canonical progress',
          canOpen: true,
        },
        {
          uid: 'vc_handoff_unknown_1234567890',
          shortUid: 'vc_handoff...',
          statusLabel: 'blocked',
          progressNote: null,
          canOpen: false,
        },
      ],
      toolGrants: [
        { toolName: 'shell_command', scope: 'workspace_write', grantedLabel: '2026-05-30T00:09:00.000Z' },
        { toolName: 'vault_collab_update_handoff', scope: 'coordination_write', grantedLabel: null },
        { toolName: 'vault_save_memory', scope: 'coordination_write', grantedLabel: null },
        { toolName: 'browser', scope: 'read', grantedLabel: null },
      ],
      sync: {
        label: 'snapshot 2m ago',
        stale: false,
        source: 'snapshot',
      },
    },
    ...overrides,
  } as VaultCollabRosterAgent;
}

function render(element: React.ReactElement): string {
  return renderToStaticMarkup(element);
}

describe('SessionHudCard', () => {
  it('renders adapter identity, dual status labels, and snapshot-priority sync text', () => {
    const html = render(React.createElement(SessionHudCard, {
      agent: hudAgent(),
      onSelectHandoff: () => undefined,
    }));

    expect(html).toContain('ADAPTER');
    expect(html).toContain('Lifecycle:');
    expect(html).toContain('working');
    expect(html).toContain('Agent reports:');
    expect(html).toContain('idle');
    expect(html).toContain('snapshot 2m ago');
  });

  it('renders the legacy roster row and omits HUD sections when no snapshot is available', () => {
    const html = render(React.createElement(SessionHudCard, {
      agent: hudAgent({
        displayName: 'Legacy Codex',
        currentHandoffUid: null,
        hud: { ...hudAgent().hud, hasSnapshot: false },
      }),
      onSelectHandoff: () => undefined,
    }));

    expect(html).toContain('Legacy Codex');
    expect(html).toContain('Implementer');
    expect(html).toContain('unassigned');
    expect(html).not.toContain('Token usage');
    expect(html).not.toContain('Agent reports:');
  });

  it('renders context, token gauge ARIA, cost, risk colors, and risk reasons', () => {
    const html = render(React.createElement(SessionHudCard, {
      agent: hudAgent(),
      onSelectHandoff: () => undefined,
    }));

    expect(html).toContain('openai');
    expect(html).toContain('gpt-5-codex');
    expect(html).toContain('role="progressbar"');
    expect(html).toContain('aria-valuenow="86"');
    expect(html).toContain('Token usage: 86,000 used, 14,000 remaining');
    expect(html).toContain('$1.25 est.');
    expect(html).toContain('vault-collab-risk-critical');
    expect(html).toContain('Context nearly full');
  });

  it('renders unavailable token state without a fake percentage', () => {
    const html = render(React.createElement(TokenGauge, {
      gauge: {
        available: false,
        used: null,
        remaining: null,
        total: null,
        percentUsed: null,
        label: 'tokens unavailable',
      },
      riskLevel: 'unknown',
    }));

    expect(html).toContain('tokens unavailable');
    expect(html).toContain('role="progressbar"');
    expect(html).not.toContain('aria-valuenow');
  });

  it('maps low, medium, high, critical, and unknown risk levels to stable classes', () => {
    for (const level of ['low', 'medium', 'high', 'critical', 'unknown'] as const) {
      const html = render(React.createElement(SessionRiskBadge, {
        risk: {
          level,
          label: level,
          className: `vault-collab-risk-${level}`,
          reasons: [],
        },
      }));

      expect(html).toContain(`vault-collab-risk-${level}`);
      expect(html).toContain('No reasons reported');
    }
  });

  it('renders progress, read-only handoffs, disabled unknown handoffs, and capped tool grants', () => {
    const html = render(React.createElement(SessionHudCard, {
      agent: hudAgent(),
      onSelectHandoff: () => undefined,
    }));

    expect(html).toContain('Implement HUD cards');
    expect(html).toContain('42%');
    expect(html).toContain('Canonical progress');
    expect(html).toContain('disabled');
    expect(html).toContain('shell_command');
    expect(html).toContain('workspace_write');
    expect(html).toContain('+1');
    expect(html).not.toContain('args');
    expect(html).not.toContain('env');
    expect(html).not.toContain('result');
  });

  it('renders null progress as unknown instead of zero percent', () => {
    const html = render(React.createElement(SessionHudCard, {
      agent: hudAgent({
        hud: {
          ...hudAgent().hud,
          progress: {
            taskLabel: 'No task reported',
            percent: null,
            percentLabel: 'progress unknown',
            blockers: [],
            available: false,
          },
        },
      }),
      onSelectHandoff: () => undefined,
    }));

    expect(html).toContain('progress unknown');
    expect(html).not.toContain('<span>0%</span>');
  });

  it('shows the inactive session toggle in the roster zone header', () => {
    const html = render(React.createElement(Roster, {
      groups: [],
      actionBusy: null,
      selectedRoleProfile: null,
      selectedRoleProfileId: null,
      showInactiveSessions: false,
      onShowInactiveSessionsChange: () => undefined,
      onSelectRoleProfile: () => undefined,
      onCloseRoleProfile: () => undefined,
      onCleanupSessions: () => undefined,
      onSelectHandoff: () => undefined,
    }));

    expect(html).toContain('Show inactive');
    expect(html).toContain('Clear inactive');
    expect(html).toContain('type="checkbox"');
  });

  it('shows connected agent details in the open office modal', () => {
    const html = render(React.createElement(RoleProfileModal, {
      roleProfile: {
        roleProfileId: 'implementer',
        displayName: 'Implementer',
        purpose: 'Build assigned work.',
        mutationLabel: 'workspace write',
        capabilities: ['code editing'],
        triggerLabels: ['implementation'],
        suggestedNextRoleLabels: [],
        primarySkillNames: [],
        secondarySkillNames: [],
        isWatchdog: false,
      },
      agents: [
        hudAgent({
          displayName: 'Snapshot Codex',
          roleLabel: 'Implementer / phase-7',
        }),
      ],
      onClose: () => undefined,
    }));

    expect(html).toContain('Connected agents');
    expect(html).toContain('Snapshot Codex');
    expect(html).toContain('Implementer / phase-7');
    expect(html).toContain('working');
    expect(html).toContain('vc_handoff...');
    expect(html).toContain('openai');
    expect(html).toContain('gpt-5-codex');
    expect(html).toContain('snapshot 2m ago');
  });
});
