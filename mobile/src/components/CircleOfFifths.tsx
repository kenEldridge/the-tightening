import React, { useCallback, useMemo } from 'react';
import Svg, { Circle, G, Line, Path, Polygon, Text as SvgText } from 'react-native-svg';
import {
  FIFTHS_ORDER,
  nodeIdToChordName,
  chordNameToNodeId,
  getDirectEdgeTypes,
  findChordPath,
  edgeTypeColor,
  edgeTypeTitle,
  mostDissonantEdgeType,
  getReciprocalSet,
  EDGE_TYPE_INFO,
  getChordDefinition,
  noteToPitchClass,
  respellChordName,
  pitchClassName,
} from 'theory-core';
import type { EdgeType, GraphState, NoteSpelling } from 'theory-core';

// Port of the desktop CircleOfFifths (Walk-mode surface only for now; Jam and
// Replay rendering stay desktop-side until B7). Geometry/state logic matches
// src/components/CircleOfFifths.tsx; hover tooltips become tap-to-inspect via
// onNodePress/onEdgeInfo, and SVG markers become hand-drawn arrowheads
// (react-native-svg marker support is unreliable).

function triadNotes(chordName: string, spelling: NoteSpelling): string {
  const def = getChordDefinition(chordName);
  const rootPc = noteToPitchClass(def.root);
  const pcs = Array.from(def.pitchClasses).sort((a, b) => {
    return ((a - rootPc + 12) % 12) - ((b - rootPc + 12) % 12);
  });
  return pcs.map((pc) => pitchClassName(pc, spelling)).join(' ');
}

export interface WalkPathOverlay {
  nodes: string[]; // chord names in path order
  edgeTypes: EdgeType[];
  currentStep: number;
}

interface Props {
  walkPath?: WalkPathOverlay;
  matchedChords: string[];
  /** Jam mode: when present, renders progression slots/edges instead of walk styling. */
  graphState?: GraphState;
  jamMatchedChords?: string[];
  noteSpelling?: NoteSpelling;
  onNodePress?: (chordName: string) => void;
  onEdgeInfo?: (info: string) => void;
}

function classifyJamEdge(source: string, target: string): EdgeType[] {
  const directTypes = getDirectEdgeTypes(source, target);
  if (directTypes.length > 0) return directTypes;
  const path = findChordPath(source, target, { relative: false, iiVI: false, leadingTone: false });
  return path?.edgeTypes ?? [];
}

function edgeTypesTitle(edgeTypes: EdgeType[]): string {
  if (edgeTypes.length === 0) return 'Unclassified harmonic move';
  return edgeTypes.map(edgeTypeTitle).join('\n');
}

interface JamSlotInfo {
  chordNames: string[];
  progressionColors: string[];
}

const CX = 300;
const CY = 300;
const R_MAJOR = 258;
const R_MINOR = 175;
const R_DIM = 98;
const NODE_R_MAJOR = 30;
const NODE_R_MINOR = 26;
const NODE_R_DIM = 22;
const ARROW = 8;

interface RingNode {
  id: string;
  name: string;
  x: number;
  y: number;
  r: number;
  ring: 'major' | 'minor' | 'dim';
}

function buildRingNodes(): RingNode[] {
  const nodes: RingNode[] = [];
  for (let i = 0; i < 12; i++) {
    const angle = (i / 12) * 2 * Math.PI - Math.PI / 2;
    const cos = Math.cos(angle);
    const sin = Math.sin(angle);
    nodes.push(
      { id: `key-${i}`, name: nodeIdToChordName(`key-${i}`), x: CX + R_MAJOR * cos, y: CY + R_MAJOR * sin, r: NODE_R_MAJOR, ring: 'major' },
      { id: `minor-${i}`, name: nodeIdToChordName(`minor-${i}`), x: CX + R_MINOR * cos, y: CY + R_MINOR * sin, r: NODE_R_MINOR, ring: 'minor' },
      { id: `dim-${i}`, name: nodeIdToChordName(`dim-${i}`), x: CX + R_DIM * cos, y: CY + R_DIM * sin, r: NODE_R_DIM, ring: 'dim' },
    );
  }
  return nodes;
}

/** Arrowhead polygon at (tipX, tipY) pointing along (ux, uy). */
function arrowPoints(tipX: number, tipY: number, ux: number, uy: number): string {
  const bx = tipX - ux * ARROW;
  const by = tipY - uy * ARROW;
  const px = -uy;
  const py = ux;
  return `${tipX},${tipY} ${bx + px * (ARROW / 2)},${by + py * (ARROW / 2)} ${bx - px * (ARROW / 2)},${by - py * (ARROW / 2)}`;
}

