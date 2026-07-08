import type { EdgeType, IntervalStep } from './chordPathfinder';
import { CYCLE_PRESETS } from './cyclePresets';
import type { CyclePreset } from './cyclePresets';

/**
 * A "mood" is a coarse feel/genre filter over the cycle-preset pool. It shapes
 * the endless-mode wander in two ways:
 *   1. Palette — only presets whose harmonic moves match the mood are drawn.
 *   2. Anchor  — the tonic (home base) is pinned to a quality that delivers the
 *      mood (major for happy, minor for melancholy). This matters because most
 *      presets preserve the tonic's quality ('same' steps), so a walk that
 *      drifts onto a minor tonic keeps sounding minor regardless of the pattern.
 *
 * 'any' is the original behavior: no palette filter, no anchor pinning.
 */
export type WalkMood = 'any' | 'happy' | 'melancholy' | 'dramatic';

export interface MoodInfo {
  id: WalkMood;
  label: string;
  emoji: string;
  blurb: string;
}

export const MOODS: MoodInfo[] = [
  { id: 'any',        label: 'Any',        emoji: '\u{1F3B2}', blurb: 'No filter — wander freely through every pattern.' },
  { id: 'happy',      label: 'Happy',      emoji: '☀️', blurb: 'Bright and resolved — major chords, fifths and V–I motion.' },
  { id: 'melancholy', label: 'Melancholy', emoji: '\u{1F327}️', blurb: 'Wistful — minor tonics and relative/borrowed color.' },
  { id: 'dramatic',   label: 'Dramatic',   emoji: '\u{1F3AD}', blurb: 'Tense and cinematic — chromatic mediants, tritone subs, diminished.' },
];

/** Edges that read as bright/resolved. */
const BRIGHT_EDGES: ReadonlySet<EdgeType> = new Set<EdgeType>(['fifth', 'dom7', 'diatonic']);
/** Edges that pull toward minor/wistful color without tension. */
const SOFT_EDGES: ReadonlySet<EdgeType> = new Set<EdgeType>(['relative', 'iiVI']);
/** Edges that read as tense/dark/cinematic. */
const DARK_EDGES: ReadonlySet<EdgeType> = new Set<EdgeType>([
  'borrowed', 'parallel', 'leadingTone', 'chromaticMediant', 'tritoneSub',
]);

/**
 * Classify a preset into its dominant mood from its harmonic palette alone
 * (edge types + the qualities its interval steps force). Tonic-independent:
 * the mood's anchor quality (see moodTonicQuality) is what actually delivers
 * major-vs-minor at play time.
 */
export function classifyPresetMood(preset: CyclePreset): Exclude<WalkMood, 'any'> {
  const edges = new Set(preset.loop.split(' ') as EdgeType[]);
  const forcedQualities = new Set(
    preset.steps.map(s => s.quality).filter((q): q is IntervalStep['quality'] => q !== 'same'),
  );

  // Dramatic: any tense/dark edge, or a diminished chord in the shape.
  for (const e of edges) if (DARK_EDGES.has(e)) return 'dramatic';
  if (forcedQualities.has('dim')) return 'dramatic';

  // Melancholy: introduces minor color (soft edges or a forced minor chord).
  for (const e of edges) if (SOFT_EDGES.has(e)) return 'melancholy';
  if (forcedQualities.has('minor')) return 'melancholy';

  // Happy: only bright edges, no minor/dim forcing.
  for (const e of edges) if (!BRIGHT_EDGES.has(e)) return 'melancholy';
  return 'happy';
}

/**
 * The tonic quality that anchors a mood, or null to leave the tonic untouched.
 * Pinning the anchor is what keeps a happy walk from sliding into minor.
 */
export function moodTonicQuality(mood: WalkMood): 'major' | 'minor' | null {
  if (mood === 'happy') return 'major';
  if (mood === 'melancholy') return 'minor';
  return null;
}

// Precompute the bucket for each preset once.
const _moodOf = new Map<CyclePreset, Exclude<WalkMood, 'any'>>();
for (const p of CYCLE_PRESETS) _moodOf.set(p, classifyPresetMood(p));

/**
 * Presets matching a mood. 'any' returns the full pool. Falls back to the full
 * pool if a mood somehow has no matching presets, so the draw never stalls.
 */
export function presetsForMood(mood: WalkMood, presets: CyclePreset[] = CYCLE_PRESETS): CyclePreset[] {
  if (mood === 'any') return presets;
  const matches = presets.filter(p => (_moodOf.get(p) ?? classifyPresetMood(p)) === mood);
  return matches.length > 0 ? matches : presets;
}
