/**
 * Rhythm Trainer
 *
 * Builds a RhythmPracticePayload from a ChordTimelineArtifact
 * and provides MIDI chord validation logic.
 */

import type {
  ChordTimelineArtifact,
  RhythmPracticePayload,
  PracticeChordChange,
  ChordVoicingData,
  ChordValidationStats,
} from './rhythmTypes';
import { CHORD_VOICINGS } from '../data/chordProgressions';

/**
 * Build a practice payload from a timeline, optionally for a bar range
 */
export function buildPracticePayload(
  projectId: string,
  timeline: ChordTimelineArtifact,
  barRange?: { start: number; end: number },
): RhythmPracticePayload {
  const range = barRange || { start: 1, end: timeline.beatGrid.barCount };

  const changes: PracticeChordChange[] = [];

  for (const chord of timeline.chords) {
    // Skip chords outside range
    if (chord.barEnd < range.start || chord.barStart > range.end) continue;

    const voicing = chord.voicing || getDefaultVoicing(chord.symbol);
    if (!voicing) continue;

    // Find the beat for this chord start
    const beat = timeline.beatGrid.beats.find(b => b.bar === chord.barStart && b.beatInBar === 1);

    changes.push({
      time: chord.startTime,
      bar: chord.barStart,
      beat: 1,
      symbol: chord.symbol,
      voicing,
      duration: chord.endTime - chord.startTime,
    });
  }

  return {
    projectId,
    tempo: timeline.beatGrid.tempo,
    timeSignature: { ...timeline.beatGrid.timeSignature },
    changes,
    barRange: range,
  };
}

/**
 * Get a default voicing for a chord symbol
 * Tries the voicing map, then generates a simple triad
 */
function getDefaultVoicing(symbol: string): ChordVoicingData | null {
  // Direct lookup
  const direct = CHORD_VOICINGS[symbol];
  if (direct) return { bass: direct.bass, notes: [...direct.notes] };

  // Try normalizing (e.g., Bb -> A# lookup)
  const normalized = normalizeChordSymbol(symbol);
  if (normalized !== symbol) {
    const norm = CHORD_VOICINGS[normalized];
    if (norm) return { bass: norm.bass, notes: [...norm.notes] };
  }

  return null;
}

/**
 * Normalize chord symbol for voicing lookup
 */
function normalizeChordSymbol(symbol: string): string {
  const sharpToFlat: Record<string, string> = {
    'C#': 'Db', 'D#': 'Eb', 'F#': 'F#', 'G#': 'Ab', 'A#': 'Bb',
  };
  const flatToSharp: Record<string, string> = {
    'Db': 'C#', 'Eb': 'D#', 'Gb': 'F#', 'Ab': 'G#', 'Bb': 'A#',
  };

  // Try both directions
  for (const [from, to] of Object.entries(flatToSharp)) {
    if (symbol.startsWith(from)) {
      return to + symbol.slice(from.length);
    }
  }
  for (const [from, to] of Object.entries(sharpToFlat)) {
    if (symbol.startsWith(from)) {
      return to + symbol.slice(from.length);
    }
  }

  return symbol;
}

// ============================================
// MIDI Chord Validation
// ============================================

/**
 * Tolerance window for chord change timing (in seconds)
 */
const TIMING_TOLERANCE = 0.3;  // 300ms
const LATE_THRESHOLD = 0.6;    // 600ms — beyond this is "late"

/**
 * Check if a set of pressed MIDI notes matches a chord voicing.
 * Returns the validation result for a single chord change event.
 */
export function validateChordPress(
  pressedNotes: Set<number>,
  expectedVoicing: ChordVoicingData,
  timeSinceChange: number,
): 'correct' | 'late' | 'wrong' | 'pending' {
  if (pressedNotes.size === 0) return 'pending';

  // Check if pressed notes contain the expected chord tones (pitch class matching)
  const expectedPitchClasses = new Set<number>();
  for (const note of expectedVoicing.notes) {
    expectedPitchClasses.add(note % 12);
  }

  const pressedPitchClasses = new Set<number>();
  for (const note of pressedNotes) {
    pressedPitchClasses.add(note % 12);
  }

  // Check how many expected pitch classes are covered
  let matched = 0;
  for (const pc of expectedPitchClasses) {
    if (pressedPitchClasses.has(pc)) matched++;
  }

  const matchRatio = matched / expectedPitchClasses.size;

  // Require at least 2/3 of expected pitch classes
  if (matchRatio >= 0.66) {
    if (timeSinceChange <= TIMING_TOLERANCE) return 'correct';
    if (timeSinceChange <= LATE_THRESHOLD) return 'late';
    return 'late';
  }

  return 'wrong';
}

/**
 * Create empty validation stats
 */
export function createEmptyStats(): ChordValidationStats {
  return { correct: 0, late: 0, wrong: 0, missed: 0, total: 0 };
}
