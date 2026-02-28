/**
 * Key-invariant chord degree utilities.
 *
 * Converts between absolute chord symbols (e.g. "F", "C7", "Bb")
 * and key-relative degrees (e.g. "I", "V", "vi").
 */

import type { ChordDegree, ChordQualityTag } from './rhythmTypes';

const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];

const FLAT_TO_SHARP: Record<string, string> = {
  'Db': 'C#', 'Eb': 'D#', 'Fb': 'E', 'Gb': 'F#', 'Ab': 'G#', 'Bb': 'A#', 'Cb': 'B',
};

// Preferred rendering names per pitch class when in flat keys (F, Bb, Eb, Ab, Db, Gb)
const SHARP_TO_FLAT: Record<string, string> = {
  'C#': 'Db', 'D#': 'Eb', 'F#': 'Gb', 'G#': 'Ab', 'A#': 'Bb',
};

// Keys that conventionally use flats
const FLAT_KEYS = new Set([5, 10, 3, 8, 1, 6]); // F, Bb, Eb, Ab, Db, Gb

/** Scale degree intervals from the major root (in semitones) */
const DEGREE_SEMITONES: { degree: ChordDegree; semitones: number; defaultQuality: ChordQualityTag }[] = [
  { degree: 'I',        semitones: 0,  defaultQuality: 'maj' },
  { degree: 'ii',       semitones: 2,  defaultQuality: 'min' },
  { degree: 'iii',      semitones: 4,  defaultQuality: 'min' },
  { degree: 'IV',       semitones: 5,  defaultQuality: 'maj' },
  { degree: 'V',        semitones: 7,  defaultQuality: 'maj' },
  { degree: 'vi',       semitones: 9,  defaultQuality: 'min' },
  { degree: 'vii_dim',  semitones: 11, defaultQuality: 'dim' },
];

function noteToPitchClass(name: string): number {
  const sharp = FLAT_TO_SHARP[name] || name;
  return NOTE_NAMES.indexOf(sharp);
}

function parseChordSymbol(symbol: string): { root: string; suffix: string } | null {
  if (!symbol || symbol === 'N') return null;
  let root: string;
  let suffix: string;
  if (symbol.length >= 2 && (symbol[1] === '#' || symbol[1] === 'b')) {
    root = symbol.slice(0, 2);
    suffix = symbol.slice(2);
  } else {
    root = symbol[0];
    suffix = symbol.slice(1);
  }
  return { root, suffix };
}

function suffixToQuality(suffix: string): ChordQualityTag {
  if (suffix === '7') return 'dom7';
  if (suffix === 'm') return 'min';
  if (suffix === 'dim' || suffix === '°') return 'dim';
  if (suffix === '' || suffix === 'maj' || suffix === 'M') return 'maj';
  return 'unknown';
}

function qualityToSuffix(quality: ChordQualityTag): string {
  switch (quality) {
    case 'maj': return '';
    case 'min': return 'm';
    case 'dim': return 'dim';
    case 'dom7': return '7';
    case 'unknown': return '';
  }
}

/**
 * Convert an absolute chord symbol to a key-relative degree.
 * Returns null if the symbol can't be parsed or the root isn't a diatonic scale degree.
 */
export function symbolToDegree(
  symbol: string,
  keyRoot: number,
): { degree: ChordDegree; qualityTag: ChordQualityTag } | null {
  const parsed = parseChordSymbol(symbol);
  if (!parsed) return null;

  const pc = noteToPitchClass(parsed.root);
  if (pc < 0) return null;

  const interval = (pc - keyRoot + 12) % 12;
  const entry = DEGREE_SEMITONES.find(d => d.semitones === interval);
  if (!entry) return null;

  return {
    degree: entry.degree,
    qualityTag: suffixToQuality(parsed.suffix),
  };
}

/**
 * Render a degree + quality back to an absolute chord symbol in the given key.
 */
export function renderDegreeToSymbol(
  degree: ChordDegree,
  qualityTag: ChordQualityTag,
  keyRoot: number,
): string {
  if (degree === 'N') return 'N';

  const entry = DEGREE_SEMITONES.find(d => d.degree === degree);
  if (!entry) return 'N';

  const pc = (keyRoot + entry.semitones) % 12;
  let noteName = NOTE_NAMES[pc];

  // Use flats for flat keys
  if (FLAT_KEYS.has(keyRoot) && SHARP_TO_FLAT[noteName]) {
    noteName = SHARP_TO_FLAT[noteName];
  }

  return noteName + qualityToSuffix(qualityTag);
}
