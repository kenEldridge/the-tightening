import React from 'react';
import type { EdgeType } from 'theory-core';
import { EDGE_TYPE_INFO, EDGE_TYPE_ORDER, edgeTypeColor } from 'theory-core';

interface Props {
  enabled: Partial<Record<EdgeType, boolean>>;
  onChange: (next: Partial<Record<EdgeType, boolean>>) => void;
}

export default function SuggestEdgesToggle({ enabled, onChange }: Props) {
  const toggle = (type: EdgeType) => onChange({ ...enabled, [type]: !enabled[type] });

  return (
    <div className="walk-section suggest-edges-toggle">
      <label className="walk-label">Suggest next (live)</label>
      <div className="walk-toggles">
        {EDGE_TYPE_ORDER.map(edgeType => (
          <label className="walk-toggle" key={edgeType}>
            <input
              type="checkbox"
              checked={!!enabled[edgeType]}
              onChange={() => toggle(edgeType)}
            />
            <span className="walk-toggle-swatch" style={{ backgroundColor: edgeTypeColor(edgeType) }} />
            <span title={EDGE_TYPE_INFO[edgeType].description}>{EDGE_TYPE_INFO[edgeType].label}</span>
          </label>
        ))}
      </div>
    </div>
  );
}
