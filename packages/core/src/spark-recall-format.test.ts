import { describe, expect, it } from 'vitest';
import {
  formatSparkRecall,
  pickDominantProject,
  type SparkRecallGraphView,
  type SparkRecallPackView,
} from './services/spark-voice/spark-recall-format.js';

function pack(items: SparkRecallPackView['topMatches'], contextSummary?: string): SparkRecallPackView {
  return { topMatches: items, contextSummary };
}

describe('formatSparkRecall', () => {
  it('renders a project-labeled, ranked list from the cross-project recall', () => {
    const out = formatSparkRecall(
      pack([
        { item: { project: 'vault-spark', title: 'Realtime pipeline', summary: 'voice works' } },
        { item: { project: 'the-vault', subject: 'recall', summary: 'ranking engine' } },
      ]),
    );
    expect(out).toContain('- [vault-spark] Realtime pipeline: voice works');
    // falls back to subject when there is no title
    expect(out).toContain('- [the-vault] recall: ranking engine');
  });

  it('falls back to the context summary when there are no matches', () => {
    expect(formatSparkRecall(pack([], 'High-level summary of everything'))).toBe(
      'High-level summary of everything',
    );
  });

  it('returns null when there is nothing to say', () => {
    expect(formatSparkRecall(pack([]))).toBeNull();
    expect(formatSparkRecall(null)).toBeNull();
  });

  it('appends a graph-context section for the dominant project when the graph is used', () => {
    const graph: SparkRecallGraphView = {
      used: true,
      project: 'the-vault',
      centralNodes: [
        { label: 'Vault.recallContext', summary: 'ranked recall' },
        { label: 'RankingService', summary: null },
      ],
      likelyRelevantFiles: [
        { path: 'packages/core/src/services/ranking.service.ts', reason: 'central' },
      ],
      reportSnippets: [{ heading: 'Recall', text: 'how recall scores' }],
    };
    const out = formatSparkRecall(
      pack([{ item: { project: 'the-vault', title: 'Recall', summary: 'ranked recall' } }]),
      graph,
    );
    expect(out).toContain('Graph context (the-vault):');
    expect(out).toContain('Vault.recallContext: ranked recall');
    expect(out).toContain('RankingService'); // node with no summary still listed
    expect(out).toContain('packages/core/src/services/ranking.service.ts (central)');
    expect(out).toContain('Recall'); // report snippet heading
  });

  it('omits the graph section when the graph is not used', () => {
    const graph: SparkRecallGraphView = {
      used: false,
      project: 'the-vault',
      centralNodes: [],
      likelyRelevantFiles: [],
      reportSnippets: [],
    };
    const out = formatSparkRecall(
      pack([{ item: { project: 'the-vault', title: 'Recall', summary: 'x' } }]),
      graph,
    );
    expect(out).not.toContain('Graph context');
  });
});

describe('pickDominantProject', () => {
  it('returns the most frequent project among the top matches', () => {
    const dominant = pickDominantProject(
      pack([
        { item: { project: 'the-vault', title: 'a', summary: '' } },
        { item: { project: 'vault-spark', title: 'b', summary: '' } },
        { item: { project: 'the-vault', title: 'c', summary: '' } },
      ]),
    );
    expect(dominant).toBe('the-vault');
  });

  it('breaks ties by rank (the higher-ranked project wins)', () => {
    const dominant = pickDominantProject(
      pack([
        { item: { project: 'vault-spark', title: 'a', summary: '' } },
        { item: { project: 'the-vault', title: 'b', summary: '' } },
      ]),
    );
    expect(dominant).toBe('vault-spark');
  });

  it('returns null when no match carries a project', () => {
    expect(pickDominantProject(pack([{ item: { title: 'a', summary: '' } }]))).toBeNull();
    expect(pickDominantProject(null)).toBeNull();
  });
});
