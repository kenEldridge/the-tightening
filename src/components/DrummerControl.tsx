import React from 'react';
import type { DrummerPhase } from '../types/index';

interface Props {
  enabled: boolean;
  phase: DrummerPhase;
  bpm: number | null;
  onToggle: () => void;
}

const PHASE_INFO: Record<DrummerPhase, { label: string; color: string }> = {
  idle:      { label: 'Ready',        color: '#8b949e' },
  learning:  { label: 'Listening…',   color: '#d29922' },
  following: { label: 'Locking in…',  color: '#58a6ff' },
  leading:   { label: 'Driving',      color: '#2ecc71' },
};

export default function DrummerControl({ enabled, phase, bpm, onToggle }: Props) {
  const info = PHASE_INFO[phase];
  const showBpm = enabled && bpm !== null && (phase === 'following' || phase === 'leading');

  return (
    <label
      className="drummer-control"
      title="Autonomous drummer: listens to your playing, locks onto the pulse, then drives the beat. Long-press your lowest + highest keys to reset it."
    >
      <input type="checkbox" checked={enabled} onChange={onToggle} />
      <span
        className="drummer-dot"
        style={{ background: enabled ? info.color : '#555' }}
      />
      <span className="drummer-label">
        {enabled ? info.label : 'Drummer'}
        {showBpm && <span className="drummer-bpm">{Math.round(bpm!)} BPM</span>}
      </span>

      <style>{`
        .drummer-control {
          display: flex;
          align-items: center;
          gap: 6px;
          font-size: 0.8rem;
          color: var(--text-secondary);
          cursor: pointer;
          user-select: none;
        }
        .drummer-control input[type="checkbox"] {
          margin: 0;
        }
        .drummer-dot {
          width: 8px;
          height: 8px;
          border-radius: 50%;
          flex-shrink: 0;
        }
        .drummer-label {
          white-space: nowrap;
          display: flex;
          align-items: baseline;
          gap: 6px;
        }
        .drummer-bpm {
          font-variant-numeric: tabular-nums;
          opacity: 0.8;
        }
        @media (max-width: 600px) {
          .drummer-label { display: none; }
        }
      `}</style>
    </label>
  );
}
