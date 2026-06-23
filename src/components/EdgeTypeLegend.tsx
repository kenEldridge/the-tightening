import React from 'react';
import { EDGE_TYPE_INFO, EDGE_TYPE_ORDER } from '../core/edgeTypeStyles';

export default function EdgeTypeLegend() {
  return (
    <div className="edge-legend">
      <div className="edge-legend-title">Harmony to dissonance</div>
      <div className="edge-legend-items">
        {EDGE_TYPE_ORDER.map(edgeType => {
          const info = EDGE_TYPE_INFO[edgeType];
          return (
            <div className="edge-legend-item" key={edgeType} title={info.description}>
              <span className="edge-legend-swatch" style={{ backgroundColor: info.color }} />
              <span className="edge-legend-label">{info.label}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
