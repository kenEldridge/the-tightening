import React from 'react';
import { midiNoteToName, describeChordMatch } from 'theory-core';
import type { ExtendedMatch, NoteSpelling } from 'theory-core';

interface Props {
  heldNotes: Set<number>;
  matchedChords: string[];
  extendedMatches?: ExtendedMatch[];
  noteSpelling?: NoteSpelling;
}

export default function HeldNotes({ heldNotes, matchedChords, extendedMatches, noteSpelling = 'sharps' }: Props) {
  const sortedNotes = Array.from(heldNotes).sort((a, b) => a - b);
  const noteNames = sortedNotes.map(n => midiNoteToName(n, noteSpelling));
  const bassPc = sortedNotes.length > 0 ? ((sortedNotes[0] % 12) + 12) % 12 : undefined;

  const { chords, qualityLabels } = describeChordMatch(matchedChords, extendedMatches ?? [], noteSpelling, bassPc);

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
          {chords.length > 0 ? chords.map((c, i) => (
            <React.Fragment key={i}>
              {i > 0 && ', '}
              {c.name}
              {c.inversion > 0 && <sup>{"'".repeat(c.inversion)}</sup>}
            </React.Fragment>
          )) : '—'}
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
