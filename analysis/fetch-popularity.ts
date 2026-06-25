/**
 * Fetches listener counts from Last.fm for each song in the library.
 * Run once: npx tsx analysis/fetch-popularity.ts
 *
 * Requires LASTFM_API_KEY in your .env file (project root).
 * Get a free key at: https://www.last.fm/api/account/create
 *
 * Results are cached in analysis/song-popularity.json — re-running only
 * fetches songs not already in the cache.
 */

import { readFileSync, writeFileSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SONGS_CSV = join(__dirname, 'songs.csv');
const OUTPUT_FILE = join(__dirname, 'song-popularity.json');

// Load .env from project root if present
const envPath = join(__dirname, '..', '.env');
if (existsSync(envPath)) {
  for (const line of readFileSync(envPath, 'utf-8').split('\n')) {
    const m = line.match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);
    if (m) process.env[m[1]] = m[2].trim();
  }
}

const API_KEY = process.env.LASTFM_API_KEY;
if (!API_KEY) {
  console.error('Error: LASTFM_API_KEY not set. Add it to .env or export it.');
  process.exit(1);
}

/**
 * Parse "Artist - Track Title" from our filename-derived song title.
 * Strips trailing parenthetical suffixes like " (A)", " (key of C)", " (Bm)".
 */
function parseSongTitle(title: string): { artist: string; track: string } {
  const cleaned = title.replace(/\s*\([^)]*\)\s*$/, '').trim();
  const idx = cleaned.indexOf(' - ');
  if (idx === -1) return { artist: '', track: cleaned };
  return { artist: cleaned.slice(0, idx).trim(), track: cleaned.slice(idx + 3).trim() };
}

async function fetchListeners(artist: string, track: string): Promise<number> {
  const url = new URL('https://ws.audioscrobbler.com/2.0/');
  url.searchParams.set('method', 'track.getInfo');
  url.searchParams.set('api_key', API_KEY!);
  url.searchParams.set('artist', artist);
  url.searchParams.set('track', track);
  url.searchParams.set('format', 'json');

  const res = await fetch(url.toString());
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const data = await res.json() as Record<string, unknown>;
  const trackData = data?.track as Record<string, unknown> | undefined;
  const listeners = parseInt((trackData?.listeners as string) ?? '0', 10);
  return isNaN(listeners) ? 0 : listeners;
}

async function sleep(ms: number) {
  return new Promise(r => setTimeout(r, ms));
}

async function main() {
  if (!existsSync(SONGS_CSV)) {
    console.error('Run analyze-songs.ts first to generate songs.csv');
    process.exit(1);
  }

  const csv = readFileSync(SONGS_CSV, 'utf-8');
  const titles = csv.split('\n').slice(1)
    .map(line => line.split(',')[0].trim())
    .filter(Boolean);

  const cache: Record<string, number> = existsSync(OUTPUT_FILE)
    ? JSON.parse(readFileSync(OUTPUT_FILE, 'utf-8'))
    : {};

  const missing = titles.filter(t => !(t in cache));
  console.log(`${titles.length} songs total — ${missing.length} to fetch, ${titles.length - missing.length} cached`);

  if (missing.length === 0) {
    console.log('All songs already cached.');
  }

  for (let i = 0; i < missing.length; i++) {
    const title = missing[i];
    const { artist, track } = parseSongTitle(title);

    try {
      const listeners = await fetchListeners(artist, track);
      cache[title] = listeners;
      const tag = listeners > 0 ? `${listeners.toLocaleString()} listeners` : 'not found';
      console.log(`[${i + 1}/${missing.length}] ${title}  →  ${tag}`);
    } catch {
      cache[title] = 0;
      console.log(`[${i + 1}/${missing.length}] ${title}  →  fetch error, 0`);
    }

    // ~3 req/sec — well within Last.fm's limits
    await sleep(350);

    // Checkpoint every 25 songs so progress isn't lost on interrupt
    if ((i + 1) % 25 === 0) {
      writeFileSync(OUTPUT_FILE, JSON.stringify(cache, null, 2), 'utf-8');
      console.log(`  (saved checkpoint)`);
    }
  }

  writeFileSync(OUTPUT_FILE, JSON.stringify(cache, null, 2), 'utf-8');
  console.log(`\nSaved ${Object.keys(cache).length} entries to ${OUTPUT_FILE}`);

  // Show top 20
  const top20 = Object.entries(cache)
    .filter(([, v]) => v > 0)
    .sort(([, a], [, b]) => b - a)
    .slice(0, 20);

  console.log('\n── Top 20 by Last.fm listeners ──');
  for (const [t, n] of top20) {
    console.log(`  ${n.toLocaleString().padStart(12)}  ${t}`);
  }
}

main().catch(console.error);
