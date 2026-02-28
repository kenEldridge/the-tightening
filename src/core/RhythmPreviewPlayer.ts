/**
 * Rhythm Preview Player
 *
 * Dual-source playback for the rhythm trainer timeline view:
 * - "generated" mode: plays chords + bass from ChordTimelineArtifact via smplr piano
 * - "source" mode: plays the original normalized WAV audio
 *
 * A/B toggle preserves cursor position. Shared time update callback
 * drives UI chord highlighting and transport display.
 */

import * as Tone from 'tone';
import { SplendidGrandPiano } from 'smplr';
import type { ChordTimelineArtifact, ChordEvent } from './rhythmTypes';
import { CHORD_VOICINGS } from '../data/chordProgressions';

export type PreviewMode = 'generated' | 'source';

export interface HearItState {
  mode: PreviewMode;
  playing: boolean;
  currentTime: number;
  duration: number;
  activeChordId: string | null;
  loopRange: { startTime: number; endTime: number } | null;
  skippedChords: number;
}

type TimeUpdateCallback = (state: HearItState) => void;

export class RhythmPreviewPlayer {
  // Generated playback (Tone.js + smplr)
  private piano: SplendidGrandPiano | null = null;
  private bassPart: Tone.Part | null = null;
  private chordPart: Tone.Part | null = null;
  private audioContext: AudioContext | null = null;
  private initialized = false;

  // Source playback (HTMLAudioElement)
  private sourceAudio: HTMLAudioElement | null = null;
  private sourceBlobUrl: string | null = null;

  // Timeline data
  private timeline: ChordTimelineArtifact | null = null;

  // State
  private mode: PreviewMode = 'generated';
  private playing = false;
  private loopRange: { startTime: number; endTime: number } | null = null;
  private duration = 0;
  private skippedChords = 0;

  // Time update polling
  private timeUpdateCallback: TimeUpdateCallback | null = null;
  private pollTimer: number | null = null;

  // ============================================
  // Initialization
  // ============================================

  async initialize(): Promise<void> {
    if (this.initialized) return;

    await Tone.start();
    this.audioContext = Tone.context.rawContext as AudioContext;

    this.piano = new SplendidGrandPiano(this.audioContext, {
      decayTime: 1.0,
    });
    await this.piano.load;

    this.initialized = true;
    console.log('[RhythmPreview] Initialized');
  }

  // ============================================
  // Load Timeline (Generated Mode)
  // ============================================

