export const PENDING_DELETE_REVIEW_LIMIT = 100;

export function buildPendingDeleteReviewQuery() {
  return {
    status: 'pending_delete' as const,
    limit: PENDING_DELETE_REVIEW_LIMIT,
  };
}

const PROJECT_REVIEW_SKIP_LABELS: Record<VaultProjectReviewSkipReason, string> = {
  disabled: 'the project review duty is disabled',
  cooldown: 'it was reviewed recently',
  project_not_found: 'the project could not be found',
  below_item_threshold: 'there is not enough project memory yet',
};

export function describeProjectReviewResult(result: VaultProjectReviewResult): string {
  if (result.skipped) {
    const reason = result.skipReason ? PROJECT_REVIEW_SKIP_LABELS[result.skipReason] : 'the review was skipped';
    return `Skipped ${result.project} because ${reason}.`;
  }

  const proposalCount = result.proposalsCreated.length;
  if (proposalCount > 0) {
    const proposalNoun = proposalCount === 1 ? 'proposal' : 'proposals';
    const candidateNoun = result.candidatesEvaluated === 1 ? 'candidate' : 'candidates';
    return `Created ${proposalCount} ${proposalNoun} for ${result.project} after checking ${result.candidatesEvaluated} ${candidateNoun}.`;
  }

  if (result.candidatesEvaluated > 0) {
    const candidateNoun = result.candidatesEvaluated === 1 ? 'candidate' : 'candidates';
    return `Reviewed ${result.project} and checked ${result.candidatesEvaluated} ${candidateNoun}. No new review actions were queued.`;
  }

  return `Reviewed ${result.project}. No new review actions were found.`;
}
