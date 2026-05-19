import { useEffect, useMemo, useRef, useState } from 'react';
import type { KeyboardEvent, PointerEvent, WheelEvent } from 'react';
import { Maximize2, Minus, Plus } from 'lucide-react';
import {
  forceCenter,
  forceCollide,
  forceLink,
  forceManyBody,
  forceSimulation,
  forceX,
  forceY,
  type SimulationLinkDatum,
  type SimulationNodeDatum,
} from 'd3-force';

import type {
  RelationshipGraphLink,
  RelationshipGraphNode,
  RelationshipGraphPreview,
} from '../cockpit-metrics.js';
import {
  buildGraphFocusState,
  createSeededGraphNodes,
  graphLinkKey,
  type SeededGraphNode,
} from '../memory-graph-model.js';

type MemoryGraphCanvasProps = {
  graph: RelationshipGraphPreview;
  variant?: 'compact' | 'full';
  onOpenMemory?: (itemUid: string) => void;
};

type GraphTransform = {
  x: number;
  y: number;
  k: number;
};

type ForceNode = SeededGraphNode & SimulationNodeDatum;

type ForceLink = RelationshipGraphLink & SimulationLinkDatum<ForceNode> & {
  key: string;
  sourceId: string;
  targetId: string;
};

type GraphLayout = {
  nodes: ForceNode[];
  links: ForceLink[];
};

type DragState =
  | {
      type: 'pan';
      pointerId: number;
      start: GraphPoint;
      origin: GraphTransform;
    }
  | {
      type: 'node';
      pointerId: number;
      nodeId: string;
      offset: GraphPoint;
    };

type GraphPoint = {
  x: number;
  y: number;
};

const GRAPH_DIMENSIONS = {
  compact: { width: 560, height: 330 },
  full: { width: 920, height: 580 },
};

const DEFAULT_TRANSFORM: GraphTransform = { x: 0, y: 0, k: 1 };
const MIN_ZOOM = 0.72;
const MAX_ZOOM = 2.25;

