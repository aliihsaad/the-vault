import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { ApprovalsTab } from './components/spark/ApprovalsTab.js';
import type { SparkApprovalsModel } from './spark-settings-view-model.js';

function render(element: React.ReactElement): string {
  return renderToStaticMarkup(element);
}

describe('Spark settings Wave 5 Approvals tab', () => {
  it('renders pending skill proposals with permissions, risk flags, and approval actions', () => {
    const html = render(React.createElement(ApprovalsTab, {
      model: approvalsModel(),
      actionPendingApprovalId: null,
      onApproveSkill: () => undefined,
      onRejectSkill: () => undefined,
    }));

    expect(html).toContain('Skill Creator approvals');
    expect(html).toContain('2 pending skill approvals');
    expect(html).toContain('Release Executor');
    expect(html).toContain('Runs release workflow commands after approval.');
    expect(html).toContain('repo:write, process:execute');
    expect(html).toContain('Critical risk');
    expect(html).toContain('Higher risk proposal');
    expect(html).toContain('Approve');
    expect(html).toContain('Reject');
    expect(html).toContain('Meeting Notes');
    expect(html).toContain('Low risk');

    expect(html).not.toContain('Install pack');
    expect(html).not.toContain('Evolution');
  });

  it('renders an empty state when there are no pending skill approvals', () => {
    const html = render(React.createElement(ApprovalsTab, {
      model: {
        summaryLabel: '0 pending skill approvals',
        emptyLabel: 'No pending Skill Creator approvals.',
        rows: [],
      },
      actionPendingApprovalId: null,
      onApproveSkill: () => undefined,
      onRejectSkill: () => undefined,
    }));

    expect(html).toContain('Skill Creator approvals');
    expect(html).toContain('No pending Skill Creator approvals.');
    expect(html).not.toContain('Approve');
    expect(html).not.toContain('Reject');
  });
});

function approvalsModel(): SparkApprovalsModel {
  return {
    summaryLabel: '2 pending skill approvals',
    emptyLabel: 'No pending Skill Creator approvals.',
    rows: [
      {
        proposalId: 'proposal-critical',
        skillName: 'Release Executor',
        purpose: 'Runs release workflow commands after approval.',
        requiredPermissionsSummary: 'repo:write, process:execute',
        riskLevel: 'critical',
        riskLabel: 'Critical risk',
        riskClassName: 'spark-approval-risk-critical',
        highRisk: true,
        approveAction: { type: 'approve-skill', proposalId: 'proposal-critical' },
        rejectAction: {
          type: 'reject-skill',
          proposalId: 'proposal-critical',
          reason: 'Rejected from Spark settings approvals queue.',
        },
      },
      {
        proposalId: 'proposal-low',
        skillName: 'Meeting Notes',
        purpose: 'Summarize recurring meeting workflows.',
        requiredPermissionsSummary: 'vault:read',
        riskLevel: 'low',
        riskLabel: 'Low risk',
        riskClassName: 'spark-approval-risk-low',
        highRisk: false,
        approveAction: { type: 'approve-skill', proposalId: 'proposal-low' },
        rejectAction: {
          type: 'reject-skill',
          proposalId: 'proposal-low',
          reason: 'Rejected from Spark settings approvals queue.',
        },
      },
    ],
  };
}
