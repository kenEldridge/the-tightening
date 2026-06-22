import React from 'react';

interface Props {
  connected: boolean;
  message: string;
}

export default function MidiStatus({ connected, message }: Props) {
  return (
    <div className="midi-status">
      <span
        className="midi-dot"
        style={{ background: connected ? '#2ecc71' : '#e74c3c' }}
      />
      <span className="midi-text">{message}</span>

      <style>{`
        .midi-status {
          display: flex;
          align-items: center;
          gap: 6px;
          font-size: 0.8rem;
          color: var(--text-secondary);
        }
        .midi-dot {
          width: 8px;
          height: 8px;
          border-radius: 50%;
          flex-shrink: 0;
        }
        .midi-text {
          white-space: nowrap;
        }
      `}</style>
    </div>
  );
}
