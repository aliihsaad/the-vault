import { describe, expect, it } from 'vitest';

import {
  buildPendingDeleteReviewQuery,
  describeProjectReviewResult,
} from './agent-review-query.js';

describe('agent review queries', () => {
  it('keeps the pending-delete memory query within the strict findMemory limit', () => {
    expect(buildPendingDeleteReviewQuery()).toEqual({
      status: 'pending_delete',
      limit: 100,
    });
  });

  it('describes project review outcomes in operator-facing language', () => {
    expect(describeProjectReviewResult({
      project: 'the-vault',
      skipped: false,
      proposalsCreated: [{ proposalUid: 'vp_1' } as VaultProjectProposal],
      candidatesEvaluated: 2,
      reviewedAt: '2026-05-05T16:00:00.000Z',
    })).toBe('Created 1 proposal for the-vault after checking 2 candidates.');

    expect(describeProjectReviewResult({
      project: 'the-vault',
      skipped: true,
      skipReason: 'cooldown',
      proposalsCreated: [],
      candidatesEvaluated: 0,
      reviewedAt: '2026-05-05T16:00:00.000Z',
    })).toBe('Skipped the-vault because it was reviewed recently.');

    expect(describeProjectReviewResult({
      project: 'the-vault',
      skipped: false,
      proposalsCreated: [],
      candidatesEvaluated: 0,
      reviewedAt: '2026-05-05T16:00:00.000Z',
    })).toBe('Reviewed the-vault. No new review actions were found.');
  });
});
