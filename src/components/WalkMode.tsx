import React, { useCallback, useMemo, useState } from 'react';
import type { WalkState } from '../types/index';
import type { EdgeType } from '../core/chordPathfinder';
import { getAllChordNames, findChordPath, getReachableDestinations, EDGE_TYPES } from '../core/chordPathfinder';
import { respellChordName } from '../core/chordDefinitions';
import type { NoteSpelling } from '../core/chordDefinitions';
import { EDGE_TYPE_INFO, EDGE_TYPE_ORDER, edgeTypeColor } from '../core/edgeTypeStyles';
import { CYCLE_PRESETS } from '../core/cyclePresets';
import type { CyclePreset } from '../core/cyclePresets';
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

  const [activeTab, setActiveTab] = useState<'out' | 'back'>('out');

  // Stable key for reachability memo — only edge-type constraints matter.
  const outConstraintKey = EDGE_TYPES.filter(t => !!options[t]).sort().join(',');

  // Which destinations are reachable from fromChord under current outbound constraints.
  // null means "no filtering" (no constraints active, everything reachable).
  const reachableToChords = useMemo<Set<string> | null>(() => {
    if (!fromChord || !outConstraintKey) return null;
    return getReachableDestinations(fromChord, options);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fromChord, outConstraintKey]);

  const updateAndFindPath = useCallback(
    (updates: Partial<WalkState>) => {
      const next: WalkState = { ...walkState, ...updates, currentStep: 0, completed: false };
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
            const returnPath = findChordPath(to, from, retOpts);
            if (returnPath) {
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
    (e: React.ChangeEvent<HTMLSelectElement>) => updateAndFindPath({ fromChord: e.target.value }),
    [updateAndFindPath],
  );

  const handleToChange = useCallback(
    (e: React.ChangeEvent<HTMLSelectElement>) => updateAndFindPath({ toChord: e.target.value }),
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

  // Split a cycle's canonical edge sequence into out (all but last) and back (closing edge).
  const splitCycleEdges = (preset: CyclePreset) => {
    const edges = preset.loop.split(' ') as EdgeType[];
    const closingEdge = edges[edges.length - 1];
    const outEdgeSet = new Set(edges.slice(0, -1));
    return { outEdgeSet, closingEdge };
  };

  // Apply a preset: out gets the non-closing edge types, back gets the closing edge.
  // Return trip is enabled automatically — the cycle needs both legs.
  const handlePresetClick = useCallback((preset: CyclePreset) => {
    const { outEdgeSet, closingEdge } = splitCycleEdges(preset);
    const outConstraints: Partial<Record<EdgeType, boolean>> = {};
    for (const t of outEdgeSet) outConstraints[t] = true;
    updateAndFindPath({
      options: { ...outConstraints, returnTrip: true, endless: options.endless },
      returnOptions: { [closingEdge]: true },
    });
  }, [options.endless, updateAndFindPath]);

  // Clear all edge-type constraints for the active leg.
  const handleClearConstraints = useCallback(() => {
    if (activeTab === 'back') {
      updateAndFindPath({ returnOptions: {} });
    } else {
      updateAndFindPath({
        options: { returnTrip: options.returnTrip, endless: options.endless },
      });
    }
  }, [activeTab, options, updateAndFindPath]);

  const legOptions = activeTab === 'back' ? returnOptions : options;
  const hasLegConstraints = EDGE_TYPES.some(t => !!legOptions[t]);

  // A preset is active when both legs match its derived split and return trip is on.
  const isPresetActive = (preset: CyclePreset): boolean => {
    const { outEdgeSet, closingEdge } = splitCycleEdges(preset);
    const activeOut = EDGE_TYPES.filter(t => !!options[t]);
    const activeBack = EDGE_TYPES.filter(t => !!returnOptions[t]);
    return (
      options.returnTrip === true &&
      activeOut.length === outEdgeSet.size &&
      [...outEdgeSet].every(t => !!options[t]) &&
      activeBack.length === 1 &&
      !!returnOptions[closingEdge]
    );
  };

  return (
    <div className="walk-mode">
      <div className="walk-section">
        <label className="walk-label">From</label>
        <ChordSelect value={fromChord} onChange={handleFromChange} noteSpelling={noteSpelling} />
      </div>

      <div className="walk-section">
        <label className="walk-label">To</label>
        <ChordSelect
          value={toChord}
          onChange={handleToChange}
          noteSpelling={noteSpelling}
          reachable={reachableToChords}
        />
      </div>

      <div className="walk-section">
        <div className="walk-constraints-header">
          <label className="walk-label">Constraints</label>
          <div className="walk-tabs" role="tablist">
            <button
              type="button" role="tab" aria-selected={activeTab === 'out'}
              className={`walk-tab ${activeTab === 'out' ? 'walk-tab-active' : ''}`}
              onClick={() => setActiveTab('out')}
            >Out</button>
            <button
              type="button" role="tab" aria-selected={activeTab === 'back'}
              className={`walk-tab ${activeTab === 'back' ? 'walk-tab-active' : ''}`}
              onClick={() => setActiveTab('back')}
            >Back</button>
          </div>
        </div>

        {/* Cycle preset browser */}
        <div className="cycle-browser">
          <div className="cycle-browser-list">
            {CYCLE_PRESETS.map(preset => (
              <button
                key={preset.loop}
                className={`cycle-preset-btn ${isPresetActive(preset) ? 'cycle-preset-active' : ''}`}
                onClick={() => handlePresetClick(preset)}
                title={`e.g. ${preset.exampleChords}`}
              >
                <span className="cycle-preset-pattern">
                  {preset.loop.split(' ').map((et, i) => (
                    <React.Fragment key={i}>
                      {i > 0 && <span className="cycle-sep">›</span>}
                      <span style={{ color: edgeTypeColor(et as EdgeType) }}>
                        {EDGE_TYPE_INFO[et as EdgeType]?.shortLabel ?? et}
                      </span>
                    </React.Fragment>
                  ))}
                </span>
                <span className="cycle-preset-count">{preset.songCount}</span>
              </button>
            ))}
          </div>
        </div>

        {/* Manual constraint checkboxes */}
        <div className="walk-toggles">
          {EDGE_TYPE_ORDER.map(edgeType => (
            <label className="walk-toggle" key={edgeType}>
              <input
                type="checkbox"
                checked={!!legOptions[edgeType]}
                onChange={() => handleToggle(edgeType)}
              />
              <span className="walk-toggle-swatch" style={{ backgroundColor: edgeTypeColor(edgeType) }} />
              <span title={EDGE_TYPE_INFO[edgeType].description}>{EDGE_TYPE_INFO[edgeType].label}</span>
            </label>
          ))}
        </div>

        {hasLegConstraints && (
          <button className="walk-clear-btn" onClick={handleClearConstraints}>
            Clear constraints
          </button>
        )}

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
              type="number" min={1} max={99} value={repeatCount}
              onChange={handleRepeatCount} className="walk-repeat-input"
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
  reachable,
}: {
  value: string;
  onChange: (e: React.ChangeEvent<HTMLSelectElement>) => void;
  noteSpelling: NoteSpelling;
  reachable?: Set<string> | null;
}) {
  const isDisabled = (name: string) => reachable !== null && reachable !== undefined && !reachable.has(name);

  return (
    <select className="walk-select" value={value} onChange={onChange}>
      <option value="">-- pick --</option>
      <optgroup label="Major">
        {allChords.major.map(name => (
          <option key={name} value={name} disabled={isDisabled(name)}>
            {respellChordName(name, noteSpelling)}{isDisabled(name) ? ' ·' : ''}
          </option>
        ))}
      </optgroup>
      <optgroup label="Minor">
        {allChords.minor.map(name => (
          <option key={name} value={name} disabled={isDisabled(name)}>
            {respellChordName(name, noteSpelling)}{isDisabled(name) ? ' ·' : ''}
          </option>
        ))}
      </optgroup>
      <optgroup label="Diminished">
        {allChords.dim.map(name => (
          <option key={name} value={name} disabled={isDisabled(name)}>
            {respellChordName(name, noteSpelling)}{isDisabled(name) ? ' ·' : ''}
          </option>
        ))}
      </optgroup>
    </select>
  );
}
