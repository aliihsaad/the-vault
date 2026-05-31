// ============================================================================
// Vault — Ranking Service
// Deterministic scoring and ranking of memory candidates for recall.
// ============================================================================

import type { MemoryItem, RankedCandidate, RecallQuery } from '../types/index.js';
import {
  MEMORY_TYPE_PRIORITY,
  PRIORITY_BOOST,
  type MemoryType,
  type PriorityValue,
} from '../rules/controlled-values.js';
import { isWithinDays } from '../utils/datetime.js';
import { extractMemoryUidTokens } from '../utils/memory-uid.js';

// ---------------------------------------------------------------------------
// Scoring weights
// ---------------------------------------------------------------------------
const WEIGHTS = {
  MEMORY_UID_EXACT: 120,
  PROJECT_EXACT: 50,
  TITLE_EXACT: 32,
  TITLE_PARTIAL: 18,
  SUBJECT_EXACT: 40,
  SUBJECT_PARTIAL: 20,
  KEYWORD_MATCH: 10,    // per keyword
  TAG_MATCH: 8,          // per tag
  PROMOTED: 42,
  DECISION_PROMOTED: 14,
  CANONICAL_PROMOTED: 18,
  RECENCY_7_DAYS: 15,
  RECENCY_30_DAYS: 8,
  ARCHIVED_PENALTY: -20,
  HIGH_ACCESS: 5,        // access_count > 5
  QUERY_TEXT_SUBJECT: 25,
  QUERY_TEXT_TITLE: 20,
  QUERY_TEXT_SUMMARY: 15,
  QUERY_TEXT_TAG: 10,
  QUERY_TEXT_KEYWORD: 10,
  QUERY_TEXT_WORD_SUBJECT: 10,
  QUERY_TEXT_WORD_TITLE: 10,
  QUERY_TEXT_WORD_SUMMARY: 6,
};

/**
 * Score and rank a list of memory candidates against a recall query.
 * Returns sorted candidates with scores and signal breakdowns.
 */
export function rankCandidates(
  candidates: MemoryItem[],
  query: RecallQuery,
): RankedCandidate[] {
  const ranked = candidates.map((item) => scoreCandidate(item, query));

  // Sort by score descending
  ranked.sort((a, b) => b.score - a.score);

  return ranked;
}

/**
 * Score a single candidate against a recall query.
 */
