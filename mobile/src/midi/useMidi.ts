import { useCallback, useEffect, useRef, useState } from 'react';
import { requestMIDIAccess, type MIDIAccess, type MIDIInput, type MIDIOutput } from '@motiz88/react-native-midi';
import { detectChords, getTheoryChordNodes, midiNoteToName } from 'theory-core';

export interface Midi {
  access: MIDIAccess | null;
  error: string | null;
  inputs: MIDIInput[];
  outputs: MIDIOutput[];
  heldNotes: number[];
  /** Theory chords currently matched by held notes (36-node graph, most specific first). */
  matchedChords: string[];
  /** Rolling log of recent note-ons, newest first. */
  log: string[];
  sendNote: (note: number) => boolean;
}

const theoryNodes = () => getTheoryChordNodes() as Parameters<typeof detectChords>[1];

/**
 * Single owner of MIDI access + input handlers (the Web MIDI onmidimessage
 * slot is assignment-based, so exactly one subscriber must exist). Lives in
 * App and is passed down to screens.
 */
export function useMidi(): Midi {
  const [access, setAccess] = useState<MIDIAccess | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [heldNotes, setHeldNotes] = useState<number[]>([]);
  const [matchedChords, setMatchedChords] = useState<string[]>([]);
  const [log, setLog] = useState<string[]>([]);
  const [deviceTick, setDeviceTick] = useState(0);
  const held = useRef(new Set<number>());

  useEffect(() => {
    let cancelled = false;
    requestMIDIAccess().then(
      (midi) => {
        if (cancelled) return;
        setAccess(midi);
        midi.onstatechange = () => setDeviceTick((t) => t + 1);
      },
      (e) => !cancelled && setError(String(e)),
    );
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!access) return;
    for (const input of access.inputs.values()) {
      input.onmidimessage = (event) => {
        const data = event.data;
        if (!data || data.length < 3) return;
        const status = data[0] & 0xf0;
        const note = data[1];
        const velocity = data[2];
        if (status === 0x90 && velocity > 0) {
          held.current.add(note);
          setLog((prev) => [`noteOn  ${midiNoteToName(note)} vel ${velocity} (${input.name})`, ...prev].slice(0, 8));
        } else if (status === 0x80 || (status === 0x90 && velocity === 0)) {
          held.current.delete(note);
        } else {
          return;
        }
        setHeldNotes([...held.current].sort((a, b) => a - b));
        setMatchedChords(detectChords(held.current, theoryNodes()));
      };
    }
    return () => {
      for (const input of access.inputs.values()) {
        input.onmidimessage = null;
      }
    };
  }, [access, deviceTick]);

  const sendNote = useCallback(
    (note: number) => {
      const output = access ? [...access.outputs.values()][0] : undefined;
      if (!output) return false;
      output.send([0x90, note, 100]);
      setTimeout(() => output.send([0x80, note, 0]), 400);
      return true;
    },
    [access],
  );

  return {
    access,
    error,
    inputs: access ? [...access.inputs.values()] : [],
    outputs: access ? [...access.outputs.values()] : [],
    heldNotes,
    matchedChords,
    log,
    sendNote,
  };
}
