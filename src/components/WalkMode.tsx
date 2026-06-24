import React, { useCallback, useState } from 'react';
import type { WalkState } from '../types/index';
import type { EdgeType } from '../core/chordPathfinder';
import { getAllChordNames, findChordPath } from '../core/chordPathfinder';
import { respellChordName } from '../core/chordDefinitions';
import type { NoteSpelling } from '../core/chordDefinitions';
import { EDGE_TYPE_INFO, EDGE_TYPE_ORDER, edgeTypeColor } from '../core/edgeTypeStyles';
import PathStrip from './PathStrip';

interface Props {
  walkState: WalkState;
  onWalkStateChange: (state: WalkState) => void;
  noteSpelling?: NoteSpelling;
}

const allChords = getAllChordNames();

export default function WalkMode({ walkState, onWalkStateChange, noteSpelling = 'sharps' }: Props) {
  const { fromChord, toChord, options, path, currentStep, completed, pathsCompleted, repeatCount } = walkState;
  const returnOptions = walkState.returnOptions ?? {};

  // Which leg the "Must include" filters edit: outbound or the return trip.
  const [activeTab, setActiveTab] = useState<'out' | 'back'>('out');

  const updateAndFindPath = useCallback(
    (updates: Partial<WalkState>) => {
      const next: WalkState = { ...walkState, ...updates, currentStep: 0, completed: false };
      // Recompute path if from/to/options changed
      const from = updates.fromChord ?? next.fromChord;
      const to = updates.toChord ?? next.toChord;
      const opts = updates.options ?? next.options;
      const retOpts = next.returnOptions ?? {};
      if (from && to && from !== to) {
        const outbound = findChordPath(from, to, opts);
        if (outbound) {
          let chordNames = outbound.chordNames;
          let edgeTypes = outbound.edgeTypes;
          let explanations = outbound.explanations;
          let totalWeight = outbound.totalWeight;

          if (opts.returnTrip) {
            // Return leg has its own independent "must include" constraints.
            const returnPath = findChordPath(to, from, retOpts);
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
      next.returnOptions = retOpts;
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
    (key: EdgeType) => {
      if (activeTab === 'back') {
        updateAndFindPath({ returnOptions: { ...returnOptions, [key]: !returnOptions[key] } });
      } else {
        updateAndFindPath({ options: { ...options, [key]: !options[key] } });
      }
    },
    [updateAndFindPath, options, returnOptions, activeTab],
  );

  const handleReturnTrip = useCallback(() => {
    updateAndFindPath({ options: { ...options, returnTrip: !options.returnTrip } });
  }, [updateAndFindPath, options]);

  const handleEndless = useCallback(() => {
    updateAndFindPath({ options: { ...options, endless: !options.endless } });
  }, [updateAndFindPath, options]);

  const handleRepeatCount = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const val = Math.max(1, Math.min(99, parseInt(e.target.value, 10) || 1));
    onWalkStateChange({ ...walkState, repeatCount: val, currentPathCompletions: 0 });
  }, [walkState, onWalkStateChange]);

  const handleReset = useCallback(() => {
    onWalkStateChange({ ...walkState, currentStep: 0, completed: false });
  }, [walkState, onWalkStateChange]);

  return (
    <div className="walk-mode">
      <div className="walk-section">
        <label className="walk-label">From</label>
        <ChordSelect value={fromChord} onChange={handleFromChange} noteSpelling={noteSpelling} />
      </div>

      <div className="walk-section">
        <label className="walk-label">To</label>
        <ChordSelect value={toChord} onChange={handleToChange} noteSpelling={noteSpelling} />
      </div>

      <div className="walk-section">
        <label className="walk-label">Must include</label>
        <div className="walk-tabs" role="tablist">
          <button
            type="button"
            role="tab"
            aria-selected={activeTab === 'out'}
            className={`walk-tab ${activeTab === 'out' ? 'walk-tab-active' : ''}`}
            onClick={() => setActiveTab('out')}
          >
            Out
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={activeTab === 'back'}
            className={`walk-tab ${activeTab === 'back' ? 'walk-tab-active' : ''}`}
            onClick={() => setActiveTab('back')}
          >
            Back
          </button>
        </div>
        <div className="walk-toggles">
          {EDGE_TYPE_ORDER.map(edgeType => {
            const legOptions = activeTab === 'back' ? returnOptions : options;
            return (
              <label className="walk-toggle" key={edgeType}>
                <input
                  type="checkbox"
                  checked={!!legOptions[edgeType]}
                  onChange={() => handleToggle(edgeType)}
                />
                <span className="walk-toggle-swatch" style={{ backgroundColor: edgeTypeColor(edgeType) }} />
                <span title={EDGE_TYPE_INFO[edgeType].description}>{EDGE_TYPE_INFO[edgeType].label}</span>
              </label>
            );
          })}
        </div>
        {activeTab === 'back' && !options.returnTrip && (
          <div className="walk-info">Return trip is off — these apply once you enable it.</div>
        )}
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
        {options.endless && (
          <label className="walk-toggle walk-repeat-count">
            <span>Repeat</span>
            <input
              type="number"
              min={1}
              max={99}
              value={repeatCount}
              onChange={handleRepeatCount}
              className="walk-repeat-input"
            />
            <span>× before advancing</span>
          </label>
        )}
      </div>

      {fromChord && toChord && fromChord === toChord && (
        <div className="walk-info">Pick two different chords.</div>
      )}

      {fromChord && toChord && fromChord !== toChord && !path && (
        <div className="walk-info">No path found with current constraints.</div>
      )}

      {path && (
        <>
          <PathStrip
            chordNames={path.chordNames}
            edgeTypes={path.edgeTypes as EdgeType[]}
            explanations={path.explanations}
            currentStep={currentStep}
            completed={completed}
            noteSpelling={noteSpelling}
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

function ChordSelect({
  value,
  onChange,
  noteSpelling,
}: {
  value: string;
  onChange: (e: React.ChangeEvent<HTMLSelectElement>) => void;
  noteSpelling: NoteSpelling;
}) {
  // value stays canonical (sharps) so pathfinding keys still resolve; only the label respells.
  return (
    <select className="walk-select" value={value} onChange={onChange}>
      <option value="">-- pick --</option>
      <optgroup label="Major">
        {allChords.major.map(name => (
          <option key={name} value={name}>{respellChordName(name, noteSpelling)}</option>
        ))}
      </optgroup>
      <optgroup label="Minor">
        {allChords.minor.map(name => (
          <option key={name} value={name}>{respellChordName(name, noteSpelling)}</option>
        ))}
      </optgroup>
      <optgroup label="Diminished">
        {allChords.dim.map(name => (
          <option key={name} value={name}>{respellChordName(name, noteSpelling)}</option>
        ))}
      </optgroup>
    </select>
  );
}
