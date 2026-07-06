// Walk-diversity analysis: are we spanning the range of valid walks, or are
// filters / bottlenecks / determinism funneling everything into the same routes?
// Run: npx tsx analysis/walk-diversity.ts
import {
  findChordPath,
  getReachableDestinations,
  getAllChordNames,
  buildPathGraph,
  chordNameToNodeId,
  nodeIdToChordName,
  EDGE_TYPES,
  type EdgeType,
  type PathOptions,
} from '../src/core/chordPathfinder';

const { major, minor, dim } = getAllChordNames();
const ALL = [...major, ...minor, ...dim];
const START = 'C';

function hist<T>(items: T[]): Map<T, number> {
  const m = new Map<T, number>();
  for (const it of items) m.set(it, (m.get(it) ?? 0) + 1);
  return m;
}
function top<T>(m: Map<T, number>, n = 12): string {
  return [...m.entries()].sort((a, b) => b[1] - a[1]).slice(0, n)
    .map(([k, v]) => `${k}:${v}`).join('  ');
}
const line = (s = '') => console.log(s);
const rule = (t: string) => { line(); line(`===== ${t} =====`); };

// ---------- 1. Reachability from C under various constraints ----------
rule('1. Reachability from C (out of 35 destinations)');
const optionSets: Array<[string, PathOptions]> = [
  ['no constraints', {}],
  ['DEFAULT {fifth+relative}', { fifth: true, relative: true }],
];
for (const t of EDGE_TYPES) optionSets.push([`require ${t}`, { [t]: true } as PathOptions]);

for (const [label, opts] of optionSets) {
  const reach = getReachableDestinations(START, opts);
  const missing = ALL.filter(c => c !== START && !reach.has(c));
  line(`${label.padEnd(26)} reachable ${reach.size}/35` +
    (missing.length ? `   UNREACHABLE(${missing.length}): ${missing.join(' ')}` : '   (all reachable)'));
}

// ---------- 2. Global connectivity / bottleneck nodes ----------
rule('2. Global connectivity (no constraints) — can every node reach every other?');
let notFull = 0;
for (const c of ALL) {
  const reach = getReachableDestinations(c, {});
  if (reach.size < ALL.length - 1) {
    notFull++;
    const missing = ALL.filter(x => x !== c && !reach.has(x));
    line(`  ${c.padEnd(6)} reaches ${reach.size}/${ALL.length - 1}  missing: ${missing.join(' ')}`);
  }
}
line(notFull === 0 ? '  All 36 nodes reach all others — graph is strongly connected.' : `  ${notFull} nodes cannot reach everything.`);

// out-degree / in-degree per node (structural bottlenecks)
const graph = buildPathGraph();
const outDeg = new Map<string, number>();
const inDeg = new Map<string, number>();
for (const [u, edges] of graph) {
  outDeg.set(u, edges.length);
  for (const e of edges) inDeg.set(e.target, (inDeg.get(e.target) ?? 0) + 1);
}
const degRow = (m: Map<string, number>) =>
  [...m.entries()].sort((a, b) => a[1] - b[1]).slice(0, 6)
    .map(([k, v]) => `${nodeIdToChordName(k)}:${v}`).join('  ');
line(`  lowest out-degree: ${degRow(outDeg)}`);
line(`  lowest in-degree : ${degRow(inDeg)}`);

// ---------- 3. Path diversity from C ----------
function analyzeFromC(label: string, opts: PathOptions) {
  rule(`3. Path diversity from C — ${label}`);
  const firstHops: string[] = [];
  const intermediates: string[] = [];
  const usedEdgeTypes: EdgeType[] = [];
  const lengths: number[] = [];
  let count = 0;

  for (const dest of ALL) {
    if (dest === START) continue;
    const p = findChordPath(START, dest, opts);
    if (!p) continue;
    count++;
    lengths.push(p.chordNames.length - 1);
    firstHops.push(`${p.edgeTypes[0]}->${p.chordNames[1]}`);
    for (let i = 1; i < p.chordNames.length - 1; i++) intermediates.push(p.chordNames[i]);
    usedEdgeTypes.push(...p.edgeTypes);
  }

  const avgLen = (lengths.reduce((a, b) => a + b, 0) / lengths.length).toFixed(2);
  const lenHist = hist(lengths);
  line(`paths: ${count}   avg length: ${avgLen} hops   length dist: ${top(lenHist as Map<number, number>, 8)}`);
  line(`first hop out of C (funnel at source):`);
  line(`  ${top(hist(firstHops), 14)}`);
  line(`intermediate-node usage (bottleneck waypoints):`);
  line(`  ${top(hist(intermediates), 14)}`);
  const etUsed = hist(usedEdgeTypes);
  const neverUsed = EDGE_TYPES.filter(t => !etUsed.has(t));
  line(`edge-type usage across all C-paths:`);
  line(`  ${top(etUsed, 14)}`);
  line(`  NEVER used: ${neverUsed.length ? neverUsed.join(' ') : '(all edge types appear)'}`);
}
analyzeFromC('no constraints', {});
analyzeFromC('DEFAULT {fifth+relative}', { fifth: true, relative: true });

// ---------- 4. Directionality audit ----------
rule('4. Edge-type directionality (one-way edges create rotational funnels)');
for (const t of EDGE_TYPES) {
  let total = 0, symmetric = 0;
  for (const [u, edges] of graph) {
    for (const e of edges) {
      if (e.type !== t) continue;
      total++;
      const back = (graph.get(e.target) ?? []).some(b => b.type === t && b.target === u);
      if (back) symmetric++;
    }
  }
  const kind = symmetric === total ? 'bidirectional' : symmetric === 0 ? 'ONE-WAY' : 'mixed';
  line(`  ${t.padEnd(16)} ${symmetric}/${total} reciprocal  → ${kind}`);
}
