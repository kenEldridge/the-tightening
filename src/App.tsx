import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import type { GraphState, SaveData, AppMode, WalkState, MidiEvent } from './types/index';
import { detectExtendedChords } from './core/extendedChordDetection';
import type { ExtendedMatch } from './core/extendedChordDetection';
import { parseChordInput } from './core/chordParser';
import { addProgression, removeProgression, editProgression, emptyGraphState, loadFromSaveData } from './core/graphModel';
import { detectChords } from './core/chordDetection';
import type { NoteSpelling } from './core/chordDefinitions';
import ProgressionInput from './components/ProgressionInput';
import MidiStatus from './components/MidiStatus';
import HeldNotes from './components/HeldNotes';
import WalkMode from './components/WalkMode';
import { getTheoryChordNodes, getAllChordNames, findChordPath } from './core/chordPathfinder';
import type { EdgeType } from './core/chordPathfinder';
import CircleOfFifths from './components/CircleOfFifths';
import EdgeTypeLegend from './components/EdgeTypeLegend';
import AudioRecorder from './components/AudioRecorder';
import ReplayMode from './components/ReplayMode';
import DidYouKnow from './components/DidYouKnow';
import { EDGE_TYPE_INFO, EDGE_TYPE_ORDER } from './core/edgeTypeStyles';

