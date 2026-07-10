import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { loadJSON, saveJSON } from '../storage';
import {
  buildIntervalCyclePath,
  findChordPath,
  findExactCyclePath,
  getAllChordNames,
  getCycleEndpoints,
  getReachableDestinations,
  intervalCycleDestination,
  pickNextCycleAdvance,
  presetsForMood,
  moodTonicQuality,
  transposeChord,
  CYCLE_PRESETS,
  EDGE_TYPES,
  EDGE_TYPE_INFO,
} from 'theory-core';
import type { CyclePreset, EdgeType, IntervalStep, WalkMood } from 'theory-core';

// Port of the desktop walk state machine: WalkState shape from src/types,
// defaultWalkState + progress/endless effects from App.tsx, and
// updateAndFindPath + handlers from WalkMode.tsx. Session-only, like desktop.

export interface WalkPathResult {
  chordNames: string[];
  edgeTypes: string[];
  explanations: string[];
  totalWeight: number;
}

export interface WalkState {
  fromChord: string;
  toChord: string;
  options: Partial<Record<EdgeType, boolean>> & {
    returnTrip: boolean;
    endless: boolean;
    randomPattern?: boolean;
  };
  returnOptions: Partial<Record<EdgeType, boolean>>;
  cycleEdgeTypes?: EdgeType[];
  cycleSteps?: IntervalStep[];
  path: WalkPathResult | null;
  currentStep: number;
  completed: boolean;
  pathsCompleted: number;
  repeatCount: number;
  currentPathCompletions: number;
  recentTonics?: string[];
  mood?: WalkMood;
}

const DEFAULT_PRESET = CYCLE_PRESETS[0];
const DEFAULT_PRESET_EDGES = DEFAULT_PRESET.loop.split(' ') as EdgeType[];

function defaultWalkState(): WalkState {
  return {
    fromChord: 'C',
    toChord: '', // auto-select fills this and builds the path on mount
    options: { returnTrip: true, endless: true, randomPattern: true },
    returnOptions: {},
    cycleEdgeTypes: DEFAULT_PRESET_EDGES,
    cycleSteps: DEFAULT_PRESET.steps,
    mood: 'happy',
    path: null,
    currentStep: 0,
    completed: false,
    pathsCompleted: 0,
    repeatCount: 1,
    currentPathCompletions: 0,
    recentTonics: ['C'],
  };
}

// Persisted slice of WalkState (B8). Path/progress are session state and get
// rebuilt from these preferences on restore.
const WALK_PREFS_KEY = 'walkPrefs.v1';
type WalkPrefs = Pick<
  WalkState,
  'fromChord' | 'toChord' | 'options' | 'returnOptions' | 'cycleEdgeTypes' | 'cycleSteps' | 'mood' | 'repeatCount' | 'pathsCompleted'
>;