function scoreCandidate(item: MemoryItem, query: RecallQuery): RankedCandidate {
  const signals: Record<string, number> = {};
  let score = 0;
  const requestedMemoryUids = extractMemoryUidTokens(query.queryText, query.subject, query.keywords, query.tags)
    .map((uid) => uid.toLowerCase());
  const itemUid = item.itemUid.toLowerCase();

  if (requestedMemoryUids.includes(itemUid)) {
    signals.memoryUidExact = WEIGHTS.MEMORY_UID_EXACT;
    score += WEIGHTS.MEMORY_UID_EXACT;
  }

  // 1. Project exact match
  if (query.project && item.project.toLowerCase() === query.project.toLowerCase()) {
    signals.projectMatch = WEIGHTS.PROJECT_EXACT;
    score += WEIGHTS.PROJECT_EXACT;
  }

  // 2. Subject matching
  if (query.subject) {
    const qSubject = query.subject.toLowerCase();
    const iTitle = item.title.toLowerCase();

    if (iTitle === qSubject) {
      signals.titleExact = WEIGHTS.TITLE_EXACT;
      score += WEIGHTS.TITLE_EXACT;
    } else if (iTitle.includes(qSubject) || qSubject.includes(iTitle)) {
      signals.titlePartial = WEIGHTS.TITLE_PARTIAL;
      score += WEIGHTS.TITLE_PARTIAL;
    }
  }

  // 3. Subject matching
  if (query.subject) {
    const qSubject = query.subject.toLowerCase();
    const iSubject = item.subject.toLowerCase();

    if (iSubject === qSubject) {
      signals.subjectExact = WEIGHTS.SUBJECT_EXACT;
      score += WEIGHTS.SUBJECT_EXACT;
    } else if (iSubject.includes(qSubject) || qSubject.includes(iSubject)) {
      signals.subjectPartial = WEIGHTS.SUBJECT_PARTIAL;
      score += WEIGHTS.SUBJECT_PARTIAL;
    }
  }

  // 4. Keyword overlap
  if (query.keywords && query.keywords.length > 0) {
    const itemKeywords = new Set(item.keywords.map((k) => k.toLowerCase()));
    let keywordHits = 0;
    for (const kw of query.keywords) {
      if (itemKeywords.has(kw.toLowerCase())) {
        keywordHits++;
      }
    }
    if (keywordHits > 0) {
      const boost = keywordHits * WEIGHTS.KEYWORD_MATCH;
      signals.keywordOverlap = boost;
      score += boost;
    }
  }

  // 5. Tag overlap
  if (query.tags && query.tags.length > 0) {
    const itemTags = new Set(item.tags.map((t) => t.toLowerCase()));
    let tagHits = 0;
    for (const tag of query.tags) {
      if (itemTags.has(tag.toLowerCase())) {
        tagHits++;
      }
    }
    if (tagHits > 0) {
      const boost = tagHits * WEIGHTS.TAG_MATCH;
      signals.tagOverlap = boost;
      score += boost;
    }
  }

  // 6. Promoted/canonical
  if (item.promoted) {
    signals.promoted = WEIGHTS.PROMOTED;
    score += WEIGHTS.PROMOTED;

    if (item.memoryType === 'decision') {
      signals.promotedDecision = WEIGHTS.DECISION_PROMOTED;
      score += WEIGHTS.DECISION_PROMOTED;
    }

    if (item.priority === 'canonical') {
      signals.canonicalPromoted = WEIGHTS.CANONICAL_PROMOTED;
      score += WEIGHTS.CANONICAL_PROMOTED;
    }
  }

  // 7. Memory type priority
  const typePriority = MEMORY_TYPE_PRIORITY[item.memoryType as MemoryType] || 0;
  if (typePriority > 0) {
    signals.typePriority = typePriority;
    score += typePriority;
  }

  // 8. Priority level
  const priorityBoost = PRIORITY_BOOST[item.priority as PriorityValue] || 0;
  if (priorityBoost !== 0) {
    signals.priorityBoost = priorityBoost;
    score += priorityBoost;
  }

  // 9. Recency
  if (isWithinDays(item.createdAt, 7)) {
    signals.recency7d = WEIGHTS.RECENCY_7_DAYS;
    score += WEIGHTS.RECENCY_7_DAYS;
  } else if (isWithinDays(item.createdAt, 30)) {
    signals.recency30d = WEIGHTS.RECENCY_30_DAYS;
    score += WEIGHTS.RECENCY_30_DAYS;
  }

  // 10. Archived penalty
  if (item.status === 'archived') {
    signals.archivedPenalty = WEIGHTS.ARCHIVED_PENALTY;
    score += WEIGHTS.ARCHIVED_PENALTY;
  }

  // 11. High access count
  if (item.accessCount > 5) {
    signals.highAccess = WEIGHTS.HIGH_ACCESS;
    score += WEIGHTS.HIGH_ACCESS;
  }

  // 12. Query text matching (text search against title, subject, summary, keywords, tags)
  if (query.queryText) {
    const qt = query.queryText.toLowerCase();
    const words = [...new Set(qt.split(/\s+/).filter((w) => w.length > 2))];
    const loweredTitle = item.title.toLowerCase();
    const loweredSubject = item.subject.toLowerCase();
    const loweredSummary = item.summary.toLowerCase();
    const loweredTags = item.tags.map((t) => t.toLowerCase());

    if (loweredTitle.includes(qt)) {
      signals.queryTextTitle = WEIGHTS.QUERY_TEXT_TITLE;
      score += WEIGHTS.QUERY_TEXT_TITLE;
    }

    // Check subject
    if (loweredSubject.includes(qt)) {
      signals.queryTextSubject = WEIGHTS.QUERY_TEXT_SUBJECT;
      score += WEIGHTS.QUERY_TEXT_SUBJECT;
    }

    // Check summary
    if (loweredSummary.includes(qt)) {
      signals.queryTextSummary = WEIGHTS.QUERY_TEXT_SUMMARY;
      score += WEIGHTS.QUERY_TEXT_SUMMARY;
    }

    if (words.some((word) => loweredTags.some((tag) => tag.includes(word)))) {
      signals.queryTextTag = WEIGHTS.QUERY_TEXT_TAG;
      score += WEIGHTS.QUERY_TEXT_TAG;
    }

    // Check keywords for individual word matches
    const itemKeywords = item.keywords.map((k) => k.toLowerCase());
    for (const word of words) {
      if (itemKeywords.some((k) => k.includes(word))) {
        signals.queryTextKeyword = (signals.queryTextKeyword || 0) + WEIGHTS.QUERY_TEXT_KEYWORD;
        score += WEIGHTS.QUERY_TEXT_KEYWORD;
        break;
      }
    }

    const subjectWordHits = words.filter((word) => loweredSubject.includes(word)).length;
    if (subjectWordHits > 0) {
      const boost = Math.min(subjectWordHits * WEIGHTS.QUERY_TEXT_WORD_SUBJECT, 20);
      signals.queryTextWordSubject = boost;
      score += boost;
    }

    const titleWordHits = words.filter((word) => loweredTitle.includes(word)).length;
    if (titleWordHits > 0) {
      const boost = Math.min(titleWordHits * WEIGHTS.QUERY_TEXT_WORD_TITLE, 20);
      signals.queryTextWordTitle = boost;
      score += boost;
    }

    const summaryWordHits = words.filter((word) => loweredSummary.includes(word)).length;
    if (summaryWordHits > 0) {
      const boost = Math.min(summaryWordHits * WEIGHTS.QUERY_TEXT_WORD_SUMMARY, 18);
      signals.queryTextWordSummary = boost;
      score += boost;
    }
  }

  return { item, score, signals };
}