export function MemoryGraphCanvas({
  graph,
  variant = 'compact',
  onOpenMemory,
}: MemoryGraphCanvasProps) {
  const svgRef = useRef<SVGSVGElement | null>(null);
  const dragStateRef = useRef<DragState | null>(null);
  const [measuredDimensions, setMeasuredDimensions] = useState<{ width: number; height: number } | null>(null);
  const [hoveredNodeId, setHoveredNodeId] = useState<string | null>(null);
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [transform, setTransform] = useState<GraphTransform>(DEFAULT_TRANSFORM);
  const [manualPositions, setManualPositions] = useState<Record<string, GraphPoint>>({});
  const graphKey = useMemo(() => serializeGraph(graph), [graph]);
  const dimensions = measuredDimensions || GRAPH_DIMENSIONS[variant];

  useEffect(() => {
    setHoveredNodeId(null);
    setSelectedNodeId(null);
    setManualPositions({});
    setTransform(DEFAULT_TRANSFORM);
    setMeasuredDimensions(null);
  }, [graphKey, variant]);

  useEffect(() => {
    const svg = svgRef.current;
    if (!svg || typeof ResizeObserver === 'undefined') {
      return undefined;
    }

    const observer = new ResizeObserver(([entry]) => {
      const width = Math.round(entry.contentRect.width);
      const height = Math.round(entry.contentRect.height);

      if (width < 120 || height < 120) {
        return;
      }

      setMeasuredDimensions((current) => {
        if (current && Math.abs(current.width - width) < 4 && Math.abs(current.height - height) < 4) {
          return current;
        }

        return { width, height };
      });
    });

    observer.observe(svg);
    return () => observer.disconnect();
  }, [graphKey, variant]);

  const layout = useMemo(
    () => buildForceLayout(graph, dimensions.width, dimensions.height, variant),
    [graph, dimensions.height, dimensions.width, variant],
  );

  const displayNodes = useMemo(
    () => layout.nodes.map((node) => {
      const manual = manualPositions[node.id];
      return manual ? { ...node, x: manual.x, y: manual.y } : node;
    }),
    [layout.nodes, manualPositions],
  );

  const nodesById = useMemo(
    () => new Map(displayNodes.map((node) => [node.id, node])),
    [displayNodes],
  );

  const activeNodeId = hoveredNodeId || selectedNodeId;
  const focus = useMemo(() => buildGraphFocusState(graph, activeNodeId), [graph, activeNodeId]);
  const selectedNode = selectedNodeId ? nodesById.get(selectedNodeId) || null : null;

  function resetView() {
    setTransform(DEFAULT_TRANSFORM);
  }

  function zoomBy(factor: number) {
    setTransform((current) => zoomAroundPoint(current, {
      x: dimensions.width / 2,
      y: dimensions.height / 2,
    }, factor));
  }

  function openNode(node: ForceNode) {
    if (node.openableMemoryId) {
      onOpenMemory?.(node.openableMemoryId);
    }
  }

  function handleNodeKeyDown(event: KeyboardEvent<SVGGElement>, node: ForceNode) {
    if (event.key !== 'Enter' && event.key !== ' ') {
      return;
    }

    event.preventDefault();
    setSelectedNodeId(node.id);
    if (event.key === 'Enter') {
      openNode(node);
    }
  }

  function handleWheel(event: WheelEvent<SVGSVGElement>) {
    event.preventDefault();
    const rawPoint = clientPointToViewBox(event.clientX, event.clientY);
    if (!rawPoint) {
      return;
    }

    setTransform((current) => zoomAroundPoint(current, rawPoint, event.deltaY > 0 ? 0.9 : 1.1));
  }

  function handleSvgPointerDown(event: PointerEvent<SVGSVGElement>) {
    const start = clientPointToViewBox(event.clientX, event.clientY);
    if (!start) {
      return;
    }

    dragStateRef.current = {
      type: 'pan',
      pointerId: event.pointerId,
      start,
      origin: transform,
    };
    event.currentTarget.setPointerCapture(event.pointerId);
  }

  function handleNodePointerDown(event: PointerEvent<SVGGElement>, node: ForceNode) {
    event.stopPropagation();
    setSelectedNodeId(node.id);
    setHoveredNodeId(node.id);

    const point = clientPointToGraph(event.clientX, event.clientY);
    if (!point) {
      return;
    }

    dragStateRef.current = {
      type: 'node',
      pointerId: event.pointerId,
      nodeId: node.id,
      offset: {
        x: point.x - (node.x || 0),
        y: point.y - (node.y || 0),
      },
    };
    svgRef.current?.setPointerCapture(event.pointerId);
  }

  function handlePointerMove(event: PointerEvent<SVGSVGElement>) {
    const dragState = dragStateRef.current;
    if (!dragState || dragState.pointerId !== event.pointerId) {
      return;
    }

    if (dragState.type === 'pan') {
      const point = clientPointToViewBox(event.clientX, event.clientY);
      if (!point) {
        return;
      }

      setTransform({
        ...dragState.origin,
        x: dragState.origin.x + point.x - dragState.start.x,
        y: dragState.origin.y + point.y - dragState.start.y,
      });
      return;
    }

    const graphPoint = clientPointToGraph(event.clientX, event.clientY);
    if (!graphPoint) {
      return;
    }

    setManualPositions((current) => ({
      ...current,
      [dragState.nodeId]: {
        x: clamp(graphPoint.x - dragState.offset.x, 16, dimensions.width - 16),
        y: clamp(graphPoint.y - dragState.offset.y, 16, dimensions.height - 16),
      },
    }));
  }

  function handlePointerUp(event: PointerEvent<SVGSVGElement>) {
    if (dragStateRef.current?.pointerId === event.pointerId) {
      dragStateRef.current = null;
    }

    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
  }

  function clientPointToViewBox(clientX: number, clientY: number): GraphPoint | null {
    const svg = svgRef.current;
    const rect = svg?.getBoundingClientRect();
    if (!rect || rect.width === 0 || rect.height === 0) {
      return null;
    }

    return {
      x: ((clientX - rect.left) / rect.width) * dimensions.width,
      y: ((clientY - rect.top) / rect.height) * dimensions.height,
    };
  }

  function clientPointToGraph(clientX: number, clientY: number): GraphPoint | null {
    const point = clientPointToViewBox(clientX, clientY);
    if (!point) {
      return null;
    }

    return {
      x: (point.x - transform.x) / transform.k,
      y: (point.y - transform.y) / transform.k,
    };
  }

  if (graph.nodes.length === 0) {
    return <div className="empty-state">No relationship links or related files are present in the loaded memory set.</div>;
  }

  return (
    <div className={`memory-graph-canvas memory-graph-canvas-${variant}`}>
      <div className="memory-graph-toolbar" aria-label="Graph controls">
        <button type="button" className="icon-button" aria-label="Zoom out" onClick={() => zoomBy(0.86)}>
          <Minus size={14} />
        </button>
        <button type="button" className="icon-button" aria-label="Reset graph view" onClick={resetView}>
          <Maximize2 size={14} />
        </button>
        <button type="button" className="icon-button" aria-label="Zoom in" onClick={() => zoomBy(1.16)}>
          <Plus size={14} />
        </button>
      </div>

      <svg
        ref={svgRef}
        className="memory-graph-svg"
        viewBox={`0 0 ${dimensions.width} ${dimensions.height}`}
        role="img"
        aria-label="Vault relationship graph"
        onWheel={handleWheel}
        onPointerDown={handleSvgPointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerUp}
        onPointerLeave={() => setHoveredNodeId(null)}
      >
        <defs>
          <radialGradient id={`memoryGraphGlow-${variant}`} cx="50%" cy="50%" r="50%">
            <stop offset="0%" stopColor="rgba(56, 223, 255, 0.22)" />
            <stop offset="100%" stopColor="rgba(56, 223, 255, 0)" />
          </radialGradient>
        </defs>
        <rect className="memory-graph-backdrop" x="0" y="0" width={dimensions.width} height={dimensions.height} />
        <g transform={`translate(${transform.x} ${transform.y}) scale(${transform.k})`}>
          {layout.links.map((link) => {
            const source = nodesById.get(link.sourceId);
            const target = nodesById.get(link.targetId);
            if (!source || !target) {
              return null;
            }

            const isActive = focus.focusedLinkKeys.has(link.key);
            const isMuted = Boolean(focus.activeNodeId && !isActive);

            return (
              <line
                key={link.key}
                x1={source.x}
                y1={source.y}
                x2={target.x}
                y2={target.y}
                className={[
                  'memory-graph-link',
                  `memory-graph-link-${link.kind}`,
                  isActive ? 'is-active' : '',
                  isMuted ? 'is-muted' : '',
                ].filter(Boolean).join(' ')}
              />
            );
          })}

          {displayNodes.map((node) => {
            const degree = layout.links.filter((link) => link.sourceId === node.id || link.targetId === node.id).length;
            const isFocused = focus.focusedNodeIds.has(node.id);
            const isSelected = selectedNodeId === node.id;
            const isHovered = hoveredNodeId === node.id;
            const isMuted = Boolean(focus.activeNodeId && !isFocused);
            const showLabel = node.visual.labelPriority === 'always'
              || isSelected
              || isHovered
              || (variant === 'full' && degree > 1);

            return (
              <g
                key={node.id}
                role="button"
                tabIndex={0}
                aria-label={`${node.label} ${node.kind}`}
                className={[
                  'memory-graph-node',
                  `memory-graph-node-${node.kind}`,
                  `memory-graph-node-${node.memoryType || 'none'}`,
                  `memory-graph-node-shape-${node.visual.shape}`,
                  `memory-graph-node-tone-${node.visual.tone}`,
                  node.openableMemoryId ? 'is-openable' : '',
                  isSelected ? 'is-selected' : '',
                  isHovered ? 'is-hovered' : '',
                  isMuted ? 'is-muted' : '',
                ].filter(Boolean).join(' ')}
                transform={`translate(${node.x} ${node.y})`}
                onPointerDown={(event) => handleNodePointerDown(event, node)}
                onPointerEnter={() => setHoveredNodeId(node.id)}
                onPointerLeave={() => setHoveredNodeId(null)}
                onClick={() => setSelectedNodeId(node.id)}
                onDoubleClick={() => openNode(node)}
                onKeyDown={(event) => handleNodeKeyDown(event, node)}
              >
                <title>{node.label}</title>
                <circle className="memory-graph-node-aura" r={node.radius + 13} />
                {renderGraphNodeCore(node)}
                {showLabel ? (
                  <text className="memory-graph-node-label" y={node.radius + 15}>
                    {truncateLabel(node.label, variant === 'full' ? 22 : 14)}
                  </text>
                ) : null}
              </g>
            );
          })}
        </g>
      </svg>

      <div className="memory-graph-footer">
        <span>{graph.linkedMemoryCount} linked memories</span>
        <span>{graph.linkedFileCount} related files</span>
        {graph.typeCounts.slice(0, 4).map((entry) => (
          <span key={entry.type}>{entry.type} {entry.count}</span>
        ))}
      </div>

      {selectedNode ? (
        <div className="memory-graph-inspector">
          <div>
            <strong>{selectedNode.label}</strong>
            <span>{formatNodeKind(selectedNode)}</span>
          </div>
          {selectedNode.openableMemoryId ? (
            <button type="button" className="header-button header-button-compact" onClick={() => openNode(selectedNode)}>
              Open memory
            </button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

function renderGraphNodeCore(node: ForceNode) {
  const radius = node.radius;

  switch (node.visual.shape) {
    case 'hexagon':
      return (
        <polygon
          className="memory-graph-node-core"
          points={polygonPoints(radius * 1.08, 6)}
        />
      );
    case 'document':
      return (
        <g className="memory-graph-document-shape">
          <rect
            className="memory-graph-node-core"
            x={-radius * 0.82}
            y={-radius * 1.05}
            width={radius * 1.64}
            height={radius * 2.1}
            rx={2.4}
          />
          <path
            className="memory-graph-node-fold"
            d={`M ${radius * 0.22} ${-radius * 1.05} L ${radius * 0.82} ${-radius * 0.46} L ${radius * 0.82} ${-radius * 1.05} Z`}
          />
        </g>
      );
    case 'diamond':
      return <polygon className="memory-graph-node-core" points={`0,${-radius} ${radius},0 0,${radius} ${-radius},0`} />;
    case 'square':
      return (
        <rect
          className="memory-graph-node-core"
          x={-radius}
          y={-radius}
          width={radius * 2}
          height={radius * 2}
          rx={3}
        />
      );
    case 'triangle':
      return (
        <polygon
          className="memory-graph-node-core"
          points={`0,${-radius * 1.08} ${radius * 1.02},${radius * 0.86} ${-radius * 1.02},${radius * 0.86}`}
        />
      );
    case 'circle':
    default:
      return <circle className="memory-graph-node-core" r={radius} />;
  }
}

function polygonPoints(radius: number, sides: number, rotation = -Math.PI / 2): string {
  return Array.from({ length: sides }, (_, index) => {
    const angle = rotation + (index * Math.PI * 2) / sides;
    return `${roundGraphPoint(Math.cos(angle) * radius)},${roundGraphPoint(Math.sin(angle) * radius)}`;
  }).join(' ');
}

function roundGraphPoint(value: number): number {
  return Math.round(value * 10) / 10;
}

function buildForceLayout(
  graph: RelationshipGraphPreview,
  width: number,
  height: number,
  variant: 'compact' | 'full',
): GraphLayout {
  const nodes: ForceNode[] = createSeededGraphNodes(graph, width, height);
  const links: ForceLink[] = graph.links.map((link) => ({
    ...link,
    key: graphLinkKey(link),
    sourceId: link.source,
    targetId: link.target,
    source: link.source,
    target: link.target,
  }));
  const centerY = variant === 'compact' ? Math.min(height / 2, 250) : height / 2;

  forceSimulation<ForceNode>(nodes)
    .force('center', forceCenter(width / 2, centerY))
    .force('charge', forceManyBody<ForceNode>().strength((node) => node.kind === 'project' ? -230 : node.kind === 'file' ? -72 : -116))
    .force('link', forceLink<ForceNode, ForceLink>(links)
      .id((node) => node.id)
      .distance((link) => graphLinkDistance(link, variant))
      .strength((link) => link.kind === 'project' ? 0.48 : 0.34))
    .force('collision', forceCollide<ForceNode>().radius((node) => node.radius + (variant === 'full' ? 18 : 12)).strength(0.82))
    .force('x', forceX<ForceNode>(width / 2).strength(0.035))
    .force('y', forceY<ForceNode>(centerY).strength(0.035))
    .stop()
    .tick(variant === 'full' ? 260 : 210);

  for (const node of nodes) {
    node.x = clamp(node.x || width / 2, 18, width - 18);
    node.y = clamp(node.y || height / 2, 18, height - 18);
  }

  return {
    nodes,
    links: links.map((link) => ({
      ...link,
      sourceId: endpointId(link.source),
      targetId: endpointId(link.target),
    })),
  };
}

function graphLinkDistance(link: RelationshipGraphLink, variant: 'compact' | 'full'): number {
  const scale = variant === 'full' ? 1.34 : 1;

  if (link.kind === 'project') {
    return 72 * scale;
  }

  if (link.kind === 'related-file') {
    return 124 * scale;
  }

  return 92 * scale;
}

function endpointId(endpoint: string | ForceNode | SimulationNodeDatum): string {
  return typeof endpoint === 'string' ? endpoint : (endpoint as ForceNode).id;
}

function zoomAroundPoint(current: GraphTransform, point: GraphPoint, factor: number): GraphTransform {
  const nextZoom = clamp(current.k * factor, MIN_ZOOM, MAX_ZOOM);
  const ratio = nextZoom / current.k;

  return {
    k: nextZoom,
    x: point.x - (point.x - current.x) * ratio,
    y: point.y - (point.y - current.y) * ratio,
  };
}

function serializeGraph(graph: RelationshipGraphPreview): string {
  return [
    graph.nodes.map((node) => node.id).join('|'),
    graph.links.map((link) => `${link.source}>${link.target}:${link.kind}`).join('|'),
  ].join('::');
}

function formatNodeKind(node: RelationshipGraphNode): string {
  if (node.kind === 'memory') {
    return [node.memoryType || 'memory', node.group].filter(Boolean).join(' · ');
  }

  return [node.kind, node.group].filter(Boolean).join(' · ');
}

function truncateLabel(value: string, limit: number): string {
  return value.length > limit ? `${value.slice(0, limit - 1)}...` : value;
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}
