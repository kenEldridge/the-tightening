/**
 * Fills in the debut-year gap the Billboard match leaves (Billboard only
 * covers US Hot 100 entries, ~15% of the library) using MusicBrainz's
 * recording search - free, no API key, and it carries a real
 * first-release-date field (unlike Last.fm's track.getInfo, which has no
 * structured release date at all - checked live, its "wiki.published" is
 * when the wiki text was last edited, not when the song came out).
 *
 * Run: npx tsx analysis/fetch-musicbrainz-dates.ts
 *
 * Rate limit: MusicBrainz asks for max 1 req/sec from anonymous clients
 * (https://musicbrainz.org/doc/MusicBrainz_API/Rate_Limiting) - this uses
 * 1.1s to stay safely under it. ~4,500 unmatched songs means this takes
 * over an hour; it checkpoints every 25 so it's safe to stop and resume.
 */

import { readFileSync, writeFileSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SONGS_CSV = join(__dirname, 'songs.csv');
const BILLBOARD_FILE = join(__dirname, 'song-billboard-matches.json');
const OUTPUT_FILE = join(__dirname, 'song-musicbrainz-dates.json');

const USER_AGENT = 'the-tightening-chord-eda/0.1 (+https://github.com/kenEldridge/the-tightening)';

function parseSongTitle(title: string): { artist: string; track: string } {
  const cleaned = title.replace(/\s*\([^)]*\)\s*$/, '').trim();
  const idx = cleaned.indexOf(' - ');
  if (idx === -1) return { artist: '', track: cleaned };
  return { artist: cleaned.slice(0, idx).trim(), track: cleaned.slice(idx + 3).trim() };
}

interface MbResult {
  year: number | null;
  matchedTitle: string | null;
}

async function fetchFirstReleaseYear(artist: string, track: string): Promise<MbResult> {
  if (!artist || !track) return { year: null, matchedTitle: null };
  const query = `recording:"${track}" AND artist:"${artist}"`;
  const url = new URL('https://musicbrainz.org/ws/2/recording');
  url.searchParams.set('query', query);
  url.searchParams.set('fmt', 'json');
  url.searchParams.set('limit', '25');

  const res = await fetch(url.toString(), { headers: { 'User-Agent': USER_AGENT } });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const data = await res.json() as any;
  const recordings = data?.recordings as any[] | undefined;
  if (!recordings || recordings.length === 0) return { year: null, matchedTitle: null };

  // A well-covered old pop song can have dozens of recordings that all
  // text-match perfectly (score 100): live versions, later re-recordings,
  // best-of compilations. Confirmed live on "Air Supply - All Out of Love"
  // (already correctly dated 1980 by Billboard): MusicBrainz's top matches
  // were all live/compilation entries dated 1995-2013, and blindly taking
  // the earliest of those gave a wrong answer, not just an imprecise one.
  // Only trust a release-group with EMPTY secondary-types (a plain Album or
  // Single - not Live/Compilation/Remix/Soundtrack) as the actual original.
  // If nothing clean turns up, report unknown rather than guess.
  let earliest: string | null = null;
  let matchedTitle: string | null = null;
  for (const rec of recordings) {
    if (rec.score < 90) continue;
    for (const release of rec.releases ?? []) {
      const rg = release['release-group'];
      if (!rg) continue;
      const secondaryTypes = rg['secondary-types'] ?? [];
      if (secondaryTypes.length > 0) continue; // Live/Compilation/Remix/... - skip
      const date = rg['first-release-date'];
      if (date && /^\d{4}/.test(date)) {
        if (!earliest || date < earliest) {
          earliest = date;
          matchedTitle = `${rec['artist-credit']?.[0]?.name ?? artist} - ${rec.title}`;
        }
      }
    }
  }
  if (!earliest) return { year: null, matchedTitle: null };
  return { year: parseInt(earliest.slice(0, 4), 10), matchedTitle };
}

async function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

async function main() {
  if (!existsSync(SONGS_CSV)) {
    console.error('Run analyze-songs.ts first to generate songs.csv');
    process.exit(1);
  }

  const csv = readFileSync(SONGS_CSV, 'utf-8');
  const titles = csv.split('\n').slice(1).map((line) => line.split(',')[0].trim()).filter(Boolean);

  const billboard: Record<string, unknown> = existsSync(BILLBOARD_FILE)
    ? JSON.parse(readFileSync(BILLBOARD_FILE, 'utf-8'))
    : {};

  const cache: Record<string, MbResult> = existsSync(OUTPUT_FILE)
    ? JSON.parse(readFileSync(OUTPUT_FILE, 'utf-8'))
    : {};

  // Billboard already has a real, more authoritative debut year for these -
  // don't spend MusicBrainz's rate-limited budget re-deriving it.
  const todo = titles.filter((t) => !(t in billboard) && !(t in cache));
  console.log(`${titles.length} songs total, ${Object.keys(billboard).length} already Billboard-matched, ${todo.length} to look up`);

  for (let i = 0; i < todo.length; i++) {
    const title = todo[i];
    const { artist, track } = parseSongTitle(title);

    // A transient 503 (rate-limit) is NOT the same fact as "no MusicBrainz
    // data exists" - conflating them would permanently cache a wrong "no
    // date" for a song MusicBrainz actually has, just because one request
    // got throttled. Retry with backoff before giving up on a song.
    let result: MbResult | null = null;
    let lastErr: Error | null = null;
    for (let attempt = 0; attempt < 3 && result === null; attempt++) {
      if (attempt > 0) await sleep(5000 * attempt);
      try {
        result = await fetchFirstReleaseYear(artist, track);
      } catch (err) {
        lastErr = err as Error;
      }
    }

    if (result !== null) {
      cache[title] = result;
      console.log(`[${i + 1}/${todo.length}] ${title} -> ${result.year ?? 'not found'}`);
    } else {
      // All 3 attempts failed - leave it OUT of the cache (not cached as
      // null) so a future run retries it, instead of a permanent wrong answer.
      console.log(`[${i + 1}/${todo.length}] ${title} -> SKIPPED, all retries failed (${lastErr?.message})`);
    }

    await sleep(1500);

    if ((i + 1) % 25 === 0) {
      writeFileSync(OUTPUT_FILE, JSON.stringify(cache, null, 1), 'utf-8');
      console.log(`  (checkpoint: ${Object.keys(cache).length} cached)`);
    }
  }

  writeFileSync(OUTPUT_FILE, JSON.stringify(cache, null, 1), 'utf-8');
  const found = Object.values(cache).filter((r) => r.year !== null).length;
  console.log(`\nDone. ${found} of ${Object.keys(cache).length} looked-up songs got a year.`);
}

main().catch(console.error);
