import type { EdgeType } from './chordPathfinder';

export const EDGE_TYPE_ORDER: EdgeType[] = [
  'fifth',
  'plagal',
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
  plagal: {
    label: 'Plagal',
    shortLabel: 'IV-I',
    color: '#4d7c0f',
    description: 'Subdominant-to-tonic color, like IV to I.',
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
