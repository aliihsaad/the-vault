import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { OverviewTab } from './components/spark/OverviewTab.js';
import { ProvidersTab } from './components/spark/ProvidersTab.js';
import { buildSparkProviderRegistryModel } from './spark-settings-view-model.js';
import type {
  SparkOverviewModel,
} from './spark-settings-view-model.js';

function render(element: React.ReactElement): string {
  return renderToStaticMarkup(element);
}

describe('Spark settings Wave 3 tabs', () => {
  it('renders the overview status, toggle, Brain project link, sync time, and health summary', () => {
    const html = render(React.createElement(OverviewTab, {
      model: overviewModel(),
      onToggleEnabled: () => undefined,
      actionPending: false,
    }));

    expect(html).toContain('Spark ready');
    expect(html).toContain('Disable Spark');
    expect(html).toContain('Spark Brain');
    expect(html).toContain('#vault-project-Spark%20Brain');
    expect(html).toContain('Last sync 2026-06-05 09:17 UTC');
    expect(html).toContain('1 healthy / 1 degraded / 1 unavailable provider');
  });

  it('renders the provider registry with role assignment dropdowns and a masked configure form', () => {
    const html = render(React.createElement(ProvidersTab, {
      model: buildSparkProviderRegistryModel(null),
      providerPending: null,
      roleAssignmentPending: null,
      onConfigureProvider: () => undefined,
      onAssignRole: () => undefined,
    }));

    expect(html).toContain('FreeLLMAPI');
    expect(html).toContain('Default (always available)');
    expect(html).toContain('Speech-to-text');
    expect(html).toContain('Language model');
    expect(html).toContain('type="password"');
    expect(html).toContain('0 of 8 providers configured');

    // No secret key value or credential getter ever leaks into the markup.
    expect(html).not.toContain('getKey');
    expect(html).not.toContain('sk-live-openrouter');
  });
});

function overviewModel(): SparkOverviewModel {
  return {
    installStatusLabel: 'Spark ready',
    installDetail: 'Spark settings are ready.',
    sourceLabel: 'managed',
    versionLabel: '0.3.0',
    activeProviderLabel: 'OpenRouter / realtime',
    extensionToggle: {
      enabled: true,
      label: 'Disable Spark',
      disabled: false,
      action: { type: 'toggle-extension', enabled: false },
    },
    brainProjectLink: {
      label: 'Spark Brain',
      href: '#vault-project-Spark%20Brain',
    },
    lastSyncLabel: 'Last sync 2026-06-05 09:17 UTC',
    healthSummary: '1 healthy / 1 degraded / 1 unavailable provider',
    issues: ['Realtime provider fallback is visible.'],
    metrics: [
      { label: 'Pending approvals', value: '3' },
      { label: 'Installed skills', value: '8' },
      { label: 'Installed packs', value: '2' },
      { label: 'Brain artifacts', value: '6' },
    ],
  };
}
