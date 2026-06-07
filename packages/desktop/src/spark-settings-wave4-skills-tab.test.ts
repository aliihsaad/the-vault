import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { SkillsTab } from './components/spark/SkillsTab.js';
import type { SparkSkillsModel } from './spark-settings-view-model.js';

function render(element: React.ReactElement): string {
  return renderToStaticMarkup(element);
}

describe('Spark settings Wave 4 Skills tab', () => {
  it('renders installed skills, discovery-only rows, catalog rows, and toggle affordances', () => {
    const html = render(React.createElement(SkillsTab, {
      model: skillsModel(),
      actionPendingSkillId: null,
      onToggleSkill: () => undefined,
    }));

    expect(html).toContain('Installed skills');
    expect(html).toContain('1 enabled / 1 disabled / 0 locked skills');
    expect(html).toContain('Vault Memory');
    expect(html).toContain('vault.native');
    expect(html).toContain('1.0.0');
    expect(html).toContain('Enabled');
    expect(html).toContain('Vault platform');
    expect(html).toContain('vault:read, vault:write');
    expect(html).toContain('Disable');
    expect(html).toContain('Meeting Notes');
    expect(html).toContain('Discovery-only');
    expect(html).toContain('Architecture Reviewer');
    expect(html).toContain('Architecture Pack');
    expect(html).toContain('repo:read');

    expect(html).not.toContain('Install pack');
    expect(html).not.toContain('Approve skill');
  });
});

function skillsModel(): SparkSkillsModel {
  return {
    summaryLabel: '1 enabled / 1 disabled / 0 locked skills',
    installedEmptyLabel: 'No Spark skills are installed yet.',
    catalogEmptyLabel: 'No uninstalled Spark catalog skills are available.',
    installedRows: [
      {
        skillId: 'vault-memory',
        name: 'Vault Memory',
        namespace: 'vault.native',
        versionLabel: '1.0.0',
        sourceLabel: 'vault-native',
        stateLabel: 'Enabled',
        stateClassName: 'spark-skill-state-enabled',
        packSourceLabel: 'Vault platform',
        permissionsSummary: 'vault:read, vault:write',
        executionLabel: 'Executable',
        supportedToolsSummary: 'vault_recall_context',
        outputContractsSummary: 'memory-pack',
        healthLabel: 'Ready',
        lockedReasonLabel: null,
        toggleLabel: 'Disable',
        toggleDisabled: false,
        toggleAction: { type: 'toggle-skill', skillId: 'vault-memory', enabled: false },
      },
      {
        skillId: 'ops-meeting-notes',
        name: 'Meeting Notes',
        namespace: 'operations',
        versionLabel: 'unversioned',
        sourceLabel: 'pack',
        stateLabel: 'Disabled',
        stateClassName: 'spark-skill-state-disabled',
        packSourceLabel: 'Operations Pack',
        permissionsSummary: 'No extra permissions',
        executionLabel: 'Discovery-only',
        supportedToolsSummary: 'No registered tools',
        outputContractsSummary: 'summary',
        healthLabel: 'Unknown',
        lockedReasonLabel: 'Discovery-only until executable registration is available.',
        toggleLabel: 'Enable',
        toggleDisabled: true,
        toggleAction: null,
      },
    ],
    catalogRows: [
      {
        skillId: 'architecture-reviewer',
        name: 'Architecture Reviewer',
        namespace: 'architecture',
        versionLabel: '0.4.0',
        sourceLabel: 'pack',
        packSourceLabel: 'Architecture Pack',
        permissionsSummary: 'repo:read',
        executionLabel: 'Discovery-only',
        supportedToolsSummary: 'No registered tools',
        outputContractsSummary: 'review-notes',
        categoryLabel: 'Architecture',
        description: 'Catalog-only review helper.',
      },
    ],
  };
}
