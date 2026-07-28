// A lightweight Web Audio sampler feeding off MIDI note on/off (the same choke
// point the chord detector uses, so both live MIDI and replay make sound).
//
// Three sound sources, selectable at runtime:
//   'synth'   — built-in oscillator, zero assets, always available
//   'builtin' — smplr's SplendidGrandPiano (streamed from CDN, then cached)
//   'samples' — an imported multisample library (see soundLibrary.ts)
//
// Imported samples may carry velocity layers; on note-on we pick the nearest
// sampled note and the layer whose velocity band contains the played velocity.

export type SoundSource = 'synth' | 'builtin' | 'samples';

export interface LoadedSample {
  /** Root MIDI note this sample was recorded at. */
  midi: number;
  /** Inclusive MIDI-velocity band (0..127) this layer covers. */
  velLo: number;
  velHi: number;
  buffer: AudioBuffer;
}

interface Voice {
  source: AudioBufferSourceNode | OscillatorNode;
  gain: GainNode;
  released: boolean;
}

const SAMPLE_RELEASE_SEC = 0.28;
const SYNTH_RELEASE_SEC = 0.12;

export class Sampler {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;

  private samples: LoadedSample[] = [];
  private byRoot = new Map<number, LoadedSample[]>(); // root midi -> layers
  private rootMidis: number[] = []; // sorted ascending
  private voices = new Map<number, Voice[]>();

  private _source: SoundSource = 'synth';
  private _enabled = true;
  private _volume = 0.7;
  instrumentName: string | null = null;

  private builtin: import('smplr').SplendidGrandPiano | null = null;
  private builtinLoading: Promise<void> | null = null;

  get source() {
    return this._source;
  }
  get enabled() {
    return this._enabled;
  }
  get volume() {
    return this._volume;
  }
  get hasSamples() {
    return this.samples.length > 0;
  }
  get builtinLoaded() {
    return !!this.builtin;
  }

  /** Lazily create the AudioContext so nothing spins up until first use. */
  private ensureCtx(): { ctx: AudioContext; master: GainNode } {
    if (!this.ctx || !this.master) {
      const ctx = new AudioContext();
      const master = ctx.createGain();
      master.gain.value = this._enabled ? this._volume : 0;
      master.connect(ctx.destination);
      this.ctx = ctx;
      this.master = master;
    }
    return { ctx: this.ctx, master: this.master };
  }

  /** Browsers start the context suspended; resume it on the first note/gesture. */
  resume() {
    const { ctx } = this.ensureCtx();
    if (ctx.state === 'suspended') void ctx.resume();
  }

  setSource(s: SoundSource) {
    if (s === this._source) return;
    this.allNotesOff();
    this._source = s;
  }

  setEnabled(v: boolean) {
    this._enabled = v;
    if (this.master && this.ctx) {
      this.master.gain.setTargetAtTime(v ? this._volume : 0, this.ctx.currentTime, 0.01);
    }
    if (!v) this.allNotesOff();
  }

  /** @param v master volume, 0..1 */
  setVolume(v: number) {
    this._volume = Math.max(0, Math.min(1, v));
    if (this.master && this.ctx && this._enabled) {
      this.master.gain.setTargetAtTime(this._volume, this.ctx.currentTime, 0.01);
    }
  }

  loadSamples(samples: LoadedSample[], name: string) {
    this.allNotesOff();
    this.samples = [...samples].sort((a, b) => a.midi - b.midi || a.velLo - b.velLo);
    this.byRoot = new Map();
    for (const s of this.samples) {
      const arr = this.byRoot.get(s.midi) ?? [];
      arr.push(s);
      this.byRoot.set(s.midi, arr);
    }
    this.rootMidis = [...this.byRoot.keys()].sort((a, b) => a - b);
    this.instrumentName = name;
  }

  clearSamples() {
    this.allNotesOff();
    this.samples = [];
    this.byRoot = new Map();
    this.rootMidis = [];
    this.instrumentName = null;
  }

  /** Decode raw WAV/FLAC/MP3/etc. bytes using this sampler's context. */
  decode(bytes: ArrayBuffer): Promise<AudioBuffer> {
    const { ctx } = this.ensureCtx();
    return ctx.decodeAudioData(bytes);
  }

