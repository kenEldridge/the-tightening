/**
 * Comparison Engine
 *
 * Compares detected notes (from microphone) against expected notes (from MIDI).
 * Provides detailed feedback on accuracy, timing, and errors.
 *
 * For post-performance analysis in Piano Instructor mode.
 */

import type { MelodyNote } from '../utils/midiParser';

// ============================================
// Types and Interfaces
// ============================================

/**
 * Result of comparing a single note
 */
export interface NoteComparisonResult {
  // The expected note (from MIDI), null if extra note played
  expectedNote: MelodyNote | null;
  // The detected note (from mic), null if note was missed
  detectedMidi: number | null;
  detectedNoteName: string | null;
  // Time the note was detected (seconds from song start)
  detectedTime: number | null;
  // Classification of the result
  type: NoteMatchType;
  // Timing difference in ms (positive = late, negative = early)
  timingDiffMs: number | null;
  // Pitch difference in semitones (0 = correct, positive = sharp, negative = flat)
  pitchDiff: number | null;
  // Clarity/confidence of detection (0-1)
  clarity: number;
}

/**
 * Types of note matching results
 */
export type NoteMatchType =
  | 'hit'           // Correct note at correct time
  | 'early'         // Correct note but played too early
  | 'late'          // Correct note but played too late
  | 'wrong_pitch'   // Wrong note played at expected time
  | 'wrong_octave'  // Correct pitch class but wrong octave
  | 'miss'          // Expected note was not played
  | 'extra';        // Note played when nothing expected

/**
 * Session-level comparison statistics
 */
export interface ComparisonStats {
  // Total expected notes in the passage
  totalExpected: number;
  // Breakdown by result type
  hits: number;
  earlyNotes: number;
  lateNotes: number;
  wrongPitch: number;
  wrongOctave: number;
  misses: number;
  extras: number;
  // Calculated metrics
  accuracy: number;           // hits / totalExpected (0-1)
  pitchAccuracy: number;      // (hits + early + late) / totalExpected
  timingAccuracy: number;     // hits / (hits + early + late)
  averageTimingDiffMs: number;
  // All individual results
  results: NoteComparisonResult[];
}

/**
 * A detected note event for comparison
 */
export interface DetectedNote {
  midi: number;
  noteName: string;
  time: number;       // seconds from song start
  clarity: number;
  velocity: number;
}

/**
 * Configuration for the comparison engine
 */
export interface ComparisonConfig {
  // Time window (ms) before expected note to count as "early" vs "extra"
  earlyWindowMs: number;
  // Time window (ms) after expected note to count as "late" vs "miss"
  lateWindowMs: number;
  // Time tolerance (ms) to count as "on time" (hit)
  onTimeToleranceMs: number;
  // Allow octave errors to be counted separately
  trackOctaveErrors: boolean;
}

export const defaultComparisonConfig: ComparisonConfig = {
  earlyWindowMs: 500,      // Can play up to 500ms early
  lateWindowMs: 500,       // Can play up to 500ms late
  onTimeToleranceMs: 150,  // ±150ms counts as "on time"
  trackOctaveErrors: true,
};

// ============================================
// Comparison Engine Class
// ============================================

export class ComparisonEngine {
  private config: ComparisonConfig;

  // Current session tracking
  private expectedNotes: MelodyNote[] = [];
  private detectedNotes: DetectedNote[] = [];
  private results: NoteComparisonResult[] = [];

  // Matching state
  private matchedExpectedIndices: Set<number> = new Set();
  private matchedDetectedIndices: Set<number> = new Set();

  constructor(config: Partial<ComparisonConfig> = {}) {
    this.config = { ...defaultComparisonConfig, ...config };
  }

  /**
   * Start a new comparison session with expected notes
   */
  startSession(expectedNotes: MelodyNote[]): void {
    this.expectedNotes = [...expectedNotes];
    this.detectedNotes = [];
    this.results = [];
    this.matchedExpectedIndices.clear();
    this.matchedDetectedIndices.clear();

    console.log('[ComparisonEngine] Session started', {
      expectedNotes: expectedNotes.length,
    });
  }

