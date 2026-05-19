import { describe, expect, it } from 'vitest';

import {
  buildGraphFocusState,
  createSeededGraphNodes,
  getGraphNodeVisual,
  getOpenableMemoryId,
} from './memory-graph-model.js';
import type { RelationshipGraphPreview } from './cockpit-metrics.js';

const graph: RelationshipGraphPreview = {
  nodes: [
    { id: 'project:the-vault', label: 'the-vault', kind: 'project', group: 'the-vault' },
    { id: 'vm_a', label: 'Decision A', kind: 'memory', group: 'the-vault', memoryType: 'decision' },
    { id: 'memory:vm_b', label: 'vm_b', kind: 'memory', group: 'the-vault' },
    { id: 'file:packages/desktop/src/App.tsx', label: 'App.tsx', kind: 'file', group: 'the-vault' },
  ],
  links: [
    { source: 'project:the-vault', target: 'vm_a', kind: 'project' },
    { source: 'vm_a', target: 'memory:vm_b', kind: 'related-memory' },
    { source: 'vm_a', target: 'file:packages/desktop/src/App.tsx', kind: 'related-file' },
  ],
  typeCounts: [{ type: 'decision', count: 1 }],
  linkedMemoryCount: 1,
  linkedFileCount: 1,
};

describe('memory graph model', () => {
  it('maps visible memory nodes to openable memory UIDs', () => {
    expect(getOpenableMemoryId(graph.nodes[1])).toBe('vm_a');
    expect(getOpenableMemoryId(graph.nodes[2])).toBe('vm_b');
    expect(getOpenableMemoryId(graph.nodes[0])).toBeNull();
    expect(getOpenableMemoryId(graph.nodes[3])).toBeNull();
  });

  it('builds a focus state for the selected node and its direct neighbors', () => {
    const focus = buildGraphFocusState(graph, 'vm_a');

    expect(Array.from(focus.focusedNodeIds).sort()).toEqual([
      'file:packages/desktop/src/App.tsx',
      'memory:vm_b',
      'project:the-vault',
      'vm_a',
    ]);
    expect(focus.focusedLinkKeys.has('project:the-vault->vm_a')).toBe(true);
    expect(focus.focusedLinkKeys.has('vm_a->memory:vm_b')).toBe(true);
  });

  it('creates deterministic seeded positions with project hubs near the center', () => {
    const first = createSeededGraphNodes(graph, 800, 520);
    const second = createSeededGraphNodes(graph, 800, 520);
    const project = first.find((node) => node.id === 'project:the-vault');
    const memory = first.find((node) => node.id === 'vm_a');

    expect(first.map(({ id, x, y }) => ({ id, x, y }))).toEqual(second.map(({ id, x, y }) => ({ id, x, y })));
    expect(project).toMatchObject({ x: 400, y: 260, radius: 10 });
    expect(memory?.radius).toBeGreaterThan(5);
  });

  it('assigns distinct visual shapes and tones by graph node role', () => {
    expect(getGraphNodeVisual(graph.nodes[0])).toMatchObject({
      shape: 'hexagon',
      tone: 'project',
      labelPriority: 'always',
    });
    expect(getGraphNodeVisual(graph.nodes[1])).toMatchObject({
      shape: 'diamond',
      tone: 'decision',
      labelPriority: 'focus',
    });
    expect(getGraphNodeVisual(graph.nodes[3])).toMatchObject({
      shape: 'document',
      tone: 'file',
      labelPriority: 'focus',
    });
  });
});
