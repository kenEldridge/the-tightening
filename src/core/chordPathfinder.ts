import { getChordDefinition, noteToPitchClass, NOTE_NAMES } from './chordDefinitions';

// ---------- Constants ----------

/** Pitch classes in circle-of-fifths order: C, G, D, A, E, B, F#, C#, Ab, Eb, Bb, F */
export const FIFTHS_ORDER = [0, 7, 2, 9, 4, 11, 6, 1, 8, 3, 10, 5];

// ---------- Types ----------

export type EdgeType = 'dom7' | 'relative' | 'iiVI' | 'leadingTone';

export interface PathEdge {
  target: string;
  weight: number;
  type: EdgeType;
}

export interface PathResult {
  path: string[];       // node IDs in order
  edgeTypes: EdgeType[];
  totalWeight: number;
}

export interface PathOptions {
  relative: boolean;
  iiVI: boolean;
  leadingTone: boolean;
}

// ---------- Node ID ↔ Chord name mapping ----------

/**
 * Map a chord name (e.g. "C", "Am", "Bdim", "G7") to a 36-node pathfinder ID.
 * Returns null for unsupported qualities (aug).
 */
export function chordNameToNodeId(chordName: string): string | null {
  const def = getChordDefinition(chordName);
  const pc = noteToPitchClass(def.root);
  if (pc < 0) return null;

  // Downgrade extended qualities to triads
  let quality = def.quality;
  if (quality === 'dom7' || quality === 'maj7' || quality === 'sus2' || quality === 'sus4') {
    quality = 'major';
  } else if (quality === 'min7') {
    quality = 'minor';
  } else if (quality === 'aug') {
    return null; // no mapping
  }

  if (quality === 'major') {
    return `key-${FIFTHS_ORDER.indexOf(pc)}`;
  } else if (quality === 'minor') {
    // minor-i is positioned at its relative major's fifths slot
    // relative major root = (minor root + 3) % 12
    const relMajPc = (pc + 3) % 12;
    return `minor-${FIFTHS_ORDER.indexOf(relMajPc)}`;
  } else if (quality === 'dim') {
    // dim-i's root = (FIFTHS_ORDER[i] + 11) % 12
    // so given root pc: i = FIFTHS_ORDER.indexOf((pc + 1) % 12)
    return `dim-${FIFTHS_ORDER.indexOf((pc + 1) % 12)}`;
  }

  return null;
}

/**
 * Map a pathfinder node ID back to a chord name string.
 */
export function nodeIdToChordName(nodeId: string): string {
  const [prefix, idxStr] = nodeId.split('-');
  const i = parseInt(idxStr, 10);
  const fifthsPc = FIFTHS_ORDER[i];

  if (prefix === 'key') {
    return NOTE_NAMES[fifthsPc];
  } else if (prefix === 'minor') {
    // minor root = (FIFTHS_ORDER[i] + 9) % 12
    const rootPc = (fifthsPc + 9) % 12;
    return NOTE_NAMES[rootPc] + 'm';
  } else if (prefix === 'dim') {
    // dim root = (FIFTHS_ORDER[i] + 11) % 12
    const rootPc = (fifthsPc + 11) % 12;
    return NOTE_NAMES[rootPc] + 'dim';
  }

  return nodeId; // fallback
}

// ---------- Graph construction ----------

/**
 * Build a weighted adjacency list over 36 theory nodes (12 major, 12 minor, 12 dim).
 * Ported from derple-dex CircleOfFifths.astro with added leading-tone support.
 */
