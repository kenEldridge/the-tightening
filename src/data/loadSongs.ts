/**
 * Song Data Loader
 *
 * Loads and caches song data from MIDI files
 */

import type { SongData } from '../utils/midiParser';
import { loadMidiFromUrl } from '../utils/midiParser';

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
