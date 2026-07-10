/**
 * theory-core package tests.
 * Run with: npx tsx tests/theory-core.test.ts
 *
 * Unlike tests/chord-walk.test.mjs (which REPLICATES core logic as an
 * executable spec), this suite imports the actual theory-core package, so it
 * fails if the extraction/packaging is broken.
 */

import {
  FIFTHS_ORDER,
  EDGE_TYPES,
  chordNameToNodeId,
  nodeIdToChordName,
  findChordPath,
  transposeChord,
  getAllChordNames,
  getTheoryChordNodes,
  getChordDefinition,
  parseChordInput,
  detectChords,
  midiNoteToName,
  CYCLE_PRESETS,
  MOODS,
  classifyPresetMood,
  moodTonicQuality,
  presetsForMood,
  EDGE_TYPE_INFO,
  EDGE_TYPE_ORDER,
} from 'theory-core';

let passed = 0;
let failed = 0;

function assert(condition: boolean, message: string) {
  if (condition) {
    passed++;
  } else {
    failed++;
    console.error(`  FAIL: ${message}`);
  }
}

function assertEq(actual: unknown, expected: unknown, message: string) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a === e) {
    passed++;
  } else {
    failed++;
    console.error(`  FAIL: ${message} — expected ${e}, got ${a}`);
  }
}

function section(name: string) {
  console.log(`\n── ${name} ──`);
}

section('package surface');
assertEq(FIFTHS_ORDER, [0, 7, 2, 9, 4, 11, 6, 1, 8, 3, 10, 5], 'FIFTHS_ORDER');
assertEq(EDGE_TYPES.length, 10, '10 edge types');
assertEq(EDGE_TYPE_ORDER.length, 10, 'EDGE_TYPE_ORDER covers all types');
for (const et of EDGE_TYPES) {
  assert(!!EDGE_TYPE_INFO[et], `EDGE_TYPE_INFO has entry for ${et}`);
}

section('chord definitions');
assertEq([...getChordDefinition('C').pitchClasses].sort((a, b) => a - b), [0, 4, 7], 'C major pitch classes');
assertEq([...getChordDefinition('Gm7').pitchClasses].sort((a, b) => a - b), [2, 5, 7, 10], 'Gm7 pitch classes');
assertEq([...getChordDefinition('Bb').pitchClasses].sort((a, b) => a - b), [2, 5, 10], 'flat spelling maps to correct pitch classes');

section('node id mapping (critical detail)');
assertEq(chordNameToNodeId('C'), 'key-0', 'C → key-0');
assertEq(chordNameToNodeId('Am'), 'minor-0', 'Am → minor-0 (relative major slot)');
assertEq(chordNameToNodeId('Bdim'), 'dim-0', 'Bdim → dim-0');
assertEq(chordNameToNodeId('Caug'), null, 'aug rejected');
for (const name of ['C', 'F#', 'Am', 'D#m', 'Bdim', 'Gdim']) {
  const id = chordNameToNodeId(name);
  assert(id !== null && nodeIdToChordName(id) === name, `roundtrip ${name} ↔ ${id}`);
}

section('theory graph');
const names = getAllChordNames();
assertEq([names.major.length, names.minor.length, names.dim.length], [12, 12, 12], '12 chords per ring');
assertEq(getTheoryChordNodes().size, 36, '36 theory nodes');

section('pathfinding');
const direct = findChordPath('C', 'G', {});
assert(direct !== null, 'C→G path exists');
assertEq(direct!.chordNames[0], 'C', 'path starts at C');
assertEq(direct!.chordNames[direct!.chordNames.length - 1], 'G', 'path ends at G');
assertEq(direct!.edgeTypes.length, direct!.chordNames.length - 1, 'one edge per hop');
const constrained = findChordPath('C', 'G', { relative: true });
assert(constrained !== null && constrained.edgeTypes.includes('relative'), 'must-include relative honored');

section('interval arithmetic');
assertEq(transposeChord('C', 7, 'same'), 'G', 'C +7 same → G');
assertEq(transposeChord('C', 9, 'minor'), 'Am', 'C +9 minor → Am');

section('chord parsing');
assert(parseChordInput('C, G, Am, F').chords !== null, 'valid progression parses');
assert(parseChordInput('C, Zx9').error !== null, 'invalid chord rejected');

section('midi + detection');
assertEq(midiNoteToName(60), 'C4', 'MIDI 60 → C4');
const detected = detectChords(new Set([60, 64, 67]), getTheoryChordNodes() as Parameters<typeof detectChords>[1]);
assert(detected.includes('C'), 'held C-E-G detects C major');

section('cycle presets + mood');
assert(CYCLE_PRESETS.length > 0, 'CYCLE_PRESETS non-empty');
assertEq(MOODS.length, 4, 'four moods (any/happy/melancholy/dramatic)');
assertEq(moodTonicQuality('happy'), 'major', 'happy anchors major');
assertEq(moodTonicQuality('melancholy'), 'minor', 'melancholy anchors minor');
assertEq(moodTonicQuality('any'), null, 'any does not anchor');
const buckets = { happy: 0, melancholy: 0, dramatic: 0 };
for (const p of CYCLE_PRESETS) buckets[classifyPresetMood(p)]++;
assert(buckets.happy > 0 && buckets.melancholy > 0 && buckets.dramatic > 0, 'every mood has presets');
assertEq(
  buckets.happy + buckets.melancholy + buckets.dramatic,
  CYCLE_PRESETS.length,
  'mood classification partitions all presets',
);
for (const mood of ['happy', 'melancholy', 'dramatic'] as const) {
  assertEq(presetsForMood(mood).length, buckets[mood], `presetsForMood(${mood}) matches classification`);
}
assertEq(presetsForMood('any').length, CYCLE_PRESETS.length, 'any mood keeps all presets');

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
