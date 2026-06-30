import type { EdgeType } from './chordPathfinder';

export interface Insight {
  /** Short grouping label shown as a chip (e.g. "Intervals", "Circle"). */
  category: string;
  /** The one-line fact. Keep it to a sentence or two. */
  text: string;
  /**
   * Optional edge types this insight explains. Can let a panel surface a
   * relevant tip when one of these relationships appears in the current path.
   */
  relatedEdges?: EdgeType[];
}

/**
 * A growing collection of bite-sized music-theory insights for the learning
 * panel. Add freely — keep each entry accurate and to roughly one sentence.
 */
export const INSIGHTS: Insight[] = [
  // --- Intervals & the physics ---
  {
    category: 'Intervals',
    text: 'A perfect fifth is a 3:2 frequency ratio; invert it within the octave and you get 4:3, a perfect fourth — the same two notes, the other direction.',
    relatedEdges: ['fifth', 'dom7'],
  },
  {
    category: 'Intervals',
    text: 'Invert any interval and the two sizes add up to nine: a fifth becomes a fourth, a third a sixth, a second a seventh.',
  },
  {
    category: 'Intervals',
    text: 'Stack twelve perfect fifths and you almost return to where you started — the leftover gap is the Pythagorean comma, the reason pianos use equal temperament.',
  },
  {
    category: 'Intervals',
    text: 'The octave is the simplest ratio after unison (2:1) — which is why two notes an octave apart sound like "the same note."',
  },
  {
    category: 'Intervals',
    text: 'A pure (just) major third is 5:4 — about 14 cents flatter than the piano’s equal-tempered third. Equal temperament widens every third a touch so all keys sound equally (im)perfect.',
  },
  {
    category: 'Intervals',
    text: 'The major third and minor sixth are inversions — they add to an octave — so tuning the third pure (flat of the piano) makes its minor sixth pure too, but sharp of the piano.',
  },

  // --- The circle itself ---
  {
    category: 'Circle',
    text: 'Each clockwise step is a perfect fifth up — seven semitones. Go all twelve steps and you arrive back at the same note.',
  },
  {
    category: 'Circle',
    text: 'Neighboring keys on the circle share all but one note — that is why moving between them sounds smooth.',
    relatedEdges: ['fifth'],
  },
  {
    category: 'Circle',
    text: 'The "circle of fifths" and the "circle of fourths" are the same circle, just read in opposite directions.',
  },
  {
    category: 'Circle',
    text: 'A major key and its relative minor share a key signature — here they sit on the same spoke, outer ring versus middle.',
    relatedEdges: ['relative'],
  },
  {
    category: 'Circle',
    text: 'In equal temperament, twelve fifth-steps are adjusted to land exactly seven octaves up.',
  },

  // --- The relationships (edge types) ---
  {
    category: 'Harmony',
    text: 'ii–V–I is the workhorse cadence of jazz: predominant, dominant, then home.',
    relatedEdges: ['iiVI'],
  },
  {
    category: 'Harmony',
    text: 'A tritone substitution swaps a V7 for the dominant a tritone away — they share the same third and seventh, so the ear barely flinches.',
    relatedEdges: ['tritoneSub'],
  },
  {
    category: 'Harmony',
    text: '"Borrowed" chords are taken from the parallel minor — the ♭VI or ♭VII that adds a wistful tint to a major key.',
    relatedEdges: ['borrowed'],
  },
  {
    category: 'Harmony',
    text: 'Chromatic mediants sit a third apart and share just one note — film composers reach for them for that "wonder" lift.',
    relatedEdges: ['chromaticMediant'],
  },
  {
    category: 'Harmony',
    text: 'Relative major/minor share every note; parallel major/minor share a root but their scales differ by three (the 3rd, 6th, and 7th).',
    relatedEdges: ['relative', 'parallel'],
  },
  {
    category: 'Harmony',
    text: 'The plagal cadence (IV→I) is the "A-men" tag at the end of a hymn.',
    relatedEdges: ['plagal'],
  },
  {
    category: 'Harmony',
    text: 'A leading tone is the half-step below the tonic that "wants" to resolve up to it — the engine behind the dominant’s pull home.',
    relatedEdges: ['leadingTone', 'dom7'],
  },

  // --- How chords are built ---
  {
    category: 'Chords',
    text: 'A major triad stacks a major third with a minor third on top; a minor triad stacks a minor third with a major third on top.',
  },
  {
    category: 'Chords',
    text: 'A diminished triad is two minor thirds stacked — symmetric and restless, so it rarely sits still.',
  },
  {
    category: 'Chords',
    text: 'An augmented triad splits the octave into three equal major thirds, so it has no single "home."',
  },
  {
    category: 'Chords',
    text: 'Keep stacking thirds on a triad and you climb the seventh, ninth, eleventh, and thirteenth.',
  },

  // --- What the app is doing ---
  {
    category: 'This app',
    text: 'Chords are matched by pitch class, ignoring octave — a C played low, high, spread, or tight is still "C."',
  },
  {
    category: 'This app',
    text: 'An inversion changes which note is on the bottom, not the chord’s name.',
  },
  {
    category: 'This app',
    text: 'Transposing a song is just rotating it around this circle; every relationship stays identical.',
  },
  {
    category: 'This app',
    text: 'A walk is a sequence of moves, not a key — the tonal center can sit anywhere along the path, not just the first chord.',
  },
  {
    category: 'Circle',
    text: 'C and F♯/G♭ sit directly opposite on the circle — a tritone apart, the most distant key relationship there is. That opposite-pole geometry is part of why tritone relationships feel so unstable.',
    relatedEdges: ['tritoneSub'],
  },
  {
    category: 'Harmony',
    text: 'Consonance is relational: a plain major triad can feel restful as a tonic or tense as a tritone away from home — same notes, different context.',
  },
];
