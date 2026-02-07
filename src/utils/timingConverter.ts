/**
 * Timing Converter Utility
 *
 * Converts OCR measure/beat positions to video timestamps.
 * Infers tempo from segment duration and measure count.
 */

import type { ExtractedNote } from '../core/SheetMusicOCR';
import type { MelodyNote } from './midiParser';

export interface TimingConfig {
  /** Beats per measure from time signature (e.g., 4 for 4/4) */
  beatsPerMeasure: number;
  /** Tempo in BPM */
  tempo: number;
  /** Start time in the video (seconds) */
  segmentStartTime: number;
}

/**
 * Infer tempo from segment duration and measure count
 *
 * Example: 10-second segment, 4 measures of 4/4 time
 * = 16 beats in 10 seconds = 96 BPM
 *
 * @param segmentDuration - Duration of the segment in seconds
 * @param measureCount - Number of measures detected
 * @param beatsPerMeasure - Beats per measure (e.g., 4 for 4/4)
 * @returns Inferred tempo in BPM
 */
export function inferTempo(
  segmentDuration: number,
  measureCount: number,
  beatsPerMeasure: number
): number {
  if (segmentDuration <= 0 || measureCount <= 0 || beatsPerMeasure <= 0) {
    console.warn('[timingConverter] Invalid parameters, using default tempo 120 BPM');
    return 120;
  }

  const totalBeats = measureCount * beatsPerMeasure;
  const tempo = (totalBeats / segmentDuration) * 60;

  // Clamp to reasonable range (40-240 BPM)
  const clampedTempo = Math.max(40, Math.min(240, tempo));

  console.log('[timingConverter] Inferred tempo:', {
    segmentDuration,
    measureCount,
    beatsPerMeasure,
    totalBeats,
    tempo: clampedTempo,
  });

  return clampedTempo;
}

/**
 * Count the number of measures from OCR notes
 *
 * @param notes - Array of OCR-extracted notes
 * @returns Maximum measure number found
 */
export function countMeasures(notes: ExtractedNote[]): number {
  if (notes.length === 0) return 0;

  return Math.max(...notes.map(n => n.measure));
}

/**
 * Convert OCR note (measure/beat position) to timestamp relative to segment start
 *
 * @param note - OCR extracted note with measure/beat info
 * @param config - Timing configuration
 * @returns Timestamp in seconds relative to segment start
 */
export function ocrNoteToRelativeTime(
  note: ExtractedNote,
  config: TimingConfig
): number {
  const { beatsPerMeasure, tempo } = config;

  // Calculate beat position from start of segment (0-indexed)
  // Measures and beats are 1-indexed in the OCR output
  const beatPosition = (note.measure - 1) * beatsPerMeasure + (note.beat - 1);

  // Convert beats to seconds
  const secondsPerBeat = 60 / tempo;
  const relativeTime = beatPosition * secondsPerBeat;

  return relativeTime;
}

/**
 * Convert OCR note to absolute video timestamp
 *
 * @param note - OCR extracted note
 * @param config - Timing configuration (includes segment start time)
 * @returns Absolute timestamp in the video
 */
export function ocrNoteToTimestamp(
  note: ExtractedNote,
  config: TimingConfig
): number {
  const relativeTime = ocrNoteToRelativeTime(note, config);
  return config.segmentStartTime + relativeTime;
}

/**
 * Duration string to seconds
 */
export function durationToSeconds(
  duration: string,
  tempo: number
): number {
  const secondsPerBeat = 60 / tempo;

  const durationMap: Record<string, number> = {
    'whole': 4,
    'half': 2,
    'dotted-half': 3,
    'quarter': 1,
    'dotted-quarter': 1.5,
    'eighth': 0.5,
    'dotted-eighth': 0.75,
    'sixteenth': 0.25,
    'thirty-second': 0.125,
  };

  const beats = durationMap[duration.toLowerCase()] ?? 1;
  return beats * secondsPerBeat;
}

/**
 * Convert all OCR notes to MelodyNote format with proper timing
 *
 * @param ocrNotes - Array of OCR-extracted notes
 * @param config - Timing configuration
 * @returns Array of MelodyNotes with absolute timing
 */
export function convertOcrNotesToMelody(
  ocrNotes: ExtractedNote[],
  config: TimingConfig
): MelodyNote[] {
  return ocrNotes.map(note => {
    const time = ocrNoteToRelativeTime(note, config);
    const duration = durationToSeconds(note.duration, config.tempo);

    return {
      midi: note.midi,
      time,
      duration,
      velocity: 0.8,
      name: note.noteName,
    };
  }).sort((a, b) => a.time - b.time);
}

/**
 * Calculate segment duration from measure count and tempo
 *
 * @param measureCount - Number of measures
 * @param beatsPerMeasure - Beats per measure
 * @param tempo - Tempo in BPM
 * @returns Duration in seconds
 */
export function calculateSegmentDuration(
  measureCount: number,
  beatsPerMeasure: number,
  tempo: number
): number {
  const totalBeats = measureCount * beatsPerMeasure;
  const secondsPerBeat = 60 / tempo;
  return totalBeats * secondsPerBeat;
}

/**
 * Get the note that should be playing at a given time
 *
 * @param notes - Array of MelodyNotes
 * @param currentTime - Current playback time (relative to segment start)
 * @returns The note at current time, or null if none
 */
export function getNoteAtTime(
  notes: MelodyNote[],
  currentTime: number
): MelodyNote | null {
  return notes.find(
    note => currentTime >= note.time && currentTime < note.time + note.duration
  ) ?? null;
}

/**
 * Get upcoming notes within a time window
 *
 * @param notes - Array of MelodyNotes
 * @param currentTime - Current playback time
 * @param windowSeconds - How far ahead to look
 * @returns Array of upcoming notes
 */
export function getUpcomingNotes(
  notes: MelodyNote[],
  currentTime: number,
  windowSeconds: number = 3
): MelodyNote[] {
  return notes.filter(
    note => note.time > currentTime && note.time <= currentTime + windowSeconds
  );
}

/**
 * Get past notes within a time window
 *
 * @param notes - Array of MelodyNotes
 * @param currentTime - Current playback time
 * @param windowSeconds - How far back to look
 * @returns Array of past notes
 */
export function getPastNotes(
  notes: MelodyNote[],
  currentTime: number,
  windowSeconds: number = 2
): MelodyNote[] {
  return notes.filter(
    note => note.time + note.duration < currentTime &&
            note.time + note.duration >= currentTime - windowSeconds
  );
}

/**
 * Find index of the note closest to a given time
 */
export function findClosestNoteIndex(
  notes: MelodyNote[],
  time: number
): number {
  if (notes.length === 0) return -1;

  let closestIndex = 0;
  let closestDiff = Math.abs(notes[0].time - time);

  for (let i = 1; i < notes.length; i++) {
    const diff = Math.abs(notes[i].time - time);
    if (diff < closestDiff) {
      closestDiff = diff;
      closestIndex = i;
    }
  }

  return closestIndex;
}
