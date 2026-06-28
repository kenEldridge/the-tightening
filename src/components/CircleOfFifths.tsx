import React, { useCallback, useMemo } from 'react';
import { FIFTHS_ORDER, nodeIdToChordName, chordNameToNodeId, getDirectEdgeTypes, findChordPath } from '../core/chordPathfinder';
import type { EdgeType } from '../core/chordPathfinder';
import { EDGE_TYPE_INFO, edgeTypeColor, edgeTypeTitle, mostDissonantEdgeType } from '../core/edgeTypeStyles';
import { getChordDefinition, NOTE_NAMES, noteToPitchClass, respellChordName, pitchClassName } from '../core/chordDefinitions';
import type { NoteSpelling } from '../core/chordDefinitions';
import type { GraphState, GraphEdge } from '../types/index';
import { qualityToRing, getReciprocalSet } from '../core/graphModel';

/** Get the individual note names of a chord's triad, e.g. "C" → "C E G" */
function triadNotes(chordName: string, spelling: NoteSpelling): string {
  const def = getChordDefinition(chordName);
  const rootPc = noteToPitchClass(def.root);
  // Sort by interval from root so notes appear in root position order
  const pcs = Array.from(def.pitchClasses).sort((a, b) => {
    return ((a - rootPc + 12) % 12) - ((b - rootPc + 12) % 12);
  });
  return pcs.map(pc => pitchClassName(pc, spelling)).join(' ');
}

interface WalkPathOverlay {
  nodes: string[];       // chord names in path order
  edgeTypes: EdgeType[];
  currentStep: number;
}

interface Props {
  walkPath?: WalkPathOverlay;
  matchedChords: string[];
  graphState?: GraphState;
  jamMatchedChords?: string[];
  replayMatchedChords?: string[];  // replay: draw live edges between detected chords
  noteSpelling?: NoteSpelling;
  layout?: 'fifths' | 'chromatic';
}

// Layout constants
const CX = 300;
const CY = 300;
// Ring radii are spread so the same-spoke edges (relative: major↔minor,
// leading-tone: minor↔dim) clear both node circles plus edge padding and stay
// visible/hoverable. Gap must exceed (nodeR_a + nodeR_b + 2*pad) ≈ 64/56.
const R_MAJOR = 258;
const R_MINOR = 175;
const R_DIM = 98;
const NODE_R_MAJOR = 30;
const NODE_R_MINOR = 26;
const NODE_R_DIM = 22;

interface RingNode {
  id: string;        // node ID (key-0, minor-0, etc.)
  name: string;      // chord name
  x: number;
  y: number;
  r: number;
  ring: 'major' | 'minor' | 'dim';
}

function buildRingNodes(layout: 'fifths' | 'chromatic'): RingNode[] {
  const nodes: RingNode[] = [];
  for (let i = 0; i < 12; i++) {
    // Fifths layout: angle determined by circle-of-fifths position index.
    // Chromatic layout: angle determined by each ring's root pitch class so that
    // all three qualities sharing a root (e.g. C, Cm, Cdim) align on the same spoke.
    const majorPc = FIFTHS_ORDER[i];
    const minorRootPc = (majorPc + 9) % 12;  // relative minor root
    const dimRootPc = (majorPc + 11) % 12;   // diminished root

    const majorAngle = layout === 'chromatic'
      ? (majorPc / 12) * 2 * Math.PI - Math.PI / 2
      : (i / 12) * 2 * Math.PI - Math.PI / 2;
    const minorAngle = layout === 'chromatic'
      ? (minorRootPc / 12) * 2 * Math.PI - Math.PI / 2
      : (i / 12) * 2 * Math.PI - Math.PI / 2;
    const dimAngle = layout === 'chromatic'
      ? (dimRootPc / 12) * 2 * Math.PI - Math.PI / 2
      : (i / 12) * 2 * Math.PI - Math.PI / 2;

    nodes.push({
      id: `key-${i}`,
      name: nodeIdToChordName(`key-${i}`),
      x: CX + R_MAJOR * Math.cos(majorAngle),
      y: CY + R_MAJOR * Math.sin(majorAngle),
      r: NODE_R_MAJOR,
      ring: 'major',
    });

    nodes.push({
      id: `minor-${i}`,
      name: nodeIdToChordName(`minor-${i}`),
      x: CX + R_MINOR * Math.cos(minorAngle),
      y: CY + R_MINOR * Math.sin(minorAngle),
      r: NODE_R_MINOR,
      ring: 'minor',
    });

    nodes.push({
      id: `dim-${i}`,
      name: nodeIdToChordName(`dim-${i}`),
      x: CX + R_DIM * Math.cos(dimAngle),
      y: CY + R_DIM * Math.sin(dimAngle),
      r: NODE_R_DIM,
      ring: 'dim',
    });
  }
  return nodes;
}

