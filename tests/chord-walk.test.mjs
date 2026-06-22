/**
 * chord-walk pure function tests.
 * Run with: node tests/chord-walk.test.mjs
 *
 * Replicates core logic as pure functions (no DOM/React/TS imports)
 * to verify chord definitions, parsing, graph model, and chord detection.
 */

let passed = 0;
let failed = 0;

function assert(condition, message) {
  if (condition) {
    passed++;
  } else {
    failed++;
    console.error(`  FAIL: ${message}`);
  }
}

function assertEq(actual, expected, message) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a === e) {
    passed++;
  } else {
    failed++;
    console.error(`  FAIL: ${message} — expected ${e}, got ${a}`);
  }
}

function section(name) {
  console.log(`\n── ${name} ──`);
}

// ═══════════════════════════════════════════════════════════
// Replicated pure functions (matching src/core/*.ts)
// ═══════════════════════════════════════════════════════════

const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];

const FLAT_TO_SHARP = {
  'Db': 'C#', 'Eb': 'D#', 'Fb': 'E', 'Gb': 'F#', 'Ab': 'G#', 'Bb': 'A#', 'Cb': 'B',
};

function noteToPitchClass(name) {
  const sharp = FLAT_TO_SHARP[name] || name;
  return NOTE_NAMES.indexOf(sharp);
}

const QUALITY_INTERVALS = {
  major:  [0, 4, 7],
  minor:  [0, 3, 7],
  dim:    [0, 3, 6],
  aug:    [0, 4, 8],
  dom7:   [0, 4, 7, 10],
  maj7:   [0, 4, 7, 11],
  min7:   [0, 3, 7, 10],
  sus2:   [0, 2, 7],
  sus4:   [0, 5, 7],
};

const SUFFIX_TO_QUALITY = {
  '':     'major',
  'm':    'minor',
  'dim':  'dim',
  '\u00B0': 'dim',
  'aug':  'aug',
  '7':    'dom7',
  'maj7': 'maj7',
  'm7':   'min7',
  'sus2': 'sus2',
  'sus4': 'sus4',
};

function parseChordName(name) {
  if (!name || name.length === 0) return null;
  let root, suffix;
  if (name.length >= 2 && (name[1] === '#' || name[1] === 'b')) {
    root = name.slice(0, 2);
    suffix = name.slice(2);
  } else {
    root = name[0];
    suffix = name.slice(1);
  }
  return { root, suffix };
}

function getChordDefinition(name) {
  const parsed = parseChordName(name);
  if (!parsed) throw new Error(`Cannot parse: ${name}`);
  const rootPc = noteToPitchClass(parsed.root);
  if (rootPc < 0) throw new Error(`Unknown root: ${parsed.root}`);
  const quality = SUFFIX_TO_QUALITY[parsed.suffix];
  if (!quality) throw new Error(`Unknown suffix: ${parsed.suffix}`);
  const intervals = QUALITY_INTERVALS[quality];
  const pitchClasses = new Set(intervals.map(i => (rootPc + i) % 12));
  return { name, root: parsed.root, quality, pitchClasses };
}

// ── Chord Parser ──

