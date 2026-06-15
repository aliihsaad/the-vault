import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { WorkBoard } from './WorkBoard.js';
import type { VaultCollabWorkColumn } from '../../vault-collab-view-model.js';

function render(element: React.ReactElement): string {
  return renderToStaticMarkup(element);
}

describe('WorkBoard', () => {
  it('renders subtle source-project accent styling on handoff cards', () => {
    const columns = [
      {
        state: 'available',
        label: 'Available',
        cards: [
          {
            uid: 'vc_handoff_project_accent_1234567890',
            shortUid: 'vc_handoff...',
            title: 'Project accent work',
            prompt: 'Add source project accent.',
            promptPreview: 'Add source project accent.',
            statusLabel: 'available',
            badgeClass: 'badge-task-pending',
            railClass: 'queue-status-rail-pending',
            priorityLabel: 'normal',
            routeLabel: 'Vault Collab -> the-vault',
            routeHintLabel: null,
            suggestedRoleProfileId: null,
            queueLabel: 'dashboard #1',
            ownerLabel: 'unclaimed',
            dependencyLabel: null,
            ageLabel: 'just now',
            visibleLabels: [],
            extraLabel: null,
            threadLabel: null,
            attention: false,
            urgent: false,
            state: 'available',
            sourceProjectLabel: 'Vault Collab',
            sourceProjectSlug: 'vault-collab',
            projectAccentColor: '#8fb3a6',
            projectAccentSoftColor: 'rgba(143, 179, 166, 0.16)',
          },
        ],
      },
    ] as unknown as VaultCollabWorkColumn[];

    const html = render(React.createElement(WorkBoard, {
      columns,
      selectedHandoffUid: null,
      selectedHandoff: null,
      conversation: [],
      discussionDraft: '',
      discussionDisabled: false,
      onSelectHandoff: () => undefined,
      onCloseHandoff: () => undefined,
      onDiscussionDraftChange: () => undefined,
      onDiscussionSubmit: () => undefined,
    }));

    expect(html).toContain('--vault-collab-project-accent:#8fb3a6');
    expect(html).toContain('--vault-collab-project-accent-soft:rgba(143, 179, 166, 0.16)');
    expect(html).toContain('vault-collab-project-pill');
    expect(html).toContain('Vault Collab');
  });
});
