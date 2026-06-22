import React from 'react';
import { midiNoteToName } from '../core/chordDetection';

interface Props {
  heldNotes: Set<number>;
  matchedChords: string[];
}

export default function HeldNotes({ heldNotes, matchedChords }: Props) {
  const noteNames = Array.from(heldNotes).sort((a, b) => a - b).map(midiNoteToName);

  return (
    <div className="held-notes">
      <div className="held-notes-section">
        <span className="held-label">Held notes:</span>
        <span className="held-value">
          {noteNames.length > 0 ? noteNames.join(', ') : '\u2014'}
        </span>
      </div>
      <div className="held-notes-section">
        <span className="held-label">Matched:</span>
        <span className="held-value matched">
          {matchedChords.length > 0 ? matchedChords.join(', ') : '\u2014'}
        </span>
      </div>

      <style>{`
        .held-notes {
          display: flex;
          flex-direction: column;
          gap: 4px;
          padding: 8px;
          background: var(--bg-primary);
          border: 1px solid var(--border);
          border-radius: 4px;
        }
        .held-notes-section {
          display: flex;
          gap: 6px;
          font-size: 0.8rem;
        }
        .held-label {
          color: var(--text-secondary);
          flex-shrink: 0;
        }
        .held-value {
          color: var(--text-primary);
          font-family: monospace;
        }
        .held-value.matched {
          color: var(--accent);
          font-weight: 600;
        }
      `}</style>
    </div>
  );
}
