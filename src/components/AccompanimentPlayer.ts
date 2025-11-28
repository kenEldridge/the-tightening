/**
 * Accompaniment Player
 *
 * Plays chord accompaniment (bass + chord voicings) using SplendidGrandPiano.
 * The USER supplies the melody - accompaniment just provides harmonic support.
 *
 * This solves the "playing along sounds bad" problem:
 * - Old approach: Reference plays melody, user plays melody = interference
 * - New approach: Reference plays chords, user plays melody = complete music
 */

import * as Tone from 'tone';
import { SplendidGrandPiano } from 'smplr';
import type { AppConfig } from '../config/AppConfig';
import type { SongData, SongSegment } from '../utils/midiParser';
import { getChordProgression, getChordVoicing, type ChordEvent } from '../data/chordProgressions';

export class AccompanimentPlayer {
  private piano: SplendidGrandPiano | null = null;
  private bassPart: Tone.Part | null = null;
  private chordPart: Tone.Part | null = null;
  private config: AppConfig;
  private currentVolume: number;
  private initialized = false;
  private currentSegment: SongSegment | null = null;
  private isSegmentLoopEnabled = false;
  private songDuration = 0;
  private currentSongId: string = '';
  private audioContext: AudioContext | null = null;

  constructor(config: AppConfig) {
    this.config = config;
    this.currentVolume = config.referenceMelody.initialVolume;
  }

  /**
   * Initialize the accompaniment piano
   */
  async initialize(): Promise<void> {
    if (this.initialized) return;

    const startTime = Date.now();
    console.info('[Accompaniment] Initializing with SplendidGrandPiano...');

    await Tone.start();

    // Get the raw AudioContext from Tone.js
    this.audioContext = Tone.context.rawContext as AudioContext;

    // Create SplendidGrandPiano for accompaniment
    console.log('[Accompaniment] Loading SplendidGrandPiano samples...');
    this.piano = new SplendidGrandPiano(this.audioContext, {
      decayTime: 1.2,  // Longer decay for accompaniment chords
    });

    await this.piano.load;

    const loadTime = Date.now() - startTime;
    console.info('[Accompaniment] SplendidGrandPiano loaded', {
      loadTimeMs: loadTime
    });

    this.initialized = true;
    console.info('[Accompaniment] AccompanimentPlayer initialization complete');
  }

  /**
   * Load a song and prepare accompaniment for playback
   */
  loadSong(songData: SongData): void {
    if (!this.initialized || !this.piano) {
      console.warn('[Accompaniment] Cannot load song: AccompanimentPlayer not initialized');
      return;
    }

    // Extract song ID from name (e.g., "Canon in D" -> "canon-in-d")
    this.currentSongId = songData.name.toLowerCase().replace(/\s+/g, '-');

    console.info('[Accompaniment] Loading song accompaniment', {
      name: songData.name,
      songId: this.currentSongId,
      tempo: songData.tempo,
      duration: songData.duration.toFixed(2)
    });

    // Stop and dispose existing parts
    this.stop();
    if (this.bassPart) this.bassPart.dispose();
    if (this.chordPart) this.chordPart.dispose();

    // Get chord progression for this song
    const chords = getChordProgression(this.currentSongId);
    if (!chords) {
      console.warn('[Accompaniment] No chord progression found for song, using fallback', {
        songId: this.currentSongId
      });
      return;
    }

    // Store reference to piano for closures
    const piano = this.piano;
    const getVolume = () => this.currentVolume;
    const isEnabled = () => this.config.referenceMelody.enabled;

    // Create bass events
    const bassEvents = chords.map((chord: ChordEvent) => {
      const voicing = getChordVoicing(chord.chord);
      if (!voicing) return null;
      return {
        time: chord.time,
        note: voicing.bass,
        duration: chord.duration * 0.9,
        velocity: 0.6,
      };
    }).filter(Boolean);

    // Create chord events
    const chordEvents = chords.map((chord: ChordEvent) => {
      const voicing = getChordVoicing(chord.chord);
      if (!voicing) return null;
      return {
        time: chord.time + 0.05,
        notes: voicing.notes,
        duration: chord.duration * 0.8,
        velocity: 0.4,
      };
    }).filter(Boolean);

    // Create bass part
    this.bassPart = new Tone.Part((time, event) => {
      if (piano && isEnabled()) {
        // Calculate velocity based on current volume
        const velocity = Math.round(event.velocity * 127 * getVolume() * 0.8);

        // Use Tone.Draw for visual sync, but schedule audio immediately
        piano.start({
          note: event.note,
          velocity,
          duration: event.duration,
          time: time,
        });
      }
    }, bassEvents);

    // Create chord part
    this.chordPart = new Tone.Part((time, event) => {
      if (piano && isEnabled()) {
        const velocity = Math.round(event.velocity * 127 * getVolume() * 0.5);

        // Play all chord tones simultaneously
        event.notes.forEach((note: number) => {
          piano.start({
            note,
            velocity,
            duration: event.duration,
            time: time,
          });
        });
      }
    }, chordEvents);

    // Configure looping
    this.bassPart.loop = true;
    this.bassPart.loopStart = 0;
    this.bassPart.loopEnd = songData.duration - 0.001;

    this.chordPart.loop = true;
    this.chordPart.loopStart = 0;
    this.chordPart.loopEnd = songData.duration - 0.001;

    this.songDuration = songData.duration;
    this.currentSegment = null;
    this.isSegmentLoopEnabled = false;

    console.log('[Accompaniment] Accompaniment loaded', {
      bassEvents: bassEvents.length,
      chordEvents: chordEvents.length,
      loopEnd: songData.duration - 0.001
    });
  }

