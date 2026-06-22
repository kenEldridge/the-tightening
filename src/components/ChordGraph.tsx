import React, { useRef, useEffect, useCallback, useMemo } from 'react';
import type { GraphState, GraphEdge } from '../types/index';
import { getNodeRadius, getEdgeStyle, getReciprocalSet } from '../core/graphModel';
import { ForceSimulation, type SimNode, type SimEdge } from '../core/forceSimulation';
import { noteToPitchClass } from '../core/chordDefinitions';

interface Props {
  graphState: GraphState;
  matchedChords: string[];
  positionsRef?: React.MutableRefObject<(() => Map<string, { x: number; y: number }>) | null>;
}

export default function ChordGraph({ graphState, matchedChords, positionsRef }: Props) {
  const svgRef = useRef<SVGSVGElement>(null);
  const simRef = useRef<ForceSimulation | null>(null);
  const nodeRefs = useRef(new Map<string, SVGGElement>());
  const edgeRefs = useRef(new Map<string, SVGPathElement>());
  const dragState = useRef<{
    nodeId: string;
    pointerId: number;
  } | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const sizeRef = useRef({ width: 800, height: 600 });

  const matchedSet = useMemo(() => new Set(matchedChords), [matchedChords]);

  // Outgoing edge keys from matched nodes
  const highlightedEdgeKeys = useMemo(() => {
    const keys = new Set<string>();
    if (matchedSet.size === 0) return keys;
    for (const [key, edge] of graphState.edges) {
      if (matchedSet.has(edge.source)) {
        keys.add(key);
      }
    }
    return keys;
  }, [matchedSet, graphState.edges]);

  // Target nodes of highlighted edges ("next candidates")
  const nextCandidateNodes = useMemo(() => {
    const ids = new Set<string>();
    for (const key of highlightedEdgeKeys) {
      const edge = graphState.edges.get(key);
      if (edge && !matchedSet.has(edge.target)) {
        ids.add(edge.target);
      }
    }
    return ids;
  }, [highlightedEdgeKeys, matchedSet, graphState.edges]);

  const hasHighlight = matchedSet.size > 0;

  // Ref callbacks for nodes and edges
  const setNodeRef = useCallback((id: string, el: SVGGElement | null) => {
    if (el) nodeRefs.current.set(id, el);
    else nodeRefs.current.delete(id);
  }, []);

  const setEdgeRef = useCallback((key: string, el: SVGPathElement | null) => {
    if (el) edgeRefs.current.set(key, el);
    else edgeRefs.current.delete(key);
  }, []);

  // Initialize / update simulation when topology changes
  useEffect(() => {
    const getNodeEl = (id: string) => nodeRefs.current.get(id) || null;
    const getEdgeEl = (key: string) => edgeRefs.current.get(key) || null;

    if (!simRef.current) {
      simRef.current = new ForceSimulation(
        getNodeEl,
        getEdgeEl,
        sizeRef.current.width,
        sizeRef.current.height,
      );
    }

    // Assign positions getter for save
    if (positionsRef) {
      positionsRef.current = () => simRef.current!.getPositions();
    }

    const sim = simRef.current;

    const simNodes: SimNode[] = [];
    const rootPitchClasses = new Map<string, number>();
    for (const [id, node] of graphState.nodes) {
      simNodes.push({ id, r: getNodeRadius(node) });
      const pc = noteToPitchClass(node.chord.root);
      if (pc >= 0) rootPitchClasses.set(id, pc);
    }

    const simEdges: SimEdge[] = [];
    for (const [key, edge] of graphState.edges) {
      simEdges.push({ key, source: edge.source, target: edge.target });
    }

    const savedPositions = graphState.nodePositions;

    // Use requestAnimationFrame to ensure React has committed the new DOM
    requestAnimationFrame(() => {
      sim.setData(simNodes, simEdges, rootPitchClasses, savedPositions);
      if (savedPositions && savedPositions.size > 0) {
        // Restored from file — just render without running physics
        sim.flush();
      } else {
        sim.start();
      }
    });
  }, [graphState.nodes, graphState.edges, graphState.nodePositions, positionsRef]);

  // Resize observer
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const observer = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (!entry) return;
      const { width, height } = entry.contentRect;
      sizeRef.current = { width, height };
      simRef.current?.resize(width, height);
    });

    observer.observe(container);
    return () => observer.disconnect();
  }, []);

  // Cleanup simulation on unmount
  useEffect(() => {
    return () => {
      simRef.current?.dispose();
    };
  }, []);

  // Drag handling — pointer down on nodes, move/up on SVG for reliability
  const handlePointerDown = useCallback((e: React.PointerEvent, nodeId: string) => {
    e.stopPropagation();
    dragState.current = { nodeId, pointerId: e.pointerId };

    const svgEl = svgRef.current;
    if (!svgEl) return;
    const pt = svgPoint(svgEl, e.clientX, e.clientY);
    simRef.current?.pinNode(nodeId, pt.x, pt.y);
    simRef.current?.start();
  }, []);

  const handleSvgPointerMove = useCallback((e: React.PointerEvent) => {
    if (!dragState.current) return;
    const svgEl = svgRef.current;
    if (!svgEl) return;

    const pt = svgPoint(svgEl, e.clientX, e.clientY);
    simRef.current?.pinNode(dragState.current.nodeId, pt.x, pt.y);
    if (simRef.current) simRef.current.start();
  }, []);

  const handleSvgPointerUp = useCallback(() => {
    if (!dragState.current) return;
    // Keep node pinned so it stays where it was dragged
    dragState.current = null;
  }, []);

  // Reciprocal set for edge rendering
  const reciprocalSet = useMemo(() => getReciprocalSet(graphState.edges), [graphState.edges]);

  // Get edge color: progression color if single contributor, accent if multi
  const getEdgeColor = useCallback((edge: GraphEdge): string => {
    if (edge.contributors.size === 1) {
      const progName = edge.contributors.keys().next().value!;
      const prog = graphState.progressions.find(p => p.name === progName);
      return prog ? prog.color : '#58a6ff';
    }
    return '#58a6ff';
  }, [graphState.progressions]);

  // Collect all unique edge colors for arrowhead markers
  const edgeColors = useMemo(() => {
    const colors = new Set<string>();
    // Normal edge colors
    for (const edge of graphState.edges.values()) {
      colors.add(getEdgeColor(edge));
    }
    // Highlight edge colors (by target quality)
    for (const key of highlightedEdgeKeys) {
      const edge = graphState.edges.get(key);
      if (edge) {
        const targetNode = graphState.nodes.get(edge.target);
        if (targetNode) {
          const style = getEdgeStyle(targetNode.chord.quality);
          colors.add(style.stroke);
        }
      }
    }
    return colors;
  }, [graphState.edges, graphState.nodes, getEdgeColor, highlightedEdgeKeys]);

  const { width, height } = sizeRef.current;

  return (
    <div ref={containerRef} style={{ width: '100%', height: '100%' }}>
      <svg
        ref={svgRef}
        viewBox={`0 0 ${width} ${height}`}
        style={{ width: '100%', height: '100%' }}
        onPointerMove={handleSvgPointerMove}
        onPointerUp={handleSvgPointerUp}
      >
        {/* Defs: arrowhead markers + glow filter */}
        <defs>
          {Array.from(edgeColors).map(color => {
            const markerId = `arrow-${color.replace(/[^a-zA-Z0-9]/g, '_')}`;
            return (
              <marker
                key={markerId}
                id={markerId}
                viewBox="0 0 10 10"
                refX="10"
                refY="5"
                markerWidth="6"
                markerHeight="6"
                orient="auto-start-reverse"
              >
                <path d="M 0 0 L 10 5 L 0 10 z" fill={color} />
              </marker>
            );
          })}
          <filter id="glow">
            <feGaussianBlur stdDeviation="4" result="blur" />
            <feMerge>
              <feMergeNode in="blur" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
        </defs>

        {/* Edge layer */}
        <g className="edge-layer">
          {Array.from(graphState.edges.entries()).map(([key, edge]) => {
            const isHighlighted = highlightedEdgeKeys.has(key);
            const targetNode = graphState.nodes.get(edge.target);

            let strokeColor: string;
            let strokeWidth: number;
            let dasharray: string;

            if (isHighlighted && targetNode) {
              const style = getEdgeStyle(targetNode.chord.quality);
              strokeColor = style.stroke;
              strokeWidth = style.strokeWidth;
              dasharray = style.strokeDasharray;
            } else {
              strokeColor = getEdgeColor(edge);
              strokeWidth = 1 + edge.count;
              dasharray = '';
            }

            const markerId = `arrow-${strokeColor.replace(/[^a-zA-Z0-9]/g, '_')}`;
            const opacity = hasHighlight ? (isHighlighted ? 1 : 0.25) : 0.8;

            return (
              <path
                key={key}
                ref={(el) => setEdgeRef(key, el)}
                data-key={key}
                stroke={strokeColor}
                strokeWidth={strokeWidth}
                strokeDasharray={dasharray}
                fill="none"
                markerEnd={`url(#${markerId})`}
                opacity={opacity}
                d="M 0 0 L 0 0"
              />
            );
          })}
        </g>

        {/* Node layer */}
        <g className="node-layer">
          {Array.from(graphState.nodes.entries()).map(([id, node]) => {
            const r = getNodeRadius(node);
            const isMatched = matchedSet.has(id);
            const isNextCandidate = nextCandidateNodes.has(id);

            // Node color: single-progression color or accent for multi
            let fillColor: string;
            if (node.progressions.size > 1) {
              fillColor = '#58a6ff';
            } else {
              const progName = node.progressions.values().next().value!;
              const prog = graphState.progressions.find(p => p.name === progName);
              fillColor = prog ? prog.color : '#58a6ff';
            }

            let opacity: number;
            if (!hasHighlight) {
              opacity = 1;
            } else if (isMatched) {
              opacity = 1;
            } else if (isNextCandidate) {
              opacity = 0.85;
            } else {
              opacity = 0.25;
            }

            return (
              <g
                key={id}
                ref={(el) => { if (el) setNodeRef(id, el); }}
                data-id={id}
                className={isMatched ? 'node-matched' : ''}
                style={{ cursor: 'grab' }}
                opacity={opacity}
                filter={isMatched ? 'url(#glow)' : undefined}
                onPointerDown={(e) => handlePointerDown(e, id)}
              >
                <circle
                  r={r}
                  fill={fillColor}
                  fillOpacity={0.85}
                  stroke={isNextCandidate ? '#fff' : fillColor}
                  strokeWidth={isNextCandidate ? 3 : 2}
                />
                <text
                  textAnchor="middle"
                  y={-r * 0.12}
                  fontSize={r * 0.6}
                  fill="#0d1117"
                  fontWeight={700}
                  style={{ pointerEvents: 'none' }}
                >
                  {id}
                </text>
                <text
                  textAnchor="middle"
                  y={r * 0.35}
                  fontSize={r * 0.3}
                  fill="#0d1117"
                  opacity={0.8}
                  style={{ pointerEvents: 'none', fontFamily: 'monospace' }}
                >
                  {node.inDeg}in {node.outDeg}out
                </text>
              </g>
            );
          })}
        </g>
      </svg>
    </div>
  );
}

/** Convert client coordinates to SVG coordinates */
function svgPoint(svg: SVGSVGElement, clientX: number, clientY: number): { x: number; y: number } {
  const rect = svg.getBoundingClientRect();
  const viewBox = svg.viewBox.baseVal;
  const scaleX = viewBox.width / rect.width;
  const scaleY = viewBox.height / rect.height;
  return {
    x: (clientX - rect.left) * scaleX,
    y: (clientY - rect.top) * scaleY,
  };
}
