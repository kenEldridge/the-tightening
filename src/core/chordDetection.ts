import type { GraphNode } from '../types/index.js';

/**
 * Detect which graph chords are being played based on held MIDI notes.
 *
 * Uses pitch class subset matching: a chord matches if its pitch class set
 * is a subset of the held pitch classes. Results are sorted by pitch class
 * set size descending ("prefer most specific") — e.g. G7 ranks above G.
 *
 * Returns all matching node IDs. First element is the "best match".
 */
export function detectChords(
  heldMidiNotes: Set<number>,
  graphNodes: Map<string, GraphNode>,
): string[] {
  if (heldMidiNotes.size === 0) return [];

  // Compute held pitch classes (note % 12)
  const heldPitchClasses = new Set<number>();
  for (const note of heldMidiNotes) {
    heldPitchClasses.add(note % 12);
  }

  // Find all matching chords
  const matches: { id: string; size: number }[] = [];

  for (const [id, node] of graphNodes) {
    const chordPcs = node.chord.pitchClasses;
    // Check if chord's pitch classes are a subset of held pitch classes
    let isSubset = true;
    for (const pc of chordPcs) {
      if (!heldPitchClasses.has(pc)) {
        isSubset = false;
        break;
      }
    }
    if (isSubset) {
      matches.push({ id, size: chordPcs.size });
    }
  }

  // Sort by pitch class set size descending (prefer most specific)
  matches.sort((a, b) => b.size - a.size);

  return matches.map(m => m.id);
}

/**
 * Convert a MIDI note number to a note name (e.g. 60 → "C4").
 */
export function midiNoteToName(note: number): string {
  const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
  const octave = Math.floor(note / 12) - 1;
  const name = NOTE_NAMES[note % 12];
  return `${name}${octave}`;
}
