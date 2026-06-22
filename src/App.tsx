import React, { useState, useEffect, useRef, useCallback } from 'react';
import type { GraphState, SaveData } from './types/index';
import { parseChordInput } from './core/chordParser';
import { addProgression, removeProgression, editProgression, emptyGraphState, loadFromSaveData } from './core/graphModel';
import { detectChords } from './core/chordDetection';
import ChordGraph from './components/ChordGraph';
import ProgressionInput from './components/ProgressionInput';
import MidiStatus from './components/MidiStatus';
import HeldNotes from './components/HeldNotes';

export default function App() {
  const [graphState, setGraphState] = useState<GraphState>(emptyGraphState);
  const [heldNotes, setHeldNotes] = useState<Set<number>>(new Set());
  const [matchedChords, setMatchedChords] = useState<string[]>([]);
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
  useEffect(() => {
    if (debounceRef.current) {
      clearTimeout(debounceRef.current);
    }

    debounceRef.current = setTimeout(() => {
      const matches = detectChords(heldNotes, graphState.nodes);
      setMatchedChords(matches);
    }, 50);

    return () => {
      if (debounceRef.current) {
        clearTimeout(debounceRef.current);
      }
    };
  }, [heldNotes, graphState.nodes]);

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

  return (
    <div className="app">
      <div className="app-header">
        <h1>Chord Walk</h1>
        <MidiStatus connected={midiStatus.connected} message={midiStatus.message} />
      </div>
      <div className="app-body">
        <div className="sidebar">
          <ProgressionInput
            onAdd={handleAddProgression}
            onRemove={handleRemoveProgression}
            onEdit={handleEditProgression}
            progressions={graphState.progressions}
          />
          <HeldNotes heldNotes={heldNotes} matchedChords={matchedChords} />
        </div>
        <div className="graph-area">
          <ChordGraph
            graphState={graphState}
            matchedChords={matchedChords}
            positionsRef={positionsRef}
          />
        </div>
      </div>
    </div>
  );
}