  /**
   * Start playback
   */
  start(): void {
    if (!this.bassPart || !this.chordPart) {
      console.warn('[Accompaniment] Cannot start: no song loaded');
      return;
    }

    console.info('[Accompaniment] Starting accompaniment', {
      transportState: Tone.Transport.state,
      transportSeconds: Tone.Transport.seconds
    });

    // Reset Transport to beginning
    Tone.Transport.seconds = 0;

    // Start Parts at beginning
    this.bassPart.start(0);
    this.chordPart.start(0);

    // Start Transport if not already started
    if (Tone.Transport.state !== 'started') {
      Tone.Transport.start();
    }

    console.log('[Accompaniment] Accompaniment started', {
      transportState: Tone.Transport.state
    });
  }

  /**
   * Stop playback
   */
  stop(): void {
    console.info('[Accompaniment] Stopping accompaniment');

    if (this.bassPart) this.bassPart.stop();
    if (this.chordPart) this.chordPart.stop();

    if (this.piano) {
      this.piano.stop();
    }

    if (Tone.Transport.state !== 'stopped') {
      Tone.Transport.stop();
    }

    Tone.Transport.seconds = 0;
  }

  /**
   * Pause playback
   */
  pause(): void {
    if (Tone.Transport.state === 'started') {
      console.info('[Accompaniment] Pausing accompaniment');
      Tone.Transport.pause();
    }
  }

  /**
   * Resume playback
   */
  resume(): void {
    if (Tone.Transport.state === 'paused') {
      console.info('[Accompaniment] Resuming accompaniment');
      Tone.Transport.start();
    }
  }

  /**
   * Seek to a specific time
   */
  seek(timeInSeconds: number): void {
    console.log('[Accompaniment] Seeking', {
      from: Tone.Transport.seconds,
      to: timeInSeconds
    });
    Tone.Transport.seconds = timeInSeconds;
  }

  /**
   * Enable looping of a specific segment
   */
  setLoopSegment(segment: SongSegment | null): void {
    this.currentSegment = segment;

    if (!this.bassPart || !this.chordPart) return;

    if (segment) {
      this.bassPart.loopStart = segment.startTime;
      this.bassPart.loopEnd = segment.endTime - 0.001;
      this.chordPart.loopStart = segment.startTime;
      this.chordPart.loopEnd = segment.endTime - 0.001;
      this.isSegmentLoopEnabled = true;

      console.info('[Accompaniment] Segment loop enabled', {
        name: segment.name,
        start: segment.startTime,
        end: segment.endTime
      });

      if (Tone.Transport.state === 'started') {
        Tone.Transport.seconds = segment.startTime;
      }
    } else {
      this.bassPart.loopStart = 0;
      this.bassPart.loopEnd = this.songDuration - 0.001;
      this.chordPart.loopStart = 0;
      this.chordPart.loopEnd = this.songDuration - 0.001;
      this.isSegmentLoopEnabled = false;

      console.info('[Accompaniment] Segment loop disabled');
    }
  }

  /**
   * Get currently looping segment
   */
  getCurrentSegment(): SongSegment | null {
    return this.currentSegment;
  }

  /**
   * Check if segment loop is enabled
   */
  isLoopingSegment(): boolean {
    return this.isSegmentLoopEnabled;
  }

  /**
   * Fade volume based on user accuracy
   * As user improves, accompaniment can get quieter (optional)
   */
  fadeBasedOnAccuracy(accuracy: number): void {
    if (!this.config.referenceMelody.enabled) return;

    const targetVolume = this.config.referenceMelody.initialVolume * (1 - accuracy * 0.3);
    this.currentVolume = Math.max(this.config.referenceMelody.minVolume, targetVolume);

    if (this.config.referenceMelody.manualVolumeOverride !== null) {
      this.currentVolume = this.config.referenceMelody.manualVolumeOverride;
    }
  }

  /**
   * Set volume manually
   */
  setVolume(volume: number): void {
    this.currentVolume = Math.max(0, Math.min(1, volume));
    console.info('[Accompaniment] Volume set', {
      volume: this.currentVolume.toFixed(2)
    });
  }

  /**
   * Get current volume
   */
  getVolume(): number {
    return this.currentVolume;
  }

  /**
   * Set tempo
   */
  setTempo(bpm: number): void {
    Tone.Transport.bpm.value = bpm;
    console.info('[Accompaniment] Tempo set', { bpm });
  }

  /**
   * Get current playback time
   */
  getCurrentTime(): number {
    return Tone.Transport.seconds;
  }

  /**
   * Update configuration
   */
  updateConfig(config: AppConfig): void {
    this.config = config;
  }

  /**
   * Clean up resources
   */
  dispose(): void {
    this.stop();

    if (this.bassPart) {
      this.bassPart.dispose();
      this.bassPart = null;
    }
    if (this.chordPart) {
      this.chordPart.dispose();
      this.chordPart = null;
    }
    if (this.piano) {
      this.piano.stop();
      this.piano = null;
    }

    this.audioContext = null;
    this.initialized = false;
  }
}
