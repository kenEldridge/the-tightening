import React from 'react';
import { midiNoteToName } from '../core/chordDetection';
import type { ExtendedMatch } from '../core/extendedChordDetection';

interface Props {
  heldNotes: Set<number>;
  matchedChords: string[];
  extendedMatches?: ExtendedMatch[];
}

export default function HeldNotes({ heldNotes, matchedChords, extendedMatches }: Props) {
  const noteNames = Array.from(heldNotes).sort((a, b) => a - b).map(midiNoteToName);

  // When extended chords are detected, show those names instead of basic triad names.
  const displayChords: string[] = [];
  const qualityLabels: string[] = [];

  if (extendedMatches && extendedMatches.length > 0) {
    const extendedBases = new Set(extendedMatches.map(m => m.baseChordName));
    for (const m of extendedMatches) {
      displayChords.push(m.displayName);
      qualityLabels.push(m.qualityLabel);
    }
    // Include any matched chords not covered by an extended match
    for (const c of matchedChords) {
      if (!extendedBases.has(c)) displayChords.push(c);
    }
  } else {
    displayChords.push(...matchedChords);
  }

  return (
    <div className="held-notes">
      <div className="held-notes-section">
        <span className="held-label">Held notes:</span>
        <span className="held-value">
          {noteNames.length > 0 ? noteNames.join(', ') : '—'}
        </span>
      </div>
      <div className="held-notes-section">
        <span className="held-label">Matched:</span>
        <span className="held-value matched">
          {displayChords.length > 0 ? displayChords.join(', ') : '—'}
        </span>
      </div>
      {qualityLabels.length > 0 && (
        <div className="held-notes-section">
          <span className="held-label" style={{ visibility: 'hidden' }}>·</span>
          <span className="held-value held-quality">
            {qualityLabels.join(', ')}
          </span>
        </div>
      )}

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
        .held-value.held-quality {
          color: #f0a020;
          font-size: 0.75rem;
          font-style: italic;
        }
      `}</style>
    </div>
  );
}
