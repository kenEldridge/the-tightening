import type { EdgeType } from './chordPathfinder';
import type { ChordQuality } from './types';

export const EDGE_TYPE_ORDER: EdgeType[] = [
  'fifth',
  'diatonic',
  'relative',
  'iiVI',
  'borrowed',
  'parallel',
  'dom7',
  'leadingTone',
  'chromaticMediant',
  'tritoneSub',
];

export const EDGE_TYPE_INFO: Record<EdgeType, {
  label: string;
  shortLabel: string;
  color: string;
  description: string;
}> = {
  fifth: {
    label: 'Fifth',
    shortLabel: 'P5',
    color: '#16a34a',
    description: 'Root moves by a perfect fifth around the circle.',
  },
  diatonic: {
    label: 'Diatonic',
    shortLabel: 'dia',
    color: '#84cc16',
    description: 'Neighbor movement within one major-key collection.',
  },
  relative: {
    label: 'Relative',
    shortLabel: 'rel',
    color: '#bef264',
    description: 'Relative major/minor pair sharing the same key signature.',
  },
  iiVI: {
    label: 'ii-V-I',
    shortLabel: 'ii-V-I',
    color: '#fde047',
    description: 'Predominant-to-tonic shortcut standing for ii through V to I.',
  },
  borrowed: {
    label: 'Borrowed',
    shortLabel: 'mix',
    color: '#facc15',
    description: 'Modal-mixture color borrowed from the parallel mode.',
  },
  parallel: {
    label: 'Parallel',
    shortLabel: 'par',
    color: '#fb923c',
    description: 'Same root, changed quality, like C to Cm.',
  },
  dom7: {
    label: 'V-I',
    shortLabel: 'V-I',
    color: '#f97316',
    description: 'Dominant resolution: V moving to I.',
  },
  leadingTone: {
    label: 'Leading tone',
    shortLabel: 'vii°',
    color: '#dc2626',
    description: 'Leading-tone diminished harmony resolving to tonic.',
  },
  chromaticMediant: {
    label: 'Chromatic mediant',
    shortLabel: 'chr med',
    color: '#b91c1c',
    description: 'Same-quality chords a third apart for strong chromatic color.',
  },
  tritoneSub: {
    label: 'Tritone sub',
    shortLabel: 'tri sub',
    color: '#7f1d1d',
    description: 'Dominant substitution a tritone away, resolving by semitone.',
  },
};

export const UNKNOWN_EDGE_COLOR = '#6b7280';

export function edgeTypeColor(edgeType: EdgeType | string | undefined): string {
  if (!edgeType || !(edgeType in EDGE_TYPE_INFO)) return UNKNOWN_EDGE_COLOR;
  return EDGE_TYPE_INFO[edgeType as EdgeType].color;
}

export function edgeTypeShortLabel(edgeType: EdgeType): string {
  return EDGE_TYPE_INFO[edgeType].shortLabel;
}

export function edgeTypeTitle(edgeType: EdgeType): string {
  const info = EDGE_TYPE_INFO[edgeType];
  return `${info.label}: ${info.description}`;
}

/**
 * Visual badge for a chord quality that "hides" inside a base triad's node
 * on the Circle of Fifths (dom7/maj7/min7/sus2/sus4 all collapse onto a
 * major/minor node for pathfinding — see chordNameToNodeId). The badge is
 * how the graph tells the user a 7th (or sus) is actually being voiced,
 * and which one, since the fixed 3-note triad text alone can't.
 */
export interface QualityBadge {
  label: string;   // short glyph drawn on the node, e.g. "7", "Δ7", "m7"
  color: string;
  title: string;   // hover text, e.g. "dominant 7th (adds ♭7)"
}

export const QUALITY_BADGES: Partial<Record<ChordQuality, QualityBadge>> = {
  dom7: { label: '7', color: '#f97316', title: 'Dominant 7th — major triad + ♭7' },
  maj7: { label: 'Δ7', color: '#a78bfa', title: 'Major 7th — major triad + natural 7' },
  min7: { label: 'm7', color: '#2dd4bf', title: 'Minor 7th — minor triad + ♭7' },
  sus2: { label: 's2', color: '#94a3b8', title: 'Suspended 2nd — 3rd replaced by the 2nd' },
  sus4: { label: 's4', color: '#94a3b8', title: 'Suspended 4th — 3rd replaced by the 4th' },
};

export function qualityBadge(quality: ChordQuality | undefined): QualityBadge | null {
  if (!quality) return null;
  return QUALITY_BADGES[quality] ?? null;
}

export function mostDissonantEdgeType(edgeTypes: EdgeType[]): EdgeType | null {
  let selected: EdgeType | null = null;
  let selectedRank = -1;
  for (const edgeType of edgeTypes) {
    const rank = EDGE_TYPE_ORDER.indexOf(edgeType);
    if (rank > selectedRank) {
      selected = edgeType;
      selectedRank = rank;
    }
  }
  return selected;
}
