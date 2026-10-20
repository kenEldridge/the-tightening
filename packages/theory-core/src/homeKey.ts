import { NOTE_NAMES, noteToPitchClass } from './chordDefinitions';
import { extendedSuffixOffsets } from './extendedChordDetection';

/**
 * Jam-mode "home key": a manually locked major key the player is practicing
 * in. Provides the key's seven diatonic triads (as canonical 36-node chord
 * names) and Roman-numeral labels for whatever chord is being played.
 */

/** Semitone offsets of the major scale. */
export const MAJOR_SCALE = [0, 2, 4, 5, 7, 9, 11];

const ROMAN = ['I', 'II', 'III', 'IV', 'V', 'VI', 'VII'];

// Diatonic triad per major-scale degree: I ii iii IV V vi vii°
const DIATONIC_SUFFIX = ['', 'm', 'm', '', '', 'm', 'dim'];

// Semitone offset from tonic → [degree index 0-6, accidental], spelled
// relative to the major scale (the convention analysis/romanNumerals.ts uses).
const DEGREE_BY_OFFSET: [number, '' | 'b'][] = [
  [0, ''], [1, 'b'], [1, ''], [2, 'b'], [2, ''], [3, ''],
  [4, 'b'], [4, ''], [5, 'b'], [5, ''], [6, 'b'], [6, ''],
];

const TRIAD_OFFSETS: Record<string, number[]> = {
  '': [0, 4, 7],
  m: [0, 3, 7],
  dim: [0, 3, 6],
  '°': [0, 3, 6],
};

export interface DiatonicChord {
  name: string;     // canonical sharp-spelled node name, e.g. "D#", "Fm", "Ddim"
  numeral: string;  // "I", "ii", ..., "vii°"
}

/** The seven diatonic triads of the major key on `tonicPc`. */
export function diatonicChords(tonicPc: number): DiatonicChord[] {
  return MAJOR_SCALE.map((offset, i) => {
    const suffix = DIATONIC_SUFFIX[i];
    const numeral = suffix === '' ? ROMAN[i] : ROMAN[i].toLowerCase() + (suffix === 'dim' ? '°' : '');
    return { name: NOTE_NAMES[(tonicPc + offset) % 12] + suffix, numeral };
  });
}

export interface RomanNumeralLabel {
  numeral: string;   // e.g. "IV", "ii7", "V7sus4", "bVII", "vii°"
  diatonic: boolean; // every chord tone lies in the key's major scale
}

/**
 * Roman numeral for `chordName` (any spelling, triad or extended suffix the
 * app detects) relative to the major key on `tonicPc`. Case follows the
 * chord's actual quality; null when the name can't be parsed.
 */
export function romanNumeralInMajor(tonicPc: number, chordName: string): RomanNumeralLabel | null {
  const match = chordName.match(/^([A-G][#b]?)(.*)$/);
  if (!match) return null;
  const rootPc = noteToPitchClass(match[1]);
  if (rootPc < 0) return null;
  const suffix = match[2];

  const offsets = TRIAD_OFFSETS[suffix] ?? extendedSuffixOffsets(suffix);
  if (!offsets) return null;

  const isDim = /^(dim|°|m7b5)/.test(suffix);
  const isMinor = isDim || /^m(?!aj)/.test(suffix);

  const [degree, accidental] = DEGREE_BY_OFFSET[(rootPc - tonicPc + 12) % 12];
  const base = isMinor ? ROMAN[degree].toLowerCase() : ROMAN[degree];

  let ext: string;
  if (suffix === 'dim' || suffix === '°') ext = '°';
  else if (suffix === 'dim7') ext = '°7';
  else if (suffix === 'm7b5') ext = 'ø7';
  else if (suffix === 'aug') ext = '+';
  else if (isMinor) ext = suffix.slice(1); // "m7" → "7", "madd9" → "add9"
  else ext = suffix;

  const scale = new Set(MAJOR_SCALE.map(o => (tonicPc + o) % 12));
  const diatonic = offsets.every(o => scale.has((rootPc + o) % 12));

  return { numeral: accidental + base + ext, diatonic };
}

/**
 * Key practice: when the held notes are exactly `triadName`'s three pitch
 * classes (doublings allowed, nothing extra), which inversion is voiced —
 * 0 root position, 1 first (3rd in bass), 2 second (5th in bass). Null when
 * the held notes aren't exactly that triad.
 */
export function exactTriadInversion(heldNotes: Set<number>, triadName: string): number | null {
  const match = triadName.match(/^([A-G][#b]?)(.*)$/);
  if (!match) return null;
  const offsets = TRIAD_OFFSETS[match[2]];
  const rootPc = noteToPitchClass(match[1]);
  if (!offsets || rootPc < 0 || heldNotes.size === 0) return null;

  const tones = offsets.map(o => (rootPc + o) % 12);
  const heldPcs = new Set(Array.from(heldNotes, n => ((n % 12) + 12) % 12));
  if (heldPcs.size !== 3 || !tones.every(pc => heldPcs.has(pc))) return null;

  const bassPc = ((Math.min(...heldNotes) % 12) + 12) % 12;
  return tones.indexOf(bassPc);
}

/** Key for a played triad voicing in the practice record, e.g. "G#:1". */
export function practiceVoicingKey(triadName: string, inversion: number): string {
  return `${triadName}:${inversion}`;
}
