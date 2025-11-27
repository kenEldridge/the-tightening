/**
 * MIDI Parser Utility
 *
 * Parses MIDI files and extracts melody information
 * Converts to internal JSON format for the app
 */

import { Midi } from '@tonejs/midi';

export interface MelodyNote {
  // MIDI note number (0-127)
  midi: number;
  // Time in seconds from start of song
  time: number;
  // Duration in seconds
  duration: number;
  // Velocity (0-1)
  velocity: number;
  // Note name (e.g., "C4", "D#5")
  name: string;
}

export interface SongSegment {
  // Unique identifier
  id: string;
  // User-friendly name
  name: string;
  // Start time in seconds
  startTime: number;
  // End time in seconds
  endTime: number;
  // Index of first note in segment
  startNoteIndex: number;
  // Index of last note in segment
  endNoteIndex: number;
  // Number of notes in segment
  noteCount: number;
}

export interface SongData {
  // Song metadata
  name: string;
  // Tempo in BPM
  tempo: number;
  // Time signature
  timeSignature: {
    numerator: number;
    denominator: number;
  };
  // Total duration in seconds
  duration: number;
  // Melody notes in order
  notes: MelodyNote[];
  // MIDI note range (for visual keyboard)
  range: {
    min: number;
    max: number;
  };
  // Detected song segments
  segments: SongSegment[];
}

/**
 * Detect song segments based on gaps between notes
 *
 * @param notes - Array of melody notes
 * @param config - Detection configuration
 * @returns Array of detected segments
 */
function detectSegments(
  notes: MelodyNote[],
  config: {
    minGapSize?: number;
    minSegmentLength?: number;
  } = {}
): SongSegment[] {
  const minGapSize = config.minGapSize ?? 0.5; // seconds
  const minSegmentLength = config.minSegmentLength ?? 2.0; // seconds

  const segments: SongSegment[] = [];
  let segmentStartIdx = 0;

  for (let i = 1; i < notes.length; i++) {
    // Calculate gap between previous note end and current note start
    const gap = notes[i].time - (notes[i - 1].time + notes[i - 1].duration);

    // If gap is large enough, end current segment
    if (gap >= minGapSize) {
      const startTime = notes[segmentStartIdx].time;
      const endTime = notes[i - 1].time + notes[i - 1].duration;
      const duration = endTime - startTime;

      // Only create segment if it's long enough
      if (duration >= minSegmentLength) {
        segments.push({
          id: `segment-${segments.length}`,
          name: `Phrase ${segments.length + 1}`,
          startTime,
          endTime,
          startNoteIndex: segmentStartIdx,
          endNoteIndex: i - 1,
          noteCount: i - segmentStartIdx,
        });
      }

      segmentStartIdx = i;
    }
  }

  // Add final segment
  if (segmentStartIdx < notes.length) {
    const startTime = notes[segmentStartIdx].time;
    const endTime = notes[notes.length - 1].time + notes[notes.length - 1].duration;
    segments.push({
      id: `segment-${segments.length}`,
      name: `Phrase ${segments.length + 1}`,
      startTime,
      endTime,
      startNoteIndex: segmentStartIdx,
      endNoteIndex: notes.length - 1,
      noteCount: notes.length - segmentStartIdx,
    });
  }

  // Fallback: if no segments detected, treat entire song as one segment
  if (segments.length === 0 && notes.length > 0) {
    segments.push({
      id: 'segment-0',
      name: 'Full Song',
      startTime: 0,
      endTime: notes[notes.length - 1].time + notes[notes.length - 1].duration,
      startNoteIndex: 0,
      endNoteIndex: notes.length - 1,
      noteCount: notes.length,
    });
  }

  return segments;
}

/**
 * Parse a MIDI file and extract the melody line
 *
 * @param midiData - ArrayBuffer or Uint8Array of MIDI file data
 * @param trackIndex - Which track to use (default: 0, first track)
 * @returns Parsed song data
 */
export function parseMidiFile(
  midiData: ArrayBuffer | Uint8Array,
  trackIndex: number = 0
): SongData {
  const midi = new Midi(midiData);

  if (midi.tracks.length === 0) {
    throw new Error('MIDI file has no tracks');
  }

  // Use specified track or first non-empty track
  let track = midi.tracks[trackIndex];

  // If specified track is empty, find first non-empty track
  if (!track || track.notes.length === 0) {
    track = midi.tracks.find((t) => t.notes.length > 0);
    if (!track) {
      throw new Error('MIDI file has no notes');
    }
  }

  // Extract melody notes
  const notes: MelodyNote[] = track.notes.map((note) => ({
    midi: note.midi,
    time: note.time,
    duration: note.duration,
    velocity: note.velocity,
    name: note.name,
  }));

  // Calculate note range
  const midiNumbers = notes.map((n) => n.midi);
  const minMidi = Math.min(...midiNumbers);
  const maxMidi = Math.max(...midiNumbers);

  // Get tempo (use first tempo change or default 120 BPM)
  const tempo = midi.header.tempos.length > 0
    ? midi.header.tempos[0].bpm
    : 120;

  // Get time signature (use first or default 4/4)
  const timeSignature = midi.header.timeSignatures.length > 0
    ? {
        numerator: midi.header.timeSignatures[0].timeSignature[0],
        denominator: midi.header.timeSignatures[0].timeSignature[1],
      }
    : { numerator: 4, denominator: 4 };

  // Detect segments
  const segments = detectSegments(notes);

  return {
    name: midi.name || 'Unknown',
    tempo,
    timeSignature,
    duration: midi.duration,
    notes,
    range: {
      min: minMidi,
      max: maxMidi,
    },
    segments,
  };
}

/**
 * Load and parse a MIDI file from a URL
 *
 * @param url - URL to MIDI file
 * @param trackIndex - Which track to use (default: 0)
 * @returns Promise resolving to parsed song data
 */
export async function loadMidiFromUrl(
  url: string,
  trackIndex: number = 0
): Promise<SongData> {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Failed to fetch MIDI file: ${response.statusText}`);
  }

  const arrayBuffer = await response.arrayBuffer();
  return parseMidiFile(arrayBuffer, trackIndex);
}

/**
 * Get all tracks from a MIDI file (for debugging/exploration)
 *
 * @param midiData - ArrayBuffer or Uint8Array of MIDI file data
 * @returns Array of track information
 */
export function getMidiTracks(midiData: ArrayBuffer | Uint8Array) {
  const midi = new Midi(midiData);

  return midi.tracks.map((track, index) => ({
    index,
    name: track.name || `Track ${index + 1}`,
    noteCount: track.notes.length,
    instrument: track.instrument?.name || 'Unknown',
    channel: track.channel,
  }));
}

/**
 * Helper: Convert MIDI note number to frequency (Hz)
 */
export function midiToFrequency(midi: number): number {
  return Math.pow(2, (midi - 69) / 12) * 440;
}

/**
 * Helper: Convert MIDI note number to note name
 */
export function midiToNoteName(midi: number): string {
  const notes = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
  const octave = Math.floor(midi / 12) - 1;
  const noteIndex = midi % 12;
  return `${notes[noteIndex]}${octave}`;
}