export default function App() {
  const [graphState, setGraphState] = useState<GraphState>(emptyGraphState);
  const [heldNotes, setHeldNotes] = useState<Set<number>>(new Set());
  const [matchedChords, setMatchedChords] = useState<string[]>([]);
  const [extendedMatches, setExtendedMatches] = useState<ExtendedMatch[]>([]);
  const [mode, setMode] = useState<AppMode>('jam');
  const [walkState, setWalkState] = useState<WalkState>({
    fromChord: '',
    toChord: '',
    options: { fifth: true, relative: true, returnTrip: false, endless: false },
    returnOptions: {},
    path: null,
    currentStep: 0,
    completed: false,
    pathsCompleted: 0,
    repeatCount: 1,
    currentPathCompletions: 0,
  });
  const [frozenWalkPath, setFrozenWalkPath] = useState<{ nodes: string[]; edgeTypes: EdgeType[] } | null>(null);
  const [noteSpelling, setNoteSpelling] = useState<NoteSpelling>('flats');
  const [circleLayout, setCircleLayout] = useState<'fifths' | 'chromatic'>('fifths');
  const [graphExpanded, setGraphExpanded] = useState(false);
  const [replayGraphState, setReplayGraphState] = useState<GraphState | null>(null);
  const [replayWalkPath, setReplayWalkPath] = useState<{ nodes: string[]; edgeTypes: EdgeType[] } | null>(null);
  const [replayStep, setReplayStep] = useState(0);
  const replayWalkHistoryRef = useRef<{ startMs: number; nodes: string[]; edgeTypes: EdgeType[] }[] | null>(null);
  const activeReplayEntryRef = useRef<{ startMs: number; nodes: string[]; edgeTypes: EdgeType[] } | null>(null);
  const [pendingReplay, setPendingReplay] = useState<{ audioUrl: string; midiBuffer: ArrayBuffer | null; cwalkData: string; autoPlay: boolean } | null>(null);

  useEffect(() => {
    window.electronAPI?.setMenuBarVisible(!graphExpanded);
    if (!graphExpanded) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setGraphExpanded(false); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [graphExpanded]);
  const [midiStatus, setMidiStatus] = useState<{ connected: boolean; message: string }>({
    connected: false,
    message: 'Requesting MIDI access...',
  });

  // Debounce timer ref for chord detection
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Ref to latest graphState for menu-save callback
  const graphStateRef = useRef(graphState);
  graphStateRef.current = graphState;
  const modeRef = useRef(mode);
  modeRef.current = mode;
  const noteSpellingRef = useRef(noteSpelling);
  noteSpellingRef.current = noteSpelling;

  // Flatten all hint edges from extended matches for the circle
  const hintEdges = useMemo(() => extendedMatches.flatMap(m => m.hintEdges), [extendedMatches]);
  const walkStateRef = useRef(walkState);
  walkStateRef.current = walkState;

  // MIDI note handlers — lifted out of useEffect so Replay can share them
  const handleNoteOn = useCallback((note: number) => {
    setHeldNotes(prev => { const n = new Set(prev); n.add(note); return n; });
  }, []);

  const handleNoteOff = useCallback((note: number) => {
    setHeldNotes(prev => { const n = new Set(prev); n.delete(note); return n; });
  }, []);

  // MIDI capture refs (written by onMidiMessage, frozen by onRecordingStop)
  const midiEventsRef = useRef<MidiEvent[]>([]);
  const isRecordingRef = useRef(false);
  const recordingStartRef = useRef(0);
  const walkHistoryRef = useRef<{ startMs: number; nodes: string[]; edgeTypes: EdgeType[] }[]>([]);

  const onRecordingStart = useCallback((startMs: number) => {
    midiEventsRef.current = [];
    recordingStartRef.current = startMs;
    isRecordingRef.current = true;
    walkHistoryRef.current = [];
    // Capture the walk path that's already active when recording starts
    if (walkStateRef.current.path) {
      walkHistoryRef.current.push({
        startMs: 0,
        nodes: [...walkStateRef.current.path.chordNames],
        edgeTypes: [...walkStateRef.current.path.edgeTypes as EdgeType[]],
      });
    }
  }, []);

  const onRecordingStop = useCallback((): MidiEvent[] => {
    isRecordingRef.current = false;
    const frozen = [...midiEventsRef.current];
    midiEventsRef.current = [];
    return frozen;
  }, []);

  // Capture each new walk path that appears during recording
  useEffect(() => {
    if (!isRecordingRef.current || !walkState.path) return;
    const last = walkHistoryRef.current[walkHistoryRef.current.length - 1];
    const nodes = walkState.path.chordNames;
    if (last && last.nodes.join(',') === nodes.join(',')) return;
    const offsetMs = performance.now() - recordingStartRef.current;
    walkHistoryRef.current.push({
      startMs: offsetMs,
      nodes: [...nodes],
      edgeTypes: [...walkState.path.edgeTypes as EdgeType[]],
    });
  }, [walkState.path]);

  const getSaveData = useCallback((): string => {
    return JSON.stringify(createSaveData(modeRef.current, graphStateRef.current, walkStateRef.current, walkHistoryRef.current));
  }, []);

  const handleNew = useCallback(() => {
    setGraphState(emptyGraphState());
    setWalkState({
      fromChord: '',
      toChord: '',
      options: { fifth: true, relative: true, returnTrip: false, endless: false },
      returnOptions: {},
      path: null,
      currentStep: 0,
      completed: false,
      pathsCompleted: 0,
      repeatCount: 1,
      currentPathCompletions: 0,
    });
    setFrozenWalkPath(null);
    setReplayGraphState(null);
    setReplayWalkPath(null);
    setReplayStep(0);
    setPendingReplay(null);
  }, []);

  // Clear pendingReplay when the user navigates away from Replay manually
  useEffect(() => {
    if (mode !== 'replay') setPendingReplay(null);
  }, [mode]);

  // Once the user finds a live walk, retire the frozen one so it can't shadow exploration
  useEffect(() => {
    if (walkState.path) setFrozenWalkPath(null);
  }, [walkState.path]);

  const applyReplaySaveData = useCallback((saveData: SaveData) => {
    const history = saveData.walkHistory?.length
      ? saveData.walkHistory.map(e => ({ ...e, edgeTypes: e.edgeTypes as EdgeType[] }))
      : null;
    replayWalkHistoryRef.current = history;
    activeReplayEntryRef.current = null;

    const firstEntry = history?.[0] ?? null;
    const initialPath = firstEntry
      ? { nodes: firstEntry.nodes, edgeTypes: firstEntry.edgeTypes }
      : saveData.walkPath
        ? { nodes: saveData.walkPath.nodes, edgeTypes: saveData.walkPath.edgeTypes as EdgeType[] }
        : null;

    if (initialPath) {
      setReplayWalkPath(initialPath);
      setReplayGraphState(null);
    } else {
      setReplayGraphState(loadFromSaveData(saveData.progressions, undefined));
      setReplayWalkPath(null);
    }
    setReplayStep(0);
  }, []);

  const onReplayTimeUpdate = useCallback((timeMs: number) => {
    const history = replayWalkHistoryRef.current;
    if (!history || history.length <= 1) return;
    let target = history[0];
    for (const entry of history) {
      if (entry.startMs <= timeMs) target = entry;
      else break;
    }
    if (target === activeReplayEntryRef.current) return;
    activeReplayEntryRef.current = target;
    setReplayWalkPath({ nodes: target.nodes, edgeTypes: target.edgeTypes });
    setReplayStep(0);
  }, []);

  const onPlayRecording = useCallback((data: { audioUrl: string; midiBuffer: ArrayBuffer | null; cwalkData: string }) => {
    try {
      applyReplaySaveData(JSON.parse(data.cwalkData) as SaveData);
    } catch {
      setReplayGraphState(null);
      setReplayWalkPath(null);
      replayWalkHistoryRef.current = null;
    }
    setPendingReplay({ ...data, autoPlay: true });
    setMode('replay');
  }, [applyReplaySaveData]);

  // Advance replay step as MIDI playback drives chord detection
  useEffect(() => {
    if (mode !== 'replay' || !replayWalkPath) return;
    const expected = replayWalkPath.nodes[replayStep];
    if (expected && matchedChords.includes(expected)) {
      setReplayStep(prev => Math.min(prev + 1, replayWalkPath.nodes.length - 1));
    }
  }, [matchedChords, mode, replayWalkPath, replayStep]);

  const onReplayLoaded = useCallback((data: SaveData | null) => {
    if (!data) {
      setReplayGraphState(null);
      setReplayWalkPath(null);
      replayWalkHistoryRef.current = null;
      return;
    }
    applyReplaySaveData(data);
  }, [applyReplaySaveData]);

  // WebMIDI setup
  useEffect(() => {
    if (!navigator.requestMIDIAccess) {
      setMidiStatus({ connected: false, message: 'WebMIDI not supported' });
      return;
    }

    let midiAccess: MIDIAccess | null = null;

    const onMidiMessage = (e: MIDIMessageEvent) => {
      window.electronAPI?.midiActivity();
      const [status, data1, data2] = e.data!;
      const msgType = status & 0xF0;
      const isNoteOn = msgType === 0x90 && data2 > 0;
      const isNoteOff = msgType === 0x80 || (msgType === 0x90 && data2 === 0);
      const isSustain = msgType === 0xB0 && data1 === 64;

      if (isNoteOn) {
        handleNoteOn(data1);
        if (isRecordingRef.current) {
          midiEventsRef.current.push({
            type: 'noteOn', note: data1, velocity: data2,
            channel: status & 0x0F, offsetMs: e.timeStamp - recordingStartRef.current,
          });
        }
      } else if (isNoteOff) {
        handleNoteOff(data1);
        if (isRecordingRef.current) {
          midiEventsRef.current.push({
            type: 'noteOff', note: data1, velocity: 0,
            channel: status & 0x0F, offsetMs: e.timeStamp - recordingStartRef.current,
          });
        }
      } else if (isSustain && isRecordingRef.current) {
        midiEventsRef.current.push({
          type: 'cc', note: 64, velocity: data2,
          channel: status & 0x0F, offsetMs: e.timeStamp - recordingStartRef.current,
        });
      }
    };

    const bindInputs = (access: MIDIAccess) => {
      const inputs = Array.from(access.inputs.values());
      for (const input of inputs) {
        input.onmidimessage = onMidiMessage;
      }
      if (inputs.length > 0) {
        const names = inputs.map(i => i.name).join(', ');
        setMidiStatus({ connected: true, message: `Connected: ${names}` });
      } else {
        setMidiStatus({ connected: false, message: 'No MIDI devices found' });
      }
    };

    navigator.requestMIDIAccess().then(
      (access) => {
        midiAccess = access;
        bindInputs(access);
        access.onstatechange = () => bindInputs(access);
      },
      (err) => {
        setMidiStatus({ connected: false, message: `MIDI Error: ${err.message}` });
      }
    );

    return () => {
      if (midiAccess) {
        for (const input of midiAccess.inputs.values()) {
          input.onmidimessage = null;
        }
        midiAccess.onstatechange = null;
      }
    };
  }, [handleNoteOn, handleNoteOff]);

  // File menu events (New / Open / Save)
  useEffect(() => {
    const api = window.electronAPI;
    if (!api) return;

    api.onMenuNew(() => {
      handleNew();
      setMode('jam');
    });

    api.onMenuOpen((data: SaveData) => {
      if (data && data.progressions) {
        let nodePositions: Map<string, { x: number; y: number }> | undefined;
        if (data.nodePositions) {
          nodePositions = new Map(Object.entries(data.nodePositions));
        }
        setGraphState(loadFromSaveData(data.progressions, nodePositions));
        setFrozenWalkPath(data.walkPath
          ? { nodes: data.walkPath.nodes, edgeTypes: data.walkPath.edgeTypes as EdgeType[] }
          : null
        );
        setMode('jam');
      }
    });

    api.onMenuSave((filePath: string, saveAs: boolean) => {
      const saveData = createSaveData(modeRef.current, graphStateRef.current, walkStateRef.current);
      const json = JSON.stringify(saveData, null, 2);
      if (filePath && !saveAs) {
        // Overwrite the existing file directly
        api.fileWrite(filePath, json);
      } else {
        // New file or explicit Save As — show dialog with a smart default name
        api.fileSaveAs(defaultSaveName(modeRef.current, graphStateRef.current, walkStateRef.current), json);
      }
    });

    return () => {
      api.removeMenuListeners();
    };
  }, []);

  // Chord detection with 50ms debounce
  // Both modes now detect against all 36 theory chords (CoF is used for both)
  useEffect(() => {
    if (debounceRef.current) {
      clearTimeout(debounceRef.current);
    }

    debounceRef.current = setTimeout(() => {
      const detectionNodes = getTheoryChordNodes() as unknown as Map<string, import('./types/index').GraphNode>;
      const matches = detectChords(heldNotes, detectionNodes);
      setMatchedChords(matches);
      setExtendedMatches(detectExtendedChords(heldNotes, noteSpellingRef.current));
    }, 50);

    return () => {
      if (debounceRef.current) {
        clearTimeout(debounceRef.current);
      }
    };
  }, [heldNotes, mode]);

  // Walk mode: advance progress when matched chord matches current step
  useEffect(() => {
    if (mode !== 'walk') return;
    if (!walkState.path || walkState.completed) return;

    const expected = walkState.path.chordNames[walkState.currentStep];
    if (!expected) return;

    // matchedChords now contains theory chord names (same naming as pathfinder)
    if (matchedChords.includes(expected)) {
      const nextStep = walkState.currentStep + 1;
      const isComplete = nextStep >= walkState.path.chordNames.length;
      setWalkState(prev => ({
        ...prev,
        currentStep: nextStep,
        completed: isComplete,
        pathsCompleted: isComplete ? prev.pathsCompleted + 1 : prev.pathsCompleted,
      }));
    }
  }, [matchedChords, mode, walkState.path, walkState.currentStep, walkState.completed]);

  // Endless mode: repeat N times then auto-pick next destination
  useEffect(() => {
    if (!walkState.completed || !walkState.options.endless) return;
    if (!walkState.path) return;

    const newCompletions = walkState.currentPathCompletions + 1;

    if (newCompletions < walkState.repeatCount) {
      // Replay the same path
      const timer = setTimeout(() => {
        setWalkState(prev => ({
          ...prev,
          currentStep: 0,
          completed: false,
          currentPathCompletions: newCompletions,
        }));
      }, 1500);
      return () => clearTimeout(timer);
    }

    // Done repeating — pick a new destination
    const allChords = getAllChordNames();
    const allNames = [...allChords.major, ...allChords.minor, ...allChords.dim];
    const lastChord = walkState.path.chordNames[walkState.path.chordNames.length - 1];

    const timer = setTimeout(() => {
      const opts = walkState.options;
      const candidates = allNames.filter(c => c !== lastChord);
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

        setWalkState(prev => ({
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
  }, [walkState.completed, walkState.options.endless]);


  const handleAddProgression = useCallback((name: string, chordsInput: string): string | null => {
    const { chords, error: parseError } = parseChordInput(chordsInput);
    if (parseError) return parseError;

    const { state: newState, error } = addProgression(graphState, name, chords!);
    if (error) return error;

    setGraphState(newState);
    return null;
  }, [graphState]);

  const handleRemoveProgression = useCallback((name: string) => {
    setGraphState(prev => removeProgression(prev, name));
  }, []);

  const handleEditProgression = useCallback((oldName: string, newName: string, chordsInput: string): string | null => {
    const { chords, error: parseError } = parseChordInput(chordsInput);
    if (parseError) return parseError;

    const { state: newState, error } = editProgression(graphState, oldName, newName, chords!);
    if (error) return error;

    setGraphState(newState);
    return null;
  }, [graphState]);

  // Walk path overlay: shown whenever a path exists, regardless of which sidebar tab is active.
  // The sidebar tab controls the tools panel; the circle always shows the most specific view available.
  const walkPath = walkState.path
    ? { nodes: walkState.path.chordNames, edgeTypes: walkState.path.edgeTypes as EdgeType[], currentStep: walkState.currentStep }
    : undefined;

  return (
    <div className={`app${graphExpanded ? ' graph-expanded' : ''}`}>
      <div className="app-header">
        <h1>Chord Walk</h1>
        <button
          className="new-session-btn"
          onClick={() => { handleNew(); setMode('jam'); }}
          title="Clear everything and start fresh"
        >
          New
        </button>
        <select
          className="spelling-select"
          value={noteSpelling}
          onChange={(e) => setNoteSpelling(e.target.value as NoteSpelling)}
        >
          <option value="sharps">Sharps (C#)</option>
          <option value="flats">Flats (Db)</option>
        </select>
        <button
          className="layout-toggle-btn"
          onClick={() => setCircleLayout(l => l === 'fifths' ? 'chromatic' : 'fifths')}
          title={circleLayout === 'fifths' ? 'Switch to chromatic (pitch class) layout' : 'Switch to circle of fifths layout'}
        >
          {circleLayout === 'fifths' ? 'Chromatic' : 'Fifths'}
        </button>
        <MidiStatus connected={midiStatus.connected} message={midiStatus.message} />
      </div>
      <div className="app-body">
        <div className="sidebar">
          <div className="mode-toggle sidebar-tabs">
            <button className={`mode-btn ${mode === 'jam'    ? 'mode-btn-active' : ''}`} onClick={() => setMode('jam')}>Jam</button>
            <button className={`mode-btn ${mode === 'walk'   ? 'mode-btn-active' : ''}`} onClick={() => setMode('walk')}>Walk</button>
            <button className={`mode-btn ${mode === 'replay' ? 'mode-btn-active' : ''}`} onClick={() => setMode('replay')}>Replay</button>
          </div>
          {mode === 'jam' && (
            <ProgressionInput
              onAdd={handleAddProgression}
              onRemove={handleRemoveProgression}
              onEdit={handleEditProgression}
              progressions={graphState.progressions}
            />
          )}
          {mode === 'walk' && (
            <WalkMode
              walkState={walkState}
              onWalkStateChange={setWalkState}
              noteSpelling={noteSpelling}
            />
          )}
          {mode === 'replay' && (
            <ReplayMode
              handleNoteOn={handleNoteOn}
              handleNoteOff={handleNoteOff}
              onLoaded={onReplayLoaded}
              autoLoad={pendingReplay}
              onTimeUpdate={onReplayTimeUpdate}
            />
          )}
          <EdgeTypeLegend />
          <HeldNotes heldNotes={heldNotes} matchedChords={matchedChords} extendedMatches={extendedMatches} />
          {mode !== 'replay' && (
            <AudioRecorder
              onRecordingStart={onRecordingStart}
              onRecordingStop={onRecordingStop}
              getSaveData={getSaveData}
              onPlayRecording={onPlayRecording}
            />
          )}
          <DidYouKnow />
        </div>
        <div className="graph-area">
          <button
            className="graph-expand-btn"
            onClick={() => setGraphExpanded(e => !e)}
            title={graphExpanded ? 'Collapse' : 'Expand graph'}
          >
            {graphExpanded ? (
              <svg viewBox="0 0 16 16" fill="currentColor"><path d="M5.5 1H2a1 1 0 0 0-1 1v3.5h1.5V2.5H5.5V1zM1 11.5V15a1 1 0 0 0 1 1h3.5v-1.5H2.5V11.5H1zM14 1h-3.5v1.5h2.5V5H14.5V2a1 1 0 0 0-1-1zM14.5 11.5H13V15.5h-2.5V16H14a1 1 0 0 0 1-1v-3.5h-0.5z"/></svg>
            ) : (
              <svg viewBox="0 0 16 16" fill="currentColor"><path d="M1 1h4.5v1.5H2.5V5H1V1zm9.5 0H15v4h-1.5V2.5H10.5V1zM1 11h1.5v2.5H5.5V15H1v-4zm13.5 0V15H11v-1.5h2.5V11H14.5z"/></svg>
            )}
          </button>
          {mode === 'replay' ? (
            // Replay: drive the circle from the cwalk saved with the recording,
            // not the current session state.
            replayWalkPath ? (
              <CircleOfFifths
                walkPath={{ nodes: replayWalkPath.nodes, edgeTypes: replayWalkPath.edgeTypes, currentStep: replayStep }}
                matchedChords={matchedChords}
                hintEdges={hintEdges}
                noteSpelling={noteSpelling}
                layout={circleLayout}
              />
            ) : (
              <CircleOfFifths
                graphState={replayGraphState ?? undefined}
                jamMatchedChords={replayGraphState ? matchedChords : undefined}
                matchedChords={matchedChords}
                hintEdges={hintEdges}
                noteSpelling={noteSpelling}
                layout={circleLayout}
              />
            )
          ) : walkPath ? (
            <CircleOfFifths
              walkPath={walkPath}
              matchedChords={matchedChords}
              hintEdges={hintEdges}
              noteSpelling={noteSpelling}
              layout={circleLayout}
            />
          ) : frozenWalkPath ? (
            <CircleOfFifths
              walkPath={{ nodes: frozenWalkPath.nodes, edgeTypes: frozenWalkPath.edgeTypes, currentStep: 0 }}
              matchedChords={matchedChords}
              hintEdges={hintEdges}
              noteSpelling={noteSpelling}
              layout={circleLayout}
            />
          ) : (
            <CircleOfFifths
              graphState={graphState}
              jamMatchedChords={matchedChords}
              matchedChords={matchedChords}
              hintEdges={hintEdges}
              noteSpelling={noteSpelling}
              layout={circleLayout}
            />
          )}
        </div>
      </div>
    </div>
  );
}

function createSaveData(
  mode: AppMode,
  graphState: GraphState,
  walkState: WalkState,
  walkHistory?: { startMs: number; nodes: string[]; edgeTypes: EdgeType[] }[],
): SaveData {
  const hasHistory = walkHistory && walkHistory.length > 0;

  if (mode === 'walk' && (walkState.path || hasHistory)) {
    // Use current path if available, otherwise fall back to last history entry
    const pathNodes = walkState.path?.chordNames ?? walkHistory![walkHistory!.length - 1].nodes;
    const pathEdges = walkState.path?.edgeTypes ?? walkHistory![walkHistory!.length - 1].edgeTypes;

    const constraintTags = [
      ...EDGE_TYPE_ORDER
        .filter(edgeType => walkState.options[edgeType])
        .map(edgeType => EDGE_TYPE_INFO[edgeType].label),
      walkState.options.returnTrip ? 'return' : null,
    ].filter(Boolean);
    const suffix = constraintTags.length > 0 ? ` (${constraintTags.join(', ')})` : '';
    const data: SaveData = {
      version: 1,
      progressions: [{
        name: `${walkState.fromChord || 'Walk'} to ${walkState.toChord || 'path'}${suffix}`,
        chords: pathNodes,
        color: '#58a6ff',
      }],
      walkPath: { nodes: pathNodes, edgeTypes: pathEdges },
    };
    if (hasHistory) data.walkHistory = walkHistory;
    return data;
  }

  return {
    version: 1,
    progressions: graphState.progressions.map(p => ({
      name: p.name,
      chords: p.chords,
      color: p.color,
    })),
  };
}

function defaultSaveName(mode: AppMode, graphState: GraphState, walkState: WalkState): string {
  const date = todayStr();

  if (mode === 'walk' && walkState.path) {
    const from = walkState.fromChord || 'walk';
    const to   = walkState.toChord   || 'path';

    // Edge pattern: cycle preset edges take priority over individual toggles
    let edgePart = '';
    if (walkState.cycleEdgeTypes && walkState.cycleEdgeTypes.length > 0) {
      edgePart = walkState.cycleEdgeTypes
        .map(t => EDGE_TYPE_INFO[t]?.shortLabel ?? t)
        .join('-');
    } else {
      const active = EDGE_TYPE_ORDER
        .filter(t => walkState.options[t])
        .map(t => EDGE_TYPE_INFO[t].shortLabel);
      if (active.length > 0) edgePart = active.join('+');
    }

    const parts = [
      `${from}_to_${to}`,
      edgePart,
      walkState.options.returnTrip ? 'rtrip' : '',
      date,
    ].filter(Boolean);

    return filenameSafe(parts.join('_')) + '.cwalk.json';
  }

  // Jam mode: first few unique chords across all progressions + date
  const allChords = [...new Set(graphState.progressions.flatMap(p => p.chords))].slice(0, 6);
  if (allChords.length > 0) {
    return filenameSafe(`jam_${allChords.join('-')}_${date}`) + '.cwalk.json';
  }

  return `jam_${date}.cwalk.json`;
}

function todayStr(): string {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

function filenameSafe(s: string): string {
  return s
    .replace(/°/g, 'dim')
    .replace(/\s+/g, '-')
    .replace(/[^a-zA-Z0-9._#+\-]+/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_|_$/g, '');
}
