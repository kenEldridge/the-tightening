import React, { useCallback, useEffect, useRef, useState } from 'react';
import { parseMidi } from '../core/midiParser';
import type { MidiEvent, SaveData } from '../types/index';
import type { SavedRecordingData } from './AudioRecorder';

interface ReplayModeProps {
  handleNoteOn: (note: number) => void;
  handleNoteOff: (note: number) => void;
  onLoaded?: (data: SaveData | null) => void;
  autoLoad?: (SavedRecordingData & { autoPlay: boolean }) | null;
}

interface LoadedRecording {
  audioPath: string;
  audioUrl: string;
  midiLoaded: boolean;
  midiEventCount: number;
}

export default function ReplayMode({ handleNoteOn, handleNoteOff, onLoaded, autoLoad }: ReplayModeProps) {
  const [recording, setRecording] = useState<LoadedRecording | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [playing, setPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);

  const audioRef = useRef<HTMLAudioElement>(null);
  const midiEventsRef = useRef<MidiEvent[]>([]);
  const eventIndexRef = useRef(0);
  const rafRef = useRef(0);

  const handleNoteOnRef = useRef(handleNoteOn);
  handleNoteOnRef.current = handleNoteOn;
  const handleNoteOffRef = useRef(handleNoteOff);
  handleNoteOffRef.current = handleNoteOff;
  const onLoadedRef = useRef(onLoaded);
  onLoadedRef.current = onLoaded;

  const allNotesOff = useCallback(() => {
    for (let n = 0; n < 128; n++) handleNoteOffRef.current(n);
  }, []);

  const tick = useCallback(() => {
    const audio = audioRef.current;
    if (!audio || audio.paused || audio.ended) return;
    const nowMs = audio.currentTime * 1000;
    const events = midiEventsRef.current;
    while (eventIndexRef.current < events.length) {
      const ev = events[eventIndexRef.current];
      if (ev.offsetMs > nowMs + 50) break;
      if (ev.type === 'noteOn') handleNoteOnRef.current(ev.note);
      else if (ev.type === 'noteOff') handleNoteOffRef.current(ev.note);
      eventIndexRef.current++;
    }
    setCurrentTime(audio.currentTime);
    rafRef.current = requestAnimationFrame(tick);
  }, []);

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;
    const onPlay  = () => { setPlaying(true);  rafRef.current = requestAnimationFrame(tick); };
    const onPause = () => { setPlaying(false); cancelAnimationFrame(rafRef.current); };
    const onEnded = () => {
      setPlaying(false);
      cancelAnimationFrame(rafRef.current);
      allNotesOff();
      eventIndexRef.current = 0;
      setCurrentTime(0);
    };
    const onMeta = () => setDuration(audio.duration || 0);
    audio.addEventListener('play', onPlay);
    audio.addEventListener('pause', onPause);
    audio.addEventListener('ended', onEnded);
    audio.addEventListener('loadedmetadata', onMeta);
    return () => {
      audio.removeEventListener('play', onPlay);
      audio.removeEventListener('pause', onPause);
      audio.removeEventListener('ended', onEnded);
      audio.removeEventListener('loadedmetadata', onMeta);
      cancelAnimationFrame(rafRef.current);
    };
  }, [tick, allNotesOff]);

  useEffect(() => () => {
    cancelAnimationFrame(rafRef.current);
    allNotesOff();
    setRecording(prev => { if (prev?.audioUrl) URL.revokeObjectURL(prev.audioUrl); return null; });
  }, [allNotesOff]);

  const shouldAutoPlayRef = useRef(false);

  // Auto-load from a just-saved recording (no file picker needed).
  // App.tsx already handled the circle state via onReplayLoaded before mounting us.
  useEffect(() => {
    if (!autoLoad) return;

    cancelAnimationFrame(rafRef.current);
    allNotesOff();
    setPlaying(false);
    setCurrentTime(0);
    setDuration(0);
    setLoadError(null);
    setRecording(prev => { if (prev?.audioUrl) URL.revokeObjectURL(prev.audioUrl); return null; });

    let midiLoaded = false;
    let midiEventCount = 0;
    if (autoLoad.midiBuffer) {
      try {
        const events = parseMidi(autoLoad.midiBuffer);
        midiEventsRef.current = events;
        eventIndexRef.current = 0;
        midiLoaded = true;
        midiEventCount = events.length;
      } catch { /* non-fatal */ }
    }

    if (autoLoad.autoPlay) shouldAutoPlayRef.current = true;

    setRecording({ audioPath: 'Just recorded', audioUrl: autoLoad.audioUrl, midiLoaded, midiEventCount });
  }, [autoLoad, allNotesOff]);

  // Fire auto-play once the audio element is ready after auto-load.
  useEffect(() => {
    if (!recording || !shouldAutoPlayRef.current) return;
    shouldAutoPlayRef.current = false;
    const audio = audioRef.current;
    if (!audio) return;
    const doPlay = () => audio.play().catch(() => {});
    if (audio.readyState >= 3) {
      doPlay();
    } else {
      audio.addEventListener('canplay', doPlay, { once: true });
    }
  }, [recording]);

  const openRecording = useCallback(async () => {
    setLoadError(null);
    cancelAnimationFrame(rafRef.current);
    allNotesOff();
    setPlaying(false);
    setCurrentTime(0);
    setDuration(0);

    setRecording(prev => {
      if (prev?.audioUrl) URL.revokeObjectURL(prev.audioUrl);
      return null;
    });
    onLoadedRef.current?.(null);

    const result = await window.electronAPI?.openRecording() ?? null;
    if (!result) return;

    // Load audio into a Blob URL (file:// URLs are blocked from http:// origins in dev)
    let audioUrl: string;
    try {
      const data = await window.electronAPI!.readFileBinary(result.audioPath);
      const buf = data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength) as ArrayBuffer;
      const mime = result.audioPath.toLowerCase().endsWith('.wav') ? 'audio/wav' : 'audio/mpeg';
      audioUrl = URL.createObjectURL(new Blob([buf], { type: mime }));
    } catch (e) {
      setLoadError(`Could not read audio: ${(e as Error).message}`);
      return;
    }

    // Load MIDI
    let midiLoaded = false;
    let midiEventCount = 0;
    if (result.midiPath) {
      try {
        const data = await window.electronAPI!.readFileBinary(result.midiPath);
        const buf = data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength) as ArrayBuffer;
        const events = parseMidi(buf);
        midiEventsRef.current = events;
        eventIndexRef.current = 0;
        midiLoaded = true;
        midiEventCount = events.length;
      } catch (e) {
        setLoadError(`Audio loaded. MIDI error: ${(e as Error).message}`);
      }
    } else {
      setLoadError('No .mid file found in this recording folder.');
    }

    // Load cwalk and notify App
    if (result.cwalkData) {
      try {
        const saveData = JSON.parse(result.cwalkData) as SaveData;
        onLoadedRef.current?.(saveData);
      } catch {
        // cwalk parse failure is non-fatal — circle just stays blank
      }
    }

    setRecording({
      audioPath: result.audioPath,
      audioUrl,
      midiLoaded,
      midiEventCount,
    });
  }, [allNotesOff]);

  const seek = useCallback((timeS: number) => {
    const audio = audioRef.current;
    if (!audio) return;
    allNotesOff();
    const seekMs = timeS * 1000;
    const events = midiEventsRef.current;
    const held = new Set<number>();
    for (const ev of events) {
      if (ev.offsetMs > seekMs) break;
      if (ev.type === 'noteOn') held.add(ev.note);
      else if (ev.type === 'noteOff') held.delete(ev.note);
    }
    let idx = 0;
    while (idx < events.length && events[idx].offsetMs <= seekMs) idx++;
    eventIndexRef.current = idx;
    for (const n of held) handleNoteOnRef.current(n);
    audio.currentTime = timeS;
    setCurrentTime(timeS);
  }, [allNotesOff]);

  const handlePlay  = useCallback(() => { audioRef.current?.play(); }, []);
  const handlePause = useCallback(() => { audioRef.current?.pause(); allNotesOff(); }, [allNotesOff]);
  const handleStop  = useCallback(() => {
    const audio = audioRef.current;
    if (!audio) return;
    audio.pause();
    audio.currentTime = 0;
    cancelAnimationFrame(rafRef.current);
    eventIndexRef.current = 0;
    setCurrentTime(0);
    allNotesOff();
    setPlaying(false);
  }, [allNotesOff]);

  const fmt = (s: number) => {
    if (!isFinite(s)) return '0:00';
    return `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;
  };

  const folderName = recording?.audioPath
    ? recording.audioPath.replace(/[\\/][^\\/]+$/, '').replace(/.*[\\/]/, '')
    : null;

  return (
    <div className="replay-mode">
      <button className="replay-btn replay-btn-open" onClick={openRecording} style={{ alignSelf: 'flex-start' }}>
        Open Recording...
      </button>

      {recording && (
        <div className="replay-section">
          <span className="replay-label">Folder</span>
          <span className="replay-file-hint" style={{ color: 'var(--text-primary)', fontStyle: 'normal' }}>
            {folderName}
          </span>
          {recording.midiLoaded && (
            <span className="replay-file-hint">{recording.midiEventCount} MIDI events</span>
          )}
        </div>
      )}

      {loadError && (
        <div className="replay-file-hint" style={{ color: '#f5a623' }}>{loadError}</div>
      )}

      {recording && (
        <>
          <div className="replay-transport">
            {!playing ? (
              <button className="replay-btn replay-btn-play" onClick={handlePlay}>▶ Play</button>
            ) : (
              <button className="replay-btn" onClick={handlePause}>⏸ Pause</button>
            )}
            <button className="replay-btn" onClick={handleStop}>⏹</button>
            <span className="replay-time">{fmt(currentTime)} / {fmt(duration)}</span>
          </div>

          <input
            type="range"
            className="replay-scrub"
            min={0}
            max={isFinite(duration) ? duration : 0}
            step={0.1}
            value={currentTime}
            onChange={e => seek(parseFloat(e.target.value))}
          />
        </>
      )}

      <audio ref={audioRef} src={recording?.audioUrl} preload="metadata" style={{ display: 'none' }} />
    </div>
  );
}