function classifyJamEdge(source: string, target: string): EdgeType[] {
  const directTypes = getDirectEdgeTypes(source, target);
  if (directTypes.length > 0) return directTypes;

  const path = findChordPath(source, target, {
    relative: false,
    iiVI: false,
    leadingTone: false,
  });
  return path?.edgeTypes ?? [];
}

function edgeTypesTitle(edgeTypes: EdgeType[]): string {
  if (edgeTypes.length === 0) return 'Unclassified harmonic move';
  return edgeTypes.map(edgeTypeTitle).join('\n');
}

/** Info about a progression chord occupying a CoF slot */
interface JamSlotInfo {
  chordNames: string[];          // all user chord names mapped here
  progressionColors: string[];   // colors from their progressions
}

export default function CircleOfFifths({ walkPath, matchedChords, graphState, jamMatchedChords, replayMatchedChords, noteSpelling = 'sharps', layout = 'fifths' }: Props) {
  const isJamMode = !!graphState;

  // Layout-aware ring nodes — rebuilds when layout prop changes.
  const ringNodes = useMemo(() => buildRingNodes(layout), [layout]);
  const nodeByName = useMemo(() => {
    const m = new Map<string, RingNode>();
    for (const n of ringNodes) m.set(n.name, n);
    return m;
  }, [ringNodes]);
  const chordToRingNode = useCallback((chordName: string): RingNode | null => {
    const nodeId = chordNameToNodeId(chordName);
    if (!nodeId) return null;
    return ringNodes.find(n => n.id === nodeId) ?? null;
  }, [ringNodes]);

  // --- Walk mode data ---
  const pathNodeNames = useMemo(() => {
    if (!walkPath) return new Set<string>();
    return new Set(walkPath.nodes);
  }, [walkPath]);

  const matchedSet = useMemo(() => new Set(matchedChords), [matchedChords]);

  const hasPath = walkPath && walkPath.nodes.length > 1;

  // --- Jam mode data ---

  // Map CoF node id -> JamSlotInfo (which progression chords occupy this slot)
  const jamSlots = useMemo(() => {
    if (!graphState) return new Map<string, JamSlotInfo>();
    const slots = new Map<string, JamSlotInfo>();
    for (const [chordName, node] of graphState.nodes) {
      const ringNode = chordToRingNode(chordName);
      if (!ringNode) continue; // aug chords can't map

      if (!slots.has(ringNode.id)) {
        slots.set(ringNode.id, { chordNames: [], progressionColors: [] });
      }
      const slot = slots.get(ringNode.id)!;
      slot.chordNames.push(chordName);

      // Collect progression colors for this chord
      for (const progName of node.progressions) {
        const prog = graphState.progressions.find(p => p.name === progName);
        if (prog && !slot.progressionColors.includes(prog.color)) {
          slot.progressionColors.push(prog.color);
        }
      }
    }
    return slots;
  }, [graphState, chordToRingNode]);

  // Jam mode: which CoF node ids are in progressions
  const jamActiveNodeIds = useMemo(() => {
    return new Set(jamSlots.keys());
  }, [jamSlots]);

  // Jam mode: matched chord names mapped to CoF node ids
  const jamMatchedSet = useMemo(() => {
    if (!jamMatchedChords) return new Set<string>();
    return new Set(jamMatchedChords);
  }, [jamMatchedChords]);

  // Jam mode: map matched chords to their CoF node ids
  const jamMatchedNodeIds = useMemo(() => {
    const ids = new Set<string>();
    for (const chordName of jamMatchedSet) {
      const ringNode = chordToRingNode(chordName);
      if (ringNode) ids.add(ringNode.id);
    }
    return ids;
  }, [jamMatchedSet, chordToRingNode]);

  // Jam mode: edges mapped to CoF positions
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
      // Skip self-loops on the CoF (e.g. G and G7 both map to same slot)
      if (fromRing.id === toRing.id) continue;

      const edgeTypes = classifyJamEdge(edge.source, edge.target);
      const color = edgeTypeColor(mostDissonantEdgeType(edgeTypes) ?? undefined);

      const isBidirectional = reciprocalSet.has(key);
      const pairKey = isBidirectional
        ? [fromRing.id, toRing.id].sort().join('<->')
        : key;
      const existing = result.get(pairKey);
      if (existing) {
        existing.keys.push(key);
        existing.count += edge.count;
        existing.isBidirectional = existing.isBidirectional || isBidirectional;
        existing.edgeTypes = Array.from(new Set([...existing.edgeTypes, ...edgeTypes]));
        existing.color = edgeTypeColor(mostDissonantEdgeType(existing.edgeTypes) ?? undefined);
      } else {
        result.set(pairKey, {
          key: pairKey,
          keys: [key],
          from: fromRing,
          to: toRing,
          color,
          edgeTypes,
          count: edge.count,
          isBidirectional,
        });
      }
    }
    return Array.from(result.values());
  }, [graphState, chordToRingNode]);

  // Jam MIDI: outgoing edge keys from matched nodes
  // Compare via CoF node ID to handle sharps/flats mismatch (e.g. matched "D#" vs edge source "Eb")
  const jamHighlightedEdgeKeys = useMemo(() => {
    if (!graphState || jamMatchedNodeIds.size === 0) return new Set<string>();
    const keys = new Set<string>();
    for (const [key, edge] of graphState.edges) {
      const sourceRing = chordToRingNode(edge.source);
      if (sourceRing && jamMatchedNodeIds.has(sourceRing.id)) {
        keys.add(key);
      }
    }
    return keys;
  }, [graphState, jamMatchedNodeIds, chordToRingNode]);

  // Jam MIDI: next candidate node ids (targets of highlighted edges)
  const jamNextCandidateIds = useMemo(() => {
    if (!graphState) return new Set<string>();
    const ids = new Set<string>();
    for (const key of jamHighlightedEdgeKeys) {
      const edge = graphState.edges.get(key);
      if (edge) {
        const targetRing = chordToRingNode(edge.target);
        if (targetRing && !jamMatchedNodeIds.has(targetRing.id)) {
          ids.add(targetRing.id);
        }
      }
    }
    return ids;
  }, [graphState, jamHighlightedEdgeKeys, jamMatchedNodeIds, chordToRingNode]);

  const jamHasHighlight = isJamMode && jamMatchedSet.size > 0;

  // Replay mode: live edges between every pair of currently detected chords.
  const replayEdges = useMemo(() => {
    if (!replayMatchedChords || replayMatchedChords.length < 2) return [];
    const result: {
      from: RingNode; to: RingNode;
      color: string; edgeTypes: EdgeType[];
      isBidirectional: boolean;
    }[] = [];
    const seen = new Set<string>();
    for (let i = 0; i < replayMatchedChords.length; i++) {
      for (let j = i + 1; j < replayMatchedChords.length; j++) {
        const a = replayMatchedChords[i];
        const b = replayMatchedChords[j];
        const fromNode = chordToRingNode(a);
        const toNode = chordToRingNode(b);
        if (!fromNode || !toNode || fromNode.id === toNode.id) continue;
        const pairKey = [fromNode.id, toNode.id].sort().join('<->');
        if (seen.has(pairKey)) continue;
        seen.add(pairKey);
        const typesAB = classifyJamEdge(a, b);
        const typesBA = classifyJamEdge(b, a);
        const allTypes = Array.from(new Set([...typesAB, ...typesBA]));
        const color = edgeTypeColor(mostDissonantEdgeType(allTypes) ?? undefined);
        result.push({
          from: fromNode, to: toNode,
          color, edgeTypes: allTypes,
          isBidirectional: typesAB.length > 0 && typesBA.length > 0,
        });
      }
    }
    return result;
  }, [replayMatchedChords, chordToRingNode]);

  return (
    <div style={{ width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <svg viewBox="0 0 600 600" style={{ width: '100%', height: '100%' }}>
        <defs>
          <marker
            id="cof-arrow"
            viewBox="0 0 10 10"
            refX="9"
            refY="5"
            markerWidth="5"
            markerHeight="5"
            orient="auto-start-reverse"
          >
            <path d="M 0 0 L 10 5 L 0 10 z" fill="context-stroke" />
          </marker>
        </defs>

        {/* Ring guide circles */}
        <circle cx={CX} cy={CY} r={R_MAJOR} fill="none" stroke="#21262d" strokeWidth={1} />
        <circle cx={CX} cy={CY} r={R_MINOR} fill="none" stroke="#21262d" strokeWidth={1} />
        <circle cx={CX} cy={CY} r={R_DIM} fill="none" stroke="#21262d" strokeWidth={1} />

        {/* Walk mode: Path edges (arced) + step labels.
            Edges are grouped by directed node pair so that same-direction
            duplicates share one arc (with multiple step-number labels spaced
            along it). Arc bulges LEFT of direction of travel, which puts it
            toward the circle centre — forward A→B and return B→A therefore
            curve to opposite sides naturally. */}
        {hasPath && (() => {
          // Build directed-pair groups in encounter order.
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

          return Array.from(groups.values()).map(({ fromNode, toNode, steps }) => {
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

            // Only arc when the reverse direction also appears in the path;
            // otherwise a straight line avoids unnecessary crossings.
            const reverseKey = `${toNode.id}→${fromNode.id}`;
            const bulge = groups.has(reverseKey) ? Math.min(48, len * 0.28) : 0;
            const qx = (x1 + x2) / 2 - uy * bulge;
            const qy = (y1 + y2) / 2 + ux * bulge;

            // Pick the most salient step's colour for the arc.
            const primary = steps.find(s => s.isActive) ?? steps.find(s => !s.isDone) ?? steps[0];
            const color = edgeTypeColor(primary.edgeType);
            const arcOpacity = primary.isDone ? 0.4 : 0.9;
            const strokeWidth = primary.isActive || primary.isDone ? 3.5 : 2.5;

            // Evenly space labels between t=0.3 and t=0.7 along the bezier.
            const tValues = steps.length === 1
              ? [0.5]
              : steps.map((_, j) => 0.3 + (j / (steps.length - 1)) * 0.4);

            const groupKey = `${fromNode.id}→${toNode.id}`;
            return (
              <g key={groupKey}>
                <path
                  d={`M ${x1} ${y1} Q ${qx} ${qy} ${x2} ${y2}`}
                  stroke={color}
                  strokeWidth={strokeWidth}
                  opacity={arcOpacity}
                  fill="none"
                  strokeLinecap="round"
                  markerEnd="url(#cof-arrow)"
                >
                  <title>{steps.map(s =>
                    `${walkPath.nodes[s.i]} → ${walkPath.nodes[s.i + 1]} (step ${s.i + 1})\n${EDGE_TYPE_INFO[s.edgeType].label}`
                  ).join('\n')}</title>
                </path>
                {steps.map((step, j) => {
                  const t = tValues[j];
                  const lx = (1-t)*(1-t)*x1 + 2*(1-t)*t*qx + t*t*x2;
                  const ly = (1-t)*(1-t)*y1 + 2*(1-t)*t*qy + t*t*y2;
                  return (
                    <g key={step.i} opacity={step.isDone ? 0.5 : 1}>
                      <circle cx={lx} cy={ly} r={9} fill="#0d1117" stroke="#30363d" strokeWidth={1} />
                      <text
                        x={lx} y={ly + 1}
                        textAnchor="middle" dominantBaseline="middle"
                        fontSize={9} fontWeight={700} fill="#c9d1d9"
                        style={{ pointerEvents: 'none' }}
                      >
                        {step.i + 1}
                      </text>
                    </g>
                  );
                })}
              </g>
            );
          });
        })()}

        {/* Replay mode: live edges between currently detected chord pairs */}
        {replayEdges.map((edge, idx) => {
          const dx = edge.to.x - edge.from.x;
          const dy = edge.to.y - edge.from.y;
          const len = Math.sqrt(dx * dx + dy * dy);
          if (len === 0) return null;
          const ux = dx / len;
          const uy = dy / len;
          const pad = 4;
          const x1 = edge.from.x + ux * (edge.from.r + pad);
          const y1 = edge.from.y + uy * (edge.from.r + pad);
          const x2 = edge.to.x - ux * (edge.to.r + pad);
          const y2 = edge.to.y - uy * (edge.to.r + pad);
          if (edge.from.r + edge.to.r + pad * 2 >= len) return null;
          return (
            <line
              key={`replay-edge-${idx}`}
              x1={x1} y1={y1} x2={x2} y2={y2}
              stroke={edge.color}
              strokeWidth={3}
              opacity={0.9}
              strokeLinecap="round"
              markerStart={edge.isBidirectional ? 'url(#cof-arrow)' : undefined}
              markerEnd="url(#cof-arrow)"
            >
              <title>{`${edge.from.name} ${edge.isBidirectional ? '<->' : '->'} ${edge.to.name}\n${edgeTypesTitle(edge.edgeTypes)}`}</title>
            </line>
          );
        })}

        {/* Jam mode: Progression edges (clipped to node borders) */}
        {isJamMode && jamEdges.map((edge) => {
          const isHighlighted = edge.keys.some(key => jamHighlightedEdgeKeys.has(key));
          const edgeOpacity = jamHasHighlight ? (isHighlighted ? 1 : 0.2) : 0.85;
          const strokeWidth = edge.count >= 2 ? 4 : 3;

          const dx = edge.to.x - edge.from.x;
          const dy = edge.to.y - edge.from.y;
          const len = Math.sqrt(dx * dx + dy * dy);
          if (len === 0) return null;

          const ux = dx / len;
          const uy = dy / len;

          // Padding beyond node radius so edge doesn't touch the circle
          const pad = 4;
          const startInset = edge.from.r + pad;
          const endInset = edge.to.r + pad;

          // If nodes overlap so much there's no room for an edge, skip
          if (startInset + endInset >= len) return null;

          const x1 = edge.from.x + ux * startInset;
          const y1 = edge.from.y + uy * startInset;
          const x2 = edge.to.x - ux * endInset;
          const y2 = edge.to.y - uy * endInset;

          return (
            <line
              key={`jam-edge-${edge.key}`}
              x1={x1}
              y1={y1}
              x2={x2}
              y2={y2}
              stroke={edge.color}
              strokeWidth={strokeWidth}
              opacity={edgeOpacity}
              strokeLinecap="round"
              markerStart={edge.isBidirectional ? 'url(#cof-arrow)' : undefined}
              markerEnd="url(#cof-arrow)"
            >
              <title>{`${edge.from.name} ${edge.isBidirectional ? '<->' : '->'} ${edge.to.name}\n${edgeTypesTitle(edge.edgeTypes)}`}</title>
            </line>
          );
        })}

        {/* Nodes */}
        {ringNodes.map((node) => {
          // Walk mode state
          const inPath = pathNodeNames.has(node.name);
          const isCurrentStep = walkPath
            ? walkPath.nodes[walkPath.currentStep] === node.name
            : false;
          const isDoneStep = walkPath
            ? walkPath.nodes.indexOf(node.name) >= 0 && walkPath.nodes.indexOf(node.name) < walkPath.currentStep
            : false;
          const isWalkMatched = matchedSet.has(node.name);

          // Jam mode state
          const jamSlot = jamSlots.get(node.id);
          const isJamActive = jamActiveNodeIds.has(node.id);
          const isJamMatched = jamMatchedNodeIds.has(node.id);
          const isJamNextCandidate = jamNextCandidateIds.has(node.id);

          let fill: string;
          let strokeColor: string;
          let strokeWidth: number;
          let opacity: number;

          // Base fill by ring
          if (node.ring === 'major') {
            fill = '#1a3a5c';
          } else if (node.ring === 'minor') {
            fill = '#2d1f3d';
          } else {
            fill = '#3d1f1f';
          }

          if (isJamMode) {
            // --- Jam mode styling ---
            if (isJamActive) {
              // Node is in a progression: keep dark fill, use progression color for stroke
              const colors = jamSlot?.progressionColors || [];
              if (colors.length === 1) {
                strokeColor = colors[0];
              } else if (colors.length > 1) {
                strokeColor = '#58a6ff'; // accent blue for multi-progression
              } else {
                strokeColor = '#c9d1d9';
              }
              strokeWidth = 3;
              opacity = 1;
            } else {
              // Not in any progression: dimmed
              strokeColor = '#30363d';
              strokeWidth = 1;
              opacity = 0.3;
            }

            // MIDI overrides for Jam mode
            if (isJamMatched) {
              strokeColor = '#58a6ff';
              strokeWidth = 3.5;
              opacity = 1;
            } else if (isJamNextCandidate && jamHasHighlight) {
              strokeColor = '#fff';
              strokeWidth = 2.5;
              opacity = 0.85;
            } else if (jamHasHighlight && !isJamActive) {
              // Already dimmed, keep it
            } else if (jamHasHighlight && isJamActive && !isJamMatched) {
              // Active but not matched while something is playing: slightly dim
              opacity = 0.5;
            }
          } else {
            // --- Walk mode styling (unchanged) ---
            if (isCurrentStep) {
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

            // Walk MIDI match overrides
            if (isWalkMatched && isCurrentStep) {
              fill = '#1a4a2a';
              strokeColor = '#2ecc71';
              strokeWidth = 3.5;
              opacity = 1;
            } else if (isWalkMatched) {
              strokeColor = '#58a6ff';
              strokeWidth = 3;
              opacity = 1;
            }
          }

          // Determine display name: in Jam mode, show user's chord name if a progression chord occupies this slot
          let displayName = respellChordName(node.name, noteSpelling);
          if (isJamMode && jamSlot) {
            // Pick the most specific name (longest, e.g. "G7" over "G")
            const mostSpecific = jamSlot.chordNames.reduce((a, b) => a.length >= b.length ? a : b);
            displayName = respellChordName(mostSpecific, noteSpelling);
          }

          const fontSize = node.ring === 'major' ? 11 : node.ring === 'minor' ? 10 : 9;
          const notes = triadNotes(node.name, noteSpelling);

          const isActive = isJamMode
            ? (isJamActive || isJamMatched || isJamNextCandidate)
            : (inPath || isWalkMatched || isCurrentStep || isDoneStep);

          const triadFontSize = isActive ? 9 : (node.ring === 'major' ? 7.5 : node.ring === 'minor' ? 6.5 : 5.5);
          const showTriadNotes = node.ring !== 'dim' || isActive;

          return (
            <g key={node.id} opacity={opacity}>
              <circle
                cx={node.x}
                cy={node.y}
                r={node.r}
                fill={fill}
                stroke={strokeColor}
                strokeWidth={strokeWidth}
              />
              {/* Glow ring for matched chords (Walk mode) */}
              {!isJamMode && isWalkMatched && (
                <circle
                  cx={node.x}
                  cy={node.y}
                  r={node.r + 5}
                  fill="none"
                  stroke={isCurrentStep ? '#2ecc71' : '#58a6ff'}
                  strokeWidth={2}
                  opacity={0.4}
                  className="walk-current-pulse"
                />
              )}
              {/* Glow ring for matched chords (Jam mode) */}
              {isJamMode && isJamMatched && (
                <circle
                  cx={node.x}
                  cy={node.y}
                  r={node.r + 5}
                  fill="none"
                  stroke="#58a6ff"
                  strokeWidth={2}
                  opacity={0.4}
                  className="walk-current-pulse"
                />
              )}
              {/* Pulse ring for current expected step (Walk mode, when not matched) */}
              {!isJamMode && isCurrentStep && !isWalkMatched && (
                <circle
                  cx={node.x}
                  cy={node.y}
                  r={node.r + 4}
                  fill="none"
                  stroke="#f5a623"
                  strokeWidth={1.5}
                  opacity={0.5}
                  className="walk-current-pulse"
                />
              )}
              {/* Chord name */}
              <text
                x={node.x}
                y={node.y - 4}
                textAnchor="middle"
                dominantBaseline="middle"
                fontSize={fontSize}
                fontWeight={600}
                fill="#c9d1d9"
                style={{ pointerEvents: 'none' }}
              >
                {displayName}
              </text>
              {/* Triad notes — hidden on dim nodes unless active */}
              {showTriadNotes && (
                <text
                  x={node.x}
                  y={node.y + 8}
                  textAnchor="middle"
                  dominantBaseline="middle"
                  fontSize={triadFontSize}
                  fill="#8b949e"
                  style={{ pointerEvents: 'none', fontFamily: 'monospace' }}
                >
                  {notes}
                </text>
              )}
            </g>
          );
        })}


      </svg>
    </div>
  );
}
