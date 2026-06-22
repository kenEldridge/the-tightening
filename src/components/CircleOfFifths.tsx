import React, { useMemo } from 'react';
import { FIFTHS_ORDER, nodeIdToChordName } from '../core/chordPathfinder';
import type { EdgeType } from '../core/chordPathfinder';
import { getChordDefinition, NOTE_NAMES, noteToPitchClass } from '../core/chordDefinitions';

/** Get the individual note names of a chord's triad, e.g. "C" → "C E G" */
function triadNotes(chordName: string): string {
  const def = getChordDefinition(chordName);
  const rootPc = noteToPitchClass(def.root);
  // Sort by interval from root so notes appear in root position order
  const pcs = Array.from(def.pitchClasses).sort((a, b) => {
    return ((a - rootPc + 12) % 12) - ((b - rootPc + 12) % 12);
  });
  return pcs.map(pc => NOTE_NAMES[pc]).join(' ');
}

interface WalkPathOverlay {
  nodes: string[];       // chord names in path order
  edgeTypes: string[];
  currentStep: number;
}

interface Props {
  walkPath?: WalkPathOverlay;
  matchedChords: string[];
}

// Layout constants
const CX = 300;
const CY = 300;
const R_MAJOR = 240;
const R_MINOR = 180;
const R_DIM = 120;
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

function buildRingNodes(): RingNode[] {
  const nodes: RingNode[] = [];
  for (let i = 0; i < 12; i++) {
    // Angle: start at top (-90°), go clockwise
    const angle = (i / 12) * 2 * Math.PI - Math.PI / 2;

    nodes.push({
      id: `key-${i}`,
      name: nodeIdToChordName(`key-${i}`),
      x: CX + R_MAJOR * Math.cos(angle),
      y: CY + R_MAJOR * Math.sin(angle),
      r: NODE_R_MAJOR,
      ring: 'major',
    });

    nodes.push({
      id: `minor-${i}`,
      name: nodeIdToChordName(`minor-${i}`),
      x: CX + R_MINOR * Math.cos(angle),
      y: CY + R_MINOR * Math.sin(angle),
      r: NODE_R_MINOR,
      ring: 'minor',
    });

    nodes.push({
      id: `dim-${i}`,
      name: nodeIdToChordName(`dim-${i}`),
      x: CX + R_DIM * Math.cos(angle),
      y: CY + R_DIM * Math.sin(angle),
      r: NODE_R_DIM,
      ring: 'dim',
    });
  }
  return nodes;
}

const RING_NODES = buildRingNodes();

// Build a lookup: chord name -> RingNode
const NODE_BY_NAME = new Map<string, RingNode>();
for (const n of RING_NODES) {
  NODE_BY_NAME.set(n.name, n);
}

const EDGE_TYPE_COLORS: Record<string, string> = {
  dom7: '#f59e0b',
  relative: '#a78bfa',
  iiVI: '#34d399',
  leadingTone: '#f87171',
};

