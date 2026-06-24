/**
 * Chord progression analysis across the PDF song library.
 * Run: npx tsx analysis/analyze-songs.ts
 *
 * For each song, extracts the chord sequence, maps it through the pathfinder
 * graph, and classifies every chord-to-chord move by edge type. Then aggregates
 * across the full library to show which Walk constraints would match which songs.
 */

import { readFileSync, readdirSync, writeFileSync } from 'fs';
import { join, dirname, basename } from 'path';
import { fileURLToPath } from 'url';
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
// pdf-parse v1 exports the parse function directly
const pdfParse: (buf: Buffer) => Promise<{ text: string }> = require('pdf-parse');
import {
  chordNameToNodeId,
  getDirectEdgeTypes,
  EDGE_TYPES,
  nodeIdToChordName,
} from '../src/core/chordPathfinder.js';
import type { EdgeType } from '../src/core/chordPathfinder.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const MUSIC_DIR = join(__dirname, '..', 'music');

// ---------------------------------------------------------------------------
// Chord token recognition and splitting
// ---------------------------------------------------------------------------

// Chord quality suffixes ordered longest-first so matching is greedy.
const QUALITY_SUFFIXES = ['maj7', 'maj', 'm7', 'm', 'dim7', 'dim', 'aug', 'sus4', 'sus2', 'sus'];

