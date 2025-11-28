/**
 * Song Metadata
 *
 * Manual section definitions with lyrics for each song.
 * Sections are defined by musical structure (Verse, Chorus, etc.)
 * rather than auto-detected gaps in the MIDI.
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
  sections: SongSection[];
}

/**
 * Hey Jude - The Beatles
 *
 * Section timing based on MIDI analysis:
 * - Section 1: 0.00 - 56.76s (Verse 1)
 * - Section 2: 58.99 - 95.68s (Verse 2)
 * - Section 3: 99.73 - 124.86s (Verse 3)
 * - Section 4: 127.09 - 163.78s (Bridge)
 * - Section 5: 167.84 - 275.68s (Outro/Coda)
 *
 * NOTE: Add your own lyrics below - they're left as placeholders
 * to avoid copyright issues in the codebase.
 */
export const HEY_JUDE_METADATA: SongMetadata = {
  songId: 'hey-jude',
  sections: [
    {
      id: 'verse-1',
      name: 'Verse 1',
      startTime: 0,
      endTime: 56.76,
      lyrics: `[Add verse 1 lyrics here]

"Hey Jude, don't make it bad..."`,
    },
    {
      id: 'verse-2',
      name: 'Verse 2',
      startTime: 58.99,
      endTime: 95.68,
      lyrics: `[Add verse 2 lyrics here]

"Hey Jude, don't be afraid..."`,
    },
    {
      id: 'verse-3',
      name: 'Verse 3',
      startTime: 99.73,
      endTime: 124.86,
      lyrics: `[Add verse 3 lyrics here]

"Hey Jude, don't let me down..."`,
    },
    {
      id: 'bridge',
      name: 'Bridge',
      startTime: 127.09,
      endTime: 163.78,
      lyrics: `[Add bridge lyrics here]

"So let it out and let it in..."`,
    },
    {
      id: 'outro',
      name: 'Outro (Na Na Na)',
      startTime: 167.84,
      endTime: 275.68,
      lyrics: `Na na na na-na-na na
Na-na-na na, hey Jude...

(Repeat and fade)`,
    },
  ],
};

/**
 * Canon in D - Johann Pachelbel
 *
 * Instrumental piece - no lyrics, but sections help with practice.
 * The piece follows a repeating chord progression (D-A-Bm-F#m-G-D-G-A)
 * with variations building in complexity.
 */
export const CANON_IN_D_METADATA: SongMetadata = {
  songId: 'canon-in-d',
  sections: [
    {
      id: 'intro',
      name: 'Introduction',
      startTime: 0,
      endTime: 30,
      lyrics: '(Instrumental - bass line establishes the progression)',
    },
    {
      id: 'theme-1',
      name: 'Theme A',
      startTime: 30,
      endTime: 60,
      lyrics: '(Simple melody over the chord progression)',
    },
    {
      id: 'theme-2',
      name: 'Theme B',
      startTime: 60,
      endTime: 90,
      lyrics: '(Melody with eighth note variations)',
    },
    {
      id: 'development',
      name: 'Development',
      startTime: 90,
      endTime: 150,
      lyrics: '(Sixteenth note runs and ornamentation)',
    },
    {
      id: 'finale',
      name: 'Finale',
      startTime: 150,
      endTime: 200,
      lyrics: '(Return to theme with full texture)',
    },
  ],
};

/**
 * Get metadata for a song by ID
 */
export function getSongMetadata(songId: string): SongMetadata | null {
  switch (songId) {
    case 'hey-jude':
      return HEY_JUDE_METADATA;
    case 'canon-in-d':
      return CANON_IN_D_METADATA;
    default:
      return null;
  }
}

/**
 * Convert SongMetadata sections to SongSegment format
 * (for compatibility with existing segment system)
 */
export function metadataToSegments(metadata: SongMetadata): import('../utils/midiParser').SongSegment[] {
  return metadata.sections.map((section, index) => ({
    id: section.id,
    name: section.name,
    startTime: section.startTime,
    endTime: section.endTime,
    startNoteIndex: 0,  // Will be calculated when merging with MIDI
    endNoteIndex: 0,    // Will be calculated when merging with MIDI
    noteCount: 0,       // Will be calculated when merging with MIDI
    lyrics: section.lyrics,
  }));
}