export function buildPathGraph(options: PathOptions): Map<string, PathEdge[]> {
  const adj = new Map<string, PathEdge[]>();

  // Initialize adjacency lists for all 36 nodes
  for (let i = 0; i < 12; i++) {
    adj.set(`key-${i}`, []);
    adj.set(`minor-${i}`, []);
    adj.set(`dim-${i}`, []);
  }

  // Dom7 resolution (always on, weight 1.0):
  // V → I: from any node with root R, edge to major/minor with root (R+5)%12
  for (let i = 0; i < 12; i++) {
    const rootPc = FIFTHS_ORDER[i];

    // === key-i (major, root = rootPc) ===
    const targetPc = (rootPc + 5) % 12;
    const targetMajPos = FIFTHS_ORDER.indexOf(targetPc);
    adj.get(`key-${i}`)!.push({ target: `key-${targetMajPos}`, weight: 1, type: 'dom7' });

    // Also resolve to minor with target root
    // minor-j has root (FIFTHS_ORDER[j]+9)%12, so we need (FIFTHS_ORDER[j]+9)%12 == targetPc
    // i.e. FIFTHS_ORDER[j] == (targetPc+3)%12
    const minorMajPc = (targetPc + 3) % 12;
    const targetMinPos = FIFTHS_ORDER.indexOf(minorMajPc);
    adj.get(`key-${i}`)!.push({ target: `minor-${targetMinPos}`, weight: 1, type: 'dom7' });

    // === minor-i (root = (rootPc+9)%12) ===
    const minorRootPc = (rootPc + 9) % 12;
    const minorTargetPc = (minorRootPc + 5) % 12;
    const minorTargetMajPos = FIFTHS_ORDER.indexOf(minorTargetPc);
    adj.get(`minor-${i}`)!.push({ target: `key-${minorTargetMajPos}`, weight: 1, type: 'dom7' });

    const minorTargetMinMajPc = (minorTargetPc + 3) % 12;
    const minorTargetMinPos = FIFTHS_ORDER.indexOf(minorTargetMinMajPc);
    adj.get(`minor-${i}`)!.push({ target: `minor-${minorTargetMinPos}`, weight: 1, type: 'dom7' });

    // === dim-i (root = (rootPc+11)%12) ===
    const dimRootPc = (rootPc + 11) % 12;
    const dimTargetPc = (dimRootPc + 5) % 12;
    const dimTargetMajPos = FIFTHS_ORDER.indexOf(dimTargetPc);
    adj.get(`dim-${i}`)!.push({ target: `key-${dimTargetMajPos}`, weight: 1, type: 'dom7' });

    const dimTargetMinMajPc = (dimTargetPc + 3) % 12;
    const dimTargetMinPos = FIFTHS_ORDER.indexOf(dimTargetMinMajPc);
    adj.get(`dim-${i}`)!.push({ target: `minor-${dimTargetMinPos}`, weight: 1, type: 'dom7' });
  }

  // Relative major/minor swap (weight 0.5)
  if (options.relative) {
    for (let i = 0; i < 12; i++) {
      adj.get(`key-${i}`)!.push({ target: `minor-${i}`, weight: 0.5, type: 'relative' });
      adj.get(`minor-${i}`)!.push({ target: `key-${i}`, weight: 0.5, type: 'relative' });
    }
  }

  // ii-V-I (weight 0.5): minor with root R -> major with root (R+10)%12
  if (options.iiVI) {
    for (let i = 0; i < 12; i++) {
      const minorRootPc = (FIFTHS_ORDER[i] + 9) % 12;
      const targetPc = (minorRootPc + 10) % 12;
      const targetMajPos = FIFTHS_ORDER.indexOf(targetPc);
      adj.get(`minor-${i}`)!.push({ target: `key-${targetMajPos}`, weight: 0.5, type: 'iiVI' });
    }
  }

  // Leading-tone resolution (weight 1.0): dim -> major/minor one semitone up
  if (options.leadingTone) {
    for (let i = 0; i < 12; i++) {
      // dim-i root = (FIFTHS_ORDER[i] + 11) % 12
      const dimRootPc = (FIFTHS_ORDER[i] + 11) % 12;
      // resolves up a semitone
      const resolvePc = (dimRootPc + 1) % 12;

      // -> major with that root
      const majPos = FIFTHS_ORDER.indexOf(resolvePc);
      adj.get(`dim-${i}`)!.push({ target: `key-${majPos}`, weight: 1, type: 'leadingTone' });

      // -> minor with that root
      const minMajPc = (resolvePc + 3) % 12;
      const minPos = FIFTHS_ORDER.indexOf(minMajPc);
      adj.get(`dim-${i}`)!.push({ target: `minor-${minPos}`, weight: 1, type: 'leadingTone' });
    }
  }

  return adj;
}

// ---------- Dijkstra ----------

/**
 * Find the shortest weighted path between two nodes using Dijkstra's algorithm.
 */