  async loadTimeline(timeline: ChordTimelineArtifact): Promise<void> {
    if (!this.initialized) await this.initialize();

    this.stop();
    this.disposeGeneratedParts();

    this.timeline = timeline;

    const piano = this.piano!;
    const chords = timeline.chords;
    const beats = timeline.beatGrid.beats;
    const beatDuration = 60 / timeline.beatGrid.tempo;
    const beatsPerBar = timeline.beatGrid.timeSignature.numerator;

    // Build rhythmic events by placing bass and chord hits on beats within each chord span
    // Pattern: beat 1 = bass + chord, beat 3 = bass (in 4/4); beats 2,4 = chord stab
    const bassEvents: Array<{ time: number; note: number; duration: number; velocity: number }> = [];
    const chordEvents: Array<{ time: number; notes: number[]; duration: number; velocity: number }> = [];
    this.skippedChords = 0;

    for (const chord of chords) {
      const voicing = chord.voicing || lookupVoicing(chord.symbol);
      if (!voicing) {
        this.skippedChords++;
        continue;
      }

      // Find all beats that fall within this chord's time range
      const chordBeats = beats.filter(b => b.time >= chord.startTime && b.time < chord.endTime);

      if (chordBeats.length === 0) {
        // Fallback: generate beats from chord timing if beat grid doesn't cover this range
        const numBeats = Math.max(1, Math.round((chord.endTime - chord.startTime) / beatDuration));
        for (let i = 0; i < numBeats; i++) {
          chordBeats.push({
            time: chord.startTime + i * beatDuration,
            bar: chord.barStart,
            beatInBar: (i % beatsPerBar) + 1,
            tempoLocal: timeline.beatGrid.tempo,
            confidence: 0.5,
          });
        }
      }

      const noteDur = beatDuration * 0.8; // Each hit lasts 80% of a beat
      const hasStrength = chordBeats.some(b => b.strength != null);

      for (const beat of chordBeats) {
        if (!hasStrength) {
          // ---- Legacy fallback: no strength data, use original fixed pattern ----
          if (beat.beatInBar === 1) {
            bassEvents.push({ time: beat.time, note: voicing.bass, duration: noteDur * 1.5, velocity: 0.65 });
            chordEvents.push({ time: beat.time + 0.02, notes: voicing.notes, duration: noteDur, velocity: 0.45 });
          } else if (beatsPerBar >= 4 && beat.beatInBar === 3) {
            bassEvents.push({ time: beat.time, note: voicing.bass, duration: noteDur, velocity: 0.5 });
          } else {
            chordEvents.push({ time: beat.time, notes: voicing.notes, duration: noteDur * 0.6, velocity: 0.35 });
          }
          continue;
        }

        // ---- Onset-driven playback ----
        let s = beat.strength ?? 0;

        // Confidence-aware blending: degrade toward legacy values when confidence is low
        if (beat.confidence < 0.45) {
          const legacyVel = beat.beatInBar === 1 ? 0.65 : (beatsPerBar >= 4 && beat.beatInBar === 3 ? 0.5 : 0.35);
          s = 0.5 * s + 0.5 * legacyVel;
        }

        // Anti-noise floor: skip weak non-anchor beats
        if (s < 0.08 && beat.beatInBar !== 1) continue;

        // Velocity mapping (clamped)
        const bassVel = Math.max(0.25, Math.min(0.85, 0.30 + 0.45 * s));
        const chordVel = Math.max(0.15, Math.min(0.75, 0.18 + 0.42 * s));
        const stabDur = (0.45 + 0.40 * s) * beatDuration;

        if (beatsPerBar >= 4) {
          // ---- 4/4 meter rules ----
          if (beat.beatInBar === 1) {
            // Beat 1: always bass + chord
            bassEvents.push({ time: beat.time, note: voicing.bass, duration: noteDur * 1.5, velocity: bassVel });
            chordEvents.push({ time: beat.time + 0.02, notes: voicing.notes, duration: noteDur, velocity: chordVel });
          } else if (beat.beatInBar === 3) {
            // Beat 3: bass if strong enough, chord optional
            if (s >= 0.30) bassEvents.push({ time: beat.time, note: voicing.bass, duration: noteDur, velocity: bassVel });
            if (s >= 0.45) chordEvents.push({ time: beat.time + 0.02, notes: voicing.notes, duration: stabDur, velocity: chordVel });
          } else {
            // Beats 2, 4: chord if strong enough, bass only if very strong
            if (s >= 0.62) bassEvents.push({ time: beat.time, note: voicing.bass, duration: noteDur, velocity: bassVel * 0.8 });
            if (s >= 0.18) chordEvents.push({ time: beat.time, notes: voicing.notes, duration: stabDur, velocity: chordVel });
          }
        } else {
          // ---- 3/4 meter rules ----
          if (beat.beatInBar === 1) {
            // Beat 1: always bass + chord
            bassEvents.push({ time: beat.time, note: voicing.bass, duration: noteDur * 1.5, velocity: bassVel });
            chordEvents.push({ time: beat.time + 0.02, notes: voicing.notes, duration: noteDur, velocity: chordVel });
          } else {
            // Beats 2, 3: chord if strong enough, bass only for rare accents
            if (s >= 0.78) bassEvents.push({ time: beat.time, note: voicing.bass, duration: noteDur, velocity: bassVel * 0.7 });
            if (s >= 0.16) chordEvents.push({ time: beat.time, notes: voicing.notes, duration: stabDur, velocity: chordVel });
          }
        }
      }
    }

    // Create Tone.Part for bass
    this.bassPart = new Tone.Part((time, event) => {
      piano.start({
        note: event.note,
        velocity: Math.round(event.velocity * 127),
        duration: event.duration,
        time,
      });
    }, bassEvents);

    // Create Tone.Part for chords
    this.chordPart = new Tone.Part((time, event) => {
      for (const note of event.notes) {
        piano.start({
          note,
          velocity: Math.round(event.velocity * 127),
          duration: event.duration,
          time,
        });
      }
    }, chordEvents);

    // Compute duration from last chord end or beat grid
    const lastChordEnd = chords.length > 0 ? chords[chords.length - 1].endTime : 0;
    const lastBeatTime = beats.length > 0 ? beats[beats.length - 1].time : 0;
    this.duration = Math.max(lastChordEnd, lastBeatTime + 1);

    // Configure looping on generated parts
    this.bassPart.loop = false;
    this.chordPart.loop = false;

    console.log('[RhythmPreview] Timeline loaded', {
      chords: chords.length,
      skippedChords: this.skippedChords,
      bassEvents: bassEvents.length,
      chordEvents: chordEvents.length,
      duration: this.duration.toFixed(1),
      tempo: timeline.beatGrid.tempo,
    });
  }

