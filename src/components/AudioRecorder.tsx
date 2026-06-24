import React, { useCallback, useEffect, useRef, useState } from 'react';

/**
 * Records a chosen audio input (e.g. the line-in carrying the piano) to a WAV
 * file you can replay in-app and download. WAV is lossless and opens in any
 * editor; convert to mp3/etc. downstream if you want a smaller file.
 *
 * The FP-10 sends MIDI only over USB, so the audio comes from a separate
 * line-level input. This panel just captures whatever input device you pick.
 */
export default function AudioRecorder() {
  const [devices, setDevices] = useState<MediaDeviceInfo[]>([]);
  const [deviceId, setDeviceId] = useState<string>('');
  const [recording, setRecording] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [clipUrl, setClipUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const ctxRef = useRef<AudioContext | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const sourceRef = useRef<MediaStreamAudioSourceNode | null>(null);
  const workletRef = useRef<AudioWorkletNode | null>(null);
  const sinkRef = useRef<GainNode | null>(null);
  const buffersRef = useRef<Float32Array[][]>([]); // per-channel chunk lists
  const channelsRef = useRef(2);
  const sampleRateRef = useRef(44100);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const listDevices = useCallback(async () => {
    try {
      const all = await navigator.mediaDevices.enumerateDevices();
      const inputs = all.filter(d => d.kind === 'audioinput');
      setDevices(inputs);
      setDeviceId(prev => {
        if (prev && inputs.some(d => d.deviceId === prev)) return prev;
        // Auto-select the most likely line input: an explicit "line in" wins,
        // then USB-audio/interface/aux inputs, then anything mentioning "line".
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

  // On mount, unlock device labels (needs one permission grant) and list inputs.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const s = await navigator.mediaDevices.getUserMedia({ audio: true });
        s.getTracks().forEach(t => t.stop());
      } catch {
        // Permission may be denied at the OS level; labels stay generic.
      }
      if (!cancelled) listDevices();
    })();
    navigator.mediaDevices.addEventListener?.('devicechange', listDevices);
    return () => {
      cancelled = true;
      navigator.mediaDevices.removeEventListener?.('devicechange', listDevices);
    };
  }, [listDevices]);

  const stop = useCallback(() => {
    if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null; }
    workletRef.current?.disconnect();
    sourceRef.current?.disconnect();
    sinkRef.current?.disconnect();
    streamRef.current?.getTracks().forEach(t => t.stop());
    const ctx = ctxRef.current;

    const chunks = buffersRef.current;
    if (ctx && chunks.length && chunks[0].length) {
      const wav = encodeWav(chunks, sampleRateRef.current);
      const blob = new Blob([wav], { type: 'audio/wav' });
      setClipUrl(prev => { if (prev) URL.revokeObjectURL(prev); return URL.createObjectURL(blob); });
    }

    ctx?.close().catch(() => {});
    ctxRef.current = null;
    workletRef.current = null;
    sourceRef.current = null;
    sinkRef.current = null;
    buffersRef.current = [];
    setRecording(false);
  }, []);

  const start = useCallback(async () => {
    setError(null);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          deviceId: deviceId ? { exact: deviceId } : undefined,
          // Music, not voice — keep the signal untouched.
          echoCancellation: false,
          noiseSuppression: false,
          autoGainControl: false,
          channelCount: 2,
        },
      });
      streamRef.current = stream;
      listDevices(); // labels are available now

      const ctx = new AudioContext();
      ctxRef.current = ctx;
      sampleRateRef.current = ctx.sampleRate;

      const source = ctx.createMediaStreamSource(stream);
      sourceRef.current = source;
      const chCount = Math.min(2, Math.max(1, source.channelCount || 2));
      channelsRef.current = chCount;
      buffersRef.current = Array.from({ length: chCount }, () => [] as Float32Array[]);

      // AudioWorklet runs on a dedicated audio thread — immune to main-thread
      // jank from React renders or the force simulation.
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
        for (let c = 0; c < chCount; c++) {
          if (e.data[c]) buffersRef.current[c].push(e.data[c]);
        }
      };

      // Connect through a silent gain node to keep the graph active.
      const sink = ctx.createGain();
      sink.gain.value = 0;
      sinkRef.current = sink;
      source.connect(worklet);
      worklet.connect(sink);
      sink.connect(ctx.destination);

      setElapsed(0);
      timerRef.current = setInterval(() => setElapsed(s => s + 1), 1000);
      setRecording(true);
    } catch (e) {
      setError(`Couldn't start recording: ${(e as Error).message}`);
    }
  }, [deviceId, listDevices]);

  useEffect(() => () => { stop(); }, []); // cleanup on unmount

  const mm = String(Math.floor(elapsed / 60)).padStart(2, '0');
  const ss = String(elapsed % 60).padStart(2, '0');

  return (
    <div className="recorder">
      <div className="recorder-header">
        <span className="recorder-title">Record</span>
        {recording && <span className="recorder-time">● {mm}:{ss}</span>}
      </div>

      <select
        className="walk-select"
        value={deviceId}
        onChange={(e) => setDeviceId(e.target.value)}
        disabled={recording}
        title="Audio input to record"
      >
        {devices.length === 0 && <option value="">No audio inputs found</option>}
        {devices.map((d, i) => (
          <option key={d.deviceId || i} value={d.deviceId}>
            {d.label || `Audio input ${i + 1}`}
          </option>
        ))}
      </select>

      {!recording ? (
        <button className="recorder-btn recorder-btn-start" onClick={start}>● Record</button>
      ) : (
        <button className="recorder-btn recorder-btn-stop" onClick={stop}>■ Stop</button>
      )}

      {error && <div className="recorder-error">{error}</div>}

      {clipUrl && !recording && (
        <div className="recorder-clip">
          <audio controls src={clipUrl} />
          <a className="recorder-download" href={clipUrl} download={`the-tightening-${timestamp()}.wav`}>
            Download WAV
          </a>
        </div>
      )}
    </div>
  );
}

