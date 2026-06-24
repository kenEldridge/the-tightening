import { getChordDefinition, noteToPitchClass, NOTE_NAMES } from './chordDefinitions';

// ---------- Constants ----------

/** Pitch classes in circle-of-fifths order: C, G, D, A, E, B, F#, C#, Ab, Eb, Bb, F */
export const FIFTHS_ORDER = [0, 7, 2, 9, 4, 11, 6, 1, 8, 3, 10, 5];

// ---------- Types ----------

export type EdgeType =
  | 'fifth'
  | 'plagal'
  | 'diatonic'
  | 'relative'
  | 'iiVI'
  | 'borrowed'
  | 'parallel'
  | 'dom7'
  | 'leadingTone'
  | 'chromaticMediant'
  | 'tritoneSub';

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

interface SearchCost {
  steps: number;
  ringChanges: number;
  weight: number;
}

export interface PathOptions {
  [key: string]: boolean | undefined;
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

export const EDGE_TYPES: EdgeType[] = [
  'fifth',
  'plagal',
  'diatonic',
  'relative',
  'iiVI',
  'borrowed',
  'parallel',
  'dom7',
  'leadingTone',
  'chromaticMediant',
  'tritoneSub',
];

const CONSTRAINABLE_TYPES: EdgeType[] = EDGE_TYPES;

function compareSearchCost(a: SearchCost, b: SearchCost): number {
  if (a.steps !== b.steps) return a.steps - b.steps;
  if (a.ringChanges !== b.ringChanges) return a.ringChanges - b.ringChanges;
  return a.weight - b.weight;
}

function ringOf(nodeId: string): string {
  return nodeId.split('-')[0];
}

function pitchClassToNodeId(prefix: 'key' | 'minor' | 'dim', pc: number): string {
  const normalized = (pc + 120) % 12;
  if (prefix === 'key') return `key-${FIFTHS_ORDER.indexOf(normalized)}`;
  if (prefix === 'minor') return `minor-${FIFTHS_ORDER.indexOf((normalized + 3) % 12)}`;
  return `dim-${FIFTHS_ORDER.indexOf((normalized + 1) % 12)}`;
}

/**
 * Build a weighted adjacency list over 36 theory nodes (12 major, 12 minor, 12 dim).
 * All 5 edge types are always present — constraints are enforced at search time.
 */
export function buildPathGraph(): Map<string, PathEdge[]> {
  const adj = new Map<string, PathEdge[]>();

  // Initialize adjacency lists for all 36 nodes
  for (let i = 0; i < 12; i++) {
    adj.set(`key-${i}`, []);
    adj.set(`minor-${i}`, []);
    adj.set(`dim-${i}`, []);
  }

  // Circle-of-fifths edges (weight 1.0):
  // Movement up a perfect fifth (clockwise on the circle): root R → root (R+7)%12
  for (let i = 0; i < 12; i++) {
    const rootPc = FIFTHS_ORDER[i];
    const fifthUpPc = (rootPc + 7) % 12;

    const fifthMajPos = FIFTHS_ORDER.indexOf(fifthUpPc);
    adj.get(`key-${i}`)!.push({ target: `key-${fifthMajPos}`, weight: 1, type: 'fifth' });

    const minorRootPc = (rootPc + 9) % 12;
    const minorFifthUpPc = (minorRootPc + 7) % 12;
    const minorFifthMajPc = (minorFifthUpPc + 3) % 12;
    const minorFifthPos = FIFTHS_ORDER.indexOf(minorFifthMajPc);
    adj.get(`minor-${i}`)!.push({ target: `minor-${minorFifthPos}`, weight: 1, type: 'fifth' });

    const dimRootPc = (rootPc + 11) % 12;
    const dimFifthUpPc = (dimRootPc + 7) % 12;
    const dimFifthResolvePos = FIFTHS_ORDER.indexOf((dimFifthUpPc + 1) % 12);
    adj.get(`dim-${i}`)!.push({ target: `dim-${dimFifthResolvePos}`, weight: 1, type: 'fifth' });
  }

  // Plagal movement (IV -> I color): same root motion as a fifth, named separately when required.
  for (let i = 0; i < 12; i++) {
    const rootPc = FIFTHS_ORDER[i];
    adj.get(`key-${i}`)!.push({ target: pitchClassToNodeId('key', rootPc + 7), weight: 1.05, type: 'plagal' });
    const minorRootPc = (rootPc + 9) % 12;
    adj.get(`minor-${i}`)!.push({ target: pitchClassToNodeId('minor', minorRootPc + 7), weight: 1.05, type: 'plagal' });
  }

  // Diatonic neighbor movement inside each major key.
  for (let keyPc = 0; keyPc < 12; keyPc++) {
    const degrees = [
      pitchClassToNodeId('key', keyPc),
      pitchClassToNodeId('minor', keyPc + 2),
      pitchClassToNodeId('minor', keyPc + 4),
      pitchClassToNodeId('key', keyPc + 5),
      pitchClassToNodeId('key', keyPc + 7),
      pitchClassToNodeId('minor', keyPc + 9),
      pitchClassToNodeId('dim', keyPc + 11),
    ];
    for (let j = 0; j < degrees.length - 1; j++) {
      adj.get(degrees[j])!.push({ target: degrees[j + 1], weight: 1.1, type: 'diatonic' });
      adj.get(degrees[j + 1])!.push({ target: degrees[j], weight: 1.1, type: 'diatonic' });
    }
  }

  // Dom7 resolution (weight 1.0): V → I
  for (let i = 0; i < 12; i++) {
    const rootPc = FIFTHS_ORDER[i];

    const targetPc = (rootPc + 5) % 12;
    const targetMajPos = FIFTHS_ORDER.indexOf(targetPc);
    adj.get(`key-${i}`)!.push({ target: `key-${targetMajPos}`, weight: 1, type: 'dom7' });

    const minorMajPc = (targetPc + 3) % 12;
    const targetMinPos = FIFTHS_ORDER.indexOf(minorMajPc);
    adj.get(`key-${i}`)!.push({ target: `minor-${targetMinPos}`, weight: 1, type: 'dom7' });

    const minorRootPc = (rootPc + 9) % 12;
    const minorTargetPc = (minorRootPc + 5) % 12;
    const minorTargetMajPos = FIFTHS_ORDER.indexOf(minorTargetPc);
    adj.get(`minor-${i}`)!.push({ target: `key-${minorTargetMajPos}`, weight: 1, type: 'dom7' });

    const minorTargetMinMajPc = (minorTargetPc + 3) % 12;
    const minorTargetMinPos = FIFTHS_ORDER.indexOf(minorTargetMinMajPc);
    adj.get(`minor-${i}`)!.push({ target: `minor-${minorTargetMinPos}`, weight: 1, type: 'dom7' });

    const dimRootPc = (rootPc + 11) % 12;
    const dimTargetPc = (dimRootPc + 5) % 12;
    const dimTargetMajPos = FIFTHS_ORDER.indexOf(dimTargetPc);
    adj.get(`dim-${i}`)!.push({ target: `key-${dimTargetMajPos}`, weight: 1, type: 'dom7' });

    const dimTargetMinMajPc = (dimTargetPc + 3) % 12;
    const dimTargetMinPos = FIFTHS_ORDER.indexOf(dimTargetMinMajPc);
    adj.get(`dim-${i}`)!.push({ target: `minor-${dimTargetMinPos}`, weight: 1, type: 'dom7' });
  }

  // Relative major/minor swap (weight 0.5)
  for (let i = 0; i < 12; i++) {
    adj.get(`key-${i}`)!.push({ target: `minor-${i}`, weight: 0.5, type: 'relative' });
    adj.get(`minor-${i}`)!.push({ target: `key-${i}`, weight: 0.5, type: 'relative' });
  }

  // ii-V-I (weight 0.5): minor with root R -> major with root (R+10)%12
  for (let i = 0; i < 12; i++) {
    const minorRootPc = (FIFTHS_ORDER[i] + 9) % 12;
    const targetPc = (minorRootPc + 10) % 12;
    const targetMajPos = FIFTHS_ORDER.indexOf(targetPc);
    adj.get(`minor-${i}`)!.push({ target: `key-${targetMajPos}`, weight: 0.5, type: 'iiVI' });
  }

  // Borrowed/modal-mixture color: bIII, bVI, bVII, and iv from the parallel minor.
  for (let i = 0; i < 12; i++) {
    const rootPc = FIFTHS_ORDER[i];
    for (const offset of [3, 8, 10]) {
      const borrowedMaj = pitchClassToNodeId('key', rootPc + offset);
      adj.get(`key-${i}`)!.push({ target: borrowedMaj, weight: 1.35, type: 'borrowed' });
      adj.get(borrowedMaj)!.push({ target: `key-${i}`, weight: 1.35, type: 'borrowed' });
    }

    const minorIv = pitchClassToNodeId('minor', rootPc + 5);
    adj.get(`key-${i}`)!.push({ target: minorIv, weight: 1.35, type: 'borrowed' });
    adj.get(minorIv)!.push({ target: `key-${i}`, weight: 1.35, type: 'borrowed' });
  }

  // Parallel major/minor color, distinct from relative major/minor.
  for (let i = 0; i < 12; i++) {
    const rootPc = FIFTHS_ORDER[i];
    const parallelMinor = pitchClassToNodeId('minor', rootPc);
    adj.get(`key-${i}`)!.push({ target: parallelMinor, weight: 1.4, type: 'parallel' });
    adj.get(parallelMinor)!.push({ target: `key-${i}`, weight: 1.4, type: 'parallel' });
  }

  // Leading-tone neighborhood (weight 1.0): vii° resolves to I, and I/vi can move to vii°.
  for (let i = 0; i < 12; i++) {
    adj.get(`dim-${i}`)!.push({ target: `key-${i}`, weight: 1, type: 'leadingTone' });
    adj.get(`dim-${i}`)!.push({ target: `minor-${i}`, weight: 1, type: 'leadingTone' });
    adj.get(`key-${i}`)!.push({ target: `dim-${i}`, weight: 1, type: 'leadingTone' });
    adj.get(`minor-${i}`)!.push({ target: `dim-${i}`, weight: 1, type: 'leadingTone' });
  }

  // Chromatic mediants: same-quality roots a major/minor third apart.
  for (let i = 0; i < 12; i++) {
    const rootPc = FIFTHS_ORDER[i];
    for (const offset of [3, 4, 8, 9]) {
      adj.get(`key-${i}`)!.push({
        target: pitchClassToNodeId('key', rootPc + offset),
        weight: 1.7,
        type: 'chromaticMediant',
      });
      const minorRootPc = (rootPc + 9) % 12;
      adj.get(`minor-${i}`)!.push({
        target: pitchClassToNodeId('minor', minorRootPc + offset),
        weight: 1.7,
        type: 'chromaticMediant',
      });
    }
  }

  // Tritone substitute dominant resolution: substitute dominant resolves down a semitone.
  for (let i = 0; i < 12; i++) {
    const rootPc = FIFTHS_ORDER[i];
    adj.get(`key-${i}`)!.push({ target: pitchClassToNodeId('key', rootPc - 1), weight: 1.6, type: 'tritoneSub' });
    adj.get(`key-${i}`)!.push({ target: pitchClassToNodeId('minor', rootPc - 1), weight: 1.6, type: 'tritoneSub' });
  }

  return adj;
}

// Lazy singleton — graph is always the same now
let _pathGraph: Map<string, PathEdge[]> | null = null;
function getPathGraph(): Map<string, PathEdge[]> {
  if (!_pathGraph) _pathGraph = buildPathGraph();
  return _pathGraph;
}

export function getDirectEdgeTypes(from: string, to: string): EdgeType[] {
  const fromId = chordNameToNodeId(from);
  const toId = chordNameToNodeId(to);
  if (!fromId || !toId) return [];

  const graph = getPathGraph();
  const seen = new Set<EdgeType>();
  for (const edge of graph.get(fromId) ?? []) {
    if (edge.target === toId) {
      seen.add(edge.type);
    }
  }
  return Array.from(seen);
}

// ---------- Constrained Dijkstra ----------

/**
 * Find the shortest path between two nodes that satisfies all constraints.
 * Uses Dijkstra over expanded state space: (nodeId, satisfiedMask) where the mask
 * tracks which required edge types have been used so far.
 * Path length is minimized first, same-ring paths are preferred next,
 * and harmonic weights break any remaining ties.
 *
 * With all edge types constrainable, the expanded state space is still modest
 * for this 36-node theory graph.
 */
export function findConstrainedPath(
  adj: Map<string, PathEdge[]>,
  fromId: string,
  toId: string,
  requiredTypes: Set<EdgeType>,
): PathResult | null {
  // Build bitmask mapping for required types
  const typeToBit = new Map<EdgeType, number>();
  let bit = 0;
  for (const t of CONSTRAINABLE_TYPES) {
    if (requiredTypes.has(t)) {
      typeToBit.set(t, 1 << bit);
      bit++;
    }
  }
  const allRequiredMask = (1 << bit) - 1; // all bits set

  if (fromId === toId && allRequiredMask === 0) {
    return { path: [fromId], edgeTypes: [], totalWeight: 0 };
  }

  // State key: "nodeId|mask"
  const stateKey = (node: string, mask: number) => `${node}|${mask}`;

  const dist = new Map<string, SearchCost>();
  const prev = new Map<string, { node: string; mask: number; edgeType: EdgeType } | null>();
  const visited = new Set<string>();

  const startKey = stateKey(fromId, 0);
  dist.set(startKey, { steps: 0, ringChanges: 0, weight: 0 });
  prev.set(startKey, null);

  const queue: { node: string; mask: number; d: SearchCost }[] = [
    { node: fromId, mask: 0, d: { steps: 0, ringChanges: 0, weight: 0 } },
  ];

  while (queue.length > 0) {
    // Find minimum
    let minIdx = 0;
    for (let i = 1; i < queue.length; i++) {
      if (compareSearchCost(queue[i].d, queue[minIdx].d) < 0) minIdx = i;
    }
    const { node: u, mask: uMask, d: uCost } = queue.splice(minIdx, 1)[0];

    const uKey = stateKey(u, uMask);
    if (visited.has(uKey)) continue;
    visited.add(uKey);

    // Goal: reached target node with all constraints satisfied
    if (u === toId && uMask === allRequiredMask) break;

    const neighbors = adj.get(u);
    if (!neighbors) continue;

    for (const edge of neighbors) {
      // Compute new mask: set bit if this edge type is required
      const edgeBit = typeToBit.get(edge.type) ?? 0;
      const newMask = uMask | edgeBit;

      // Don't let the destination appear as a waypoint — only enter it when
      // all constraints are already satisfied by this move.
      if (edge.target === toId && newMask !== allRequiredMask) continue;

      const vKey = stateKey(edge.target, newMask);

      if (visited.has(vKey)) continue;
      const newCost = {
        steps: uCost.steps + 1,
        ringChanges: uCost.ringChanges + (ringOf(u) === ringOf(edge.target) ? 0 : 1),
        weight: uCost.weight + edge.weight,
      };
      const oldCost = dist.get(vKey);
      if (!oldCost || compareSearchCost(newCost, oldCost) < 0) {
        dist.set(vKey, newCost);
        prev.set(vKey, { node: u, mask: uMask, edgeType: edge.type });
        queue.push({ node: edge.target, mask: newMask, d: newCost });
      }
    }
  }

  const goalKey = stateKey(toId, allRequiredMask);
  const goalCost = dist.get(goalKey);
  if (!goalCost) return null;

  // Reconstruct path
  const path: string[] = [];
  const edgeTypes: EdgeType[] = [];
  let curNode = toId;
  let curMask = allRequiredMask;
  while (true) {
    path.unshift(curNode);
    const p = prev.get(stateKey(curNode, curMask));
    if (p) {
      edgeTypes.unshift(p.edgeType);
      curNode = p.node;
      curMask = p.mask;
    } else {
      break;
    }
  }

  return { path, edgeTypes, totalWeight: goalCost.weight };
}

// ---------- Explanation ----------

const EDGE_TYPE_LABELS: Record<EdgeType, string> = {
  fifth: 'P5 (fifth)',
  plagal: 'IV-I (plagal)',
  diatonic: 'diatonic neighbor',
  dom7: 'V\u2192I',
  relative: 'relative maj/min',
  iiVI: 'ii-V-I',
  borrowed: 'borrowed/modal mixture',
  parallel: 'parallel maj/min',
  leadingTone: 'vii\u00B0\u2192I',
  chromaticMediant: 'chromatic mediant',
  tritoneSub: 'tritone substitute',
};

/**
 * Plain-English explanation of one step in a path.
 */
export function explainStep(fromId: string, toId: string, edgeType: EdgeType): string {
  const fromName = nodeIdToChordName(fromId);
  const toName = nodeIdToChordName(toId);
  if (edgeType === 'leadingTone' && !fromId.startsWith('dim-') && toId.startsWith('dim-')) {
    return `${fromName} \u2192 ${toName} (I/vi\u2192vii\u00B0)`;
  }
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
 * Full pipeline: chord name → pathfinder ID → constrained shortest path → chord names back.
 * True edge-type options mean "path MUST include at least one edge of this type".
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

  const graph = getPathGraph();
  const requiredTypes = new Set<EdgeType>();
  for (const edgeType of CONSTRAINABLE_TYPES) {
    if (options[edgeType]) requiredTypes.add(edgeType);
  }

  const result = findConstrainedPath(graph, fromId, toId, requiredTypes);
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
