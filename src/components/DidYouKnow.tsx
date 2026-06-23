import React, { useCallback, useState } from 'react';
import { INSIGHTS } from '../core/insights';

function randomIndex(exclude: number): number {
  if (INSIGHTS.length <= 1) return 0;
  let n = exclude;
  while (n === exclude) n = Math.floor(Math.random() * INSIGHTS.length);
  return n;
}

export default function DidYouKnow() {
  const [index, setIndex] = useState(() => Math.floor(Math.random() * INSIGHTS.length));
  const next = useCallback(() => setIndex(prev => randomIndex(prev)), []);

  const insight = INSIGHTS[index];
  if (!insight) return null;

  return (
    <div className="insight-panel">
      <div className="insight-header">
        <span className="insight-title">Did you know?</span>
        <span className="insight-category">{insight.category}</span>
      </div>
      <p className="insight-text">{insight.text}</p>
      <button className="insight-next" onClick={next} title="Show another tip">
        Next tip ↻
      </button>
    </div>
  );
}