export default function CircleOfFifths({ walkPath, matchedChords }: Props) {
  const pathNodeNames = useMemo(() => {
    if (!walkPath) return new Set<string>();
    return new Set(walkPath.nodes);
  }, [walkPath]);

  const matchedSet = useMemo(() => new Set(matchedChords), [matchedChords]);

  const hasPath = walkPath && walkPath.nodes.length > 1;

  return (
    <div style={{ width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <svg viewBox="0 0 600 600" style={{ width: '100%', maxWidth: 600, maxHeight: '100%' }}>
        {/* Ring guide circles */}
        <circle cx={CX} cy={CY} r={R_MAJOR} fill="none" stroke="#21262d" strokeWidth={1} />
        <circle cx={CX} cy={CY} r={R_MINOR} fill="none" stroke="#21262d" strokeWidth={1} />
        <circle cx={CX} cy={CY} r={R_DIM} fill="none" stroke="#21262d" strokeWidth={1} />

        {/* Path edges */}
        {hasPath && walkPath.nodes.slice(0, -1).map((fromName, i) => {
          const toName = walkPath.nodes[i + 1];
          const fromNode = NODE_BY_NAME.get(fromName);
          const toNode = NODE_BY_NAME.get(toName);
          if (!fromNode || !toNode) return null;

          const edgeType = walkPath.edgeTypes[i];
          const color = EDGE_TYPE_COLORS[edgeType] || '#f5a623';
          const isDone = i < walkPath.currentStep - 1;
          const isActive = i === walkPath.currentStep - 1;

          return (
            <line
              key={`edge-${i}`}
              x1={fromNode.x}
              y1={fromNode.y}
              x2={toNode.x}
              y2={toNode.y}
              stroke={color}
              strokeWidth={isDone || isActive ? 3.5 : 2.5}
              opacity={isDone ? 0.4 : 0.9}
              strokeLinecap="round"
            />
          );
        })}

        {/* Step number labels on edges */}
        {hasPath && walkPath.nodes.slice(0, -1).map((fromName, i) => {
          const toName = walkPath.nodes[i + 1];
          const fromNode = NODE_BY_NAME.get(fromName);
          const toNode = NODE_BY_NAME.get(toName);
          if (!fromNode || !toNode) return null;

          const mx = (fromNode.x + toNode.x) / 2;
          const my = (fromNode.y + toNode.y) / 2;

          return (
            <g key={`label-${i}`}>
              <circle cx={mx} cy={my} r={9} fill="#0d1117" stroke="#30363d" strokeWidth={1} />
              <text
                x={mx} y={my + 1}
                textAnchor="middle"
                dominantBaseline="middle"
                fontSize={9}
                fontWeight={700}
                fill="#c9d1d9"
              >
                {i + 1}
              </text>
            </g>
          );
        })}

        {/* Nodes */}
        {RING_NODES.map((node) => {
          const inPath = pathNodeNames.has(node.name);
          const isCurrentStep = walkPath
            ? walkPath.nodes[walkPath.currentStep] === node.name
            : false;
          const isDoneStep = walkPath
            ? walkPath.nodes.indexOf(node.name) >= 0 && walkPath.nodes.indexOf(node.name) < walkPath.currentStep
            : false;
          const isMatched = matchedSet.has(node.name);

          let fill: string;
          let strokeColor: string;
          let strokeWidth: number;
          let opacity: number;

          if (node.ring === 'major') {
            fill = '#1a3a5c';
          } else if (node.ring === 'minor') {
            fill = '#2d1f3d';
          } else {
            fill = '#3d1f1f';
          }

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

          // MIDI match overrides: bright glow when playing this chord
          if (isMatched && isCurrentStep) {
            // Correct chord! Green glow
            fill = '#1a4a2a';
            strokeColor = '#2ecc71';
            strokeWidth = 3.5;
            opacity = 1;
          } else if (isMatched) {
            // Playing a chord that's on the circle but not the current step
            strokeColor = '#58a6ff';
            strokeWidth = 3;
            opacity = 1;
          }

          const fontSize = node.ring === 'major' ? 11 : node.ring === 'minor' ? 10 : 8.5;
          const triadFontSize = node.ring === 'major' ? 7.5 : node.ring === 'minor' ? 6.5 : 5.5;
          const notes = triadNotes(node.name);

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
              {/* Glow ring for matched chords */}
              {isMatched && (
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
              {/* Pulse ring for current expected step (when not matched) */}
              {isCurrentStep && !isMatched && (
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
                {node.name}
              </text>
              {/* Triad notes */}
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
            </g>
          );
        })}

        {/* Ring labels */}
        <text x={CX} y={CY - R_MAJOR - 12} textAnchor="middle" fontSize={10} fill="#8b949e" opacity={0.6}>Major</text>
        <text x={CX} y={CY - R_MINOR - 10} textAnchor="middle" fontSize={9} fill="#8b949e" opacity={0.6}>Minor</text>
        <text x={CX} y={CY - R_DIM - 8} textAnchor="middle" fontSize={8} fill="#8b949e" opacity={0.6}>Dim</text>
      </svg>
    </div>
  );
}