  /**
   * Record a detected note during the session
   */
  recordDetectedNote(note: DetectedNote): NoteComparisonResult | null {
    this.detectedNotes.push(note);
    const detectedIndex = this.detectedNotes.length - 1;

    // Find the best matching expected note
    const match = this.findBestMatch(note);

    if (match) {
      // Mark both as matched
      this.matchedExpectedIndices.add(match.expectedIndex);
      this.matchedDetectedIndices.add(detectedIndex);

      const result = this.createMatchResult(note, match);
      this.results.push(result);

      console.log('[ComparisonEngine] Note matched:', result.type, {
        expected: match.expectedNote.name,
        detected: note.noteName,
        timingDiff: result.timingDiffMs,
      });

      return result;
    } else {
      // No match found - this is an extra note
      const result: NoteComparisonResult = {
        expectedNote: null,
        detectedMidi: note.midi,
        detectedNoteName: note.noteName,
        detectedTime: note.time,
        type: 'extra',
        timingDiffMs: null,
        pitchDiff: null,
        clarity: note.clarity,
      };
      this.results.push(result);

      console.log('[ComparisonEngine] Extra note:', note.noteName, 'at', note.time.toFixed(2));

      return result;
    }
  }

  /**
   * Find the best matching expected note for a detected note
   */
  private findBestMatch(detected: DetectedNote): {
    expectedIndex: number;
    expectedNote: MelodyNote;
    timingDiff: number;
    pitchDiff: number;
  } | null {
    let bestMatch: {
      expectedIndex: number;
      expectedNote: MelodyNote;
      timingDiff: number;
      pitchDiff: number;
      score: number;
    } | null = null;

    const earlyWindowSec = this.config.earlyWindowMs / 1000;
    const lateWindowSec = this.config.lateWindowMs / 1000;

    for (let i = 0; i < this.expectedNotes.length; i++) {
      // Skip already matched notes
      if (this.matchedExpectedIndices.has(i)) continue;

      const expected = this.expectedNotes[i];
      const timingDiff = (detected.time - expected.time) * 1000; // ms

      // Check if within time window
      if (timingDiff < -this.config.earlyWindowMs || timingDiff > this.config.lateWindowMs) {
        continue;
      }

      const pitchDiff = detected.midi - expected.midi;

      // Calculate match score (lower is better)
      // Prioritize: 1) correct pitch, 2) close timing
      let score = Math.abs(timingDiff);
      if (pitchDiff !== 0) {
        score += 1000; // Penalty for wrong pitch
        // But reduce penalty for octave errors
        if (this.config.trackOctaveErrors && pitchDiff % 12 === 0) {
          score -= 500; // Less penalty for octave error
        }
      }

      if (!bestMatch || score < bestMatch.score) {
        bestMatch = {
          expectedIndex: i,
          expectedNote: expected,
          timingDiff,
          pitchDiff,
          score,
        };
      }
    }

    return bestMatch ? {
      expectedIndex: bestMatch.expectedIndex,
      expectedNote: bestMatch.expectedNote,
      timingDiff: bestMatch.timingDiff,
      pitchDiff: bestMatch.pitchDiff,
    } : null;
  }

  /**
   * Create a comparison result from a match
   */
  private createMatchResult(
    detected: DetectedNote,
    match: { expectedNote: MelodyNote; timingDiff: number; pitchDiff: number }
  ): NoteComparisonResult {
    const { expectedNote, timingDiff, pitchDiff } = match;

    // Determine the type of match
    let type: NoteMatchType;

    if (pitchDiff === 0) {
      // Correct pitch - check timing
      if (Math.abs(timingDiff) <= this.config.onTimeToleranceMs) {
        type = 'hit';
      } else if (timingDiff < 0) {
        type = 'early';
      } else {
        type = 'late';
      }
    } else if (this.config.trackOctaveErrors && pitchDiff % 12 === 0) {
      // Same pitch class, different octave
      type = 'wrong_octave';
    } else {
      type = 'wrong_pitch';
    }

    return {
      expectedNote,
      detectedMidi: detected.midi,
      detectedNoteName: detected.noteName,
      detectedTime: detected.time,
      type,
      timingDiffMs: timingDiff,
      pitchDiff,
      clarity: detected.clarity,
    };
  }