  // ============================================
  // Load Source Audio
  // ============================================

  async loadSourceAudio(audioPath: string): Promise<void> {
    // Clean up old source
    this.disposeSourceAudio();

    if (!window.electronAPI?.readAudioFile) {
      console.warn('[RhythmPreview] readAudioFile not available');
      return;
    }

    const base64 = await window.electronAPI.readAudioFile(audioPath);
    if (!base64) {
      console.warn('[RhythmPreview] Failed to read source audio');
      return;
    }

    // Convert base64 to blob URL
    const binary = atob(base64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) {
      bytes[i] = binary.charCodeAt(i);
    }
    const blob = new Blob([bytes], { type: 'audio/wav' });
    this.sourceBlobUrl = URL.createObjectURL(blob);

    this.sourceAudio = new Audio(this.sourceBlobUrl);
    this.sourceAudio.preload = 'auto';

    // Update duration from source if it's longer
    this.sourceAudio.addEventListener('loadedmetadata', () => {
      if (this.sourceAudio && this.sourceAudio.duration > this.duration) {
        this.duration = this.sourceAudio.duration;
      }
    });

    // Handle source reaching end
    this.sourceAudio.addEventListener('ended', () => {
      if (this.loopRange && this.playing) {
        this.seekTo(this.loopRange.startTime);
        this.sourceAudio?.play();
      } else {
        this.playing = false;
        this.emitState();
        this.stopPolling();
      }
    });

    console.log('[RhythmPreview] Source audio loaded');
  }

  // ============================================
  // Mode Control
  // ============================================

  setMode(newMode: PreviewMode): void {
    if (newMode === this.mode) return;

    const wasPlaying = this.playing;
    const currentTime = this.getCurrentTime();

    // Stop current mode
    if (wasPlaying) this.pauseInternal();

    this.mode = newMode;

    // Seek new mode to same position
    this.seekTo(currentTime);

    // Resume if was playing
    if (wasPlaying) this.playInternal();

    console.log('[RhythmPreview] Mode switched', { mode: newMode, time: currentTime.toFixed(2) });
    this.emitState();
  }

  getMode(): PreviewMode {
    return this.mode;
  }

  // ============================================
  // Transport
  // ============================================

  async play(): Promise<void> {
    if (this.playing) return;
    if (!this.initialized) await this.initialize();

    this.playing = true;
    this.playInternal();
    this.startPolling();
    this.emitState();
  }

  pause(): void {
    if (!this.playing) return;

    this.playing = false;
    this.pauseInternal();
    this.stopPolling();
    this.emitState();
  }

  stop(): void {
    this.playing = false;
    this.stopInternal();
    this.stopPolling();
    this.emitState();
  }

  seekTo(time: number): void {
    const clampedTime = Math.max(0, Math.min(time, this.duration));

    // Seek generated transport
    Tone.Transport.seconds = clampedTime;

    // Seek source audio
    if (this.sourceAudio) {
      this.sourceAudio.currentTime = clampedTime;
    }

    this.emitState();
  }

