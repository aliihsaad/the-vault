import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { BrainTab } from './components/spark/BrainTab.js';
import {
  buildSparkBrainModel,
  type SparkBrainModel,
} from './spark-settings-view-model.js';
import type { SparkExtensionSnapshot } from '@the-vault/core';

function render(element: React.ReactElement): string {
  return renderToStaticMarkup(element);
}

describe('Spark settings Wave 7 Brain tab', () => {
  it('builds read-only rows for the six Spark Brain artifacts from the snapshot', () => {
    const model = buildSparkBrainModel(makeSnapshot());

    expect(model.summaryLabel).toBe('1 fresh / 1 stale / 4 missing Brain artifacts');
    expect(model.rows.map((row) => row.artifactName)).toEqual([
      'SPARK.md',
      'USER.md',
      'MEMORY.md',
      'VAULT.md',
      'SKILLS.md',
      'CONTEXT.md',
    ]);
    expect(model.rows[0]).toMatchObject({
      artifactName: 'SPARK.md',
      renderedAtLabel: 'Rendered 2026-06-05 10:00 UTC',
      contentHashLabel: 'Hash sha256:spark123',
      freshnessLabel: 'Fresh',
      staleReasonLabel: null,
      markdownContent: '# Spark Brain\n\nGenerated operating view.',
    });
    expect(model.rows[1]).toMatchObject({
      artifactName: 'USER.md',
      renderedAtLabel: 'Rendered 2026-06-05 09:00 UTC',
      contentHashLabel: 'Hash sha256:user456',
      freshnessLabel: 'Stale',
      staleReasonLabel: 'User preference memory changed.',
    });
    expect(model.rows[2]).toMatchObject({
      artifactName: 'MEMORY.md',
      renderedAtLabel: 'Not rendered yet',
      contentHashLabel: 'Hash unavailable',
      freshnessLabel: 'Missing',
      markdownContent: 'Artifact content is not available in the current Spark snapshot.',
    });
  });

  it('renders artifact metadata and markdown content without edit affordances', () => {
    const html = render(React.createElement(BrainTab, { model: brainModel() }));

    expect(html).toContain('Brain artifacts');
    expect(html).toContain('1 fresh / 1 stale / 4 missing Brain artifacts');
    expect(html).toContain('SPARK.md');
    expect(html).toContain('USER.md');
    expect(html).toContain('MEMORY.md');
    expect(html).toContain('VAULT.md');
    expect(html).toContain('SKILLS.md');
    expect(html).toContain('CONTEXT.md');
    expect(html).toContain('Rendered 2026-06-05 10:00 UTC');
    expect(html).toContain('Hash sha256:spark123');
    expect(html).toContain('Fresh');
    expect(html).toContain('Stale');
    expect(html).toContain('Missing');
    expect(html).toContain('Spark Brain');
    expect(html).toContain('Generated operating view.');
    expect(html).toContain('User preference memory changed.');
    expect(html).not.toContain('Evolution');
    expect(html).not.toContain('Edit');
    expect(html).not.toContain('<textarea');
    expect(html).not.toContain('contenteditable');
  });
});

function brainModel(): SparkBrainModel {
  return buildSparkBrainModel(makeSnapshot());
}

function makeSnapshot(): SparkExtensionSnapshot {
  return {
    schemaVersion: 1,
    generatedAt: '2026-06-05T10:05:00.000Z',
    status: {
      installState: 'ready',
      enabled: true,
      source: 'managed',
      version: '0.7.0',
      brainProject: 'Spark Brain',
      activeProviderId: null,
      activeProviderMode: null,
      message: 'Ready',
      installCommands: [],
      issues: [],
    },
    providerHealth: {
      activeProviderId: null,
      activeProviderMode: null,
      ready: 0,
      degraded: 0,
      unavailable: 0,
      unknown: 0,
      providers: [],
    },
    skillStatus: {
      total: 0,
      enabled: 0,
      disabled: 0,
      locked: 0,
      pendingApproval: 0,
    },
    skills: [],
    skillCatalog: [],
    pendingApprovals: [],
    capabilityPacks: [],
    evolutionSuggestions: [],
    packStatus: {
      total: 0,
      installed: 0,
      updateAvailable: 0,
    },
    approvals: {
      pending: 0,
      skillProposals: 0,
      evolutionSuggestions: 0,
    },
    brainArtifacts: {
      fresh: 1,
      stale: 1,
      missing: 4,
      latestGeneratedAt: '2026-06-05T10:00:00.000Z',
      artifacts: [
        {
          artifactName: 'SPARK.md',
          freshness: 'fresh',
          renderedAt: '2026-06-05T10:00:00.000Z',
          generatedAt: '2026-06-05T09:59:00.000Z',
          contentHash: 'sha256:spark123',
          sourceProject: 'Spark Brain',
          staleReason: null,
          markdownContent: '# Spark Brain\n\nGenerated operating view.',
        },
        {
          artifactName: 'USER.md',
          freshness: 'stale',
          renderedAt: '2026-06-05T09:00:00.000Z',
          generatedAt: '2026-06-05T08:59:00.000Z',
          contentHash: 'sha256:user456',
          sourceProject: 'Spark Brain',
          staleReason: 'User preference memory changed.',
          markdownContent: '## User\n\nPreference summary.',
        },
      ],
    },
    ledgerSuggestions: {
      total: 0,
      pending: 0,
      approved: 0,
      rejected: 0,
      deferred: 0,
      superseded: 0,
    },
    counts: {
      skills: 0,
      enabledSkills: 0,
      installedPacks: 0,
      pendingApprovals: 0,
      brainArtifacts: 2,
      staleBrainArtifacts: 1,
      ledgerSuggestions: 0,
      pendingLedgerSuggestions: 0,
    },
  };
}
