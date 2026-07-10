import { useCallback, useEffect, useRef, useState } from 'react';
import { createDrummerEngine, INITIAL_DRUMMER_STATE } from 'theory-core';
import type { DrummerEngine } from 'theory-core';
import type { DrummerState } from '../types/index';

/**
 * Thin React wrapper around the drummer engine: one engine per component
 * lifetime (lazy useRef init — cheap, no AudioContext until start()), engine
 * snapshots mirrored into state, and referentially STABLE noteOn/noteOff —
 * they join App's WebMIDI effect dependency array, which must not re-run
 * per render (it re-requests MIDI access and rebinds inputs).
 */
export function useDrummer() {
  const [state, setState] = useState<DrummerState>(INITIAL_DRUMMER_STATE);
  const engineRef = useRef<DrummerEngine | null>(null);
  if (engineRef.current === null) {
    engineRef.current = createDrummerEngine(setState);
  }

  const toggle = useCallback(() => {
    // Called synchronously from the header checkbox's user gesture —
    // engine.start() constructs/resumes the AudioContext there.
    const engine = engineRef.current!;
    if (engine.isEnabled()) engine.stop();
    else engine.start();
  }, []);

  const noteOn = useCallback((note: number, velocity: number, timeStampMs: number) => {
    engineRef.current!.noteOn(note, velocity, timeStampMs);
  }, []);

  const noteOff = useCallback((note: number) => {
    engineRef.current!.noteOff(note);
  }, []);

  useEffect(() => () => {
    engineRef.current?.dispose();
    engineRef.current = null;
  }, []);

  return { state, toggle, noteOn, noteOff };
}