  // ============================================
  // Loop
  // ============================================

  setLoop(range: { startTime: number; endTime: number } | null): void {
    this.loopRange = range;

    if (range) {
      // Configure generated loop
      Tone.Transport.loop = true;
      Tone.Transport.loopStart = range.startTime;
      Tone.Transport.loopEnd = range.endTime;
    } else {
      Tone.Transport.loop = false;
    }

    console.log('[RhythmPreview] Loop', range ? `${range.startTime.toFixed(1)}-${range.endTime.toFixed(1)}s` : 'off');
    this.emitState();
  }

  setLoopBars(startBar: number, endBar: number): void {
    if (!this.timeline) return;

    const beats = this.timeline.beatGrid.beats;
    const startBeat = beats.find(b => b.bar === startBar && b.beatInBar === 1);
    const endBeat = beats.find(b => b.bar === endBar + 1 && b.beatInBar === 1);

    if (!startBeat) return;

    const startTime = startBeat.time;
    const endTime = endBeat
      ? endBeat.time
      : startBeat.time + (endBar - startBar + 1) * this.timeline.beatGrid.timeSignature.numerator * (60 / this.timeline.beatGrid.tempo);

    this.setLoop({ startTime, endTime });
  }

  // ============================================
  // Time / State
  // ============================================

  getCurrentTime(): number {
    if (this.mode === 'source' && this.sourceAudio) {
      return this.sourceAudio.currentTime;
    }
    return Tone.Transport.seconds;
  }

  getDuration(): number {
    return this.duration;
  }

  isPlaying(): boolean {
    return this.playing;
  }

  getActiveChord(): ChordEvent | null {
    if (!this.timeline) return null;
    const time = this.getCurrentTime();
    return this.timeline.chords.find(c => time >= c.startTime && time < c.endTime) || null;
  }

  getState(): HearItState {
    const activeChord = this.getActiveChord();
    return {
      mode: this.mode,
      playing: this.playing,
      currentTime: this.getCurrentTime(),
      duration: this.duration,
      activeChordId: activeChord?.id || null,
      loopRange: this.loopRange,
      skippedChords: this.skippedChords,
    };
  }

  // ============================================
  // Callbacks
  // ============================================

  onTimeUpdate(callback: TimeUpdateCallback): void {
    this.timeUpdateCallback = callback;
  }

  removeTimeUpdateCallback(): void {
    this.timeUpdateCallback = null;
  }

  // ============================================
  // Internal
  // ============================================

  private playInternal(): void {
    if (this.mode === 'generated') {
      if (this.bassPart) this.bassPart.start(0);
      if (this.chordPart) this.chordPart.start(0);
      if (Tone.Transport.state !== 'started') {
        Tone.Transport.start();
      }
    } else {
      this.sourceAudio?.play();
    }
  }

  private pauseInternal(): void {
    if (this.mode === 'generated') {
      if (Tone.Transport.state === 'started') {
        Tone.Transport.pause();
      }
    } else {
      this.sourceAudio?.pause();
    }
  }

  private stopInternal(): void {
    // Stop generated
    if (this.bassPart) this.bassPart.stop();
    if (this.chordPart) this.chordPart.stop();
    if (this.piano) this.piano.stop();
    if (Tone.Transport.state !== 'stopped') {
      Tone.Transport.stop();
    }
    Tone.Transport.seconds = 0;

    // Stop source
    if (this.sourceAudio) {
      this.sourceAudio.pause();
      this.sourceAudio.currentTime = 0;
    }
  }

  private startPolling(): void {
    this.stopPolling();
    const poll = () => {
      this.emitState();

      // Handle source audio loop (Transport handles generated loop natively)
      if (this.mode === 'source' && this.loopRange && this.sourceAudio && this.playing) {
        if (this.sourceAudio.currentTime >= this.loopRange.endTime) {
          this.sourceAudio.currentTime = this.loopRange.startTime;
        }
      }

      if (this.playing) {
        this.pollTimer = requestAnimationFrame(poll);
      }
    };
    this.pollTimer = requestAnimationFrame(poll);
  }

