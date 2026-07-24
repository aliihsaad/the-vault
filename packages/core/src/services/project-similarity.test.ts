import { describe, expect, it } from 'vitest';

import {
  scoreProjectSimilarity,
  type ProjectSimilarityDocument,
  type ProjectSimilarityMemory,
} from './project-similarity.js';

function memory(
  itemUid: string,
  title: string,
  summary: string,
  relatedFiles: string[] = [],
): ProjectSimilarityMemory {
  return {
    itemUid,
    title,
    subject: title,
    summary,
    keywords: ['ordering', 'restaurant'],
    tags: ['supabase', 'menu'],
    relatedFiles,
    memoryType: 'summary',
    promoted: false,
    updatedAt: '2026-07-24T00:00:00.000Z',
  };
}

function project(overrides: Partial<ProjectSimilarityDocument>): ProjectSimilarityDocument {
  return {
    name: 'Project',
    description: null,
    projectType: 'work_project',
    canonicalRoot: null,
    repositoryUrl: null,
    memories: [],
    ...overrides,
  };
}

describe('scoreProjectSimilarity', () => {
  it('detects an established project stored under unrelated names from semantic and file evidence', () => {
    const sharedFiles = [
      'C:/repo/dining/src/order-router.ts',
      'C:/repo/dining/src/menu-service.ts',
    ];
    const left = project({
      name: 'Talabie AI Waiter',
      description: 'Voice-driven restaurant ordering and menu management with Supabase.',
      memories: [
        memory('left-1', 'Table order routing', 'Routes restaurant table orders through the AI waiter.', sharedFiles),
        memory('left-2', 'Menu availability sync', 'Synchronizes menu availability and prices with Supabase.', sharedFiles),
        memory('left-3', 'Kitchen ticket flow', 'Sends confirmed dining orders to the kitchen queue.', sharedFiles),
        memory('left-4', 'Voice waiter intent', 'Maps guest speech to menu items and restaurant actions.', sharedFiles),
      ],
    });
    const right = project({
      name: 'Dining Concierge Console',
      description: 'Restaurant voice assistant for menu selection, table orders, and kitchen tickets.',
      memories: [
        memory('right-1', 'Guest order pipeline', 'Routes voice menu selections into restaurant table orders.', sharedFiles),
        memory('right-2', 'Supabase menu catalog', 'Keeps menu prices and availability synchronized in Supabase.', sharedFiles),
        memory('right-3', 'Kitchen queue delivery', 'Delivers confirmed waiter orders to the kitchen ticket queue.', sharedFiles),
        memory('right-4', 'Dining intent parser', 'Maps guest speech into menu item and restaurant commands.', sharedFiles),
        memory('right-5', 'Table session state', 'Tracks active dining table sessions for the voice waiter.', sharedFiles),
      ],
    });

    const result = scoreProjectSimilarity(left, right, 2);

    expect(result.isCandidate).toBe(true);
    expect(result.confidence).toBeGreaterThanOrEqual(80);
    expect(result.signals.join(' ')).toContain('memory-topic overlap');
    expect(result.signals.join(' ')).toContain('shared file evidence');
    expect(result.evidenceItemUids).toHaveLength(4);
  });

  it('preserves typo and naming-variant detection for a small project', () => {
    const result = scoreProjectSimilarity(
      project({ name: 'Whisphry', memories: [memory('left', 'Desktop shell', 'Voice desktop shell.')] }),
      project({ name: 'Whisphr', memories: [] }),
      2,
    );

    expect(result.isCandidate).toBe(true);
    expect(result.signals.join(' ')).toContain('name similarity');
  });

  it('does not confuse different owners or agent contexts that share a generic project suffix', () => {
    const portfolioResult = scoreProjectSimilarity(
      project({ name: 'Ali Saad Portfolio' }),
      project({ name: 'Mariam Saad Portfolio' }),
      2,
    );
    const brainResult = scoreProjectSimilarity(
      project({ name: 'claude-code-brain', projectType: 'brain_context' }),
      project({ name: 'claude-desktop-brain', projectType: 'brain_context' }),
      2,
    );

    expect(portfolioResult.isCandidate).toBe(false);
    expect(brainResult.isCandidate).toBe(false);
  });

  it('never proposes a Brain and Work project as duplicates', () => {
    const memories = [memory('shared', 'Aura runtime', 'Aura realtime companion memory and desktop runtime.')];
    const result = scoreProjectSimilarity(
      project({ name: 'Aura-Brain', projectType: 'brain_context', memories }),
      project({ name: 'Aura desktop', projectType: 'work_project', memories }),
      2,
    );

    expect(result).toMatchObject({ isCandidate: false, confidence: 0 });
    expect(result.signals).toEqual(['declared project types differ']);
  });

  it('does not flag unrelated projects with generic engineering language', () => {
    const result = scoreProjectSimilarity(
      project({
        name: 'Portfolio',
        description: 'Personal portfolio website with animated case studies.',
        memories: [memory('portfolio', 'Motion system', 'Implements portfolio page transitions and case study animations.')],
      }),
      project({
        name: 'Camera Bridge',
        description: 'PTZ camera control bridge for pan, tilt, and talkback.',
        memories: [memory('camera', 'Camera commands', 'Implements PTZ camera pan tilt commands and audio talkback.')],
      }),
      2,
    );

    expect(result.isCandidate).toBe(false);
  });
});
