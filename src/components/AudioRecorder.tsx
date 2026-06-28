import React, { useCallback, useEffect, useRef, useState } from 'react';
import { processAudio, DEFAULT_CONFIG } from '../core/audioProcessor';
import type { AudioMetrics } from '../core/audioProcessor';
import { encodeMidi } from '../core/midiEncoder';
import type { MidiEvent } from '../types/index';

export interface SavedRecordingData {
  audioUrl: string;
  midiBuffer: ArrayBuffer | null;
  cwalkData: string;
}

interface AudioRecorderProps {
  onRecordingStart?: (startMs: number) => void;
  onRecordingStop?: () => MidiEvent[];
  getSaveData?: () => string;
  onPlayRecording?: (data: SavedRecordingData) => void;
}

type RecorderPhase =
  | { kind: 'idle' }
  | { kind: 'recording' }
  | { kind: 'saving'; label: string }
  | { kind: 'saved'; audioUrl: string; metrics: AudioMetrics; midiBuffer: ArrayBuffer | null; cwalkData: string }
  | { kind: 'fallback'; audioUrl: string; reason: string };

export default function AudioRecorder({ onRecordingStart, onRecordingStop, getSaveData, onPlayRecording }: AudioRecorderProps) {
  const [devices, setDevices] = useState<MediaDeviceInfo[]>([]);
  const [deviceId, setDeviceId] = useState<string>('');
  const [recording, setRecording] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [phase, setPhase] = useState<RecorderPhase>({ kind: 'idle' });
  const [error, setError] = useState<string | null>(null);

  const ctxRef = useRef<AudioContext | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const sourceRef = useRef<MediaStreamAudioSourceNode | null>(null);
  const workletRef = useRef<AudioWorkletNode | null>(null);
  const sinkRef = useRef<GainNode | null>(null);
  const buffersRef = useRef<Float32Array[][]>([]);
  const frozenChunksRef = useRef<Float32Array[][]>([]);
  const frozenMidiRef = useRef<MidiEvent[]>([]);
  const channelsRef = useRef(2);
  const sampleRateRef = useRef(44100);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const onRecordingStartRef = useRef(onRecordingStart);
  onRecordingStartRef.current = onRecordingStart;
  const onRecordingStopRef = useRef(onRecordingStop);
  onRecordingStopRef.current = onRecordingStop;
  const getSaveDataRef = useRef(getSaveData);
  getSaveDataRef.current = getSaveData;
  const onPlayRecordingRef = useRef(onPlayRecording);
  onPlayRecordingRef.current = onPlayRecording;

  const listDevices = useCallback(async () => {
    try {
      const all = await navigator.mediaDevices.enumerateDevices();
      const inputs = all.filter(d => d.kind === 'audioinput');
      setDevices(inputs);
      setDeviceId(prev => {
        if (prev && inputs.some(d => d.deviceId === prev)) return prev;
        const score = (label = '') => {
          const l = label.toLowerCase();
          if (/line\s*-?\s*in/.test(l)) return 3;
          if (/usb audio|usb codec|interface|aux/.test(l)) return 2;
          if (/\bline\b/.test(l)) return 1;
          return 0;
        };
        const best = [...inputs].sort((a, b) => score(b.label) - score(a.label))[0];
        return (best ?? inputs[0])?.deviceId ?? '';
      });
    } catch (e) {
      setError(`Could not list audio devices: ${(e as Error).message}`);
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const s = await navigator.mediaDevices.getUserMedia({ audio: true });
        s.getTracks().forEach(t => t.stop());
      } catch { /* labels stay generic */ }
      if (!cancelled) listDevices();
    })();
    navigator.mediaDevices.addEventListener?.('devicechange', listDevices);
    return () => {
      cancelled = true;
      navigator.mediaDevices.removeEventListener?.('devicechange', listDevices);
    };
  }, [listDevices]);

  const stopCapture = useCallback(() => {
    if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null; }
    workletRef.current?.disconnect();
    sourceRef.current?.disconnect();
    sinkRef.current?.disconnect();
    streamRef.current?.getTracks().forEach(t => t.stop());

    frozenChunksRef.current = buffersRef.current;
    buffersRef.current = [];
    frozenMidiRef.current = onRecordingStopRef.current?.() ?? [];

    ctxRef.current?.close().catch(() => {});
    ctxRef.current = null;
    workletRef.current = null;
    sourceRef.current = null;
    sinkRef.current = null;
    streamRef.current = null;
    setRecording(false);
  }, []);

  const save = useCallback(async () => {
    const chunks = frozenChunksRef.current;
    const midiEvents = frozenMidiRef.current;
    const sr = sampleRateRef.current;

    if (!chunks.length || !chunks[0]?.length) {
      setPhase({ kind: 'idle' });
      return;
    }

    const ts = recTimestamp();
    const saveDataJson = getSaveDataRef.current?.() ?? '{}';
    setPhase({ kind: 'saving', label: 'Choose save folder...' });

    const paths = (await window.electronAPI?.requestRecordingPaths(ts, saveDataJson)) ?? null;

    if (!paths) {
      // Canceled — offer an in-app blob for listening
      try {
        const flat = chunks.map(flatten);
        const { polished, metrics } = processAudio(flat, sr, DEFAULT_CONFIG);
        const buf = encodeWavFlat(polished, sr);
        const audioUrl = URL.createObjectURL(new Blob([buf], { type: 'audio/wav' }));
        setPhase({ kind: 'fallback', audioUrl, reason: 'Save canceled. Recording available below:' });
      } catch {
        setPhase({ kind: 'idle' });
      }
      return;
    }

    try {
      setPhase({ kind: 'saving', label: 'Encoding...' });
      const flat = chunks.map(flatten);
      const totalMs = (flat[0].length / sr) * 1000;

      setPhase({ kind: 'saving', label: 'Processing audio...' });
      const { polished, metrics } = processAudio(flat, sr, DEFAULT_CONFIG);
      const polishedBuffer = encodeWavFlat(polished, sr);
      const audioUrl = URL.createObjectURL(new Blob([polishedBuffer], { type: 'audio/wav' }));

      setPhase({ kind: 'saving', label: 'Saving audio...' });
      await streamToFile(paths.polishedPath, polishedBuffer);

      let midiBuffer: ArrayBuffer | null = null;
      if (midiEvents.length > 0) {
        setPhase({ kind: 'saving', label: 'Saving MIDI...' });
        midiBuffer = encodeMidi(midiEvents, totalMs);
        await window.electronAPI!.saveMidi(paths.midiPath, new Uint8Array(midiBuffer));
      }

      setPhase({ kind: 'saved', audioUrl, metrics, midiBuffer, cwalkData: saveDataJson });
    } catch (e) {
      const msg = (e as Error).message;
      console.error('[AudioRecorder] save failed:', msg);
      setPhase({ kind: 'fallback', audioUrl: '', reason: `Save failed: ${msg}` });
    }
  }, []);

  const handleStop = useCallback(async () => {
    stopCapture();
    await save();
  }, [stopCapture, save]);

  useEffect(() => () => { stopCapture(); }, []);

  const start = useCallback(async () => {
    setError(null);
    setPhase({ kind: 'idle' });
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          deviceId: deviceId ? { exact: deviceId } : undefined,
          echoCancellation: false,
          noiseSuppression: false,
          autoGainControl: false,
          channelCount: 2,
        },
      });
      streamRef.current = stream;
      listDevices();

      const ctx = new AudioContext();
      ctxRef.current = ctx;
      sampleRateRef.current = ctx.sampleRate;

      const source = ctx.createMediaStreamSource(stream);
      sourceRef.current = source;
      const chCount = Math.min(2, Math.max(1, source.channelCount || 2));
      channelsRef.current = chCount;
      buffersRef.current = Array.from({ length: chCount }, () => [] as Float32Array[]);
      frozenChunksRef.current = [];
      frozenMidiRef.current = [];

      const workletBlob = new Blob([`
        class RecorderProcessor extends AudioWorkletProcessor {
          process(inputs) {
            const input = inputs[0];
            if (input && input.length > 0) {
              this.port.postMessage(input.map(ch => new Float32Array(ch)));
            }
            return true;
          }
        }
        registerProcessor('recorder-processor', RecorderProcessor);
      `], { type: 'application/javascript' });
      const workletUrl = URL.createObjectURL(workletBlob);
      await ctx.audioWorklet.addModule(workletUrl);
      URL.revokeObjectURL(workletUrl);

      const worklet = new AudioWorkletNode(ctx, 'recorder-processor', {
        numberOfInputs: 1,
        numberOfOutputs: 1,
        outputChannelCount: [chCount],
        channelCount: chCount,
        channelCountMode: 'explicit',
      });
      workletRef.current = worklet;
      worklet.port.onmessage = (e: MessageEvent<Float32Array[]>) => {
        const buf = buffersRef.current;
        if (!buf.length) return;
        for (let c = 0; c < chCount; c++) {
          if (e.data[c] && buf[c]) buf[c].push(e.data[c]);
        }
      };

      const sink = ctx.createGain();
      sink.gain.value = 0;
      sinkRef.current = sink;
      source.connect(worklet);
      worklet.connect(sink);
      sink.connect(ctx.destination);

      const startMs = performance.now();
      onRecordingStartRef.current?.(startMs);

      setElapsed(0);
      timerRef.current = setInterval(() => setElapsed(s => s + 1), 1000);
      setRecording(true);
      setPhase({ kind: 'recording' });
    } catch (e) {
      setError(`Couldn't start recording: ${(e as Error).message}`);
    }
  }, [deviceId, listDevices]);

  const resetToIdle = useCallback(() => {
    setPhase({ kind: 'idle' });
    setElapsed(0);
  }, []);

  const mm = String(Math.floor(elapsed / 60)).padStart(2, '0');
  const ss = String(elapsed % 60).padStart(2, '0');

  return (
    <div className="recorder">
      <div className="recorder-header">
        <span className="recorder-title">Record</span>
        {recording && <span className="recorder-time">● {mm}:{ss}</span>}
      </div>

      {(phase.kind === 'idle' || phase.kind === 'recording') && (
        <select
          className="walk-select"
          value={deviceId}
          onChange={(e) => setDeviceId(e.target.value)}
          disabled={recording}
        >
          {devices.length === 0 && <option value="">No audio inputs found</option>}
          {devices.map((d, i) => (
            <option key={d.deviceId || i} value={d.deviceId}>
              {d.label || `Audio input ${i + 1}`}
            </option>
          ))}
        </select>
      )}

      {phase.kind === 'idle' && (
        <button className="recorder-btn recorder-btn-start" onClick={start}>● Record</button>
      )}
      {phase.kind === 'recording' && (
        <button className="recorder-btn recorder-btn-stop" onClick={handleStop} disabled={!recording}>■ Stop & Save</button>
      )}
      {phase.kind === 'saving' && (
        <div className="recorder-status">{phase.label}</div>
      )}

      {phase.kind === 'saved' && (
        <>
          <audio controls src={phase.audioUrl} style={{ width: '100%', height: 32 }} />
          <div style={{ display: 'flex', gap: 6, marginTop: 4 }}>
            <button
              className="recorder-btn recorder-btn-start"
              style={{ flex: 1 }}
              onClick={() => onPlayRecordingRef.current?.({ audioUrl: phase.audioUrl, midiBuffer: phase.midiBuffer, cwalkData: phase.cwalkData })}
            >
              ▶ Play in Replay
            </button>
            <button className="recorder-new-btn" onClick={resetToIdle}>New</button>
          </div>
          <div className="recorder-metrics">
            <div className="recorder-metrics-row">
              <span className="recorder-metrics-label">Duration</span>
              <span className="recorder-metrics-value">{fmtDur(phase.metrics.durationSec)}</span>
            </div>
            <div className="recorder-metrics-row">
              <span className="recorder-metrics-label">Raw peak</span>
              <span className="recorder-metrics-value">{fmtDb(phase.metrics.rawPeakDb)}</span>
            </div>
            <div className="recorder-metrics-row">
              <span className="recorder-metrics-label">Gain applied</span>
              <span className="recorder-metrics-value">{fmtGain(phase.metrics.appliedGainDb)}</span>
            </div>
            <div className="recorder-metrics-row">
              <span className="recorder-metrics-label">Polished peak</span>
              <span className="recorder-metrics-value">{fmtDb(phase.metrics.polishedPeakDb)}</span>
            </div>
            {phase.metrics.limiterClampedSamples > 0 && (
              <div className="recorder-metrics-row">
                <span className="recorder-metrics-label">Limiter</span>
                <span className="recorder-metrics-value">{phase.metrics.limiterClampedSamples} samples</span>
              </div>
            )}
          </div>
        </>
      )}

      {phase.kind === 'fallback' && (
        <>
          <div className="recorder-error">{phase.reason}</div>
          {phase.audioUrl && <audio controls src={phase.audioUrl} style={{ width: '100%', height: 32 }} />}
          <button className="recorder-new-btn" onClick={resetToIdle}>New Recording</button>
        </>
      )}

      {error && <div className="recorder-error">{error}</div>}
    </div>
  );
}

