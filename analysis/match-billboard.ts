/**
 * Match our song library (analysis/songs.csv) against the Billboard Hot 100
 * historical dataset (analysis/billboard/hot-100-current.csv, weekly snapshots
 * 1958-present from https://github.com/utdata/rwd-billboard-data) to attach a
 * debut year/decade and era-appropriate popularity (peak chart position, weeks
 * on chart) to each song. This is what supplies the time axis for the
 * major/minor-over-time and progression-over-time analyses — neither the MIDI
 * archive nor the PDF chord-chart library carries any release-date metadata.
 *
 * Run: npx tsx analysis/match-billboard.ts
 * Requires: analysis/songs.csv (from analyze-songs.ts)
 * Output: analysis/song-billboard-matches.json
 */

import { readFileSync, writeFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const BILLBOARD_CSV = join(__dirname, 'billboard', 'hot-100-current.csv');
const SONGS_CSV = join(__dirname, 'songs.csv');
const OUTPUT_PATH = join(__dirname, 'song-billboard-matches.json');

// ---------------------------------------------------------------------------
// CSV parsing (quote-aware, arbitrary column count)
// ---------------------------------------------------------------------------

function parseCsvRow(line: string): string[] {
  const cells: string[] = [];
  let cur = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQuotes) {
      if (ch === '"' && line[i + 1] === '"') { cur += '"'; i++; }
      else if (ch === '"') { inQuotes = false; }
      else { cur += ch; }
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === ',') {
      cells.push(cur);
      cur = '';
    } else {
      cur += ch;
    }
  }
  cells.push(cur);
  return cells;
}

// ---------------------------------------------------------------------------
// Normalization — both sides need to converge on the same key
// ---------------------------------------------------------------------------

function normalize(s: string): string {
  return s
    .toLowerCase()
    .replace(/\([^)]*\)/g, ' ')       // parentheticals: "(Remastered)", "(key of C)"
    .replace(/[’']/g, '')             // apostrophes: "don't" -> "dont"
    .replace(/[^a-z0-9]+/g, ' ')      // punctuation -> space
    .trim()
    .replace(/\s+/g, ' ');
}

function normalizeArtist(artist: string): string {
  let a = artist.toLowerCase();
  a = a.split(/\bfeaturing\b|\bfeat\.?\b|\bft\.?\b/)[0]; // drop "featuring X"
  a = a.split(/\s*&\s*|\s+and\s+/)[0];                    // drop "& Y" / "and Y"
  a = a.replace(/^the\s+/, '');                           // leading "The "
  return normalize(a);
}

function normalizeTitle(title: string): string {
  return normalize(title);
}

// ---------------------------------------------------------------------------
// Load Billboard data, aggregate per (artist, title) -> debut year, peak, weeks
// ---------------------------------------------------------------------------

interface BillboardEntry {
  debutYear: number;
  peakPos: number;
  wksOnChart: number;
}

function loadBillboardIndex(): Map<string, BillboardEntry> {
  const lines = readFileSync(BILLBOARD_CSV, 'utf-8').split('\n').slice(1).filter(Boolean);
  const index = new Map<string, BillboardEntry>();

  for (const line of lines) {
    const [chartWeek, , title, performer, , peakPosStr, wksStr] = parseCsvRow(line);
    if (!chartWeek || !title || !performer) continue;

    const year = parseInt(chartWeek.slice(0, 4), 10);
    const peakPos = parseInt(peakPosStr, 10);
    const wksOnChart = parseInt(wksStr, 10);
    if (!year || isNaN(peakPos) || isNaN(wksOnChart)) continue;

    const key = `${normalizeArtist(performer)}|${normalizeTitle(title)}`;
    const existing = index.get(key);
    if (!existing) {
      index.set(key, { debutYear: year, peakPos, wksOnChart });
    } else {
      existing.debutYear = Math.min(existing.debutYear, year);
      existing.peakPos = Math.min(existing.peakPos, peakPos);
      existing.wksOnChart = Math.max(existing.wksOnChart, wksOnChart);
    }
  }
  return index;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

function main() {
  console.log('Loading Billboard Hot 100 history...');
  const billboard = loadBillboardIndex();
  console.log(`  ${billboard.size} unique (artist, title) entries, 1958-present`);

  const songLines = readFileSync(SONGS_CSV, 'utf-8').split('\n').slice(1).filter(Boolean);
  console.log(`Matching ${songLines.length} library songs...`);

  const matches: Record<string, BillboardEntry & { decade: number }> = {};
  let matched = 0;
  const byDecade: Record<number, number> = {};

  for (const line of songLines) {
    const [title] = parseCsvRow(line);
    if (!title) continue;
    const sep = title.indexOf(' - ');
    if (sep === -1) continue;
    const artist = title.slice(0, sep);
    const track = title.slice(sep + 3);

    const key = `${normalizeArtist(artist)}|${normalizeTitle(track)}`;
    const entry = billboard.get(key);
    if (!entry) continue;

    const decade = Math.floor(entry.debutYear / 10) * 10;
    matches[title] = { ...entry, decade };
    matched++;
    byDecade[decade] = (byDecade[decade] ?? 0) + 1;
  }

  console.log(`\nMatched ${matched} of ${songLines.length} songs (${((matched / songLines.length) * 100).toFixed(0)}%)`);
  console.log('\nBy decade:');
  for (const decade of Object.keys(byDecade).map(Number).sort((a, b) => a - b)) {
    console.log(`  ${decade}s: ${byDecade[decade]}`);
  }

  writeFileSync(OUTPUT_PATH, JSON.stringify(matches, null, 2), 'utf-8');
  console.log(`\nWritten to: ${OUTPUT_PATH}`);
}

main();
