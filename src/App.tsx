import React, { useState, useEffect, useRef, useCallback } from 'react';
import type { GraphState, SaveData, AppMode, WalkState } from './types/index';
import { parseChordInput } from './core/chordParser';
import { addProgression, removeProgression, editProgression, emptyGraphState, loadFromSaveData } from './core/graphModel';
import { detectChords } from './core/chordDetection';
import ChordGraph from './components/ChordGraph';
import ProgressionInput from './components/ProgressionInput';
import MidiStatus from './components/MidiStatus';
import HeldNotes from './components/HeldNotes';
import WalkMode from './components/WalkMode';
import { getTheoryChordNodes, getAllChordNames, findChordPath } from './core/chordPathfinder';
import CircleOfFifths from './components/CircleOfFifths';

export default function App() {
  const [graphState, setGraphState] = useState<GraphState>(emptyGraphState);
  const [heldNotes, setHeldNotes] = useState<Set<number>>(new Set());
  const [matchedChords, setMatchedChords] = useState<string[]>([]);
  const [mode, setMode] = useState<AppMode>('home');
  const [walkState, setWalkState] = useState<WalkState>({
    fromChord: '',
    toChord: '',
    options: { relative: true, iiVI: false, leadingTone: false, returnTrip: false, endless: false },
    path: null,
    currentStep: 0,
    completed: false,
    pathsCompleted: 0,
  });
  const [midiStatus, setMidiStatus] = useState<{ connected: boolean; message: string }>({
    connected: false,
    message: 'Requesting MIDI access...',
  });

  // Debounce timer ref for chord detection
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Ref to latest graphState for menu-save callback
  const graphStateRef = useRef(graphState);
  graphStateRef.current = graphState;

  // Ref to get current node positions from the simulation
  const positionsRef = useRef<(() => Map<string, { x: number; y: number }>) | null>(null);

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
    });

    api.onMenuOpen((data: SaveData) => {
      if (data && data.progressions) {
        let nodePositions: Map<string, { x: number; y: number }> | undefined;
        if (data.nodePositions) {
          nodePositions = new Map(Object.entries(data.nodePositions));
        }
        setGraphState(loadFromSaveData(data.progressions, nodePositions));
      }
    });

    api.onMenuSave((filePath: string) => {
      const state = graphStateRef.current;
      const positions = positionsRef.current?.();
      const nodePositions: Record<string, { x: number; y: number }> = {};
      if (positions) {
        for (const [id, pos] of positions) {
          nodePositions[id] = { x: pos.x, y: pos.y };
        }
      }
      const saveData: SaveData = {
        version: 1,
        progressions: state.progressions.map(p => ({
          name: p.name,
          chords: p.chords,
          color: p.color,
        })),
        nodePositions,
      };
      api.fileWrite(filePath, JSON.stringify(saveData, null, 2));
    });

    return () => {
      api.removeMenuListeners();
    };
  }, []);

  // Chord detection with 50ms debounce
  // In Walk mode, detect against all 36 theory chords; in Jam mode, only graph nodes
  useEffect(() => {
    if (debounceRef.current) {
      clearTimeout(debounceRef.current);
    }

    debounceRef.current = setTimeout(() => {
      const detectionNodes = mode === 'walk'
        ? getTheoryChordNodes() as unknown as Map<string, import('./types/index').GraphNode>
        : graphState.nodes;
      const matches = detectChords(heldNotes, detectionNodes);
      setMatchedChords(matches);
    }, 50);

    return () => {
      if (debounceRef.current) {
        clearTimeout(debounceRef.current);
      }
    };
  }, [heldNotes, graphState.nodes, mode]);

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

  // Endless mode: auto-pick next destination after completing a path
  useEffect(() => {
    if (!walkState.completed || !walkState.options.endless) return;
    if (!walkState.path) return;

    const allChords = getAllChordNames();
    const allNames = [...allChords.major, ...allChords.minor, ...allChords.dim];
    const lastChord = walkState.path.chordNames[walkState.path.chordNames.length - 1];

    const timer = setTimeout(() => {
      const opts = walkState.options;
      // Shuffle candidates and try until we find a reachable one
      // (dim chords are unreachable — no inbound edges)
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
          const returnPath = findChordPath(nextTo, lastChord, opts);
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
    ? { nodes: walkState.path.chordNames, edgeTypes: walkState.path.edgeTypes, currentStep: walkState.currentStep }
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
              <p>Build chord progressions and see them as a force-directed graph. Play chords on MIDI and watch them light up in real time.</p>
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
    <div className="app">
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
              <HeldNotes heldNotes={heldNotes} matchedChords={matchedChords} />
            </>
          ) : (
            <>
              <WalkMode walkState={walkState} onWalkStateChange={setWalkState} />
              <HeldNotes heldNotes={heldNotes} matchedChords={matchedChords} />
            </>
          )}
        </div>
        <div className="graph-area">
          {mode === 'jam' ? (
            <ChordGraph
              graphState={graphState}
              matchedChords={matchedChords}
              positionsRef={positionsRef}
            />
          ) : (
            <CircleOfFifths
              walkPath={walkPath}
              matchedChords={matchedChords}
            />
          )}
        </div>
      </div>
    </div>
  );
}