export function findShortestPath(
  adj: Map<string, PathEdge[]>,
  fromId: string,
  toId: string,
): PathResult | null {
  if (fromId === toId) return { path: [fromId], edgeTypes: [], totalWeight: 0 };

  const dist = new Map<string, number>();
  const prev = new Map<string, { node: string; edgeType: EdgeType } | null>();
  const visited = new Set<string>();

  for (const key of adj.keys()) {
    dist.set(key, Infinity);
    prev.set(key, null);
  }
  dist.set(fromId, 0);

  const queue: { id: string; d: number }[] = [{ id: fromId, d: 0 }];

  while (queue.length > 0) {
    // Find minimum
    let minIdx = 0;
    for (let i = 1; i < queue.length; i++) {
      if (queue[i].d < queue[minIdx].d) minIdx = i;
    }
    const { id: u, d: uDist } = queue.splice(minIdx, 1)[0];

    if (visited.has(u)) continue;
    visited.add(u);

    if (u === toId) break;

    const neighbors = adj.get(u);
    if (!neighbors) continue;

    for (const edge of neighbors) {
      if (visited.has(edge.target)) continue;
      const newDist = uDist + edge.weight;
      if (newDist < (dist.get(edge.target) ?? Infinity)) {
        dist.set(edge.target, newDist);
        prev.set(edge.target, { node: u, edgeType: edge.type });
        queue.push({ id: edge.target, d: newDist });
      }
    }
  }

  if (dist.get(toId) === Infinity) return null;

  // Reconstruct path
  const path: string[] = [];
  const edgeTypes: EdgeType[] = [];
  let cur: string | undefined = toId;
  while (cur) {
    path.unshift(cur);
    const p = prev.get(cur);
    if (p) {
      edgeTypes.unshift(p.edgeType);
      cur = p.node;
    } else {
      break;
    }
  }

  return { path, edgeTypes, totalWeight: dist.get(toId)! };
}

// ---------- Explanation ----------

const EDGE_TYPE_LABELS: Record<EdgeType, string> = {
  dom7: 'V\u2192I',
  relative: 'relative maj/min',
  iiVI: 'ii-V-I',
  leadingTone: 'vii\u00B0\u2192I',
};

/**
 * Plain-English explanation of one step in a path.
 */
export function explainStep(fromId: string, toId: string, edgeType: EdgeType): string {
  const fromName = nodeIdToChordName(fromId);
  const toName = nodeIdToChordName(toId);
  return `${fromName} \u2192 ${toName} (${EDGE_TYPE_LABELS[edgeType]})`;
}

// ---------- Convenience ----------

export interface ChordPathResult {
  chordNames: string[];
  explanations: string[];
  edgeTypes: EdgeType[];
  totalWeight: number;
}

/**
 * Full pipeline: chord name → pathfinder ID → shortest path → chord names back.
 * Returns null if either chord can't be mapped or no path exists.
 */
export function findChordPath(
  from: string,
  to: string,
  options: PathOptions,
): ChordPathResult | null {
  const fromId = chordNameToNodeId(from);
  const toId = chordNameToNodeId(to);
  if (!fromId || !toId) return null;

  const graph = buildPathGraph(options);
  const result = findShortestPath(graph, fromId, toId);
  if (!result) return null;

  const chordNames = result.path.map(nodeIdToChordName);
  const explanations = result.edgeTypes.map((et, i) =>
    explainStep(result.path[i], result.path[i + 1], et),
  );

  return {
    chordNames,
    explanations,
    edgeTypes: result.edgeTypes,
    totalWeight: result.totalWeight,
  };
}

/**
 * Get all 36 chord names in circle-of-fifths order, grouped by quality.
 */
export function getAllChordNames(): { major: string[]; minor: string[]; dim: string[] } {
  const major: string[] = [];
  const minor: string[] = [];
  const dim: string[] = [];
  for (let i = 0; i < 12; i++) {
    major.push(nodeIdToChordName(`key-${i}`));
    minor.push(nodeIdToChordName(`minor-${i}`));
    dim.push(nodeIdToChordName(`dim-${i}`));
  }
  return { major, minor, dim };
}

/**
 * Build a Map of all 36 theory chords as GraphNode-compatible entries
 * for MIDI chord detection in Walk mode.
 */
export function buildTheoryChordNodes(): Map<string, { id: string; chord: { pitchClasses: Set<number>; name: string; root: string; quality: string } }> {
  const nodes = new Map<string, { id: string; chord: { pitchClasses: Set<number>; name: string; root: string; quality: string } }>();
  const all = getAllChordNames();
  for (const name of [...all.major, ...all.minor, ...all.dim]) {
    const def = getChordDefinition(name);
    nodes.set(name, {
      id: name,
      chord: def,
    });
  }
  return nodes;
}

// Lazy singleton so we don't rebuild on every render
let _theoryNodes: ReturnType<typeof buildTheoryChordNodes> | null = null;
export function getTheoryChordNodes() {
  if (!_theoryNodes) _theoryNodes = buildTheoryChordNodes();
  return _theoryNodes;
}
