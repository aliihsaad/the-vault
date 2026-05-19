import type {
  RelationshipGraphLink,
  RelationshipGraphNode,
  RelationshipGraphPreview,
} from './cockpit-metrics.js';

export type SeededGraphNode = RelationshipGraphNode & {
  x: number;
  y: number;
  radius: number;
  openableMemoryId: string | null;
  visual: GraphNodeVisual;
};

export type GraphFocusState = {
  activeNodeId: string | null;
  focusedNodeIds: Set<string>;
  focusedLinkKeys: Set<string>;
};

export type GraphNodeShape = 'circle' | 'diamond' | 'document' | 'hexagon' | 'square' | 'triangle';

export type GraphNodeVisual = {
  shape: GraphNodeShape;
  tone: 'project' | 'file' | VaultMemoryType | 'memory';
  labelPriority: 'always' | 'focus';
};

export function getOpenableMemoryId(node: RelationshipGraphNode): string | null {
  if (node.kind !== 'memory') {
    return null;
  }

  const memoryId = node.id.startsWith('memory:') ? node.id.slice('memory:'.length) : node.id;
  return memoryId.trim() ? memoryId : null;
}

export function getGraphNodeVisual(node: RelationshipGraphNode): GraphNodeVisual {
  if (node.kind === 'project') {
    return { shape: 'hexagon', tone: 'project', labelPriority: 'always' };
  }

  if (node.kind === 'file') {
    return { shape: 'document', tone: 'file', labelPriority: 'focus' };
  }

  switch (node.memoryType) {
    case 'decision':
      return { shape: 'diamond', tone: 'decision', labelPriority: 'focus' };
    case 'handoff':
      return { shape: 'square', tone: 'handoff', labelPriority: 'focus' };
    case 'plan':
      return { shape: 'triangle', tone: 'plan', labelPriority: 'focus' };
    case 'artifact':
      return { shape: 'square', tone: 'artifact', labelPriority: 'focus' };
    case 'summary':
      return { shape: 'circle', tone: 'summary', labelPriority: 'focus' };
    case 'reference':
      return { shape: 'diamond', tone: 'reference', labelPriority: 'focus' };
    case 'session':
      return { shape: 'circle', tone: 'session', labelPriority: 'focus' };
    default:
      return { shape: 'circle', tone: 'memory', labelPriority: 'focus' };
  }
}

export function buildGraphFocusState(
  graph: RelationshipGraphPreview,
  activeNodeId: string | null,
): GraphFocusState {
  const focusedNodeIds = new Set<string>();
  const focusedLinkKeys = new Set<string>();

  if (!activeNodeId) {
    return { activeNodeId, focusedNodeIds, focusedLinkKeys };
  }

  focusedNodeIds.add(activeNodeId);

  for (const link of graph.links) {
    if (link.source !== activeNodeId && link.target !== activeNodeId) {
      continue;
    }

    focusedNodeIds.add(link.source);
    focusedNodeIds.add(link.target);
    focusedLinkKeys.add(graphLinkKey(link));
  }

  return { activeNodeId, focusedNodeIds, focusedLinkKeys };
}

export function createSeededGraphNodes(
  graph: RelationshipGraphPreview,
  width: number,
  height: number,
): SeededGraphNode[] {
  const centerX = width / 2;
  const centerY = height / 2;
  const byKind = {
    project: graph.nodes.filter((node) => node.kind === 'project'),
    memory: graph.nodes.filter((node) => node.kind === 'memory'),
    file: graph.nodes.filter((node) => node.kind === 'file'),
  };

  const kindCounts = {
    project: Math.max(byKind.project.length, 1),
    memory: Math.max(byKind.memory.length, 1),
    file: Math.max(byKind.file.length, 1),
  };

  const kindIndexes = new Map<string, number>();

  return graph.nodes.map((node) => {
    const kindIndex = kindIndexes.get(node.kind) || 0;
    kindIndexes.set(node.kind, kindIndex + 1);

    const count = kindCounts[node.kind];
    const radius = graphNodeRadius(node);
    const orbit = graphNodeOrbit(node, width, height, count);
    const angle = graphNodeAngle(node, kindIndex, count);

    return {
      ...node,
      x: roundPoint(centerX + Math.cos(angle) * orbit),
      y: roundPoint(centerY + Math.sin(angle) * orbit),
      radius,
      openableMemoryId: getOpenableMemoryId(node),
      visual: getGraphNodeVisual(node),
    };
  });
}

export function graphLinkKey(link: RelationshipGraphLink): string {
  return `${link.source}->${link.target}`;
}

function graphNodeRadius(node: RelationshipGraphNode): number {
  if (node.kind === 'project') {
    return 10;
  }

  if (node.kind === 'file') {
    return 6;
  }

  if (node.memoryType === 'decision' || node.memoryType === 'handoff') {
    return 8;
  }

  return 7;
}

function graphNodeOrbit(
  node: RelationshipGraphNode,
  width: number,
  height: number,
  count: number,
): number {
  const minDimension = Math.min(width, height);

  if (node.kind === 'project') {
    return count === 1 ? 0 : minDimension * 0.12;
  }

  if (node.kind === 'file') {
    return minDimension * 0.38;
  }

  return minDimension * 0.26;
}

function graphNodeAngle(node: RelationshipGraphNode, index: number, count: number): number {
  if (node.kind === 'project' && count === 1) {
    return 0;
  }

  const baseAngle = (Math.PI * 2 * index) / Math.max(count, 1) - Math.PI / 2;
  const groupOffset = ((hashString(node.group) % 17) - 8) * 0.018;
  const kindOffset = node.kind === 'file' ? Math.PI / Math.max(count, 4) : 0;
  return baseAngle + groupOffset + kindOffset;
}

function hashString(value: string): number {
  let hash = 0;
  for (let index = 0; index < value.length; index += 1) {
    hash = ((hash << 5) - hash + value.charCodeAt(index)) | 0;
  }
  return Math.abs(hash);
}

function roundPoint(value: number): number {
  return Math.round(value * 10) / 10;
}
