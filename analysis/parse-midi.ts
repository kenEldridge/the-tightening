/**
 * Mine chord progressions from the 50k MIDI file collection (By ARTIST section).
 * Run:  npx tsx analysis/parse-midi.ts [--test] [--limit N]
 * Output: analysis/midi-songs.csv
 *
 * --test    process only the first 100 files (quick sanity check)
 * --limit N process at most N files
 */

import { writeFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
// adm-zip is CJS
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const AdmZip = require('adm-zip') as any;
const { Midi } = require('@tonejs/midi') as typeof import('@tonejs/midi');
import { detectChords } from '../src/core/chordDetection.js';
import { getTheoryChordNodes, nodeIdToChordName } from '../src/core/chordPathfinder.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ZIP_PATH = join(__dirname, '../music/50000midifiles.zip');
const BY_ARTIST_PREFIX = '50000 MIDI FILES/By ARTIST/';
const OUTPUT_PATH = join(__dirname, 'midi-songs.csv');

const args = process.argv.slice(2);
const TEST_MODE = args.includes('--test');
const limitIdx = args.indexOf('--limit');
const LIMIT = limitIdx !== -1 ? parseInt(args[limitIdx + 1], 10) : TEST_MODE ? 100 : Infinity;

// ---------------------------------------------------------------------------
// Name cleaning
// ---------------------------------------------------------------------------

function cleanSongName(filename: string): string {
  return filename
    .replace(/\.midi?$/i, '')
    .replace(/\b(MM\s*(GM|XG)|GM|XG)\b/gi, '')  // MIDI variant tags
    .replace(/-[A-G]b?#?\d{2,3}$/i, '')           // key+tempo suffix: -G120, -Bb80
    .replace(/[-_]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function parseEntryPath(entryName: string): { artist: string; songTitle: string } | null {
  const relative = entryName.slice(BY_ARTIST_PREFIX.length);
  const parts = relative.split('/').filter(Boolean);
  if (parts.length < 2) return null;
  const artist = parts[0];
  const filename = parts[parts.length - 1];
  const songTitle = cleanSongName(filename);
  return songTitle ? { artist, songTitle } : null;
}

// ---------------------------------------------------------------------------
// Chord detection from MIDI note events
// ---------------------------------------------------------------------------

interface MidiNote {
  midi: number;
  time: number;
  duration: number;
  velocity: number;
}

const PC_MAP: Record<string, number> = {
  C: 0, 'C#': 1, D: 2, 'D#': 3, E: 4, F: 5,
  'F#': 6, G: 7, 'G#': 8, A: 9, 'A#': 10, B: 11,
};

function rootPitchClass(chordName: string): number {
  return PC_MAP[chordName.match(/^([A-G]#?)/)?.[1] ?? ''] ?? -1;
}

const theoryNodes = getTheoryChordNodes();

function detectWindowChord(notes: MidiNote[], winStart: number, winEnd: number): string | null {
  const active = notes.filter(
    n => n.time < winEnd && n.time + n.duration > winStart && n.velocity > 0.1,
  );
  if (active.length < 2) return null;

  const sorted = [...active].sort((a, b) => a.midi - b.midi);
  const noteSet = new Set(sorted.map(n => n.midi));

  const matches = detectChords(noteSet, theoryNodes);
  if (matches.length === 0) return null;

  // Multiple matches → prefer the one whose root matches the bass note
  if (matches.length > 1) {
    const bassPc = sorted[0].midi % 12;
    for (const nodeId of matches) {
      if (rootPitchClass(nodeIdToChordName(nodeId)) === bassPc) {
        return nodeIdToChordName(nodeId);
      }
    }
  }

  return nodeIdToChordName(matches[0]);
}

// ---------------------------------------------------------------------------
// MIDI file → chord sequence
// ---------------------------------------------------------------------------

function processMidi(data: Buffer): string[] | null {
  let midi: Midi;
  try {
    midi = new Midi(data);
  } catch {
    return null;
  }

  if (midi.duration < 15) return null; // skip very short files

  const bpm = midi.header.tempos[0]?.bpm ?? 120;
  const beatDur = 60 / bpm;
  const beatsPerBar = midi.header.timeSignatures[0]?.timeSignature[0] ?? 4;
  const barDur = beatDur * beatsPerBar;

  // Collect all melodic notes (skip percussion tracks)
  const allNotes: MidiNote[] = [];
  for (const track of midi.tracks) {
    if (track.instrument.percussion) continue;
    for (const n of track.notes) {
      allNotes.push({ midi: n.midi, time: n.time, duration: n.duration, velocity: n.velocity });
    }
  }
  if (allNotes.length < 10) return null;

  // One chord per bar, cap at 64 bars
  const numBars = Math.min(Math.ceil(midi.duration / barDur), 64);
  const raw: string[] = [];
  for (let b = 0; b < numBars; b++) {
    const chord = detectWindowChord(allNotes, b * barDur, (b + 1) * barDur);
    if (chord) raw.push(chord);
  }

  // Deduplicate consecutive same chords
  const chords = raw.filter((c, i) => i === 0 || c !== raw[i - 1]);

  // Require at least 3 distinct chords to be musically interesting
  if (new Set(chords).size < 3) return null;

  return chords;
}

// ---------------------------------------------------------------------------
// CSV helpers
// ---------------------------------------------------------------------------

function csvCell(v: string): string {
  return v.includes(',') || v.includes('"') || v.includes('\n')
    ? `"${v.replace(/"/g, '""')}"`
    : v;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  console.log('Opening zip (this takes a moment for the index)...');
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const zip = new AdmZip(ZIP_PATH) as any;
  const entries = (zip.getEntries() as any[]).filter(
    (e: any) =>
      !e.isDirectory &&
      e.entryName.startsWith(BY_ARTIST_PREFIX) &&
      /\.midi?$/i.test(e.entryName),
  );

  console.log(`Found ${entries.length} MIDI files under By ARTIST/`);
  if (TEST_MODE) console.log(`Test mode: processing first ${LIMIT} files`);

  const rows: string[] = ['title,chord_sequence'];
  let processed = 0;
  let succeeded = 0;
  let failed = 0;
  const seen = new Set<string>();

  for (const entry of entries) {
    if (processed >= LIMIT) break;
    processed++;

    const meta = parseEntryPath(entry.entryName);
    if (!meta) { failed++; continue; }

    const title = `${meta.artist} - ${meta.songTitle}`;
    const titleKey = title.toLowerCase();
    if (seen.has(titleKey)) continue;
    seen.add(titleKey);

    let data: Buffer;
    try {
      data = entry.getData() as Buffer;
    } catch {
      failed++;
      continue;
    }

    const chords = processMidi(data);
    if (!chords) { failed++; continue; }

    rows.push(`${csvCell(title)},${csvCell(chords.join(' '))}`);
    succeeded++;

    if (succeeded % 25 === 0 || TEST_MODE) {
      process.stdout.write(`  ${succeeded} songs | ${processed} processed | ${failed} skipped\r`);
    }
  }

  console.log(`\nDone: ${succeeded} songs extracted from ${processed} files (${failed} skipped)`);
  writeFileSync(OUTPUT_PATH, rows.join('\n'), 'utf-8');
  console.log(`Written to: ${OUTPUT_PATH}`);
}

main().catch(console.error);
