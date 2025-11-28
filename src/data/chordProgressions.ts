/**
 * Chord Progressions for Songs
 *
 * Contains hardcoded chord progressions for known songs.
 * Future: Could be auto-generated from MIDI analysis.
 */

export interface ChordEvent {
  time: number;      // Start time in seconds
  chord: string;     // Chord name (e.g., 'D', 'Am', 'F#m')
  duration: number;  // Duration in seconds
}

export interface ChordVoicing {
  bass: number;      // Bass note (MIDI number)
  notes: number[];   // Chord tones (MIDI numbers)
}

/**
 * Map chord names to MIDI note numbers for voicings
 * Root is in octave 2 (bass), chord tones in octave 3
 */
export const CHORD_VOICINGS: Record<string, ChordVoicing> = {
  // Major chords
  'C':   { bass: 36, notes: [48, 52, 55] },       // C2, C3-E3-G3
  'D':   { bass: 38, notes: [50, 54, 57] },       // D2, D3-F#3-A3
  'E':   { bass: 40, notes: [52, 56, 59] },       // E2, E3-G#3-B3
  'F':   { bass: 41, notes: [53, 57, 60] },       // F2, F3-A3-C4
  'G':   { bass: 43, notes: [55, 59, 62] },       // G2, G3-B3-D4
  'A':   { bass: 45, notes: [57, 61, 64] },       // A2, A3-C#4-E4
  'B':   { bass: 47, notes: [59, 63, 66] },       // B2, B3-D#4-F#4

  // Minor chords
  'Cm':  { bass: 36, notes: [48, 51, 55] },       // C2, C3-Eb3-G3
  'Dm':  { bass: 38, notes: [50, 53, 57] },       // D2, D3-F3-A3
  'Em':  { bass: 40, notes: [52, 55, 59] },       // E2, E3-G3-B3
  'Fm':  { bass: 41, notes: [53, 56, 60] },       // F2, F3-Ab3-C4
  'Gm':  { bass: 43, notes: [55, 58, 62] },       // G2, G3-Bb3-D4
  'Am':  { bass: 45, notes: [57, 60, 64] },       // A2, A3-C4-E4
  'Bm':  { bass: 47, notes: [59, 62, 66] },       // B2, B3-D4-F#4

  // Sharp/flat root minor chords
  'F#m': { bass: 42, notes: [54, 57, 61] },       // F#2, F#3-A3-C#4
  'C#m': { bass: 37, notes: [49, 52, 56] },       // C#2, C#3-E3-G#3
  'G#m': { bass: 44, notes: [56, 59, 63] },       // G#2, G#3-B3-D#4
  'Bbm': { bass: 46, notes: [58, 61, 65] },       // Bb2, Bb3-Db4-F4
  'Ebm': { bass: 39, notes: [51, 54, 58] },       // Eb2, Eb3-Gb3-Bb3

  // Sharp/flat root major chords
  'F#':  { bass: 42, notes: [54, 58, 61] },       // F#2, F#3-A#3-C#4
  'Bb':  { bass: 46, notes: [58, 62, 65] },       // Bb2, Bb3-D4-F4
  'Eb':  { bass: 39, notes: [51, 55, 58] },       // Eb2, Eb3-G3-Bb3
  'Ab':  { bass: 44, notes: [56, 60, 63] },       // Ab2, Ab3-C4-Eb4
  'Db':  { bass: 37, notes: [49, 53, 56] },       // Db2, Db3-F3-Ab3

  // Dominant 7th chords
  'C7':  { bass: 36, notes: [48, 52, 55, 58] },   // C2, C3-E3-G3-Bb3
  'F7':  { bass: 41, notes: [53, 57, 60, 63] },   // F2, F3-A3-C4-Eb4
  'G7':  { bass: 43, notes: [55, 59, 62, 65] },   // G2, G3-B3-D4-F4
};

/**
 * Canon in D by Johann Pachelbel
 * Chord progression: D - A - Bm - F#m - G - D - G - A (repeating)
 *
 * The original is in 4/4 time at ~54 BPM with 2 beats per chord
 * Each chord lasts approximately 2 seconds at original tempo
 */
export const CANON_IN_D_CHORDS: ChordEvent[] = (() => {
  const progression = ['D', 'A', 'Bm', 'F#m', 'G', 'D', 'G', 'A'];
  const beatsPerChord = 2;
  const bpm = 54;
  const secondsPerBeat = 60 / bpm;
  const chordDuration = beatsPerChord * secondsPerBeat;

  // Canon in D loops this progression throughout
  // Generate enough chords to cover ~3 minutes (typical arrangement)
  const totalDuration = 180; // 3 minutes
  const chords: ChordEvent[] = [];
  let time = 0;
  let chordIndex = 0;

  while (time < totalDuration) {
    chords.push({
      time,
      chord: progression[chordIndex],
      duration: chordDuration,
    });
    time += chordDuration;
    chordIndex = (chordIndex + 1) % progression.length;
  }

  return chords;
})();

/**
 * Hey Jude by The Beatles
 * Key: F major
 * Verse: F - C - C7 - F - Bb - F - C7 - F
 * Bridge varies, outro is F - Eb - Bb - F
 *
 * Tempo ~72 BPM, 4 beats per bar, 2 bars per chord change typically
 */
export const HEY_JUDE_CHORDS: ChordEvent[] = (() => {
  const bpm = 72;
  const beatsPerBar = 4;
  const secondsPerBeat = 60 / bpm;
  const barDuration = beatsPerBar * secondsPerBeat;

  // Hey Jude structure (simplified):
  // Verse pattern repeats, with variations
  // Each chord gets roughly 1-2 bars
  const chords: ChordEvent[] = [];

  // Verse 1: "Hey Jude, don't make it bad..."
  const versePattern = [
    { chord: 'F', bars: 2 },
    { chord: 'C', bars: 1 },
    { chord: 'C7', bars: 1 },
    { chord: 'F', bars: 2 },
    { chord: 'Bb', bars: 1 },
    { chord: 'F', bars: 1 },
    { chord: 'C7', bars: 1 },
    { chord: 'F', bars: 1 },
  ];

  // Outro "na na na" pattern
  const outroPattern = [
    { chord: 'F', bars: 2 },
    { chord: 'Eb', bars: 2 },
    { chord: 'Bb', bars: 2 },
    { chord: 'F', bars: 2 },
  ];

  let time = 0;

  // Generate 3 verses worth
  for (let verse = 0; verse < 3; verse++) {
    for (const { chord, bars } of versePattern) {
      chords.push({
        time,
        chord,
        duration: bars * barDuration,
      });
      time += bars * barDuration;
    }
  }

  // Add outro section (repeating)
  for (let i = 0; i < 6; i++) {
    for (const { chord, bars } of outroPattern) {
      chords.push({
        time,
        chord,
        duration: bars * barDuration,
      });
      time += bars * barDuration;
    }
  }

  return chords;
})();

/**
 * Get chord voicing for a chord name
 */
export function getChordVoicing(chordName: string): ChordVoicing | null {
  return CHORD_VOICINGS[chordName] || null;
}

/**
 * Get chord progression for a song
 */
export function getChordProgression(songId: string): ChordEvent[] | null {
  switch (songId) {
    case 'canon-in-d':
      return CANON_IN_D_CHORDS;
    case 'hey-jude':
      return HEY_JUDE_CHORDS;
    default:
      return null;
  }
}
