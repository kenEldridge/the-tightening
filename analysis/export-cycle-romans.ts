/**
 * Roman-numeral spelling for the aggregate cycle tables (chord_cycles.csv,
 * edge_cycles.csv). Those cycles aren't tied to one song's actual key - the
 * same "G C" loop shows up in dozens of different songs in different keys -
 * so romanNumerals.ts's per-song, per-detected-key approach doesn't apply
 * directly. Instead: treat the loop's own first chord as a pseudo-tonic (I),
 * inferring major/minor from that chord's own quality, and spell the rest
 * relative to it. This describes the loop's *shape*, not any one song's
 * actual harmony - which is exactly what these aggregate tables already are.
 *
 * Run from the-tightening's root: npx tsx analysis/export-cycle-romans.ts
 */

import { readFileSync, writeFileSync } from 'fs';
import path from 'path';
import { chordNameToNodeId } from 'theory-core';
import { romanNumeralSequence } from './romanNumerals.js';

const DIR = path.resolve(import.meta.dirname);

function parseCsv(text: string): Record<string, string>[] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; }
        else inQuotes = false;
      } else field += c;
    } else if (c === '"') {
      inQuotes = true;
    } else if (c === ',') {
      row.push(field); field = '';
    } else if (c === '\n') {
      row.push(field.replace(/\r$/, '')); rows.push(row);
      row = []; field = '';
    } else {
      field += c;
    }
  }
  if (field !== '' || row.length) { row.push(field); rows.push(row); }
  const header = rows.shift()!;
  return rows
    .filter((r) => r.length === header.length)
    .map((r) => Object.fromEntries(header.map((h, idx) => [h, r[idx]])));
}

function tonicQuality(chord: string): 'major' | 'minor' {
  try {
    const nodeId = chordNameToNodeId(chord);
    return nodeId?.split('-')[0] === 'minor' ? 'minor' : 'major';
  } catch {
    return 'major';
  }
}

/** Roman-numeral spelling for a chord sequence, relative to its own first chord as I. */
function romanizeLoop(chords: string[]): string[] | null {
  if (chords.length === 0) return null;
  const tonic = chords[0];
  const quality = tonicQuality(tonic);
  const romans = romanNumeralSequence(tonic, quality, chords);
  if (romans.some((r) => r === null)) return null;
  return romans as string[];
}

// -- chord_cycles.csv: romanize the loop itself ----------------------------

const chordCycles = parseCsv(readFileSync(path.join(DIR, 'chord_cycles.csv'), 'utf-8'));
const chordRomans: Record<string, string> = {};
for (const row of chordCycles) {
  const chords = row.loop.split(' ').filter(Boolean);
  const romans = romanizeLoop(chords);
  if (romans) chordRomans[`${row.loop}|${row.loop_back}`] = romans.join(' ');
}
writeFileSync(
  path.join(DIR, 'chord-cycles-romans.json'),
  JSON.stringify(chordRomans, null, 1)
);

// -- edge_cycles.csv: romanize the example_chord_instance ------------------

const edgeCycles = parseCsv(readFileSync(path.join(DIR, 'edge_cycles.csv'), 'utf-8'));
const edgeRomans: Record<string, string> = {};
for (const row of edgeCycles) {
  const chords = (row.example_chord_instance || '').split(' ').filter(Boolean);
  const romans = romanizeLoop(chords);
  if (romans) edgeRomans[`${row.loop}|${row.loop_back}`] = romans.join(' ');
}
writeFileSync(
  path.join(DIR, 'edge-cycles-romans.json'),
  JSON.stringify(edgeRomans, null, 1)
);

console.log(`chord cycles romanized: ${Object.keys(chordRomans).length} / ${chordCycles.length}`);
console.log(`edge cycles romanized: ${Object.keys(edgeRomans).length} / ${edgeCycles.length}`);