  /** Load smplr's SplendidGrandPiano (idempotent; safe to await repeatedly). */
  async loadBuiltInPiano(onProgress?: (loaded: number, total: number) => void): Promise<void> {
    if (this.builtin) return;
    if (this.builtinLoading) return this.builtinLoading;
    const { ctx, master } = this.ensureCtx();
    if (ctx.state === 'suspended') void ctx.resume();
    this.builtinLoading = (async () => {
      const { SplendidGrandPiano } = await import('smplr');
      const piano = new SplendidGrandPiano(ctx, {
        destination: master,
        onLoadProgress: (p) => onProgress?.(p.loaded, p.total),
      });
      await piano.ready;
      this.builtin = piano;
    })();
    try {
      await this.builtinLoading;
    } finally {
      this.builtinLoading = null;
    }
  }

  private effectiveSource(): SoundSource {
    if (this._source === 'builtin' && this.builtin) return 'builtin';
    if (this._source === 'samples' && this.samples.length > 0) return 'samples';
    return 'synth';
  }

  noteOn(midi: number, velocity = 100) {
    if (!this._enabled) return;
    const { ctx, master } = this.ensureCtx();
    if (ctx.state === 'suspended') void ctx.resume();

    if (this.effectiveSource() === 'builtin') {
      this.builtin!.start({ note: midi, velocity });
      return;
    }

    // Piano keys are effectively monophonic per key — retriggering releases
    // the previous local voice quickly so repeated notes don't stack up.
    this.releaseNote(midi, true);

    const now = ctx.currentTime;
    const vol = Math.max(0, Math.min(1, velocity / 127));
    const gain = ctx.createGain();

    let source: AudioBufferSourceNode | OscillatorNode;
    if (this.effectiveSource() === 'samples') {
      const sample = this.nearestSample(midi, velocity);
      const src = ctx.createBufferSource();
      src.buffer = sample.buffer;
      src.detune.value = (midi - sample.midi) * 100; // 100 cents per semitone
      source = src;
      gain.gain.setValueAtTime(0, now);
      gain.gain.linearRampToValueAtTime(vol, now + 0.005);
    } else {
      const osc = ctx.createOscillator();
      osc.type = 'triangle';
      osc.frequency.value = midiToFreq(midi);
      source = osc;
      gain.gain.setValueAtTime(0, now);
      gain.gain.linearRampToValueAtTime(vol * 0.5, now + 0.01);
      gain.gain.linearRampToValueAtTime(vol * 0.32, now + 0.35); // gentle decay to sustain
    }

    source.connect(gain);
    gain.connect(master);
    source.start(now);

    const arr = this.voices.get(midi) ?? [];
    arr.push({ source, gain, released: false });
    this.voices.set(midi, arr);
  }

  noteOff(midi: number) {
    // Stop whichever source is holding the note. Both calls are safe no-ops if
    // that source isn't currently playing it, so this survives source switches.
    if (this.builtin) {
      try {
        this.builtin.stop(midi);
      } catch {
        /* noop */
      }
    }
    this.releaseNote(midi, false);
  }

  allNotesOff() {
    if (this.builtin) {
      try {
        this.builtin.stop();
      } catch {
        /* noop */
      }
    }
    for (const midi of Array.from(this.voices.keys())) this.releaseNote(midi, false);
  }

  private releaseNote(midi: number, fast: boolean) {
    const arr = this.voices.get(midi);
    if (!arr || arr.length === 0 || !this.ctx) return;
    const now = this.ctx.currentTime;
    const rel = fast ? 0.03 : this.samples.length > 0 ? SAMPLE_RELEASE_SEC : SYNTH_RELEASE_SEC;
    for (const v of arr) {
      if (v.released) continue;
      v.released = true;
      const g = v.gain.gain;
      g.cancelScheduledValues(now);
      g.setValueAtTime(g.value, now);
      g.linearRampToValueAtTime(0.0001, now + rel);
      try {
        v.source.stop(now + rel + 0.02);
      } catch {
        /* already stopped */
      }
      v.source.onended = () => {
        try {
          v.source.disconnect();
          v.gain.disconnect();
        } catch {
          /* noop */
        }
      };
    }
    this.voices.delete(midi);
  }

  /** Nearest sampled root note, then the velocity layer covering `velocity`. */
  private nearestSample(midi: number, velocity: number): LoadedSample {
    let root = this.rootMidis[0];
    let bestDist = Math.abs(root - midi);
    for (let i = 1; i < this.rootMidis.length; i++) {
      const d = Math.abs(this.rootMidis[i] - midi);
      if (d < bestDist) {
        bestDist = d;
        root = this.rootMidis[i];
      }
      if (this.rootMidis[i] >= midi) break;
    }
    const layers = this.byRoot.get(root)!;
    for (const l of layers) if (velocity >= l.velLo && velocity <= l.velHi) return l;
    return layers[layers.length - 1]; // velocity above all bands -> loudest
  }
}

function midiToFreq(m: number): number {
  return 440 * Math.pow(2, (m - 69) / 12);
}
