import type { EdgeType } from './chordPathfinder';

export const EDGE_TYPE_ORDER: EdgeType[] = ['fifth', 'relative', 'iiVI', 'dom7', 'leadingTone'];

export const EDGE_TYPE_INFO: Record<EdgeType, { label: string; shortLabel: string; color: string }> = {
  fifth: { label: 'Fifth', shortLabel: 'P5', color: '#22c55e' },
  relative: { label: 'Relative', shortLabel: 'rel', color: '#84cc16' },
  iiVI: { label: 'ii-V-I', shortLabel: 'ii-V-I', color: '#eab308' },
  dom7: { label: 'V-I', shortLabel: 'V-I', color: '#f59e0b' },
  leadingTone: { label: 'Leading tone', shortLabel: 'vii°', color: '#f97316' },
};

export const UNKNOWN_EDGE_COLOR = '#6b7280';

export function edgeTypeColor(edgeType: EdgeType | string | undefined): string {
  if (!edgeType || !(edgeType in EDGE_TYPE_INFO)) return UNKNOWN_EDGE_COLOR;
  return EDGE_TYPE_INFO[edgeType as EdgeType].color;
}

export function edgeTypeShortLabel(edgeType: EdgeType): string {
  return EDGE_TYPE_INFO[edgeType].shortLabel;
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
