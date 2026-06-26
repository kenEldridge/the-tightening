import React, { useState, useEffect, useRef, useCallback } from 'react';
import type { GraphState, SaveData, AppMode, WalkState } from './types/index';
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
import DidYouKnow from './components/DidYouKnow';
import { EDGE_TYPE_INFO, EDGE_TYPE_ORDER } from './core/edgeTypeStyles';

export default function App() {
  const [graphState, setGraphState] = useState<GraphState>(emptyGraphState);
  const [heldNotes, setHeldNotes] = useState<Set<number>>(new Set());
  const [matchedChords, setMatchedChords] = useState<string[]>([]);
  const [mode, setMode] = useState<AppMode>('home');
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
  const [noteSpelling, setNoteSpelling] = useState<NoteSpelling>('flats');
  const [keyShift, setKeyShift] = useState(0);
  const [circleLayout, setCircleLayout] = useState<'fifths' | 'chromatic'>('fifths');
  const [graphExpanded, setGraphExpanded] = useState(false);

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
  const walkStateRef = useRef(walkState);
  walkStateRef.current = walkState;

  // WebMIDI setup
  useEffect(() => {
    if (!navigator.requestMIDIAccess) {
      setMidiStatus({ connected: false, message: 'WebMIDI not supported' });
      return;
    }

    let midiAccess: MIDIAccess | null = null;

    const handleNoteOn = (note: number) => {
      setHeldNotes(prev => {
        const next = new Set(prev);
        next.add(note);
        return next;
      });
    };

    const handleNoteOff = (note: number) => {
      setHeldNotes(prev => {
        const next = new Set(prev);
        next.delete(note);
        return next;
      });
    };

    const onMidiMessage = (e: MIDIMessageEvent) => {
      window.electronAPI?.midiActivity();
      const [status, data1, data2] = e.data!;
      if (status >= 0x90 && status <= 0x9F && data2 > 0) {
        handleNoteOn(data1);
      } else if ((status >= 0x80 && status <= 0x8F) || (status >= 0x90 && status <= 0x9F && data2 === 0)) {
        handleNoteOff(data1);
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
  }, []);

  // File menu events (New / Open / Save)
  useEffect(() => {
    const api = window.electronAPI;
    if (!api) return;

    api.onMenuNew(() => {
      setGraphState(emptyGraphState());
      setMode('jam');
    });

    api.onMenuOpen((data: SaveData) => {
      if (data && data.progressions) {
        let nodePositions: Map<string, { x: number; y: number }> | undefined;
        if (data.nodePositions) {
          nodePositions = new Map(Object.entries(data.nodePositions));
        }
        setGraphState(loadFromSaveData(data.progressions, nodePositions));
        setMode('jam');
      }
    });

    api.onMenuSave((filePath: string, saveAs: boolean) => {
      const saveData = createSaveData(modeRef.current, graphStateRef.current, walkStateRef.current);
      const json = JSON.stringify(saveData, null, 2);
      if (modeRef.current === 'walk' && !saveAs) {
        api.fileSaveAs(defaultWalkSaveName(walkStateRef.current), json);
        return;
      }
      api.fileWrite(filePath, json);
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

  // Add default G→D→A→G on mount
  useEffect(() => {
    const initial = emptyGraphState();
    const { state } = addProgression(initial, 'Default', ['G', 'D', 'A', 'G']);
    setGraphState(state);
  }, []);

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

  // Walk path data for circle of fifths overlay
  const walkPath = mode === 'walk' && walkState.path
    ? { nodes: walkState.path.chordNames, edgeTypes: walkState.path.edgeTypes as EdgeType[], currentStep: walkState.currentStep }
    : undefined;

  if (mode === 'home') {
    return (
      <div className="app">
        <div className="app-header">
          <h1>Chord Walk</h1>
          <MidiStatus connected={midiStatus.connected} message={midiStatus.message} />
        </div>
        <div className="landing">
          <div className="landing-hero">
            <p className="landing-subtitle">MIDI chord exploration</p>
          </div>
          <div className="landing-cards">
            <button className="landing-card" onClick={() => setMode('jam')}>
              <div className="landing-card-icon">&#9835;</div>
              <h2>Jam</h2>
              <p>Build chord progressions and see them on the Circle of Fifths. Play chords on MIDI and watch them light up in real time.</p>
            </button>
            <button className="landing-card" onClick={() => setMode('walk')}>
              <div className="landing-card-icon">&#10132;</div>
              <h2>Walk</h2>
              <p>Pick two chords and find the shortest harmonic path between them. Then play the path on MIDI to practice the voice leading.</p>
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className={`app${graphExpanded ? ' graph-expanded' : ''}`}>
      <div className="app-header">
        <h1 className="app-title-link" onClick={() => setMode('home')}>Chord Walk</h1>
        <div className="mode-toggle">
          <button
            className={`mode-btn ${mode === 'jam' ? 'mode-btn-active' : ''}`}
            onClick={() => setMode('jam')}
          >
            Jam
          </button>
          <button
            className={`mode-btn ${mode === 'walk' ? 'mode-btn-active' : ''}`}
            onClick={() => setMode('walk')}
          >
            Walk
          </button>
        </div>
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
          {mode === 'jam' ? (
            <>
              <ProgressionInput
                onAdd={handleAddProgression}
                onRemove={handleRemoveProgression}
                onEdit={handleEditProgression}
                progressions={graphState.progressions}
              />
            </>
          ) : (
            <>
              <WalkMode
                walkState={walkState}
                onWalkStateChange={setWalkState}
                noteSpelling={noteSpelling}
                keyShift={keyShift}
                onKeyShiftChange={setKeyShift}
              />
            </>
          )}
          <EdgeTypeLegend />
          <HeldNotes heldNotes={heldNotes} matchedChords={matchedChords} />
          <AudioRecorder />
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
          {mode === 'jam' ? (
            <CircleOfFifths
              graphState={graphState}
              jamMatchedChords={matchedChords}
              matchedChords={matchedChords}
              noteSpelling={noteSpelling}
              layout={circleLayout}
              keyShift={keyShift}
            />
          ) : (
            <CircleOfFifths
              walkPath={walkPath}
              matchedChords={matchedChords}
              noteSpelling={noteSpelling}
              layout={circleLayout}
              keyShift={keyShift}
            />
          )}
        </div>
      </div>
    </div>
  );
}

function createSaveData(mode: AppMode, graphState: GraphState, walkState: WalkState): SaveData {
  if (mode === 'walk' && walkState.path) {
    const constraintTags = [
      ...EDGE_TYPE_ORDER
        .filter(edgeType => walkState.options[edgeType])
        .map(edgeType => EDGE_TYPE_INFO[edgeType].label),
      walkState.options.returnTrip ? 'return' : null,
    ].filter(Boolean);
    const suffix = constraintTags.length > 0 ? ` (${constraintTags.join(', ')})` : '';
    return {
      version: 1,
      progressions: [{
        name: `${walkState.fromChord || 'Walk'} to ${walkState.toChord || 'path'}${suffix}`,
        chords: walkState.path.chordNames,
        color: '#58a6ff',
      }],
    };
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

function defaultWalkSaveName(walkState: WalkState): string {
  const from = walkState.fromChord || 'walk';
  const to = walkState.toChord || 'path';
  return `${from}_to_${to}.cwalk.json`.replace(/[^a-zA-Z0-9._-]+/g, '_');
}
