/**
 * Song Metadata Types
 *
 * Type definitions for song metadata.
 * Actual data is now loaded from LRC files (industry standard format).
 *
 * LRC files are located in: public/songs/*.lrc
 */

export interface SongSection {
  id: string;
  name: string;
  startTime: number;
  endTime: number;
  lyrics?: string;
}

export interface SongMetadata {
  songId: string;
  title?: string;
  artist?: string;
  album?: string;
  sections: SongSection[];
}

/**
 * @deprecated Use LRC files instead. This function is kept for backwards compatibility.
 * LRC files are loaded automatically by loadSongs.ts
 */
export function getSongMetadata(_songId: string): SongMetadata | null {
  // Metadata is now loaded from LRC files
  // See: public/songs/*.lrc
  return null;
}
