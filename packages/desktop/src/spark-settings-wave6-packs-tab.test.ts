import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { PacksTab } from './components/spark/PacksTab.js';
import type { SparkPacksModel } from './spark-settings-view-model.js';

function render(element: React.ReactElement): string {
  return renderToStaticMarkup(element);
}

describe('Spark settings Wave 6 Packs tab', () => {
  it('renders installed and available packs with expandable skill previews and actions', () => {
    const html = render(React.createElement(PacksTab, {
      model: packsModel(),
      actionPendingPackId: null,
      onInstallPack: () => undefined,
      onUninstallPack: () => undefined,
    }));

    expect(html).toContain('Capability packs');
    expect(html).toContain('1 installed / 1 available packs');
    expect(html).toContain('Research');
    expect(html).toContain('Research workflow helpers.');
    expect(html).toContain('2 skills');
    expect(html).toContain('Installed');
    expect(html).toContain('Uninstall');
    expect(html).toContain('literature-review');
    expect(html).toContain('source-synthesis');
    expect(html).toContain('Operations');
    expect(html).toContain('Operational runbook helpers.');
    expect(html).toContain('1 skill');
    expect(html).toContain('Available');
    expect(html).toContain('Install');
    expect(html).toContain('runbook-writer');

    expect(html).not.toContain('Brain artifacts');
    expect(html).not.toContain('Evolution');
  });

  it('renders an empty state when no packs are available', () => {
    const html = render(React.createElement(PacksTab, {
      model: {
        summaryLabel: '0 installed / 0 available packs',
        emptyLabel: 'No Spark capability packs are available yet.',
        rows: [],
      },
      actionPendingPackId: null,
      onInstallPack: () => undefined,
      onUninstallPack: () => undefined,
    }));

    expect(html).toContain('Capability packs');
    expect(html).toContain('No Spark capability packs are available yet.');
    expect(html).not.toContain('Install');
    expect(html).not.toContain('Uninstall');
  });
});

function packsModel(): SparkPacksModel {
  return {
    summaryLabel: '1 installed / 1 available packs',
    emptyLabel: 'No Spark capability packs are available yet.',
    rows: [
      {
        packId: 'research',
        name: 'Research',
        description: 'Research workflow helpers.',
        includedSkillsCountLabel: '2 skills',
        statusLabel: 'Installed',
        statusClassName: 'spark-pack-status-installed',
        actionLabel: 'Uninstall',
        actionClassName: 'danger-button',
        action: { type: 'uninstall-pack', packId: 'research' },
        includedSkills: ['literature-review', 'source-synthesis'],
      },
      {
        packId: 'operations',
        name: 'Operations',
        description: 'Operational runbook helpers.',
        includedSkillsCountLabel: '1 skill',
        statusLabel: 'Available',
        statusClassName: 'spark-pack-status-available',
        actionLabel: 'Install',
        actionClassName: 'primary-button',
        action: { type: 'install-pack', packId: 'operations' },
        includedSkills: ['runbook-writer'],
      },
    ],
  };
}
