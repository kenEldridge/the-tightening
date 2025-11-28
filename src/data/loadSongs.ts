/**
 * Song Data Loader
 *
 * Loads and caches song data from MIDI files.
 * Merges manual metadata (sections, lyrics) when available.
 */

import type { SongData, SongSegment } from '../utils/midiParser';
import { loadMidiFromUrl } from '../utils/midiParser';
import { getSongMetadata } from './songMetadata';

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

  // Load and parse MIDI file
  const songData = await loadMidiFromUrl(songMeta.url, songMeta.trackIndex);

  // Update name from library
  songData.name = songMeta.name;

  // Check for manual metadata (sections with lyrics)
  const metadata = getSongMetadata(songId);
  if (metadata) {
    // Use manual sections instead of auto-detected segments
    songData.segments = metadata.sections.map((section): SongSegment => {
      // Calculate note indices for this section
      let startNoteIndex = 0;
      let endNoteIndex = songData.notes.length - 1;
      let noteCount = 0;

      songData.notes.forEach((note, index) => {
        const noteEnd = note.time + note.duration;
        if (note.time >= section.startTime && noteEnd <= section.endTime) {
          if (noteCount === 0) startNoteIndex = index;
          endNoteIndex = index;
          noteCount++;
        }
      });

      return {
        id: section.id,
        name: section.name,
        startTime: section.startTime,
        endTime: section.endTime,
        startNoteIndex,
        endNoteIndex,
        noteCount,
        lyrics: section.lyrics,
      };
    });

    console.info('[LoadSongs] Using manual sections for', songId, {
      sectionCount: songData.segments.length,
      sections: songData.segments.map(s => s.name),
    });
  }

  // Cache it
  songCache.set(songId, songData);

  return songData;
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
