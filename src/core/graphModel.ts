import type { GraphState, GraphNode, GraphEdge, Progression, EdgeStyle, ChordQuality } from '../types/index.js';
import { getChordDefinition } from './chordDefinitions.js';

const PALETTE = ['#e74c3c', '#3498db', '#2ecc71', '#f39c12', '#9b59b6', '#1abc9c'];

/**
 * Build the graph from scratch given current progressions and color counter.
 * Returns a new GraphState. The caller manages nextColorIndex across add/remove.
 */
export function buildGraph(progressions: Progression[]): { nodes: Map<string, GraphNode>; edges: Map<string, GraphEdge> } {
  const nodes = new Map<string, GraphNode>();
  const edges = new Map<string, GraphEdge>();

  for (const prog of progressions) {
    // Add nodes
    for (const chordName of prog.chords) {
      if (!nodes.has(chordName)) {
        nodes.set(chordName, {
          id: chordName,
          chord: getChordDefinition(chordName),
          inDeg: 0,
          outDeg: 0,
          progressions: new Set(),
        });
      }
      nodes.get(chordName)!.progressions.add(prog.name);
    }

    // Add edges
    for (let i = 0; i < prog.chords.length - 1; i++) {
      const s = prog.chords[i];
      const t = prog.chords[i + 1];
      const key = `${s}->${t}`;
      if (!edges.has(key)) {
        edges.set(key, { source: s, target: t, count: 0, contributors: new Map() });
      }
      const edge = edges.get(key)!;
      edge.count++;
      edge.contributors.set(prog.name, (edge.contributors.get(prog.name) || 0) + 1);
    }
  }

  // Compute unique-edge degree
  for (const edge of edges.values()) {
    const sn = nodes.get(edge.source);
    const tn = nodes.get(edge.target);
    if (sn) sn.outDeg++;
    if (tn) tn.inDeg++;
  }

  return { nodes, edges };
}

/**
 * Add a progression to a GraphState. Returns a new state.
 * Rejects duplicate names with an error string.
 */
export function addProgression(
  state: GraphState,
  name: string,
  chords: string[],
): { state: GraphState; error: string | null } {
  if (state.progressions.some(p => p.name === name)) {
    return { state, error: 'Progression name already exists' };
  }

  const color = PALETTE[state.nextColorIndex % PALETTE.length];
  const newProg: Progression = { name, chords, color };
  const newProgressions = [...state.progressions, newProg];
  const { nodes, edges } = buildGraph(newProgressions);

  return {
    state: {
      nodes,
      edges,
      progressions: newProgressions,
      nextColorIndex: state.nextColorIndex + 1,
    },
    error: null,
  };
}

/**
 * Remove a progression by name. Returns a new state.
 * Decrements shared edge counts, removes zero-count edges,
 * removes nodes not in any remaining progression.
 * Does NOT recolor other progressions (monotonic counter preserved).
 */
export function removeProgression(state: GraphState, name: string): GraphState {
  const newProgressions = state.progressions.filter(p => p.name !== name);
  const { nodes, edges } = buildGraph(newProgressions);

  return {
    nodes,
    edges,
    progressions: newProgressions,
    nextColorIndex: state.nextColorIndex, // preserved, not decremented
  };
}

/**
 * Edit a progression: replace its chords (and optionally rename it).
 * Preserves the progression's original color.
 */
export function editProgression(
  state: GraphState,
  oldName: string,
  newName: string,
  newChords: string[],
): { state: GraphState; error: string | null } {
  const idx = state.progressions.findIndex(p => p.name === oldName);
  if (idx < 0) return { state, error: 'Progression not found' };

  // If renaming, check for duplicate
  if (newName !== oldName && state.progressions.some(p => p.name === newName)) {
    return { state, error: 'Progression name already exists' };
  }

  const updated = { ...state.progressions[idx], name: newName, chords: newChords };
  const newProgressions = [...state.progressions];
  newProgressions[idx] = updated;
  const { nodes, edges } = buildGraph(newProgressions);

  return {
    state: { nodes, edges, progressions: newProgressions, nextColorIndex: state.nextColorIndex },
    error: null,
  };
}

/** Create an empty graph state */
export function emptyGraphState(): GraphState {
  return {
    nodes: new Map(),
    edges: new Map(),
    progressions: [],
    nextColorIndex: 0,
  };
}

/** Load a graph state from saved progression data (e.g. from a .cwalk.json file) */
export function loadFromSaveData(
  progressions: Progression[],
  nodePositions?: Map<string, { x: number; y: number }>,
): GraphState {
  const { nodes, edges } = buildGraph(progressions);
  return {
    nodes,
    edges,
    progressions,
    nextColorIndex: progressions.length,
    nodePositions,
  };
}

/** Node radius scaling: base 20 + 4 per total degree */
export function getNodeRadius(node: GraphNode): number {
  return 20 + (node.inDeg + node.outDeg) * 4;
}

/** Edge style by target chord quality */
export function getEdgeStyle(targetQuality: ChordQuality): EdgeStyle {
  switch (targetQuality) {
    case 'major':
      return { stroke: '#4a9eff', strokeWidth: 2.5, strokeDasharray: '' };
    case 'minor':
      return { stroke: '#a0a0a0', strokeWidth: 2, strokeDasharray: '6 3' };
    case 'dom7':
      return { stroke: '#f59e0b', strokeWidth: 3, strokeDasharray: '' };
    case 'maj7':
      return { stroke: '#60a5fa', strokeWidth: 2.5, strokeDasharray: '' };
    case 'min7':
      return { stroke: '#9ca3af', strokeWidth: 2, strokeDasharray: '6 3' };
    case 'dim':
      return { stroke: '#ef4444', strokeWidth: 2, strokeDasharray: '2 2' };
    case 'aug':
      return { stroke: '#a855f7', strokeWidth: 2, strokeDasharray: '8 3 2 3' };
    case 'sus2':
      return { stroke: '#4a9eff', strokeWidth: 2, strokeDasharray: '' };
    case 'sus4':
      return { stroke: '#4a9eff', strokeWidth: 2, strokeDasharray: '' };
    default:
      return { stroke: '#4a9eff', strokeWidth: 2, strokeDasharray: '' };
  }
}

/** Get the reciprocal set: edge keys that have a reverse edge */
export function getReciprocalSet(edges: Map<string, GraphEdge>): Set<string> {
  const keys = new Set(edges.keys());
  const reciprocal = new Set<string>();
  for (const edge of edges.values()) {
    const reverseKey = `${edge.target}->${edge.source}`;
    if (keys.has(reverseKey)) {
      reciprocal.add(`${edge.source}->${edge.target}`);
    }
  }
  return reciprocal;
}

export { PALETTE };