  private stopPolling(): void {
    if (this.pollTimer !== null) {
      cancelAnimationFrame(this.pollTimer);
      this.pollTimer = null;
    }
  }

  private emitState(): void {
    this.timeUpdateCallback?.(this.getState());
  }

  // ============================================
  // Cleanup
  // ============================================

  private disposeGeneratedParts(): void {
    if (this.bassPart) {
      this.bassPart.stop();
      this.bassPart.dispose();
      this.bassPart = null;
    }
    if (this.chordPart) {
      this.chordPart.stop();
      this.chordPart.dispose();
      this.chordPart = null;
    }
  }

  private disposeSourceAudio(): void {
    if (this.sourceAudio) {
      this.sourceAudio.pause();
      this.sourceAudio.src = '';
      this.sourceAudio = null;
    }
    if (this.sourceBlobUrl) {
      URL.revokeObjectURL(this.sourceBlobUrl);
      this.sourceBlobUrl = null;
    }
  }

  dispose(): void {
    this.stop();
    this.stopPolling();
    this.removeTimeUpdateCallback();
    this.disposeGeneratedParts();
    this.disposeSourceAudio();

    if (this.piano) {
      this.piano.stop();
      this.piano = null;
    }

    this.audioContext = null;
    this.timeline = null;
    this.initialized = false;

    console.log('[RhythmPreview] Disposed');
  }
}

// ============================================
// Helpers
// ============================================

const NOTE_TO_SEMITONE: Record<string, number> = {
  'C': 0, 'C#': 1, 'Db': 1, 'D': 2, 'D#': 3, 'Eb': 3,
  'E': 4, 'Fb': 4, 'E#': 5, 'F': 5, 'F#': 6, 'Gb': 6,
  'G': 7, 'G#': 8, 'Ab': 8, 'A': 9, 'A#': 10, 'Bb': 10,
  'B': 11, 'Cb': 11,
};

const SHARP_TO_FLAT: Record<string, string> = {
  'C#': 'Db', 'D#': 'Eb', 'F#': 'F#', 'G#': 'Ab', 'A#': 'Bb',
};
const FLAT_TO_SHARP: Record<string, string> = {
  'Db': 'C#', 'Eb': 'D#', 'Gb': 'F#', 'Ab': 'G#', 'Bb': 'A#',
};

function lookupVoicing(symbol: string): { bass: number; notes: number[] } | null {
  // Direct lookup
  let v = CHORD_VOICINGS[symbol];
  if (v) return { bass: v.bass, notes: [...v.notes] };

  // Try sharp↔flat conversion
  const isMinor = symbol.endsWith('m') && !symbol.endsWith('dim');
  const is7 = symbol.endsWith('7');
  const suffix = is7 ? '7' : isMinor ? 'm' : '';
  const root = symbol.slice(0, symbol.length - suffix.length);

  // Try alternate spelling
  const alt = FLAT_TO_SHARP[root] || SHARP_TO_FLAT[root];
  if (alt) {
    v = CHORD_VOICINGS[alt + suffix];
    if (v) return { bass: v.bass, notes: [...v.notes] };
  }

  // Generate from root semitone if we know the root
  const semitone = NOTE_TO_SEMITONE[root];
  if (semitone === undefined) return null;

  // Bass in octave 2 (MIDI = 36 + semitone)
  const bass = 36 + semitone;
  // Chord in octave 3 (MIDI = 48 + semitone)
  const rootMidi = 48 + semitone;

  if (is7) {
    return { bass, notes: [rootMidi, rootMidi + 4, rootMidi + 7, rootMidi + 10] };
  } else if (isMinor) {
    return { bass, notes: [rootMidi, rootMidi + 3, rootMidi + 7] };
  } else {
    return { bass, notes: [rootMidi, rootMidi + 4, rootMidi + 7] };
  }
}