export function useWalkState(matchedChords: string[]) {
  const [walkState, setWalkState] = useState<WalkState>(defaultWalkState);
  const [activeTab, setActiveTab] = useState<'out' | 'back'>('out');
  const prefsLoaded = useRef(false);

  const { fromChord, toChord, options, cycleEdgeTypes, cycleSteps } = walkState;
  const returnOptions = walkState.returnOptions ?? {};
  const mood = walkState.mood ?? 'any';

  // Which destinations are reachable from fromChord (same three modes as desktop).
  const outConstraintKey = EDGE_TYPES.filter((t) => options[t] === true).sort().join(',');
  const reachableToChords = useMemo<Set<string> | null>(() => {
    if (!fromChord) return null;
    if (cycleSteps && cycleSteps.length >= 2) {
      return new Set([intervalCycleDestination(fromChord, cycleSteps)]);
    }
    if (cycleEdgeTypes && cycleEdgeTypes.length >= 2) {
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
      setWalkState((prev) => {
        const next: WalkState = { ...prev, ...updates, currentStep: 0, completed: false };
        const from = updates.fromChord ?? next.fromChord;
        const to = updates.toChord ?? next.toChord;
        const opts = updates.options ?? next.options;
        const retOpts = next.returnOptions ?? {};

        if (from && to && from !== to) {
          const cycleStepsNow = next.cycleSteps;
          const cycleEdgesNow = next.cycleEdgeTypes;
          if (cycleStepsNow && cycleStepsNow.length >= 2 && cycleEdgesNow) {
            next.path = buildIntervalCyclePath(from, cycleEdgesNow, cycleStepsNow, !!opts.returnTrip);
          } else if (cycleEdgesNow && cycleEdgesNow.length >= 2) {
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
                  return next;
                }
              }
              next.path = {
                chordNames,
                edgeTypes,
                explanations: edgeTypes.map((et) => EDGE_TYPE_INFO[et as EdgeType]?.label ?? et),
                totalWeight: edgeTypes.length,
              };
            } else {
              next.path = null;
            }
          } else {
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
        return next;
      });
    },
    [],
  );

  // Restore persisted preferences once on mount, then rebuild the path from them.
  useEffect(() => {
    let cancelled = false;
    loadJSON<WalkPrefs>(WALK_PREFS_KEY).then((prefs) => {
      if (cancelled) return;
      if (prefs && prefs.options) {
        updateAndFindPath({ ...prefs });
      }
      prefsLoaded.current = true;
    });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Persist preferences (not path/progress) after any change post-restore.
  useEffect(() => {
    if (!prefsLoaded.current) return;
    const prefs: WalkPrefs = {
      fromChord: walkState.fromChord,
      toChord: walkState.toChord,
      options: walkState.options,
      returnOptions: walkState.returnOptions,
      cycleEdgeTypes: walkState.cycleEdgeTypes,
      cycleSteps: walkState.cycleSteps,
      mood: walkState.mood,
      repeatCount: walkState.repeatCount,
      pathsCompleted: walkState.pathsCompleted,
    };
    saveJSON(WALK_PREFS_KEY, prefs);
  }, [
    walkState.fromChord,
    walkState.toChord,
    walkState.options,
    walkState.returnOptions,
    walkState.cycleEdgeTypes,
    walkState.cycleSteps,
    walkState.mood,
    walkState.repeatCount,
    walkState.pathsCompleted,
  ]);

  // Auto-select when the active preset + from chord leaves exactly one destination.
  useEffect(() => {
    if (reachableToChords && reachableToChords.size === 1) {
      const only = [...reachableToChords][0];
      if (only !== toChord) updateAndFindPath({ toChord: only });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reachableToChords]);

  // Advance progress when the awaited chord is played.
  useEffect(() => {
    if (!walkState.path || walkState.completed) return;
    const expected = walkState.path.chordNames[walkState.currentStep];
    if (!expected) return;
    if (matchedChords.includes(expected)) {
      setWalkState((prev) => {
        if (!prev.path || prev.completed) return prev;
        const nextStep = prev.currentStep + 1;
        const isComplete = nextStep >= prev.path.chordNames.length;
        return {
          ...prev,
          currentStep: nextStep,
          completed: isComplete,
          pathsCompleted: isComplete ? prev.pathsCompleted + 1 : prev.pathsCompleted,
        };
      });
    }
  }, [matchedChords, walkState.path, walkState.currentStep, walkState.completed]);

  // Endless mode: repeat N times then auto-pick the next advance (desktop App.tsx logic).
  useEffect(() => {
    if (!walkState.completed || !walkState.options.endless) return;
    if (!walkState.path) return;

    const newCompletions = walkState.currentPathCompletions + 1;

    if (newCompletions < walkState.repeatCount) {
      const timer = setTimeout(() => {
        setWalkState((prev) => ({ ...prev, currentStep: 0, completed: false, currentPathCompletions: newCompletions }));
      }, 1500);
      return () => clearTimeout(timer);
    }

    const allChords = getAllChordNames();
    const allNames = [...allChords.major, ...allChords.minor, ...allChords.dim];
    const lastChord = walkState.path.chordNames[walkState.path.chordNames.length - 1];

    const timer = setTimeout(() => {
      const opts = walkState.options;

      if (walkState.cycleEdgeTypes && walkState.cycleSteps) {
        const m = walkState.mood ?? 'any';
        const { from, edges, steps, dest, recentTonics } = pickNextCycleAdvance({
          fromChord: walkState.fromChord,
          toChord: walkState.toChord,
          lastChord,
          cycleEdgeTypes: walkState.cycleEdgeTypes,
          cycleSteps: walkState.cycleSteps,
          returnTrip: !!opts.returnTrip,
          randomPattern: !!opts.randomPattern,
          recentTonics: walkState.recentTonics ?? [],
          presets: presetsForMood(m),
          tonicQuality: moodTonicQuality(m),
        });
        const built = buildIntervalCyclePath(from, edges, steps, !!opts.returnTrip);
        setWalkState((prev) => ({
          ...prev,
          fromChord: from,
          toChord: dest,
          cycleEdgeTypes: edges,
          cycleSteps: steps,
          path: built,
          currentStep: 0,
          completed: false,
          currentPathCompletions: 0,
          recentTonics,
        }));
        return;
      }

      const candidates = allNames.filter((c) => c !== lastChord);
      for (let attempt = 0; attempt < candidates.length; attempt++) {
        const idx = Math.floor(Math.random() * candidates.length);
        const nextTo = candidates[idx];
        const outbound = findChordPath(lastChord, nextTo, opts);
        if (!outbound) continue;

        let chordNames = outbound.chordNames;
        let edgeTypes = outbound.edgeTypes;
        let explanations = outbound.explanations;
        let totalWeight = outbound.totalWeight;
        if (opts.returnTrip) {
          const returnPath = findChordPath(nextTo, lastChord, walkState.returnOptions ?? {});
          if (returnPath) {
            chordNames = [...chordNames, ...returnPath.chordNames.slice(1)];
            edgeTypes = [...edgeTypes, ...returnPath.edgeTypes];
            explanations = [...explanations, ...returnPath.explanations];
            totalWeight += returnPath.totalWeight;
          }
        }
        setWalkState((prev) => ({
          ...prev,
          fromChord: lastChord,
          toChord: nextTo,
          path: { chordNames, edgeTypes, explanations, totalWeight },
          currentStep: 0,
          completed: false,
          currentPathCompletions: 0,
        }));
        return;
      }
    }, 1500);

    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [walkState.completed, walkState.options.endless]);

  // --- Handlers (WalkMode.tsx ports) ---

  const setFrom = useCallback((name: string) => updateAndFindPath({ fromChord: name }), [updateAndFindPath]);
  const setTo = useCallback((name: string) => updateAndFindPath({ toChord: name }), [updateAndFindPath]);

  const toggleConstraint = useCallback(
    (key: EdgeType) => {
      if (activeTab === 'back') {
        updateAndFindPath({
          cycleEdgeTypes: undefined,
          cycleSteps: undefined,
          returnOptions: { ...returnOptions, [key]: !returnOptions[key] },
        });
      } else {
        updateAndFindPath({
          cycleEdgeTypes: undefined,
          cycleSteps: undefined,
          options: { ...options, [key]: !options[key] },
        });
      }
    },
    [updateAndFindPath, options, returnOptions, activeTab],
  );

  const toggleReturnTrip = useCallback(() => {
    updateAndFindPath({ options: { ...options, returnTrip: !options.returnTrip } });
  }, [updateAndFindPath, options]);

  const toggleEndless = useCallback(() => {
    // Just flip the flag — preserve current path and position (desktop behavior).
    setWalkState((prev) => ({ ...prev, options: { ...prev.options, endless: !prev.options.endless } }));
  }, []);

  const toggleRandomPattern = useCallback(() => {
    setWalkState((prev) => ({ ...prev, options: { ...prev.options, randomPattern: !prev.options.randomPattern } }));
  }, []);

  const setRepeatCount = useCallback((val: number) => {
    const clamped = Math.max(1, Math.min(99, val || 1));
    setWalkState((prev) => ({ ...prev, repeatCount: clamped, currentPathCompletions: 0 }));
  }, []);

  const resetProgress = useCallback(() => {
    setWalkState((prev) => ({ ...prev, currentStep: 0, completed: false }));
  }, []);

  const applyPreset = useCallback(
    (preset: CyclePreset) => {
      const edges = preset.loop.split(' ') as EdgeType[];
      updateAndFindPath({
        cycleEdgeTypes: edges,
        cycleSteps: preset.steps,
        options: { returnTrip: true, endless: options.endless, randomPattern: options.randomPattern },
        returnOptions: {},
      });
    },
    [options.endless, options.randomPattern, updateAndFindPath],
  );

  const setMood = useCallback(
    (nextMood: WalkMood) => {
      if (nextMood === mood) return;
      if (nextMood === 'any') {
        setWalkState((prev) => ({ ...prev, mood: 'any' }));
        return;
      }
      const quality = moodTonicQuality(nextMood);
      const base = fromChord || 'C';
      const anchoredFrom = quality ? transposeChord(base, 0, quality) : base;
      const preset = presetsForMood(nextMood)[0];
      updateAndFindPath({
        mood: nextMood,
        fromChord: anchoredFrom,
        cycleEdgeTypes: preset.loop.split(' ') as EdgeType[],
        cycleSteps: preset.steps,
        options: { returnTrip: true, endless: options.endless, randomPattern: options.randomPattern },
        returnOptions: {},
      });
    },
    [mood, fromChord, options.endless, options.randomPattern, updateAndFindPath],
  );

  const clearConstraints = useCallback(() => {
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

  const transposeKey = useCallback(
    (semitones: number) => {
      if (fromChord) updateAndFindPath({ fromChord: transposeChord(fromChord, semitones, 'same') });
    },
    [fromChord, updateAndFindPath],
  );

  const legOptions = activeTab === 'back' ? returnOptions : options;
  const hasLegConstraints = !!cycleEdgeTypes || EDGE_TYPES.some((t) => legOptions[t] === true);

  const isPresetActive = useCallback(
    (preset: CyclePreset): boolean => {
      if (!cycleEdgeTypes) return false;
      const edges = preset.loop.split(' ') as EdgeType[];
      return edges.length === cycleEdgeTypes.length && edges.every((e, i) => e === cycleEdgeTypes[i]);
    },
    [cycleEdgeTypes],
  );

  return {
    walkState,
    activeTab,
    setActiveTab,
    reachableToChords,
    legOptions,
    hasLegConstraints,
    isPresetActive,
    setFrom,
    setTo,
    toggleConstraint,
    toggleReturnTrip,
    toggleEndless,
    toggleRandomPattern,
    setRepeatCount,
    resetProgress,
    applyPreset,
    setMood,
    clearConstraints,
    transposeKey,
  };
}
