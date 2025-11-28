/**
 * Song Data Loader
 *
 * Loads and caches song data from MIDI files.
 * Loads LRC (standard lyrics format) files for synchronized lyrics.
 */

import type { SongData, SongSegment } from '../utils/midiParser';
import { loadMidiFromUrl } from '../utils/midiParser';
import { parseLrc, getSections, type LrcLine, type ParsedLrc } from '../utils/lrcParser';

// Cache for loaded songs
const songCache = new Map<string, SongData>();

export interface SongLibrary {
  [key: string]: {
    name: string;
    url: string;
    trackIndex?: number;
  };
}

/**
 * Available songs in the library
 */
export const SONG_LIBRARY: SongLibrary = {
  'canon-in-d': {
    name: 'Canon in D',
    url: '/songs/canon-in-d.mid',
    trackIndex: 0,
  },
  'hey-jude': {
    name: 'Hey Jude',
    url: '/songs/hey-jude.mid',
    trackIndex: 0,
  },
  // TODO: Add more songs as we download them
  // 'fur-elise': {
  //   name: 'Für Elise',
  //   url: '/songs/fur-elise.mid',
  // },
  // 'ode-to-joy': {
  //   name: 'Ode to Joy',
  //   url: '/songs/ode-to-joy.mid',
  // },
};

// Cache for LRC data (separate from song cache for flexibility)
const lrcCache = new Map<string, ParsedLrc>();

/**
 * Load LRC file for a song
 */
async function loadLrcFile(songId: string): Promise<ParsedLrc | null> {
  // Check cache
  if (lrcCache.has(songId)) {
    return lrcCache.get(songId)!;
  }

  const songMeta = SONG_LIBRARY[songId];
  if (!songMeta) return null;

  // Derive LRC URL from MIDI URL (same name, different extension)
  const lrcUrl = songMeta.url.replace(/\.mid$/, '.lrc');

  try {
    const response = await fetch(lrcUrl);
    if (!response.ok) {
      console.info('[LoadSongs] No LRC file found for', songId);
      return null;
    }

    const content = await response.text();
    const parsed = parseLrc(content);

    lrcCache.set(songId, parsed);

    console.info('[LoadSongs] Loaded LRC for', songId, {
      title: parsed.metadata.title,
      artist: parsed.metadata.artist,
      lineCount: parsed.lines.length,
      sections: getSections(parsed.lines).map(s => s.name),
    });

    return parsed;
  } catch (err) {
    console.warn('[LoadSongs] Failed to load LRC for', songId, err);
    return null;
  }
}

/**
 * Load a song by ID
 *
 * @param songId - Song identifier (key from SONG_LIBRARY)
 * @returns Promise resolving to song data
 */
export async function loadSong(songId: string): Promise<SongData> {
  // Check cache first
  if (songCache.has(songId)) {
    return songCache.get(songId)!;
  }

  // Get song metadata
  const songMeta = SONG_LIBRARY[songId];
  if (!songMeta) {
    throw new Error(`Unknown song: ${songId}`);
  }

  // Load MIDI and LRC in parallel
  const [songData, lrcData] = await Promise.all([
    loadMidiFromUrl(songMeta.url, songMeta.trackIndex),
    loadLrcFile(songId),
  ]);

  // Update name from library
  songData.name = songMeta.name;

  // If we have LRC data, use it for sections
  if (lrcData) {
    const sections = getSections(lrcData.lines);

    if (sections.length > 0) {
      // Convert LRC sections to SongSegments
      songData.segments = sections.map((section, index): SongSegment => {
        const nextSection = sections[index + 1];
        const endTime = nextSection ? nextSection.time : songData.duration;

        // Calculate note indices for this section
        let startNoteIndex = 0;
        let endNoteIndex = songData.notes.length - 1;
        let noteCount = 0;

        songData.notes.forEach((note, noteIndex) => {
          if (note.time >= section.time && note.time < endTime) {
            if (noteCount === 0) startNoteIndex = noteIndex;
            endNoteIndex = noteIndex;
            noteCount++;
          }
        });

        // Get lyrics for this section (non-section lines within time range)
        const sectionLyrics = lrcData.lines
          .filter(line => !line.isSection && line.time >= section.time && line.time < endTime)
          .map(line => line.text)
          .join('\n');

        return {
          id: section.name.toLowerCase().replace(/\s+/g, '-'),
          name: section.name,
          startTime: section.time,
          endTime,
          startNoteIndex,
          endNoteIndex,
          noteCount,
          lyrics: sectionLyrics || undefined,
        };
      });
    }
  }

  // Cache it
  songCache.set(songId, songData);

  return songData;
}

/**
 * Get LRC data for a song (for line-by-line lyrics display)
 */
export async function getLrcData(songId: string): Promise<ParsedLrc | null> {
  return loadLrcFile(songId);
}

/**
 * Get list of available songs
 */
export function getAvailableSongs(): Array<{ id: string; name: string }> {
  return Object.entries(SONG_LIBRARY).map(([id, meta]) => ({
    id,
    name: meta.name,
  }));
}

/**
 * Clear song cache (useful for debugging)
 */
export function clearSongCache(): void {
  songCache.clear();
}