function recTimestamp(): string {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}_${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
}

function fmtDb(db: number): string {
  if (!isFinite(db)) return '—';
  return (db >= 0 ? '+' : '') + db.toFixed(1) + ' dBFS';
}

function fmtGain(db: number): string {
  if (!isFinite(db)) return '—';
  return (db >= 0 ? '+' : '') + db.toFixed(1) + ' dB';
}

function fmtDur(sec: number): string {
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}:${String(s).padStart(2, '0')}`;
}

function flatten(chunks: Float32Array[]): Float32Array {
  let total = 0;
  for (const c of chunks) total += c.length;
  const out = new Float32Array(total);
  let o = 0;
  for (const c of chunks) { out.set(c, o); o += c.length; }
  return out;
}

function encodeWavFlat(channels: Float32Array[], sampleRate: number): ArrayBuffer {
  const numChannels = channels.length;
  const numFrames = channels[0]?.length ?? 0;
  const blockAlign = numChannels * 2;
  const dataSize = numFrames * blockAlign;

  const buffer = new ArrayBuffer(44 + dataSize);
  const view = new DataView(buffer);
  const ws = (off: number, s: string) => {
    for (let i = 0; i < s.length; i++) view.setUint8(off + i, s.charCodeAt(i));
  };

  ws(0, 'RIFF');
  view.setUint32(4, 36 + dataSize, true);
  ws(8, 'WAVE');
  ws(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, numChannels, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * blockAlign, true);
  view.setUint16(32, blockAlign, true);
  view.setUint16(34, 16, true);
  ws(36, 'data');
  view.setUint32(40, dataSize, true);

  let offset = 44;
  for (let i = 0; i < numFrames; i++) {
    for (let c = 0; c < numChannels; c++) {
      const s = Math.max(-1, Math.min(1, channels[c][i]));
      view.setInt16(offset, s < 0 ? s * 0x8000 : s * 0x7fff, true);
      offset += 2;
    }
  }
  return buffer;
}

async function streamToFile(filePath: string, buffer: ArrayBuffer): Promise<void> {
  const CHUNK = 512 * 1024;
  await window.electronAPI!.openWriteStream(filePath);
  let offset = 0;
  while (offset < buffer.byteLength) {
    const end = Math.min(offset + CHUNK, buffer.byteLength);
    window.electronAPI!.writeStreamChunk(filePath, new Uint8Array(buffer.slice(offset, end)));
    offset = end;
    if (offset < buffer.byteLength) await new Promise(r => setTimeout(r, 0));
  }
  await window.electronAPI!.closeWriteStream(filePath);
}