const CHORD_RE = /^[A-G][#b]?(m|dim|aug|maj7|m7|7|sus2|sus4|add9|\u00B0)?$/;

function parseChordInput(input) {
  if (!input.trim()) return { chords: null, error: 'Chord input is required' };
  const tokens = input.split(',');
  const chords = [];
  for (const raw of tokens) {
    const t = raw.trim();
    if (!t) return { chords: null, error: 'Empty chord between commas' };
    if (!CHORD_RE.test(t)) return { chords: null, error: `Invalid chord: ${t}` };
    chords.push(t);
  }
  return { chords, error: null };
}

// ── Graph Model ──

const PALETTE = ['#e74c3c', '#3498db', '#2ecc71', '#f39c12', '#9b59b6', '#1abc9c'];

function buildGraph(progressions) {
  const nodes = new Map();
  const edges = new Map();

  for (const prog of progressions) {
    for (const chordName of prog.chords) {
      if (!nodes.has(chordName)) {
        nodes.set(chordName, {
          id: chordName,
          chord: getChordDefinition(chordName),
          inDeg: 0, outDeg: 0,
          progressions: new Set(),
        });
      }
      nodes.get(chordName).progressions.add(prog.name);
    }
    for (let i = 0; i < prog.chords.length - 1; i++) {
      const s = prog.chords[i], t = prog.chords[i + 1];
      const key = `${s}->${t}`;
      if (!edges.has(key)) {
        edges.set(key, { source: s, target: t, count: 0, contributors: new Map() });
      }
      const edge = edges.get(key);
      edge.count++;
      edge.contributors.set(prog.name, (edge.contributors.get(prog.name) || 0) + 1);
    }
  }

  for (const edge of edges.values()) {
    const sn = nodes.get(edge.source);
    const tn = nodes.get(edge.target);
    if (sn) sn.outDeg++;
    if (tn) tn.inDeg++;
  }

  return { nodes, edges };
}

function addProgression(state, name, chords) {
  if (state.progressions.some(p => p.name === name)) {
    return { state, error: 'Progression name already exists' };
  }
  const color = PALETTE[state.nextColorIndex % PALETTE.length];
  const newProg = { name, chords, color };
  const newProgressions = [...state.progressions, newProg];
  const { nodes, edges } = buildGraph(newProgressions);
  return {
    state: { nodes, edges, progressions: newProgressions, nextColorIndex: state.nextColorIndex + 1 },
    error: null,
  };
}

function removeProgression(state, name) {
  const newProgressions = state.progressions.filter(p => p.name !== name);
  const { nodes, edges } = buildGraph(newProgressions);
  return { nodes, edges, progressions: newProgressions, nextColorIndex: state.nextColorIndex };
}

function emptyGraphState() {
  return { nodes: new Map(), edges: new Map(), progressions: [], nextColorIndex: 0 };
}

// ── Chord Detection ──

function detectChords(heldMidiNotes, graphNodes) {
  if (heldMidiNotes.size === 0) return [];
  const heldPitchClasses = new Set();
  for (const note of heldMidiNotes) heldPitchClasses.add(note % 12);

  const matches = [];
  for (const [id, node] of graphNodes) {
    let isSubset = true;
    for (const pc of node.chord.pitchClasses) {
      if (!heldPitchClasses.has(pc)) { isSubset = false; break; }
    }
    if (isSubset) matches.push({ id, size: node.chord.pitchClasses.size });
  }

  matches.sort((a, b) => b.size - a.size);
  return matches.map(m => m.id);
}

// ═══════════════════════════════════════════════════════════
// Tests
// ═══════════════════════════════════════════════════════════

section('Chord Definitions — pitch class sets');

{
  const c = getChordDefinition('C');
  assert(c.quality === 'major', 'C is major');
  assertEq([...c.pitchClasses].sort((a,b) => a-b), [0, 4, 7], 'C major pitch classes');
}

{
  const am = getChordDefinition('Am');
  assert(am.quality === 'minor', 'Am is minor');
  assertEq([...am.pitchClasses].sort((a,b) => a-b), [0, 4, 9], 'Am pitch classes: A=9, C=0, E=4');
}

{
  const g7 = getChordDefinition('G7');
  assert(g7.quality === 'dom7', 'G7 is dom7');
  assertEq([...g7.pitchClasses].sort((a,b) => a-b), [2, 5, 7, 11], 'G7 pitch classes: G=7, B=11, D=2, F=5');
}

{
  const ebm = getChordDefinition('Ebm');
  assert(ebm.quality === 'minor', 'Ebm is minor');
  const rootPc = noteToPitchClass('Eb');
  assertEq(rootPc, 3, 'Eb pitch class = 3 (D#)');
  assertEq([...ebm.pitchClasses].sort((a,b) => a-b), [3, 6, 10], 'Ebm pitch classes: Eb=3, Gb=6, Bb=10');
}

{
  const fsharp_dim = getChordDefinition('F#dim');
  assert(fsharp_dim.quality === 'dim', 'F#dim is dim');
  assertEq([...fsharp_dim.pitchClasses].sort((a,b) => a-b), [0, 6, 9], 'F#dim: F#=6, A=9, C=0');
}

{
  const gsus4 = getChordDefinition('Gsus4');
  assert(gsus4.quality === 'sus4', 'Gsus4 is sus4');
  assertEq([...gsus4.pitchClasses].sort((a,b) => a-b), [0, 2, 7], 'Gsus4: G=7, C=0, D=2');
}

{
  const bmaj7 = getChordDefinition('Bmaj7');
  assert(bmaj7.quality === 'maj7', 'Bmaj7 is maj7');
  assertEq([...bmaj7.pitchClasses].sort((a,b) => a-b), [3, 6, 10, 11], 'Bmaj7: B=11, D#=3, F#=6, A#=10');
}

section('Chord Parser — valid inputs');

{
  const { chords, error } = parseChordInput('G, D, A, G');
  assert(error === null, 'No error for valid input');
  assertEq(chords, ['G', 'D', 'A', 'G'], 'Parsed G, D, A, G');
}

{
  const { chords, error } = parseChordInput('Eb, Bb, Cm, Ab, Eb');
  assert(error === null, 'No error for Eb progression');
  assertEq(chords, ['Eb', 'Bb', 'Cm', 'Ab', 'Eb'], 'Parsed flat chord progression');
}

{
  const { chords, error } = parseChordInput('Am');
  assert(error === null, 'Single chord valid');
  assertEq(chords, ['Am'], 'Single Am');
}

{
  const { chords, error } = parseChordInput('C7, Dm7, G7, Cmaj7');
  assert(error === null, 'Seventh chords valid');
  assertEq(chords, ['C7', 'Dm7', 'G7', 'Cmaj7'], 'Seventh chords parsed');
}

section('Chord Parser — invalid inputs');

{
  const { chords, error } = parseChordInput('');
  assert(error !== null, 'Error on empty input');
  assert(chords === null, 'No chords on empty');
}

{
  const { error } = parseChordInput('H');
  assert(error !== null, 'Error on invalid note H');
}

{
  const { error } = parseChordInput('G,,D');
  assert(error !== null, 'Error on double comma');
}

{
  const { error } = parseChordInput('G, Xyz, D');
  assert(error !== null, 'Error on Xyz');
}

section('Graph Model — build graph');

{
  const state = emptyGraphState();
  const { state: s1 } = addProgression(state, 'Default', ['G', 'D', 'A', 'G']);
  assertEq(s1.nodes.size, 3, '3 nodes for G, D, A');
  assertEq(s1.edges.size, 3, '3 edges: G->D, D->A, A->G');
  assert(s1.edges.has('G->D'), 'Has G->D edge');
  assert(s1.edges.has('D->A'), 'Has D->A edge');
  assert(s1.edges.has('A->G'), 'Has A->G edge');
}

section('Graph Model — degree calculation');

{
  const state = emptyGraphState();
  const { state: s1 } = addProgression(state, 'Test', ['G', 'D', 'A', 'G']);

  const g = s1.nodes.get('G');
  const d = s1.nodes.get('D');
  const a = s1.nodes.get('A');

  // G: out to D (G->D), in from A (A->G) = 1 in, 1 out
  assertEq(g.inDeg, 1, 'G inDeg=1');
  assertEq(g.outDeg, 1, 'G outDeg=1');

  // D: in from G (G->D), out to A (D->A) = 1 in, 1 out
  assertEq(d.inDeg, 1, 'D inDeg=1');
  assertEq(d.outDeg, 1, 'D outDeg=1');

  // A: in from D (D->A), out to G (A->G) = 1 in, 1 out
  assertEq(a.inDeg, 1, 'A inDeg=1');
  assertEq(a.outDeg, 1, 'A outDeg=1');
}

section('Graph Model — self-loop');

{
  const state = emptyGraphState();
  const { state: s1 } = addProgression(state, 'Loop', ['G', 'G', 'D']);

  assert(s1.edges.has('G->G'), 'Has self-loop G->G');
  assert(s1.edges.has('G->D'), 'Has G->D');
  assertEq(s1.edges.size, 2, '2 edges total');

  const g = s1.nodes.get('G');
  // G->G contributes 1 in + 1 out. G->D contributes 1 out.
  assertEq(g.inDeg, 1, 'G inDeg=1 (self-loop)');
  assertEq(g.outDeg, 2, 'G outDeg=2 (self-loop + G->D)');
}

section('Graph Model — merging progressions');

{
  const state = emptyGraphState();
  const { state: s1 } = addProgression(state, 'Verse', ['G', 'D', 'A', 'G']);
  const { state: s2 } = addProgression(s1, 'Chorus', ['D', 'A', 'G', 'D']);

  // Shared nodes: G, D, A
  assertEq(s2.nodes.size, 3, 'Still 3 unique nodes');

  // Edge G->D: contributed by Verse
  // Edge D->A: contributed by both Verse and Chorus
  const daEdge = s2.edges.get('D->A');
  assertEq(daEdge.count, 2, 'D->A count=2');
  assertEq(daEdge.contributors.size, 2, 'D->A has 2 contributors');

  // New edges from Chorus: A->G already exists from Verse, G->D already exists
  // Chorus adds: D->A (exists), A->G (exists), G->D (exists)
  // So edge count for A->G should be 2
  const agEdge = s2.edges.get('A->G');
  assertEq(agEdge.count, 2, 'A->G count=2');
}

section('Graph Model — duplicate progression name rejected');

{
  const state = emptyGraphState();
  const { state: s1 } = addProgression(state, 'Test', ['G', 'D']);
  const { state: s2, error } = addProgression(s1, 'Test', ['A', 'E']);
  assert(error !== null, 'Error on duplicate name');
  assertEq(s2.nodes.size, s1.nodes.size, 'State unchanged on duplicate');
}

section('Graph Model — removal');

{
  const state = emptyGraphState();
  const { state: s1 } = addProgression(state, 'Verse', ['G', 'D', 'A']);
  const { state: s2 } = addProgression(s1, 'Chorus', ['D', 'A', 'E']);

  assertEq(s2.nodes.size, 4, '4 nodes: G, D, A, E');

  const s3 = removeProgression(s2, 'Chorus');
  assertEq(s3.nodes.size, 3, '3 nodes after removing Chorus: G, D, A');
  assert(!s3.nodes.has('E'), 'E removed');
  assert(!s3.edges.has('A->E'), 'A->E edge removed');
  assertEq(s3.nextColorIndex, s2.nextColorIndex, 'Color index preserved');
}

section('Graph Model — reciprocal edges');

{
  const state = emptyGraphState();
  const { state: s1 } = addProgression(state, 'Test', ['A', 'B', 'A']);

  assert(s1.edges.has('A->B'), 'Has A->B');
  assert(s1.edges.has('B->A'), 'Has B->A');

  // Both keys should be in the reciprocal set
  const edgeKeys = new Set(s1.edges.keys());
  let reciprocals = new Set();
  for (const [key, edge] of s1.edges) {
    const rev = `${edge.target}->${edge.source}`;
    if (edgeKeys.has(rev)) reciprocals.add(key);
  }
  assert(reciprocals.has('A->B'), 'A->B is reciprocal');
  assert(reciprocals.has('B->A'), 'B->A is reciprocal');
}

section('Graph Model — color assignment monotonic');

{
  const state = emptyGraphState();
  const { state: s1 } = addProgression(state, 'P1', ['G', 'D']);
  const { state: s2 } = addProgression(s1, 'P2', ['A', 'E']);
  const { state: s3 } = addProgression(s2, 'P3', ['C', 'F']);

  assertEq(s1.progressions[0].color, PALETTE[0], 'P1 gets color 0');
  assertEq(s2.progressions[1].color, PALETTE[1], 'P2 gets color 1');
  assertEq(s3.progressions[2].color, PALETTE[2], 'P3 gets color 2');

  // Remove P2, add P4 — should get color 3, not color 1
  const s4 = removeProgression(s3, 'P2');
  const { state: s5 } = addProgression(s4, 'P4', ['B', 'F#']);
  assertEq(s5.progressions.find(p => p.name === 'P4').color, PALETTE[3], 'P4 gets color 3 (not recycled)');
}

section('Chord Detection — exact match');

{
  const state = emptyGraphState();
  const { state: s1 } = addProgression(state, 'Test', ['G', 'D', 'Am']);

  // G major = G(7), B(11), D(2) — play exactly those notes
  const held = new Set([55, 59, 62]); // G3, B3, D4
  const matches = detectChords(held, s1.nodes);
  assert(matches.includes('G'), 'G matched when playing G,B,D');
  assert(!matches.includes('D'), 'D not matched');
  assert(!matches.includes('Am'), 'Am not matched');
}

section('Chord Detection — superset (extra notes still match)');

{
  const state = emptyGraphState();
  const { state: s1 } = addProgression(state, 'Test', ['G']);

  // Play G major + extra F# note
  const held = new Set([55, 59, 62, 66]); // G3, B3, D4, F#4
  const matches = detectChords(held, s1.nodes);
  assert(matches.includes('G'), 'G still matched with extra notes');
}

section('Chord Detection — no match');

{
  const state = emptyGraphState();
  const { state: s1 } = addProgression(state, 'Test', ['G', 'D']);

  // Play only G and B (missing D for G major triad)
  const held = new Set([55, 59]); // G3, B3
  const matches = detectChords(held, s1.nodes);
  assertEq(matches.length, 0, 'No match with incomplete chord');
}

section('Chord Detection — empty held notes');

{
  const state = emptyGraphState();
  const { state: s1 } = addProgression(state, 'Test', ['G', 'D']);

  const matches = detectChords(new Set(), s1.nodes);
  assertEq(matches.length, 0, 'No match with empty held notes');
}

section('Chord Detection — multi-match');

{
  const state = emptyGraphState();
  const { state: s1 } = addProgression(state, 'Test', ['G', 'D', 'Am']);

  // Play notes that match both G and Am:
  // G = {7, 11, 2}, Am = {9, 0, 4}
  // Need to play all of G's AND all of Am's pitch classes
  // G+B+D+A+C+E = {7, 11, 2, 9, 0, 4}
  const held = new Set([55, 59, 62, 57, 60, 64]); // G3, B3, D4, A3, C4, E4
  const matches = detectChords(held, s1.nodes);
  assert(matches.includes('G'), 'G matched in multi');
  assert(matches.includes('Am'), 'Am matched in multi');
}

section('Chord Detection — prefer most specific');

{
  const state = emptyGraphState();
  const { state: s1 } = addProgression(state, 'Test', ['G', 'G7']);

  // G = {7, 11, 2} (3 pitch classes), G7 = {7, 11, 2, 5} (4 pitch classes)
  // Play full G7 chord: G, B, D, F
  const held = new Set([55, 59, 62, 65]); // G3, B3, D4, F4
  const matches = detectChords(held, s1.nodes);
  assertEq(matches.length, 2, 'Both G and G7 match');
  assertEq(matches[0], 'G7', 'G7 ranks first (more specific)');
  assertEq(matches[1], 'G', 'G ranks second');
}

section('Chord Detection — inversions work (octave-invariant)');

{
  const state = emptyGraphState();
  const { state: s1 } = addProgression(state, 'Test', ['C']);

  // C major = {0, 4, 7} — play E2, G3, C5 (first inversion spread)
  const held = new Set([40, 55, 72]); // E2, G3, C5
  const matches = detectChords(held, s1.nodes);
  assert(matches.includes('C'), 'C matched in inversion');
}

section('Graph Model — node appears in multiple progressions');

{
  const state = emptyGraphState();
  const { state: s1 } = addProgression(state, 'V1', ['G', 'D']);
  const { state: s2 } = addProgression(s1, 'V2', ['D', 'A']);

  const d = s2.nodes.get('D');
  assertEq(d.progressions.size, 2, 'D appears in 2 progressions');
  assert(d.progressions.has('V1'), 'D in V1');
  assert(d.progressions.has('V2'), 'D in V2');
}

section('Edge Style — by target quality');

{
  // Inline the getEdgeStyle logic for testing
  function getEdgeStyle(quality) {
    switch (quality) {
      case 'major':  return { stroke: '#4a9eff', strokeWidth: 2.5, strokeDasharray: '' };
      case 'minor':  return { stroke: '#a0a0a0', strokeWidth: 2, strokeDasharray: '6 3' };
      case 'dom7':   return { stroke: '#f59e0b', strokeWidth: 3, strokeDasharray: '' };
      case 'maj7':   return { stroke: '#60a5fa', strokeWidth: 2.5, strokeDasharray: '' };
      case 'min7':   return { stroke: '#9ca3af', strokeWidth: 2, strokeDasharray: '6 3' };
      case 'dim':    return { stroke: '#ef4444', strokeWidth: 2, strokeDasharray: '2 2' };
      case 'aug':    return { stroke: '#a855f7', strokeWidth: 2, strokeDasharray: '8 3 2 3' };
      default:       return { stroke: '#4a9eff', strokeWidth: 2, strokeDasharray: '' };
    }
  }

  const majorStyle = getEdgeStyle('major');
  assertEq(majorStyle.stroke, '#4a9eff', 'Major edge blue');
  assertEq(majorStyle.strokeDasharray, '', 'Major edge solid');

  const minorStyle = getEdgeStyle('minor');
  assertEq(minorStyle.stroke, '#a0a0a0', 'Minor edge gray');
  assertEq(minorStyle.strokeDasharray, '6 3', 'Minor edge dashed');

  const dom7Style = getEdgeStyle('dom7');
  assertEq(dom7Style.stroke, '#f59e0b', 'Dom7 edge amber');
  assertEq(dom7Style.strokeWidth, 3, 'Dom7 edge width 3');

  const dimStyle = getEdgeStyle('dim');
  assertEq(dimStyle.strokeDasharray, '2 2', 'Dim edge dotted');
}

section('MIDI note name conversion');

{
  function midiNoteToName(note) {
    const names = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
    const octave = Math.floor(note / 12) - 1;
    return `${names[note % 12]}${octave}`;
  }

  assertEq(midiNoteToName(60), 'C4', 'MIDI 60 = C4');
  assertEq(midiNoteToName(69), 'A4', 'MIDI 69 = A4');
  assertEq(midiNoteToName(55), 'G3', 'MIDI 55 = G3');
  assertEq(midiNoteToName(21), 'A0', 'MIDI 21 = A0');
}

// ═══════════════════════════════════════════════════════════
// Summary
// ═══════════════════════════════════════════════════════════

console.log(`\n${'═'.repeat(50)}`);
console.log(`Results: ${passed} passed, ${failed} failed (${passed + failed} total)`);

if (failed > 0) {
  process.exit(1);
} else {
  console.log('All tests passed!');
}