export default function CircleOfFifths({ walkPath, matchedChords, graphState, jamMatchedChords, noteSpelling = 'sharps', onNodePress, onEdgeInfo }: Props) {
  const isJamMode = !!graphState;
  const ringNodes = useMemo(() => buildRingNodes(), []);
  const nodeByName = useMemo(() => {
    const m = new Map<string, RingNode>();
    for (const n of ringNodes) m.set(n.name, n);
    return m;
  }, [ringNodes]);
  const chordToRingNode = useCallback(
    (chordName: string): RingNode | null => {
      const nodeId = chordNameToNodeId(chordName);
      if (!nodeId) return null;
      return ringNodes.find((n) => n.id === nodeId) ?? null;
    },
    [ringNodes],
  );

  const pathNodeNames = useMemo(() => new Set(walkPath?.nodes ?? []), [walkPath]);
  const matchedSet = useMemo(() => new Set(matchedChords), [matchedChords]);
  const hasPath = !!walkPath && walkPath.nodes.length > 1;

  // --- Jam mode data (port of the desktop component's jam memos) ---
  const jamSlots = useMemo(() => {
    if (!graphState) return new Map<string, JamSlotInfo>();
    const slots = new Map<string, JamSlotInfo>();
    for (const [chordName, node] of graphState.nodes) {
      const ringNode = chordToRingNode(chordName);
      if (!ringNode) continue; // aug chords can't map
      if (!slots.has(ringNode.id)) slots.set(ringNode.id, { chordNames: [], progressionColors: [] });
      const slot = slots.get(ringNode.id)!;
      slot.chordNames.push(chordName);
      for (const progName of node.progressions) {
        const prog = graphState.progressions.find((p) => p.name === progName);
        if (prog && !slot.progressionColors.includes(prog.color)) slot.progressionColors.push(prog.color);
      }
    }
    return slots;
  }, [graphState, chordToRingNode]);

  const jamActiveNodeIds = useMemo(() => new Set(jamSlots.keys()), [jamSlots]);

  const jamMatchedNodeIds = useMemo(() => {
    const ids = new Set<string>();
    for (const chordName of jamMatchedChords ?? []) {
      const ringNode = chordToRingNode(chordName);
      if (ringNode) ids.add(ringNode.id);
    }
    return ids;
  }, [jamMatchedChords, chordToRingNode]);

  const jamEdges = useMemo(() => {
    if (!graphState) return [];
    const result = new Map<string, {
      key: string;
      keys: string[];
      from: RingNode;
      to: RingNode;
      color: string;
      edgeTypes: EdgeType[];
      count: number;
      isBidirectional: boolean;
    }>();
    const reciprocalSet = getReciprocalSet(graphState.edges);
    for (const [key, edge] of graphState.edges) {
      const fromRing = chordToRingNode(edge.source);
      const toRing = chordToRingNode(edge.target);
      if (!fromRing || !toRing) continue;
      if (fromRing.id === toRing.id) continue;
      const edgeTypes = classifyJamEdge(edge.source, edge.target);
      const color = edgeTypeColor(mostDissonantEdgeType(edgeTypes) ?? undefined);
      const isBidirectional = reciprocalSet.has(key);
      const pairKey = isBidirectional ? [fromRing.id, toRing.id].sort().join('<->') : key;
      const existing = result.get(pairKey);
      if (existing) {
        existing.keys.push(key);
        existing.count += edge.count;
        existing.isBidirectional = existing.isBidirectional || isBidirectional;
        existing.edgeTypes = Array.from(new Set([...existing.edgeTypes, ...edgeTypes]));
        existing.color = edgeTypeColor(mostDissonantEdgeType(existing.edgeTypes) ?? undefined);
      } else {
        result.set(pairKey, { key: pairKey, keys: [key], from: fromRing, to: toRing, color, edgeTypes, count: edge.count, isBidirectional });
      }
    }
    return Array.from(result.values());
  }, [graphState, chordToRingNode]);

  const jamHighlightedEdgeKeys = useMemo(() => {
    if (!graphState || jamMatchedNodeIds.size === 0) return new Set<string>();
    const keys = new Set<string>();
    for (const [key, edge] of graphState.edges) {
      const sourceRing = chordToRingNode(edge.source);
      if (sourceRing && jamMatchedNodeIds.has(sourceRing.id)) keys.add(key);
    }
    return keys;
  }, [graphState, jamMatchedNodeIds, chordToRingNode]);

  const jamNextCandidateIds = useMemo(() => {
    if (!graphState) return new Set<string>();
    const ids = new Set<string>();
    for (const key of jamHighlightedEdgeKeys) {
      const edge = graphState.edges.get(key);
      if (edge) {
        const targetRing = chordToRingNode(edge.target);
        if (targetRing && !jamMatchedNodeIds.has(targetRing.id)) ids.add(targetRing.id);
      }
    }
    return ids;
  }, [graphState, jamHighlightedEdgeKeys, jamMatchedNodeIds, chordToRingNode]);

  const jamHasHighlight = isJamMode && (jamMatchedChords?.length ?? 0) > 0;

  // Path edges grouped by directed node pair (same grouping/arc rules as desktop).
  const pathGroups = useMemo(() => {
    if (!walkPath || walkPath.nodes.length < 2) return [];
    const groups = new Map<string, {
      fromNode: RingNode; toNode: RingNode;
      steps: { i: number; edgeType: EdgeType; isDone: boolean; isActive: boolean }[];
    }>();
    walkPath.nodes.slice(0, -1).forEach((fromName, i) => {
      const toName = walkPath.nodes[i + 1];
      const fromNode = nodeByName.get(fromName);
      const toNode = nodeByName.get(toName);
      if (!fromNode || !toNode || fromNode.id === toNode.id) return;
      const key = `${fromNode.id}→${toNode.id}`;
      if (!groups.has(key)) groups.set(key, { fromNode, toNode, steps: [] });
      groups.get(key)!.steps.push({
        i,
        edgeType: walkPath.edgeTypes[i],
        isDone: i < walkPath.currentStep - 1,
        isActive: i === walkPath.currentStep - 1,
      });
    });
    return Array.from(groups.entries()).map(([key, g]) => ({ key, hasReverse: groups.has(`${g.toNode.id}→${g.fromNode.id}`), ...g }));
  }, [walkPath, nodeByName]);

  return (
    <Svg viewBox="0 0 600 600" width="100%" height="100%">
      {/* Ring guide circles */}
      <Circle cx={CX} cy={CY} r={R_MAJOR} fill="none" stroke="#21262d" strokeWidth={1} />
      <Circle cx={CX} cy={CY} r={R_MINOR} fill="none" stroke="#21262d" strokeWidth={1} />
      <Circle cx={CX} cy={CY} r={R_DIM} fill="none" stroke="#21262d" strokeWidth={1} />

      {/* Walk path edges (arced when a reverse leg exists) + step badges */}
      {hasPath && walkPath && pathGroups.map(({ key, fromNode, toNode, steps, hasReverse }) => {
        const dx = toNode.x - fromNode.x;
        const dy = toNode.y - fromNode.y;
        const len = Math.sqrt(dx * dx + dy * dy);
        if (len === 0) return null;
        const ux = dx / len;
        const uy = dy / len;
        const pad = 4;
        const x1 = fromNode.x + ux * (fromNode.r + pad);
        const y1 = fromNode.y + uy * (fromNode.r + pad);
        const x2 = toNode.x - ux * (toNode.r + pad);
        const y2 = toNode.y - uy * (toNode.r + pad);
        if (fromNode.r + toNode.r + pad * 2 >= len) return null;

        const bulge = hasReverse ? Math.min(48, len * 0.28) : 0;
        const qx = (x1 + x2) / 2 - uy * bulge;
        const qy = (y1 + y2) / 2 + ux * bulge;

        const primary = steps.find((s) => s.isActive) ?? steps.find((s) => !s.isDone) ?? steps[0];
        const color = edgeTypeColor(primary.edgeType);
        const arcOpacity = primary.isDone ? 0.4 : 0.9;
        const strokeWidth = primary.isActive || primary.isDone ? 3.5 : 2.5;

        // Arrowhead direction = bezier tangent at t=1.
        const tx = x2 - qx;
        const ty = y2 - qy;
        const tLen = Math.sqrt(tx * tx + ty * ty) || 1;

        const tValues = steps.length === 1 ? [0.5] : steps.map((_, j) => 0.3 + (j / (steps.length - 1)) * 0.4);
        const info = steps
          .map((s) => `${walkPath.nodes[s.i]} → ${walkPath.nodes[s.i + 1]} (step ${s.i + 1})\n${EDGE_TYPE_INFO[s.edgeType].label}: ${EDGE_TYPE_INFO[s.edgeType].description}`)
          .join('\n');

        return (
          <G key={key}>
            <Path
              d={`M ${x1} ${y1} Q ${qx} ${qy} ${x2} ${y2}`}
              stroke={color}
              strokeWidth={strokeWidth}
              opacity={arcOpacity}
              fill="none"
              strokeLinecap="round"
              onPress={onEdgeInfo ? () => onEdgeInfo(info) : undefined}
            />
            <Polygon points={arrowPoints(x2, y2, tx / tLen, ty / tLen)} fill={color} opacity={arcOpacity} />
            {steps.map((step, j) => {
              const t = tValues[j];
              const lx = (1 - t) * (1 - t) * x1 + 2 * (1 - t) * t * qx + t * t * x2;
              const ly = (1 - t) * (1 - t) * y1 + 2 * (1 - t) * t * qy + t * t * y2;
              const dtx = 2 * (1 - t) * (qx - x1) + 2 * t * (x2 - qx);
              const dty = 2 * (1 - t) * (qy - y1) + 2 * t * (y2 - qy);
              const dtLen = Math.sqrt(dtx * dtx + dty * dty) || 1;
              const px = -dty / dtLen;
              const py = dtx / dtLen;
              const towardCenter = (CX - lx) * px + (CY - ly) * py > 0;
              const bx = lx + (towardCenter ? -px : px) * 16;
              const by = ly + (towardCenter ? -py : py) * 16;
              return (
                <G key={step.i} opacity={step.isDone ? 0.5 : 1}>
                  <Circle cx={bx} cy={by} r={9} fill="#0d1117" stroke="#30363d" strokeWidth={1} />
                  <SvgText x={bx} y={by + 3.5} textAnchor="middle" fontSize={9} fontWeight="700" fill="#c9d1d9">
                    {step.i + 1}
                  </SvgText>
                </G>
              );
            })}
          </G>
        );
      })}

      {/* Jam mode: progression edges (straight, clipped to node borders) */}
      {isJamMode && jamEdges.map((edge) => {
        const isHighlighted = edge.keys.some((key) => jamHighlightedEdgeKeys.has(key));
        const edgeOpacity = jamHasHighlight ? (isHighlighted ? 1 : 0.2) : 0.85;
        const strokeWidth = edge.count >= 2 ? 4 : 3;
        const dx = edge.to.x - edge.from.x;
        const dy = edge.to.y - edge.from.y;
        const len = Math.sqrt(dx * dx + dy * dy);
        if (len === 0) return null;
        const ux = dx / len;
        const uy = dy / len;
        const pad = 4;
        if (edge.from.r + edge.to.r + pad * 2 >= len) return null;
        const x1 = edge.from.x + ux * (edge.from.r + pad);
        const y1 = edge.from.y + uy * (edge.from.r + pad);
        const x2 = edge.to.x - ux * (edge.to.r + pad);
        const y2 = edge.to.y - uy * (edge.to.r + pad);
        const info = `${edge.from.name} ${edge.isBidirectional ? '↔' : '→'} ${edge.to.name}\n${edgeTypesTitle(edge.edgeTypes)}`;
        return (
          <G key={`jam-${edge.key}`} opacity={edgeOpacity}>
            <Line
              x1={x1} y1={y1} x2={x2} y2={y2}
              stroke={edge.color}
              strokeWidth={strokeWidth}
              strokeLinecap="round"
              onPress={onEdgeInfo ? () => onEdgeInfo(info) : undefined}
            />
            <Polygon points={arrowPoints(x2, y2, ux, uy)} fill={edge.color} />
            {edge.isBidirectional && <Polygon points={arrowPoints(x1, y1, -ux, -uy)} fill={edge.color} />}
          </G>
        );
      })}

      {/* Nodes */}
      {ringNodes.map((node) => {
        const inPath = pathNodeNames.has(node.name);
        const isCurrentStep = walkPath ? walkPath.nodes[walkPath.currentStep] === node.name : false;
        const isDoneStep = walkPath
          ? walkPath.nodes.indexOf(node.name) >= 0 && walkPath.nodes.indexOf(node.name) < walkPath.currentStep
          : false;
        const isMatched = matchedSet.has(node.name);

        // Jam mode state
        const jamSlot = jamSlots.get(node.id);
        const isJamActive = jamActiveNodeIds.has(node.id);
        const isJamMatched = jamMatchedNodeIds.has(node.id);
        const isJamNextCandidate = jamNextCandidateIds.has(node.id);

        let fill = node.ring === 'major' ? '#1a3a5c' : node.ring === 'minor' ? '#2d1f3d' : '#3d1f1f';
        let strokeColor: string;
        let strokeWidth: number;
        let opacity: number;

        if (isJamMode) {
          if (isJamActive) {
            const colors = jamSlot?.progressionColors || [];
            strokeColor = colors.length === 1 ? colors[0] : colors.length > 1 ? '#58a6ff' : '#c9d1d9';
            strokeWidth = 3;
            opacity = 1;
          } else {
            strokeColor = '#30363d';
            strokeWidth = 1;
            opacity = 0.3;
          }
          if (isJamMatched) {
            strokeColor = '#58a6ff';
            strokeWidth = 3.5;
            opacity = 1;
          } else if (isJamNextCandidate && jamHasHighlight) {
            strokeColor = '#fff';
            strokeWidth = 2.5;
            opacity = 0.85;
          } else if (jamHasHighlight && isJamActive && !isJamMatched) {
            opacity = 0.5;
          }
        } else if (isCurrentStep) {
          strokeColor = '#f5a623';
          strokeWidth = 3;
          opacity = 1;
        } else if (isDoneStep) {
          strokeColor = '#2ecc71';
          strokeWidth = 2.5;
          opacity = 0.8;
        } else if (inPath) {
          strokeColor = '#f5a623';
          strokeWidth = 2;
          opacity = 1;
        } else if (hasPath) {
          strokeColor = '#30363d';
          strokeWidth = 1;
          opacity = 0.35;
        } else {
          strokeColor = '#30363d';
          strokeWidth = 1;
          opacity = 0.8;
        }

        if (!isJamMode) {
          if (isMatched && isCurrentStep) {
            fill = '#1a4a2a';
            strokeColor = '#2ecc71';
            strokeWidth = 3.5;
            opacity = 1;
          } else if (isMatched) {
            strokeColor = '#58a6ff';
            strokeWidth = 3;
            opacity = 1;
          }
        }

        // Jam mode shows the user's chord name if a progression chord occupies this slot.
        let displayName = respellChordName(node.name, noteSpelling);
        if (isJamMode && jamSlot) {
          const mostSpecific = jamSlot.chordNames.reduce((a, b) => (a.length >= b.length ? a : b));
          displayName = respellChordName(mostSpecific, noteSpelling);
        }
        const fontSize = node.ring === 'major' ? 11 : node.ring === 'minor' ? 10 : 9;
        const isActive = isJamMode
          ? isJamActive || isJamMatched || isJamNextCandidate
          : inPath || isMatched || isCurrentStep || isDoneStep;
        const triadFontSize = isActive ? 9 : node.ring === 'major' ? 7.5 : node.ring === 'minor' ? 6.5 : 5.5;
        const showTriadNotes = node.ring !== 'dim' || isActive;

        return (
          <G key={node.id} opacity={opacity} onPress={onNodePress ? () => onNodePress(node.name) : undefined}>
            <Circle cx={node.x} cy={node.y} r={node.r} fill={fill} stroke={strokeColor} strokeWidth={strokeWidth} />
            {!isJamMode && isMatched && (
              <Circle
                cx={node.x}
                cy={node.y}
                r={node.r + 5}
                fill="none"
                stroke={isCurrentStep ? '#2ecc71' : '#58a6ff'}
                strokeWidth={2}
                opacity={0.4}
              />
            )}
            {isJamMode && isJamMatched && (
              <Circle cx={node.x} cy={node.y} r={node.r + 5} fill="none" stroke="#58a6ff" strokeWidth={2} opacity={0.4} />
            )}
            {!isJamMode && isCurrentStep && !isMatched && (
              <Circle cx={node.x} cy={node.y} r={node.r + 4} fill="none" stroke="#f5a623" strokeWidth={1.5} opacity={0.5} />
            )}
            <SvgText x={node.x} y={node.y} textAnchor="middle" fontSize={fontSize} fontWeight="600" fill="#c9d1d9">
              {displayName}
            </SvgText>
            {showTriadNotes && (
              <SvgText x={node.x} y={node.y + 11} textAnchor="middle" fontSize={triadFontSize} fill="#8b949e">
                {triadNotes(node.name, noteSpelling)}
              </SvgText>
            )}
          </G>
        );
      })}
    </Svg>
  );
}