function timestamp(): string {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
}

/** Encode per-channel Float32 chunk lists into a 16-bit PCM WAV (interleaved). */
function encodeWav(channelChunks: Float32Array[][], sampleRate: number): ArrayBuffer {
  const numChannels = channelChunks.length;
  const channels = channelChunks.map(flatten);
  const numFrames = channels[0].length;
  const bytesPerSample = 2;
  const blockAlign = numChannels * bytesPerSample;
  const dataSize = numFrames * blockAlign;

  const buffer = new ArrayBuffer(44 + dataSize);
  const view = new DataView(buffer);
  const writeStr = (offset: number, s: string) => {
    for (let i = 0; i < s.length; i++) view.setUint8(offset + i, s.charCodeAt(i));
  };

  writeStr(0, 'RIFF');
  view.setUint32(4, 36 + dataSize, true);
  writeStr(8, 'WAVE');
  writeStr(12, 'fmt ');
  view.setUint32(16, 16, true);          // PCM chunk size
  view.setUint16(20, 1, true);           // format = PCM
  view.setUint16(22, numChannels, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * blockAlign, true); // byte rate
  view.setUint16(32, blockAlign, true);
  view.setUint16(34, 8 * bytesPerSample, true);      // bits per sample
  writeStr(36, 'data');
  view.setUint32(40, dataSize, true);

  let offset = 44;
  for (let i = 0; i < numFrames; i++) {
    for (let c = 0; c < numChannels; c++) {
      const sample = Math.max(-1, Math.min(1, channels[c][i]));
      view.setInt16(offset, sample < 0 ? sample * 0x8000 : sample * 0x7fff, true);
      offset += 2;
    }
  }
  return buffer;
}

function flatten(chunks: Float32Array[]): Float32Array {
  let total = 0;
  for (const c of chunks) total += c.length;
  const out = new Float32Array(total);
  let o = 0;
  for (const c of chunks) { out.set(c, o); o += c.length; }
  return out;
}
