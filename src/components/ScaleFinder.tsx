import React, { useMemo, useState } from 'react';
import { CHORD_RE, findScales, getChordDefinition, pitchClassName, SCALE_TYPES } from 'theory-core';
import type { NoteSpelling, Progression } from 'theory-core';

interface Props {
  progressions: Progression[];
  /** Raw text of the chords field being typed; previewed instead of the selection when it has chords */
  draft?: string;
  noteSpelling: NoteSpelling;
}

const ALL = '__all__';

/** Lenient parse for in-progress input: keep valid tokens, skip half-typed ones and stray commas */
function parseDraft(text: string): string[] {
  return text.split(',').map(t => t.trim()).filter(t => CHORD_RE.test(t));
}

function isKnownChord(name: string): boolean {
  try {
    getChordDefinition(name);
    return true;
  } catch {
    return false;
  }
}

export default function ScaleFinder({ progressions, draft = '', noteSpelling }: Props) {
  const [source, setSource] = useState<string | null>(null);

  // Default to the most recently added progression; fall back if the chosen one was removed.
  const selected = source === ALL || progressions.some(p => p.name === source)
    ? source
    : progressions[progressions.length - 1]?.name ?? null;

  const draftChords = useMemo(() => parseDraft(draft), [draft]);
  const live = draftChords.length > 0;

  const chords = useMemo(() => {
    if (live) return draftChords;
    if (selected === ALL) return progressions.flatMap(p => p.chords);
    return progressions.find(p => p.name === selected)?.chords ?? [];
  }, [live, draftChords, progressions, selected]);

  const matches = useMemo(() => findScales(chords), [chords]);
  const skipped = useMemo(() => [...new Set(chords.filter(c => !isKnownChord(c)))], [chords]);

  if (!live && progressions.length === 0) return null;

  const spell = (pc: number) => pitchClassName(pc, noteSpelling);

  return (
    <div className="scale-finder">
      <div className="scale-finder-header">
        <span className="scale-finder-title">Scales</span>
        {live ? (
          <span className="scale-finder-live">for what you're typing</span>
        ) : (
          <select value={selected ?? ''} onChange={e => setSource(e.target.value)}>
            {progressions.map(p => (
              <option key={p.name} value={p.name}>{p.name}</option>
            ))}
            {progressions.length > 1 && <option value={ALL}>All progressions</option>}
          </select>
        )}
      </div>

      {matches.length === 0 ? (
        <div className="scale-finder-empty">No scale fits these chords.</div>
      ) : (
        <>
          {matches[0].outside.length > 0 && (
            <div className="scale-finder-note">No scale fits every chord — closest matches:</div>
          )}
          <ul className="scale-list">
            {matches.map(m => (
              <li key={`${m.root}-${m.type}`} className="scale-row">
                <span className="scale-name">
                  {spell(m.root)} {SCALE_TYPES[m.type].label}
                </span>
                <span className="scale-notes">{m.notes.map(spell).join(' ')}</span>
                {m.outside.length > 0 && (
                  <span className="scale-outside" title="Chord tones outside this scale">
                    outside: {m.outside.map(spell).join(' ')}
                  </span>
                )}
              </li>
            ))}
          </ul>
        </>
      )}
      {skipped.length > 0 && (
        <div className="scale-finder-note">Ignored: {skipped.join(', ')}</div>
      )}

      <style>{`
        .scale-finder {
          display: flex;
          flex-direction: column;
          gap: 6px;
        }
        .scale-finder-header {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 8px;
        }
        .scale-finder-title {
          font-size: 0.8rem;
          color: var(--text-secondary);
        }
        .scale-finder-live {
          font-size: 0.75rem;
          font-style: italic;
          color: var(--accent);
        }
        .scale-finder-header select {
          padding: 2px 6px;
          border: 1px solid var(--border);
          border-radius: 4px;
          background: var(--bg-primary);
          color: var(--text-primary);
          font-size: 0.8rem;
          min-width: 0;
          max-width: 60%;
        }
        .scale-list {
          list-style: none;
          margin: 0;
          padding: 0;
          display: flex;
          flex-direction: column;
          gap: 4px;
        }
        .scale-row {
          display: flex;
          flex-direction: column;
          padding: 4px 6px;
          border: 1px solid var(--border);
          border-radius: 4px;
        }
        .scale-name {
          font-size: 0.85rem;
          color: var(--text-primary);
        }
        .scale-notes {
          font-family: monospace;
          font-size: 0.75rem;
          color: var(--text-secondary);
        }
        .scale-outside {
          font-family: monospace;
          font-size: 0.75rem;
          color: #e67e22;
        }
        .scale-finder-note, .scale-finder-empty {
          font-size: 0.75rem;
          color: var(--text-secondary);
        }
      `}</style>
    </div>
  );
}
