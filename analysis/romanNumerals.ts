/**
 * Map a chord to its Roman-numeral scale degree, relative to a song's detected
 * key (see detectKey in analyze-songs.ts). No Roman-numeral concept exists
 * anywhere else in the codebase — this is new, self-contained analysis logic,
 * built on top of theory-core's existing chord-to-node mapping rather than a
 * second chord-parsing scheme.
 *
 * Convention: scale-degree spelling is relative to the key's own diatonic
 * scale (major scale for major keys, natural minor for minor keys) — e.g. in
 * A minor, C major is "III" (not "bIII"), matching standard pop-theory usage.
 * Case reflects the chord's ACTUAL quality (major upper, minor lower, dim
 * lower + °), not the diatonically-expected one, so a borrowed/chromatic
 * chord still gets a legible label (e.g. a major IV in a minor key is "IV",
 * not "iv"). This is a defensible simplification for a general-audience
 * write-up, not a music-theory-journal-grade Roman-numeral analysis.
 */

import { noteToPitchClass, chordNameToNodeId } from 'theory-core';

const ROMAN = ['I', 'II', 'III', 'IV', 'V', 'VI', 'VII'];

interface Degree {
  numeral: number;       // 1-7
  accidental: '' | 'b' | '#';
}

// Semitone offset from tonic (0-11) -> scale degree, spelled relative to the
// major scale.
const MAJOR_DEGREES: Degree[] = [
  { numeral: 1, accidental: '' },  // 0  I
  { numeral: 2, accidental: 'b' }, // 1  bII
  { numeral: 2, accidental: '' },  // 2  II
  { numeral: 3, accidental: 'b' }, // 3  bIII
  { numeral: 3, accidental: '' },  // 4  III
  { numeral: 4, accidental: '' },  // 5  IV
  { numeral: 5, accidental: 'b' }, // 6  bV
  { numeral: 5, accidental: '' },  // 7  V
  { numeral: 6, accidental: 'b' }, // 8  bVI
  { numeral: 6, accidental: '' },  // 9  VI
  { numeral: 7, accidental: 'b' }, // 10 bVII
  { numeral: 7, accidental: '' },  // 11 VII
];

// Semitone offset from tonic (0-11) -> scale degree, spelled relative to
// natural minor (so the diatonic minor-key chords carry no accidental).
const MINOR_DEGREES: Degree[] = [
  { numeral: 1, accidental: '' },  // 0  i
  { numeral: 2, accidental: 'b' }, // 1  bii
  { numeral: 2, accidental: '' },  // 2  ii (naturally dim)
  { numeral: 3, accidental: '' },  // 3  III
  { numeral: 3, accidental: '#' }, // 4  #III
  { numeral: 4, accidental: '' },  // 5  iv
  { numeral: 5, accidental: 'b' }, // 6  bv
  { numeral: 5, accidental: '' },  // 7  v / V (natural or raised dominant)
  { numeral: 6, accidental: '' },  // 8  VI
  { numeral: 6, accidental: '#' }, // 9  #VI
  { numeral: 7, accidental: '' },  // 10 VII
  { numeral: 7, accidental: '#' }, // 11 #VII (leading tone)
];

export function romanNumeral(
  tonic: string,
  keyQuality: 'major' | 'minor',
  chordName: string,
): string | null {
  const rootMatch = chordName.match(/^[A-G][#b]?/);
  const tonicRootMatch = tonic.match(/^[A-G][#b]?/); // tonic may carry a quality suffix, e.g. "Bm"
  if (!rootMatch || !tonicRootMatch) return null;

  const tonicPc = noteToPitchClass(tonicRootMatch[0]);
  const rootPc = noteToPitchClass(rootMatch[0]);
  if (tonicPc < 0 || rootPc < 0) return null;

  let nodeId: string | null;
  try { nodeId = chordNameToNodeId(chordName); } catch { nodeId = null; }
  if (!nodeId) return null;
  const chordQuality = nodeId.split('-')[0]; // 'key' | 'minor' | 'dim'

  const offset = (rootPc - tonicPc + 12) % 12;
  const degree = (keyQuality === 'major' ? MAJOR_DEGREES : MINOR_DEGREES)[offset];
  const roman = ROMAN[degree.numeral - 1];

  if (chordQuality === 'key') return degree.accidental + roman;
  if (chordQuality === 'minor') return degree.accidental + roman.toLowerCase();
  if (chordQuality === 'dim') return degree.accidental + roman.toLowerCase() + '°';
  return null;
}

/** Re-express a whole chord sequence as Roman numerals; null entries mark unmappable chords. */
export function romanNumeralSequence(
  tonic: string,
  keyQuality: 'major' | 'minor',
  chords: string[],
): (string | null)[] {
  return chords.map(c => romanNumeral(tonic, keyQuality, c));
}