const CHORD_RE =
  /^[A-G][#b]?(maj7|maj|m7|m|dim7?|aug|sus[24]?|add\d*|\d+)?(?:\/[A-G][#b]?)?$/;

function isChordToken(token: string): boolean {
  return CHORD_RE.test(token);
}

/** Strip slash bass note, leaving just the root+quality. */
function normalizeChord(token: string): string {
  return token.split('/')[0];
}

/**
 * PDF extraction often concatenates adjacent chords into one token when they
 * come from different font runs (e.g. "F/CC" or "AmFmaj7"). This function
 * tries to split a non-matching token back into individual chord tokens using
 * the chord grammar. Returns null if any fragment is not a valid chord.
 */
function splitChordToken(token: string): string[] | null {
  if (isChordToken(token)) return [token];

  const result: string[] = [];
  let i = 0;

  while (i < token.length) {
    if (!/[A-G]/.test(token[i])) return null; // unexpected character, give up

    let chord = token[i++];

    // Optional accidental
    if (i < token.length && (token[i] === '#' || token[i] === 'b')) {
      chord += token[i++];
    }

    // Quality suffix — longest match first
    let matched = false;
    for (const s of QUALITY_SUFFIXES) {
      if (token.slice(i).startsWith(s)) {
        chord += s;
        i += s.length;
        matched = true;
        break;
      }
    }
    // Numeric suffix (6, 7, 9, 11, 13, …) only if no alphabetic suffix matched
    if (!matched && i < token.length && /\d/.test(token[i])) {
      while (i < token.length && /\d/.test(token[i])) chord += token[i++];
    }

    // Optional slash bass: /[A-G][#b]?
    if (i < token.length && token[i] === '/' && i + 1 < token.length && /[A-G]/.test(token[i + 1])) {
      chord += token[i++]; // '/'
      chord += token[i++]; // bass root
      if (i < token.length && (token[i] === '#' || token[i] === 'b')) chord += token[i++];
    }

    result.push(chord);
  }

  return result.length > 0 ? result : null;
}

/**
 * A "chord line" has all non-empty tokens (after stripping notation noise)
 * either directly matching the chord pattern or splittable into valid chords.
 * Section headers [Verse], lyric lines, and definition lines (G* = Gsus4)
 * are excluded.
 */
function extractChordsFromLine(line: string): string[] | null {
  const trimmed = line.trim();
  if (!trimmed || trimmed.startsWith('[') || trimmed.includes('=')) return null;

  const clean = trimmed
    .replace(/\|/g, ' ')       // bar lines
    .replace(/[()]/g, ' ')     // parenthesized optional chords like (C G/B)
    .replace(/X\d+/gi, ' ')    // repeat markers X2, X4
    .replace(/\*/g, '');       // G* shorthand → G

  const rawTokens = clean.split(/\s+/).filter(Boolean);
  if (rawTokens.length === 0) return null;

  const chords: string[] = [];
  for (const tok of rawTokens) {
    const pieces = splitChordToken(tok);
    if (!pieces) return null; // not all-chord line
    chords.push(...pieces.map(normalizeChord));
  }
  return chords;
}

async function extractChordsFromPDF(filePath: string): Promise<string[]> {
  const buffer = readFileSync(filePath);
  const data = await pdfParse(buffer);
  const lines = data.text.split('\n');
  const chords: string[] = [];

  for (const line of lines) {
    const lineChords = extractChordsFromLine(line);
    if (lineChords) chords.push(...lineChords);
  }

  // Deduplicate consecutive identical chords (same chord held across bars)
  const deduped: string[] = [];
  for (const c of chords) {
    if (deduped[deduped.length - 1] !== c) deduped.push(c);
  }
  return deduped;
}

// ---------------------------------------------------------------------------
// Edge classification
// ---------------------------------------------------------------------------

interface EdgeResult {
  from: string;
  to: string;
  types: EdgeType[];
  mappable: boolean; // both chords mapped to the 36-node graph
}

function safeMapChord(name: string): string | null {
  try { return chordNameToNodeId(name); } catch { return null; }
}

function classifyEdges(chords: string[]): EdgeResult[] {
  const results: EdgeResult[] = [];
  for (let i = 0; i < chords.length - 1; i++) {
    const from = chords[i];
    const to = chords[i + 1];
    if (from === to) continue;

    const fromId = safeMapChord(from);
    const toId = safeMapChord(to);

    if (!fromId || !toId) {
      results.push({ from, to, types: [], mappable: false });
      continue;
    }

    const types = getDirectEdgeTypes(nodeIdToChordName(fromId), nodeIdToChordName(toId));
    results.push({ from, to, types, mappable: true });
  }
  return results;
}

// ---------------------------------------------------------------------------
// Cycle detection
// ---------------------------------------------------------------------------

/**
 * Build the edge-type sequence for a chord sequence (key-agnostic).
 * Each element is the primary (first) edge type for that transition,
 * or '_' if unmappable.
 */
function edgeTypeSequence(chords: string[]): string[] {
  const seq: string[] = [];
  for (let i = 0; i < chords.length - 1; i++) {
    if (chords[i] === chords[i + 1]) continue;
    const fromId = safeMapChord(chords[i]);
    const toId = safeMapChord(chords[i + 1]);
    if (!fromId || !toId) { seq.push('_'); continue; }
    const types = getDirectEdgeTypes(nodeIdToChordName(fromId), nodeIdToChordName(toId));
    seq.push(types[0] ?? '_');
  }
  return seq;
}

interface CycleEntry {
  loop: string;          // the looping chords/edge-types (canonical for edge cycles)
  loopBack: string;      // the closing edge/chord back to start
  length: number;
  songCount: number;
  totalOccurrences: number;
  exampleSongs: string[];
  exampleChords: string;
}

/**
 * Extract all closed cycles of length `n` from a chord sequence.
 * A closed cycle is a run [c0, c1, ..., c_{n-1}, c0] — the last chord
 * is the same as the first, so the loop closes. We record the loop body
 * (without the repeated closing chord) as the cycle identity.
 *
 * For edge-type cycles: same idea over the edge-type sequence, where
 * we also need the loop-back edge type from c_{n-1} → c0.
 */
function extractChordCycles(chords: string[], n: number): string[] {
  const results: string[] = [];
  // We look for windows of length n+1 where first == last
  for (let i = 0; i <= chords.length - (n + 1); i++) {
    if (chords[i] === chords[i + n]) {
      results.push(chords.slice(i, i + n).join(' '));
    }
  }
  return results;
}

/**
 * Normalize an edge-type sequence to its lexicographically smallest rotation
 * so that e.g. "dom7 fifth" and "fifth dom7" both map to "dom7 fifth".
 * Returns { canonical, offset } where offset is the rotation applied.
 */
function canonicalEdgeCycle(edges: string[]): { canonical: string[]; offset: number } {
  let best = edges.join('\x00');
  let bestOffset = 0;
  for (let r = 1; r < edges.length; r++) {
    const rotated = [...edges.slice(r), ...edges.slice(0, r)].join('\x00');
    if (rotated < best) { best = rotated; bestOffset = r; }
  }
  return { canonical: best.split('\x00'), offset: bestOffset };
}

function extractEdgeTypeCycles(
  chords: string[],
  edgeSeq: string[],
  n: number,
): Array<{ loop: string; closingEdge: string; exampleChords: string }> {
  // edgeSeq[i] is the edge from chords[i] to chords[i+1].
  // An n-step cycle closes when chords[i] === chords[i+n]:
  //   edges: edgeSeq[i..i+n-1], where the LAST is the closing edge back to chords[i].
  // We canonicalize by rotating to the smallest lexicographic form so that
  //   "dom7 fifth" and "fifth dom7" are counted as the same cycle.
  const results: Array<{ loop: string; closingEdge: string; exampleChords: string }> = [];
  for (let i = 0; i <= chords.length - (n + 1); i++) {
    if (chords[i] !== chords[i + n]) continue;
    const edgeSlice = edgeSeq.slice(i, i + n);
    if (edgeSlice.length < n || edgeSlice.includes('_')) continue;

    const { canonical, offset } = canonicalEdgeCycle(edgeSlice);
    // Rotate the chord example so it starts at the canonical offset.
    // Original chords: [c_i, c_{i+1}, ..., c_{i+n-1}, c_i] (first == last)
    // After rotation by `offset`: start at c_{i+offset}, wrap around.
    const baseChords = chords.slice(i, i + n); // n chords (no trailing repeat)
    const rotatedChords = [
      ...baseChords.slice(offset),
      ...baseChords.slice(0, offset + 1), // +1 adds the closing repeat of the start chord
    ];

    results.push({
      loop: canonical.join(' '),
      closingEdge: canonical[canonical.length - 1],
      exampleChords: rotatedChords.join(' '),
    });
  }
  return results;
}

function findCycles(
  songs: Array<{ title: string; chords: string[]; edgeSeq: string[] }>,
  minSongs: number,
  minLen: number,
  maxLen: number,
): { chord: CycleEntry[]; edgeType: CycleEntry[] } {

  // --- Closed chord cycles ---
  const chordSongs = new Map<string, Set<string>>();
  const chordOccurrences = new Map<string, number>();
  const chordExampleSong = new Map<string, string>();

  for (const song of songs) {
    for (let n = minLen; n <= maxLen; n++) {
      const seen = new Set<string>();
      for (const loop of extractChordCycles(song.chords, n)) {
        chordOccurrences.set(loop, (chordOccurrences.get(loop) ?? 0) + 1);
        if (!seen.has(loop)) {
          seen.add(loop);
          if (!chordSongs.has(loop)) chordSongs.set(loop, new Set());
          chordSongs.get(loop)!.add(song.title);
          if (!chordExampleSong.has(loop)) chordExampleSong.set(loop, song.title);
        }
      }
    }
  }

  const chord: CycleEntry[] = [];
  for (const [loop, songSet] of chordSongs) {
    if (songSet.size < minSongs) continue;
    const parts = loop.split(' ');
    chord.push({
      loop,
      loopBack: `→ ${parts[0]}`,
      length: parts.length,
      songCount: songSet.size,
      totalOccurrences: chordOccurrences.get(loop)!,
      exampleSongs: [...songSet].slice(0, 8),
      exampleChords: loop,
    });
  }
  chord.sort((a, b) => b.songCount - a.songCount || b.length - a.length);

  // --- Closed edge-type cycles (key-agnostic, rotation-canonicalized) ---
  const etSongs = new Map<string, Set<string>>();
  const etOccurrences = new Map<string, number>();
  const etChordExamples = new Map<string, string>();
  const etClosingEdge = new Map<string, string>();

  for (const song of songs) {
    for (let n = minLen; n <= maxLen; n++) {
      const seen = new Set<string>();
      for (const { loop, closingEdge, exampleChords } of extractEdgeTypeCycles(song.chords, song.edgeSeq, n)) {
        etOccurrences.set(loop, (etOccurrences.get(loop) ?? 0) + 1);
        if (!seen.has(loop)) {
          seen.add(loop);
          if (!etSongs.has(loop)) etSongs.set(loop, new Set());
          etSongs.get(loop)!.add(song.title);
          if (!etChordExamples.has(loop)) etChordExamples.set(loop, exampleChords);
          if (!etClosingEdge.has(loop)) etClosingEdge.set(loop, closingEdge);
        }
      }
    }
  }

  const edgeType: CycleEntry[] = [];
  for (const [loop, songSet] of etSongs) {
    if (songSet.size < minSongs) continue;
    const closing = etClosingEdge.get(loop) ?? loop.split(' ').slice(-1)[0];
    edgeType.push({
      loop,
      loopBack: `→ ${closing} (closes)`,
      length: loop.split(' ').length,
      songCount: songSet.size,
      totalOccurrences: etOccurrences.get(loop)!,
      exampleSongs: [...songSet].slice(0, 8),
      exampleChords: etChordExamples.get(loop) ?? '',
    });
  }
  edgeType.sort((a, b) => b.songCount - a.songCount || b.length - a.length);

  return { chord, edgeType };
}

// ---------------------------------------------------------------------------
// CSV helpers
// ---------------------------------------------------------------------------

function csvCell(v: string | number | boolean): string {
  if (typeof v === 'string' && (v.includes(',') || v.includes('"') || v.includes('\n'))) {
    return `"${v.replace(/"/g, '""')}"`;
  }
  return String(v);
}

function csvRow(cells: (string | number | boolean)[]): string {
  return cells.map(csvCell).join(',');
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

interface SongResult {
  title: string;
  chords: string[];
  edgeSeq: string[];
  edges: EdgeResult[];
  edgeTypesFound: Set<EdgeType>;
  unmappableChords: string[];
}

async function main() {
  const files = readdirSync(MUSIC_DIR)
    .filter(f => f.endsWith('.pdf') && !f.startsWith('_'))
    .sort();

  console.log(`Analyzing ${files.length} songs...`);

  const songs: SongResult[] = [];
  const edgeTypeCount: Record<EdgeType, number> = {} as Record<EdgeType, number>;
  const edgeTypeSongCount: Record<EdgeType, number> = {} as Record<EdgeType, number>;
  for (const t of EDGE_TYPES) { edgeTypeCount[t] = 0; edgeTypeSongCount[t] = 0; }

  for (const file of files) {
    const title = basename(file, '.pdf');
    const filePath = join(MUSIC_DIR, file);

    let chords: string[] = [];
    try {
      chords = await extractChordsFromPDF(filePath);
    } catch (e) {
      process.stderr.write(`  ERROR reading ${title}: ${(e as Error).message}\n`);
      continue;
    }

    if (chords.length < 2) {
      process.stderr.write(`  SKIP ${title} — too few chords (${chords.length})\n`);
      continue;
    }

    const edges = classifyEdges(chords);
    const edgeSeq = edgeTypeSequence(chords);
    const edgeTypesFound = new Set<EdgeType>();
    const unmappableChords = chords.filter(c => !safeMapChord(c));

    for (const edge of edges) {
      for (const t of edge.types) {
        edgeTypesFound.add(t);
        edgeTypeCount[t]++;
      }
    }
    for (const t of edgeTypesFound) edgeTypeSongCount[t]++;

    songs.push({ title, chords, edgeSeq, edges, edgeTypesFound, unmappableChords });
  }

  console.log(`Processed ${songs.length} songs.\n`);

  // ---------------------------------------------------------------------------
  // CSV 1: songs.csv — one row per song
  // ---------------------------------------------------------------------------
  const songHeader = csvRow([
    'title', 'chord_count', 'chord_sequence', 'edge_type_sequence',
    'edge_types_found', 'unmappable_chords',
  ]);
  const songCsvRows = songs.map(s => csvRow([
    s.title,
    s.chords.length,
    s.chords.join(' '),
    s.edgeSeq.join(' '),
    EDGE_TYPES.filter(t => s.edgeTypesFound.has(t)).join('|'),
    [...new Set(s.unmappableChords)].join('|'),
  ]));
  const songsCsv = [songHeader, ...songCsvRows].join('\n');
  writeFileSync(join(__dirname, 'songs.csv'), songsCsv, 'utf-8');

  // ---------------------------------------------------------------------------
  // CSV 2: transitions.csv — one row per chord-to-chord move
  // ---------------------------------------------------------------------------
  const transHeader = csvRow(['song_title', 'position', 'from_chord', 'to_chord', 'edge_types', 'mappable']);
  const transCsvRows: string[] = [];
  for (const s of songs) {
    s.edges.forEach((edge, pos) => {
      transCsvRows.push(csvRow([
        s.title, pos, edge.from, edge.to, edge.types.join('|'), edge.mappable,
      ]));
    });
  }
  const transitionsCsv = [transHeader, ...transCsvRows].join('\n');
  writeFileSync(join(__dirname, 'transitions.csv'), transitionsCsv, 'utf-8');

  // ---------------------------------------------------------------------------
  // Cycle detection
  // ---------------------------------------------------------------------------
  console.log('Detecting cycles...');
  const { chord: chordCycles, edgeType: etCycles } = findCycles(songs, 5, 2, 5);

  // CSV 3: chord_cycles.csv — closed chord cycles appearing in 5+ songs
  const ccHeader = csvRow(['loop', 'loop_back', 'length', 'song_count', 'total_occurrences', 'example_songs']);
  const ccRows = chordCycles.map(c => csvRow([
    c.loop, c.loopBack, c.length, c.songCount, c.totalOccurrences, c.exampleSongs.join('|'),
  ]));
  writeFileSync(join(__dirname, 'chord_cycles.csv'), [ccHeader, ...ccRows].join('\n'), 'utf-8');

  // CSV 4: edge_cycles.csv — key-agnostic closed edge-type cycles, 5+ songs
  const ecHeader = csvRow(['loop', 'loop_back', 'length', 'song_count', 'total_occurrences', 'walk_constraints', 'example_chord_instance', 'example_songs']);
  const ecRows = etCycles.map(c => {
    const constraints = EDGE_TYPES
      .filter(t => c.loop.split(' ').includes(t))
      .join('|');
    return csvRow([c.loop, c.loopBack, c.length, c.songCount, c.totalOccurrences, constraints, c.exampleChords, c.exampleSongs.join('|')]);
  });
  writeFileSync(join(__dirname, 'edge_cycles.csv'), [ecHeader, ...ecRows].join('\n'), 'utf-8');

  // ---------------------------------------------------------------------------
  // Text report
  // ---------------------------------------------------------------------------
  const lines: string[] = [];
  lines.push('='.repeat(72));
  lines.push('CHORD PROGRESSION ANALYSIS — THE TIGHTENING SONG LIBRARY');
  lines.push('='.repeat(72));
  lines.push('');

  lines.push('── EDGE TYPE FREQUENCY (across all songs) ───────────────────────────');
  lines.push('');
  const sorted = [...EDGE_TYPES].sort((a, b) => edgeTypeSongCount[b] - edgeTypeSongCount[a]);
  for (const t of sorted) {
    const pct = ((edgeTypeSongCount[t] / songs.length) * 100).toFixed(0);
    lines.push(`  ${t.padEnd(20)} ${edgeTypeSongCount[t]} songs (${pct}%)   ${edgeTypeCount[t]} total edges`);
  }
  lines.push('');

  lines.push('── TOP CHORD CYCLES (literal, 5+ songs) — loop closes back to start ──');
  lines.push('');
  for (const c of chordCycles.slice(0, 50)) {
    lines.push(`  [${c.length}-chord, ${c.songCount} songs, ${c.totalOccurrences}×]  ${c.loop} ${c.loopBack}`);
    lines.push(`    ${c.exampleSongs.slice(0, 3).join(' / ')}`);
  }
  lines.push('');

  lines.push('── TOP EDGE-TYPE CYCLES (key-agnostic, 5+ songs) ────────────────────');
  lines.push('');
  for (const c of etCycles.slice(0, 50)) {
    lines.push(`  [${c.length}-step, ${c.songCount} songs, ${c.totalOccurrences}×]  ${c.loop} ${c.loopBack}`);
    lines.push(`    e.g. "${c.exampleChords}"  — ${c.exampleSongs.slice(0, 3).join(' / ')}`);
  }
  lines.push('');

  const report = lines.join('\n');
  writeFileSync(join(__dirname, 'song-analysis.txt'), report, 'utf-8');
  console.log(report);

  // TypeScript data file for the app UI — top 40 edge-type cycles
  const presets = etCycles.slice(0, 40).map(c => ({
    loop: c.loop,
    length: c.length,
    songCount: c.songCount,
    constraints: EDGE_TYPES.filter(t => c.loop.split(' ').includes(t as EdgeType)),
    exampleChords: c.exampleChords,
  }));
  const presetsTs = [
    `// Auto-generated by analysis/analyze-songs.ts — do not edit by hand.`,
    `// Re-run: npx tsx analysis/analyze-songs.ts`,
    `import type { EdgeType } from './chordPathfinder';`,
    ``,
    `export interface CyclePreset {`,
    `  loop: string;         // edge-type sequence, e.g. "fifth dom7"`,
    `  length: number;       // number of steps (= edges in the loop)`,
    `  songCount: number;    // songs in the library containing this cycle`,
    `  constraints: EdgeType[];  // Walk constraints needed to traverse it`,
    `  exampleChords: string;   // concrete chord instance, e.g. "D A D"`,
    `}`,
    ``,
    `export const CYCLE_PRESETS: CyclePreset[] = ${JSON.stringify(presets, null, 2)};`,
  ].join('\n');
  writeFileSync(join(__dirname, '..', 'src', 'core', 'cyclePresets.ts'), presetsTs, 'utf-8');

  console.log('Files written:');
  console.log('  analysis/songs.csv          — per-song chord + edge-type sequences');
  console.log('  analysis/transitions.csv    — every chord-to-chord move');
  console.log('  analysis/chord_cycles.csv   — literal chord n-grams (5+ songs)');
  console.log('  analysis/edge_cycles.csv    — key-agnostic edge-type cycles (5+ songs)');
  console.log('  analysis/song-analysis.txt  — text summary');
  console.log('  src/core/cyclePresets.ts    — top 40 cycles for app UI');
}

main().catch(console.error);