  /**
   * End the session and mark all unmatched expected notes as misses
   */
  endSession(): ComparisonStats {
    // Mark unmatched expected notes as misses
    for (let i = 0; i < this.expectedNotes.length; i++) {
      if (!this.matchedExpectedIndices.has(i)) {
        const expected = this.expectedNotes[i];
        this.results.push({
          expectedNote: expected,
          detectedMidi: null,
          detectedNoteName: null,
          detectedTime: null,
          type: 'miss',
          timingDiffMs: null,
          pitchDiff: null,
          clarity: 0,
        });
      }
    }

    const stats = this.calculateStats();

    console.log('[ComparisonEngine] Session ended', {
      totalExpected: stats.totalExpected,
      accuracy: (stats.accuracy * 100).toFixed(1) + '%',
      hits: stats.hits,
      misses: stats.misses,
      extras: stats.extras,
    });

    return stats;
  }

  /**
   * Get current stats without ending session
   */
  getCurrentStats(): ComparisonStats {
    return this.calculateStats();
  }

  /**
   * Calculate statistics from results
   */
  private calculateStats(): ComparisonStats {
    const totalExpected = this.expectedNotes.length;

    let hits = 0;
    let earlyNotes = 0;
    let lateNotes = 0;
    let wrongPitch = 0;
    let wrongOctave = 0;
    let misses = 0;
    let extras = 0;
    let totalTimingDiff = 0;
    let timingCount = 0;

    for (const result of this.results) {
      switch (result.type) {
        case 'hit':
          hits++;
          if (result.timingDiffMs !== null) {
            totalTimingDiff += result.timingDiffMs;
            timingCount++;
          }
          break;
        case 'early':
          earlyNotes++;
          if (result.timingDiffMs !== null) {
            totalTimingDiff += result.timingDiffMs;
            timingCount++;
          }
          break;
        case 'late':
          lateNotes++;
          if (result.timingDiffMs !== null) {
            totalTimingDiff += result.timingDiffMs;
            timingCount++;
          }
          break;
        case 'wrong_pitch':
          wrongPitch++;
          break;
        case 'wrong_octave':
          wrongOctave++;
          break;
        case 'miss':
          misses++;
          break;
        case 'extra':
          extras++;
          break;
      }
    }

    const correctPitchCount = hits + earlyNotes + lateNotes;
    const accuracy = totalExpected > 0 ? hits / totalExpected : 0;
    const pitchAccuracy = totalExpected > 0 ? correctPitchCount / totalExpected : 0;
    const timingAccuracy = correctPitchCount > 0 ? hits / correctPitchCount : 0;
    const averageTimingDiffMs = timingCount > 0 ? totalTimingDiff / timingCount : 0;

    return {
      totalExpected,
      hits,
      earlyNotes,
      lateNotes,
      wrongPitch,
      wrongOctave,
      misses,
      extras,
      accuracy,
      pitchAccuracy,
      timingAccuracy,
      averageTimingDiffMs,
      results: this.results,
    };
  }

  /**
   * Get notes that are coming up (for preview/preparation)
   * @param currentTime Current playback time in seconds
   * @param lookAhead How far ahead to look in seconds
   */
  getUpcomingNotes(currentTime: number, lookAhead: number = 2): MelodyNote[] {
    return this.expectedNotes.filter(note => {
      const noteTime = note.time;
      return noteTime >= currentTime && noteTime <= currentTime + lookAhead;
    });
  }

  /**
   * Check if a specific expected note has been matched
   */
  isNoteMatched(noteIndex: number): boolean {
    return this.matchedExpectedIndices.has(noteIndex);
  }

  /**
   * Get the result for a specific expected note
   */
  getNoteResult(noteIndex: number): NoteComparisonResult | null {
    if (!this.matchedExpectedIndices.has(noteIndex)) {
      return null;
    }
    return this.results.find(r =>
      r.expectedNote && this.expectedNotes.indexOf(r.expectedNote) === noteIndex
    ) || null;
  }

  /**
   * Update configuration
   */
  updateConfig(config: Partial<ComparisonConfig>): void {
    this.config = { ...this.config, ...config };
  }

  /**
   * Reset the engine
   */
  reset(): void {
    this.expectedNotes = [];
    this.detectedNotes = [];
    this.results = [];
    this.matchedExpectedIndices.clear();
    this.matchedDetectedIndices.clear();
  }
}
