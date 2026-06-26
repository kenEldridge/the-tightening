import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { WalkState } from '../types/index';
import type { EdgeType } from '../core/chordPathfinder';
import {
  getAllChordNames,
  findChordPath,
  getReachableDestinations,
  getCycleEndpoints,
  findExactCyclePath,
  transposeChord,
  intervalCycleChords,
  intervalCycleDestination,
  EDGE_TYPES,
} from '../core/chordPathfinder';
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
  keyShift?: number;
  onKeyShiftChange?: (shift: number) => void;
}

const allChords = getAllChordNames();

export default function WalkMode({ walkState, onWalkStateChange, noteSpelling = 'sharps', keyShift = 0, onKeyShiftChange }: Props) {
  const { fromChord, toChord, options, path, currentStep, completed, pathsCompleted, repeatCount } = walkState;
  const returnOptions = walkState.returnOptions ?? {};
  const cycleEdgeTypes = walkState.cycleEdgeTypes;
  const cycleSteps = walkState.cycleSteps;

  const [activeTab, setActiveTab] = useState<'out' | 'back'>('out');
  const [hoveredPreset, setHoveredPreset] = useState<{ preset: CyclePreset; rect: DOMRect } | null>(null);
  const hoverTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Which destinations are reachable from fromChord.
  // In cycle mode (interval): always exactly one destination, determined by arithmetic.
  // In cycle mode (legacy): BFS over the graph (fallback when steps not available).
  // In manual mode: chords reachable via Dijkstra with the current must-include constraints.
  // null means no filtering (no constraints active).
  const outConstraintKey = EDGE_TYPES.filter(t => options[t] === true).sort().join(',');
  const reachableToChords = useMemo<Set<string> | null>(() => {
    if (!fromChord) return null;
    if (cycleSteps && cycleSteps.length >= 2) {
      // Interval arithmetic: always produces exactly one destination from any starting chord.
      return new Set([intervalCycleDestination(fromChord, cycleSteps)]);
    }
    if (cycleEdgeTypes && cycleEdgeTypes.length >= 2) {
      // Legacy BFS fallback (no steps available).
      const outEdges = cycleEdgeTypes.slice(0, -1);
      const closingEdge = cycleEdgeTypes[cycleEdgeTypes.length - 1];
      return getCycleEndpoints(fromChord, outEdges, closingEdge);
    }
    if (!outConstraintKey) return null;
    return getReachableDestinations(fromChord, options);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fromChord, cycleSteps, cycleEdgeTypes, outConstraintKey]);

  const updateAndFindPath = useCallback(
    (updates: Partial<WalkState>) => {
      const next: WalkState = { ...walkState, ...updates, currentStep: 0, completed: false };
      const from = updates.fromChord ?? next.fromChord;
      const to = updates.toChord ?? next.toChord;
      const opts = updates.options ?? next.options;
      const retOpts = next.returnOptions ?? {};
      const cycleEdges = next.cycleEdgeTypes;

      if (from && to && from !== to) {
        const cycleStepsNow = next.cycleSteps;
        const cycleEdgesNow = next.cycleEdgeTypes;
        if (cycleStepsNow && cycleStepsNow.length >= 2 && cycleEdgesNow) {
          // Interval arithmetic cycle mode: chord sequence computed by arithmetic,
          // edge labels come from the preset's loop string (always valid EdgeType values).
          const allChords = intervalCycleChords(from, cycleStepsNow);
          // allChords = [from, ...intermediates, from]; slice off closing repetition for outbound
          const outChords = allChords.slice(0, -1); // [from, ..., to]
          const outEdgeTypes = cycleEdgesNow.slice(0, -1) as EdgeType[];
          const closingEdge = cycleEdgesNow[cycleEdgesNow.length - 1] as EdgeType;

          let chordNames = outChords;
          let edgeTypes: string[] = [...outEdgeTypes];
          if (opts.returnTrip) {
            chordNames = [...outChords, from];
            edgeTypes = [...outEdgeTypes, closingEdge];
          }
          next.path = {
            chordNames,
            edgeTypes,
            explanations: edgeTypes.map(et => EDGE_TYPE_INFO[et as EdgeType]?.label ?? et),
            totalWeight: edgeTypes.length,
          };
        } else if (cycleEdgesNow && cycleEdgesNow.length >= 2) {
          // Legacy graph BFS cycle mode (no steps — shouldn't happen with migrated presets).
          const outEdges = cycleEdgesNow.slice(0, -1);
          const closingEdge = cycleEdgesNow[cycleEdgesNow.length - 1];
          const outPath = findExactCyclePath(from, to, outEdges);
          if (outPath) {
            let chordNames = outPath;
            let edgeTypes: string[] = [...outEdges];
            if (opts.returnTrip) {
              const closingPath = findExactCyclePath(to, from, [closingEdge]);
              if (closingPath) {
                chordNames = [...outPath, ...closingPath.slice(1)];
                edgeTypes = [...outEdges, closingEdge];
              } else {
                next.path = null;
                next.fromChord = from;
                next.toChord = to;
                next.options = opts;
                next.returnOptions = retOpts;
                onWalkStateChange(next);
                return;
              }
            }
            next.path = {
              chordNames,
              edgeTypes,
              explanations: edgeTypes.map(et => EDGE_TYPE_INFO[et as EdgeType]?.label ?? et),
              totalWeight: edgeTypes.length,
            };
          } else {
            next.path = null;
          }
        } else {
          // Standard Dijkstra mode with must-include constraints.
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

  // Auto-select when a preset + from chord leaves exactly one valid destination.
  useEffect(() => {
    if (reachableToChords && reachableToChords.size === 1) {
      const only = [...reachableToChords][0];
      if (only !== toChord) {
        updateAndFindPath({ toChord: only });
      }
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reachableToChords]);

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
      // Manual toggle clears any active cycle preset.
      if (activeTab === 'back') {
        updateAndFindPath({ cycleEdgeTypes: undefined, cycleSteps: undefined, returnOptions: { ...returnOptions, [key]: !returnOptions[key] } });
      } else {
        updateAndFindPath({ cycleEdgeTypes: undefined, cycleSteps: undefined, options: { ...options, [key]: !options[key] } });
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

  // Apply a cycle preset: store the edge labels and interval steps, enable return trip.
  // Path construction uses interval arithmetic (intervalCycleChords) when steps are present.
  const handlePresetClick = useCallback((preset: CyclePreset) => {
    const edges = preset.loop.split(' ') as EdgeType[];
    updateAndFindPath({
      cycleEdgeTypes: edges,
      cycleSteps: preset.steps,
      options: { returnTrip: true, endless: options.endless },
      returnOptions: {},
    });
  }, [options.endless, updateAndFindPath]);

  const handleClearConstraints = useCallback(() => {
    if (activeTab === 'back') {
      updateAndFindPath({ cycleEdgeTypes: undefined, cycleSteps: undefined, returnOptions: {} });
    } else {
      updateAndFindPath({
        cycleEdgeTypes: undefined,
        cycleSteps: undefined,
        options: { returnTrip: options.returnTrip, endless: options.endless },
      });
    }
  }, [activeTab, options, updateAndFindPath]);

  const legOptions = activeTab === 'back' ? returnOptions : options;
  const hasLegConstraints = !!cycleEdgeTypes || EDGE_TYPES.some(t => legOptions[t] === true);

  const isPresetActive = (preset: CyclePreset): boolean => {
    if (!cycleEdgeTypes) return false;
    const edges = preset.loop.split(' ') as EdgeType[];
    return edges.length === cycleEdgeTypes.length && edges.every((e, i) => e === cycleEdgeTypes[i]);
  };

  return (
    <div className="walk-mode">
      {onKeyShiftChange && (
        <div className="walk-section walk-key-shift">
          <label className="walk-label">Key</label>
          <div className="key-shift-control">
            <button
              className="key-shift-btn"
              onClick={() => onKeyShiftChange((keyShift + 11) % 12)}
              title="Shift display down a semitone"
            >−</button>
            <span className="key-shift-label">
              {['C','C♯','D','D♯','E','F','F♯','G','G♯','A','A♯','B'][keyShift]}
            </span>
            <button
              className="key-shift-btn"
              onClick={() => onKeyShiftChange((keyShift + 1) % 12)}
              title="Shift display up a semitone"
            >+</button>
          </div>
        </div>
      )}

      <div className="walk-section">
        <label className="walk-label">From</label>
        <ChordSelect value={fromChord} onChange={handleFromChange} noteSpelling={noteSpelling} keyShift={keyShift} />
      </div>

      <div className="walk-section">
        <label className="walk-label">To</label>
        <ChordSelect
          value={toChord}
          onChange={handleToChange}
          noteSpelling={noteSpelling}
          reachable={reachableToChords}
          keyShift={keyShift}
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
                onMouseEnter={(e) => {
                  if (hoverTimerRef.current) clearTimeout(hoverTimerRef.current);
                  const rect = e.currentTarget.getBoundingClientRect();
                  hoverTimerRef.current = setTimeout(() => setHoveredPreset({ preset, rect }), 300);
                }}
                onMouseLeave={() => {
                  if (hoverTimerRef.current) clearTimeout(hoverTimerRef.current);
                  setHoveredPreset(null);
                }}
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
            keyShift={keyShift}
          />
          {currentStep > 0 && !completed && (
            <button className="walk-reset-btn" onClick={handleReset}>Reset progress</button>
          )}
          {pathsCompleted > 0 && (
            <div className="walk-score">Paths completed: {pathsCompleted}</div>
          )}
        </>
      )}

      {hoveredPreset && <CycleTooltip preset={hoveredPreset.preset} rect={hoveredPreset.rect} />}
    </div>
  );
}

function CycleTooltip({ preset, rect }: { preset: CyclePreset; rect: DOMRect }) {
  const edges = preset.loop.split(' ') as EdgeType[];
  const closingEdge = edges[edges.length - 1];
  const outEdges = edges.slice(0, -1);

  return (
    <div
      className="cycle-tooltip"
      style={{ top: Math.min(rect.top, window.innerHeight - 280), left: rect.right + 10 }}
    >
      <div className="cycle-tooltip-pattern">
        {edges.map((et, i) => (
          <React.Fragment key={i}>
            {i > 0 && <span className="cycle-tooltip-sep">›</span>}
            <span className="cycle-tooltip-et" style={{ color: edgeTypeColor(et) }}>
              {EDGE_TYPE_INFO[et]?.label ?? et}
            </span>
          </React.Fragment>
        ))}
      </div>

      <div className="cycle-tooltip-meta">
        <span>{preset.songCount} songs</span>
        <span className="cycle-tooltip-split">
          Out: {[...new Set(outEdges)].map(t => EDGE_TYPE_INFO[t]?.shortLabel ?? t).join(' + ')}
          {' · '}
          Back: {EDGE_TYPE_INFO[closingEdge]?.shortLabel ?? closingEdge}
        </span>
      </div>

      <div className="cycle-tooltip-songs">
        {preset.topSongs.slice(0, 7).map(({ title, chords }) => (
          <div key={title} className="cycle-tooltip-song">
            <span className="cycle-tooltip-title">{title}</span>
            <span className="cycle-tooltip-chords">{chords}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function ChordSelect({
  value,
  onChange,
  noteSpelling,
  reachable,
  keyShift = 0,
}: {
  value: string;
  onChange: (e: React.ChangeEvent<HTMLSelectElement>) => void;
  noteSpelling: NoteSpelling;
  reachable?: Set<string> | null;
  keyShift?: number;
}) {
  const isDisabled = (name: string) => reachable !== null && reachable !== undefined && !reachable.has(name);
  // option value stays canonical; only the display label is shifted
  const label = (name: string) => {
    const shifted = keyShift === 0 ? name : transposeChord(name, keyShift, 'same');
    return respellChordName(shifted, noteSpelling);
  };

  return (
    <select className="walk-select" value={value} onChange={onChange}>
      <option value="">-- pick --</option>
      <optgroup label="Major">
        {allChords.major.map(name => (
          <option key={name} value={name} disabled={isDisabled(name)}>
            {label(name)}{isDisabled(name) ? ' ·' : ''}
          </option>
        ))}
      </optgroup>
      <optgroup label="Minor">
        {allChords.minor.map(name => (
          <option key={name} value={name} disabled={isDisabled(name)}>
            {label(name)}{isDisabled(name) ? ' ·' : ''}
          </option>
        ))}
      </optgroup>
      <optgroup label="Diminished">
        {allChords.dim.map(name => (
          <option key={name} value={name} disabled={isDisabled(name)}>
            {label(name)}{isDisabled(name) ? ' ·' : ''}
          </option>
        ))}
      </optgroup>
    </select>
  );
}
