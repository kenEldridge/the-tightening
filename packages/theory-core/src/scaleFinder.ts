/**
 * Scale finder — given a chord progression, find scales whose notes contain
 * the progression's chord tones.
 *
 * Every chord tone in the progression is pooled into one pitch-class set and
 * tested against all 12 transpositions of each scale type. Fully-fitting scales
 * rank first; when nothing fits fully, near misses (few outside notes) are
 * returned so borrowed/chromatic chords still get a useful answer.
 *
 * Diatonic modes share notes (C Ionian = A Aeolian = D Dorian...), so the
 * tie-breaker is tonic evidence: a scale whose root matches the first chord's
 * root (then the last chord's, then any chord's) is the likelier reading.
 */

import { getChordDefinition, noteToPitchClass } from './chordDefinitions';

export type ScaleType =
  | 'major' | 'minor' | 'dorian' | 'phrygian' | 'lydian' | 'mixolydian' | 'locrian'
  | 'harmonicMinor' | 'melodicMinor' | 'majorPentatonic' | 'minorPentatonic' | 'blues';

export interface ScaleTypeInfo {
  label: string;
  /** Intervals from the root, in semitones */
  intervals: number[];
  /** Lower = more commonly the intended reading; used as a tie-breaker */
  rarity: number;
}

export const SCALE_TYPES: Record<ScaleType, ScaleTypeInfo> = {
  major:           { label: 'major (Ionian)',   intervals: [0, 2, 4, 5, 7, 9, 11], rarity: 0 },
  minor:           { label: 'minor (Aeolian)',  intervals: [0, 2, 3, 5, 7, 8, 10], rarity: 0 },
  majorPentatonic: { label: 'major pentatonic', intervals: [0, 2, 4, 7, 9],        rarity: 1 },
  minorPentatonic: { label: 'minor pentatonic', intervals: [0, 3, 5, 7, 10],       rarity: 1 },
  dorian:          { label: 'Dorian',           intervals: [0, 2, 3, 5, 7, 9, 10], rarity: 1 },
  mixolydian:      { label: 'Mixolydian',       intervals: [0, 2, 4, 5, 7, 9, 10], rarity: 1 },
  blues:           { label: 'blues',            intervals: [0, 3, 5, 6, 7, 10],    rarity: 2 },
  harmonicMinor:   { label: 'harmonic minor',   intervals: [0, 2, 3, 5, 7, 8, 11], rarity: 2 },
  melodicMinor:    { label: 'melodic minor',    intervals: [0, 2, 3, 5, 7, 9, 11], rarity: 2 },
  lydian:          { label: 'Lydian',           intervals: [0, 2, 4, 6, 7, 9, 11], rarity: 2 },
  phrygian:        { label: 'Phrygian',         intervals: [0, 1, 3, 5, 7, 8, 10], rarity: 2 },
  locrian:         { label: 'Locrian',          intervals: [0, 1, 3, 5, 6, 8, 10], rarity: 3 },
};

export interface ScaleMatch {
  /** Root pitch class (0 = C) */
  root: number;
  type: ScaleType;
  /** Scale pitch classes, in scale order starting at the root */
  notes: number[];
  /** Progression pitch classes the scale lacks (empty = full fit) */
  outside: number[];
  /** Fraction of the progression's distinct pitch classes the scale covers */
  coverage: number;
  /** 3 = root of first chord, 2 = last chord, 1 = some chord, 0 = none */
  tonicScore: number;
}

export interface FindScalesOptions {
  /** Max results returned (default 8) */
  limit?: number;
  /** Max outside notes a near miss may have when no scale fits fully (default 2) */
  maxOutside?: number;
}

/** Root pitch class of a chord name, or -1 if unparseable */
function chordRootPc(name: string): number {
  const root = name.length >= 2 && (name[1] === '#' || name[1] === 'b') ? name.slice(0, 2) : name[0];
  return noteToPitchClass(root);
}

/**
 * Find scales matching a progression. Chords that can't be parsed are ignored.
 * Returns full fits if any exist; otherwise the closest near misses.
 */
export function findScales(chords: string[], opts: FindScalesOptions = {}): ScaleMatch[] {
  const limit = opts.limit ?? 8;
  const maxOutside = opts.maxOutside ?? 2;

  const tones = new Set<number>();
  const roots: number[] = [];
  for (const name of chords) {
    let pcs: Set<number>;
    try {
      pcs = getChordDefinition(name).pitchClasses;
    } catch {
      continue;
    }
    pcs.forEach(pc => tones.add(pc));
    roots.push(chordRootPc(name));
  }
  if (tones.size === 0) return [];

  const first = roots[0];
  const last = roots[roots.length - 1];
  const matches: ScaleMatch[] = [];

  for (const type of Object.keys(SCALE_TYPES) as ScaleType[]) {
    const { intervals } = SCALE_TYPES[type];
    for (let root = 0; root < 12; root++) {
      const notes = intervals.map(i => (root + i) % 12);
      const noteSet = new Set(notes);
      const outside = [...tones].filter(pc => !noteSet.has(pc)).sort((a, b) => a - b);
      const tonicScore = root === first ? 3 : root === last ? 2 : roots.includes(root) ? 1 : 0;
      matches.push({
        root, type, notes, outside,
        coverage: (tones.size - outside.length) / tones.size,
        tonicScore,
      });
    }
  }

  matches.sort((a, b) =>
    a.outside.length - b.outside.length ||
    b.tonicScore - a.tonicScore ||
    SCALE_TYPES[a.type].rarity - SCALE_TYPES[b.type].rarity ||
    a.notes.length - b.notes.length || // tighter fit: fewer unused scale notes
    a.root - b.root,
  );

  const best = matches[0].outside.length;
  const cutoff = best === 0 ? 0 : maxOutside;
  // A scale with no chord rooted on its tonic is a weak reading — drop it
  // unless it's all we have.
  const kept = matches.filter(m => m.outside.length <= cutoff);
  const anchored = kept.filter(m => m.tonicScore > 0);
  return (anchored.length > 0 ? anchored : kept).slice(0, limit);
}
