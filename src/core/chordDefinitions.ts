import type { ChordDefinition, ChordQuality } from '../types/index.js';

const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];

const FLAT_TO_SHARP: Record<string, string> = {
  'Db': 'C#', 'Eb': 'D#', 'Fb': 'E', 'Gb': 'F#', 'Ab': 'G#', 'Bb': 'A#', 'Cb': 'B',
};

/** Interval patterns from root, in semitones */
const QUALITY_INTERVALS: Record<ChordQuality, number[]> = {
  major:  [0, 4, 7],
  minor:  [0, 3, 7],
  dim:    [0, 3, 6],
  aug:    [0, 4, 8],
  dom7:   [0, 4, 7, 10],
  maj7:   [0, 4, 7, 11],
  min7:   [0, 3, 7, 10],
  sus2:   [0, 2, 7],
  sus4:   [0, 5, 7],
};

/** Map chord suffix string to quality */
const SUFFIX_TO_QUALITY: Record<string, ChordQuality> = {
  '':     'major',
  'm':    'minor',
  'dim':  'dim',
  '\u00B0': 'dim', // ° symbol
  'aug':  'aug',
  '7':    'dom7',
  'maj7': 'maj7',
  'm7':   'min7',
  'sus2': 'sus2',
  'sus4': 'sus4',
};

function noteToPitchClass(name: string): number {
  const sharp = FLAT_TO_SHARP[name] || name;
  return NOTE_NAMES.indexOf(sharp);
}

function parseChordName(name: string): { root: string; suffix: string } | null {
  if (!name || name.length === 0) return null;
  let root: string;
  let suffix: string;
  if (name.length >= 2 && (name[1] === '#' || name[1] === 'b')) {
    root = name.slice(0, 2);
    suffix = name.slice(2);
  } else {
    root = name[0];
    suffix = name.slice(1);
  }
  return { root, suffix };
}

// Memoization cache
const cache = new Map<string, ChordDefinition>();

/**
 * Convert a chord name (e.g. "Gm7", "Eb", "F#dim") into a ChordDefinition
 * with its pitch class set. Returns cached result on repeated calls.
 */
export function getChordDefinition(name: string): ChordDefinition {
  const cached = cache.get(name);
  if (cached) return cached;

  const parsed = parseChordName(name);
  if (!parsed) throw new Error(`Cannot parse chord name: ${name}`);

  const rootPc = noteToPitchClass(parsed.root);
  if (rootPc < 0) throw new Error(`Unknown root note: ${parsed.root}`);

  const quality = SUFFIX_TO_QUALITY[parsed.suffix];
  if (!quality) throw new Error(`Unknown chord suffix: ${parsed.suffix}`);

  const intervals = QUALITY_INTERVALS[quality];
  const pitchClasses = new Set(intervals.map(i => (rootPc + i) % 12));

  const def: ChordDefinition = { name, root: parsed.root, quality, pitchClasses };
  cache.set(name, def);
  return def;
}

/** Get the interval pattern for a chord quality */
export function getQualityIntervals(quality: ChordQuality): number[] {
  return QUALITY_INTERVALS[quality];
}

/** Expose for tests */
export { NOTE_NAMES, FLAT_TO_SHARP, QUALITY_INTERVALS, SUFFIX_TO_QUALITY, noteToPitchClass };
