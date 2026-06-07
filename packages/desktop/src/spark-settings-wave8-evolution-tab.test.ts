import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { EvolutionTab } from './components/spark/EvolutionTab.js';
import type { SparkEvolutionModel } from './spark-settings-view-model.js';

function render(element: React.ReactElement): string {
  return renderToStaticMarkup(element);
}

describe('Spark settings Wave 8 Evolution tab', () => {
  it('renders Self Evolution suggestions with type, description, confidence, and actions', () => {
    const html = render(React.createElement(EvolutionTab, {
      model: evolutionModel(),
      actionPendingSuggestionId: null,
      onApproveSuggestion: () => undefined,
      onRejectSuggestion: () => undefined,
    }));

    expect(html).toContain('Self Evolution suggestions');
    expect(html).toContain('2 pending Self Evolution suggestions / 1 high confidence');
    expect(html).toContain('New skill');
    expect(html).toContain('Promote repeated release handoff cleanup into a reusable Spark skill.');
    expect(html).toContain('High confidence');
    expect(html).toContain('High confidence suggestion');
    expect(html).toContain('Missing API');
    expect(html).toContain('Add a bounded provider API handoff for realtime diagnostics.');
    expect(html).toContain('Medium confidence');
    expect(html).toContain('Approve');
    expect(html).toContain('Reject');

    expect(html).not.toContain('Brain artifacts');
    expect(html).not.toContain('Skill Creator approvals');
  });

  it('renders an empty state when no suggestions are pending', () => {
    const html = render(React.createElement(EvolutionTab, {
      model: {
        summaryLabel: '0 pending Self Evolution suggestions / 0 high confidence',
        emptyLabel: 'No pending Self Evolution suggestions.',
        rows: [],
      },
      actionPendingSuggestionId: null,
      onApproveSuggestion: () => undefined,
      onRejectSuggestion: () => undefined,
    }));

    expect(html).toContain('Self Evolution suggestions');
    expect(html).toContain('No pending Self Evolution suggestions.');
    expect(html).not.toContain('Approve');
    expect(html).not.toContain('Reject');
  });
});

function evolutionModel(): SparkEvolutionModel {
  return {
    summaryLabel: '2 pending Self Evolution suggestions / 1 high confidence',
    emptyLabel: 'No pending Self Evolution suggestions.',
    rows: [
      {
        suggestionId: 'suggestion-skill',
        typeLabel: 'New skill',
        description: 'Promote repeated release handoff cleanup into a reusable Spark skill.',
        confidenceLevel: 'high',
        confidenceLabel: 'High confidence',
        confidenceClassName: 'spark-evolution-confidence-high',
        highConfidence: true,
        approveAction: {
          type: 'approve-suggestion',
          suggestionId: 'suggestion-skill',
          routeTarget: 'skill-creator',
        },
        rejectAction: {
          type: 'reject-suggestion',
          suggestionId: 'suggestion-skill',
          reason: 'Rejected from Spark settings evolution suggestions.',
        },
      },
      {
        suggestionId: 'suggestion-api',
        typeLabel: 'Missing API',
        description: 'Add a bounded provider API handoff for realtime diagnostics.',
        confidenceLevel: 'medium',
        confidenceLabel: 'Medium confidence',
        confidenceClassName: 'spark-evolution-confidence-medium',
        highConfidence: false,
        approveAction: {
          type: 'approve-suggestion',
          suggestionId: 'suggestion-api',
          routeTarget: 'provider-config',
        },
        rejectAction: {
          type: 'reject-suggestion',
          suggestionId: 'suggestion-api',
          reason: 'Rejected from Spark settings evolution suggestions.',
        },
      },
    ],
  };
}
