import React from 'react';
import { diatonicChords, pitchClassName, practiceVoicingKey, respellChordName } from 'theory-core';
import type { NoteSpelling } from 'theory-core';

interface Props {
  homeKeyPc: number | null;
  onChange: (pc: number | null) => void;
  noteSpelling: NoteSpelling;
  /** Key practice tracker: tick off each diatonic triad × inversion played. */
  practiceOn: boolean;
  onPracticeOnChange: (on: boolean) => void;
  practicePlayed: Set<string>;
  onPracticeReset: () => void;
}

// Keys listed around the circle of fifths, the order players think in.
const KEY_ORDER = [0, 7, 2, 9, 4, 11, 6, 1, 8, 3, 10, 5];
const INVERSIONS = [0, 1, 2];
const INVERSION_NAMES = ['root position', '1st inversion', '2nd inversion'];

/** Jam sidebar: lock a major home key so the circle keeps it in view. */
export default function HomeKeySelect({
  homeKeyPc, onChange, noteSpelling, practiceOn, onPracticeOnChange, practicePlayed, onPracticeReset,
}: Props) {
  const chords = homeKeyPc === null ? [] : diatonicChords(homeKeyPc);
  const playedCount = chords.reduce(
    (n, c) => n + INVERSIONS.filter(inv => practicePlayed.has(practiceVoicingKey(c.name, inv))).length,
    0,
  );

  return (
    <div className="walk-section home-key-select">
      <label className="walk-label">Home key</label>
      <select
        className="walk-select"
        value={homeKeyPc ?? ''}
        onChange={(e) => onChange(e.target.value === '' ? null : Number(e.target.value))}
      >
        <option value="">Off</option>
        {KEY_ORDER.map(pc => (
          <option key={pc} value={pc}>{pitchClassName(pc, noteSpelling)} major</option>
        ))}
      </select>
      {homeKeyPc !== null && (
        <>
          <div className="home-key-chords">
            {chords.map(c => (
              <span key={c.numeral} className="home-key-chord">
                <span className="home-key-numeral">{c.numeral}</span>
                {respellChordName(c.name, noteSpelling)}
                {practiceOn && (
                  <span className="home-key-dots">
                    {INVERSIONS.map(inv => {
                      const played = practicePlayed.has(practiceVoicingKey(c.name, inv));
                      return (
                        <span
                          key={inv}
                          className={`home-key-dot ${played ? 'home-key-dot-played' : ''}`}
                          title={`${INVERSION_NAMES[inv]}${played ? ' — played' : ''}`}
                        />
                      );
                    })}
                  </span>
                )}
              </span>
            ))}
          </div>
          <div className="home-key-practice">
            <label className="walk-toggle">
              <input type="checkbox" checked={practiceOn} onChange={(e) => onPracticeOnChange(e.target.checked)} />
              <span>Track triads &amp; inversions</span>
            </label>
            {practiceOn && (
              <>
                <span className="home-key-progress">{playedCount}/{chords.length * INVERSIONS.length}</span>
                <button className="home-key-reset" onClick={onPracticeReset}>Reset</button>
              </>
            )}
          </div>
        </>
      )}
    </div>
  );
}
