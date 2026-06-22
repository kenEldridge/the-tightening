import React, { useCallback } from 'react';
import type { WalkState } from '../types/index';
import type { EdgeType } from '../core/chordPathfinder';
import { getAllChordNames, findChordPath } from '../core/chordPathfinder';
import PathStrip from './PathStrip';

interface Props {
  walkState: WalkState;
  onWalkStateChange: (state: WalkState) => void;
}

const allChords = getAllChordNames();

export default function WalkMode({ walkState, onWalkStateChange }: Props) {
  const { fromChord, toChord, options, path, currentStep, completed, pathsCompleted } = walkState;

  const updateAndFindPath = useCallback(
    (updates: Partial<WalkState>) => {
      const next: WalkState = { ...walkState, ...updates, currentStep: 0, completed: false };
      // Recompute path if from/to/options changed
      const from = updates.fromChord ?? next.fromChord;
      const to = updates.toChord ?? next.toChord;
      const opts = updates.options ?? next.options;
      if (from && to && from !== to) {
        const outbound = findChordPath(from, to, opts);
        if (outbound) {
          let chordNames = outbound.chordNames;
          let edgeTypes = outbound.edgeTypes;
          let explanations = outbound.explanations;
          let totalWeight = outbound.totalWeight;

          if (opts.returnTrip) {
            const returnPath = findChordPath(to, from, opts);
            if (returnPath) {
              // Concatenate: skip first chord of return (it's the last of outbound)
              chordNames = [...chordNames, ...returnPath.chordNames.slice(1)];
              edgeTypes = [...edgeTypes, ...returnPath.edgeTypes];
              explanations = [...explanations, ...returnPath.explanations];
              totalWeight += returnPath.totalWeight;
            }
          }

          next.path = { chordNames, edgeTypes, explanations, totalWeight };
        } else {
          next.path = null;
        }
      } else {
        next.path = null;
      }
      next.fromChord = from;
      next.toChord = to;
      next.options = opts;
      onWalkStateChange(next);
    },
    [walkState, onWalkStateChange],
  );

  const handleFromChange = useCallback(
    (e: React.ChangeEvent<HTMLSelectElement>) => {
      updateAndFindPath({ fromChord: e.target.value });
    },
    [updateAndFindPath],
  );

  const handleToChange = useCallback(
    (e: React.ChangeEvent<HTMLSelectElement>) => {
      updateAndFindPath({ toChord: e.target.value });
    },
    [updateAndFindPath],
  );

  const handleToggle = useCallback(
    (key: 'relative' | 'iiVI' | 'leadingTone') => {
      updateAndFindPath({ options: { ...options, [key]: !options[key] } });
    },
    [updateAndFindPath, options],
  );

  const handleReturnTrip = useCallback(() => {
    updateAndFindPath({ options: { ...options, returnTrip: !options.returnTrip } });
  }, [updateAndFindPath, options]);

  const handleEndless = useCallback(() => {
    updateAndFindPath({ options: { ...options, endless: !options.endless } });
  }, [updateAndFindPath, options]);

  const handleReset = useCallback(() => {
    onWalkStateChange({ ...walkState, currentStep: 0, completed: false });
  }, [walkState, onWalkStateChange]);

  return (
    <div className="walk-mode">
      <div className="walk-section">
        <label className="walk-label">From</label>
        <ChordSelect value={fromChord} onChange={handleFromChange} />
      </div>

      <div className="walk-section">
        <label className="walk-label">To</label>
        <ChordSelect value={toChord} onChange={handleToChange} />
      </div>

      <div className="walk-section">
        <label className="walk-label">Edge types</label>
        <div className="walk-toggles">
          <label className="walk-toggle walk-toggle-fixed" title="Always enabled">
            <input type="checkbox" checked disabled />
            <span>V{'\u2192'}I (dom7)</span>
          </label>
          <label className="walk-toggle">
            <input type="checkbox" checked={options.relative} onChange={() => handleToggle('relative')} />
            <span>Relative maj/min</span>
          </label>
          <label className="walk-toggle">
            <input type="checkbox" checked={options.iiVI} onChange={() => handleToggle('iiVI')} />
            <span>ii-V-I</span>
          </label>
          <label className="walk-toggle">
            <input type="checkbox" checked={options.leadingTone} onChange={() => handleToggle('leadingTone')} />
            <span>vii{'\u00B0'}{'\u2192'}I</span>
          </label>
        </div>
      </div>

      <div className="walk-section">
        <label className="walk-toggle">
          <input type="checkbox" checked={options.returnTrip} onChange={handleReturnTrip} />
          <span>Return trip</span>
        </label>
        <label className="walk-toggle">
          <input type="checkbox" checked={options.endless} onChange={handleEndless} />
          <span>Endless mode</span>
        </label>
      </div>

      {fromChord && toChord && fromChord === toChord && (
        <div className="walk-info">Pick two different chords.</div>
      )}

      {fromChord && toChord && fromChord !== toChord && !path && (
        <div className="walk-info">No path found with current edge types.</div>
      )}

      {path && (
        <>
          <PathStrip
            chordNames={path.chordNames}
            edgeTypes={path.edgeTypes as EdgeType[]}
            explanations={path.explanations}
            currentStep={currentStep}
            completed={completed}
          />
          {currentStep > 0 && !completed && (
            <button className="walk-reset-btn" onClick={handleReset}>Reset progress</button>
          )}
          {pathsCompleted > 0 && (
            <div className="walk-score">Paths completed: {pathsCompleted}</div>
          )}
        </>
      )}
    </div>
  );
}

function ChordSelect({ value, onChange }: { value: string; onChange: (e: React.ChangeEvent<HTMLSelectElement>) => void }) {
  return (
    <select className="walk-select" value={value} onChange={onChange}>
      <option value="">-- pick --</option>
      <optgroup label="Major">
        {allChords.major.map(name => (
          <option key={name} value={name}>{name}</option>
        ))}
      </optgroup>
      <optgroup label="Minor">
        {allChords.minor.map(name => (
          <option key={name} value={name}>{name}</option>
        ))}
      </optgroup>
      <optgroup label="Diminished">
        {allChords.dim.map(name => (
          <option key={name} value={name}>{name}</option>
        ))}
      </optgroup>
    </select>
  );
}
