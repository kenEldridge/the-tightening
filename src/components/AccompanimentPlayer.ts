/**
 * Accompaniment Player
 *
 * Plays chord accompaniment (bass + chord voicings) instead of melody.
 * The USER supplies the melody - accompaniment just provides harmonic support.
 *
 * This solves the "playing along sounds bad" problem:
 * - Old approach: Reference plays melody, user plays melody = interference
 * - New approach: Reference plays chords, user plays melody = complete music
 */

import * as Tone from 'tone';
import type { AppConfig } from '../config/AppConfig';
import type { SongData, SongSegment } from '../utils/midiParser';
import { getChordProgression, getChordVoicing, type ChordEvent } from '../data/chordProgressions';

export class AccompanimentPlayer {
  private bassSampler: Tone.Sampler | null = null;
  private chordSampler: Tone.Sampler | null = null;
  private bassPart: Tone.Part | null = null;
  private chordPart: Tone.Part | null = null;
  private config: AppConfig;
  private currentVolume: number;
  private initialized = false;
  private currentSegment: SongSegment | null = null;
  private isSegmentLoopEnabled = false;
  private songDuration = 0;
  private currentSongId: string = '';

  constructor(config: AppConfig) {
    this.config = config;
    this.currentVolume = config.referenceMelody.initialVolume;
  }

  /**
   * Initialize the accompaniment samplers
   */
  async initialize(): Promise<void> {
    if (this.initialized) return;

    const startTime = Date.now();
    console.info('[Accompaniment] Initializing AccompanimentPlayer...');

    await Tone.start();

    // Sample URLs (same Salamander piano for consistency)
    const sampleUrls = {
      A0: "A0.mp3",
      C1: "C1.mp3",
      "D#1": "Ds1.mp3",
      "F#1": "Fs1.mp3",
      A1: "A1.mp3",
      C2: "C2.mp3",
      "D#2": "Ds2.mp3",
      "F#2": "Fs2.mp3",
      A2: "A2.mp3",
      C3: "C3.mp3",
      "D#3": "Ds3.mp3",
      "F#3": "Fs3.mp3",
      A3: "A3.mp3",
      C4: "C4.mp3",
      "D#4": "Ds4.mp3",
      "F#4": "Fs4.mp3",
      A4: "A4.mp3",
      C5: "C5.mp3",
      "D#5": "Ds5.mp3",
      "F#5": "Fs5.mp3",
      A5: "A5.mp3",
      C6: "C6.mp3",
      "D#6": "Ds6.mp3",
      "F#6": "Fs6.mp3",
      A6: "A6.mp3",
      C7: "C7.mp3",
      "D#7": "Ds7.mp3",
      "F#7": "Fs7.mp3",
      A7: "A7.mp3",
      C8: "C8.mp3"
    };
    const baseUrl = "https://tonejs.github.io/audio/salamander/";

    // Create bass sampler (slightly louder for foundation)
    console.log('[Accompaniment] Loading bass sampler...');
    await new Promise<void>((resolve, reject) => {
      this.bassSampler = new Tone.Sampler({
        urls: sampleUrls,
        baseUrl,
        release: 1.5,  // Longer release for bass
        volume: Tone.gainToDb(this.currentVolume * 0.8),  // Bass at 80% of main volume
        onload: () => {
          console.info('[Accompaniment] Bass sampler loaded');
          resolve();
        },
        onerror: (err) => {
          console.error('[Accompaniment] Failed to load bass sampler', {
            error: err instanceof Error ? err.message : String(err)
          });
          reject(err);
        }
      }).toDestination();
    });

    // Create chord sampler (softer for background)
    console.log('[Accompaniment] Loading chord sampler...');
    await new Promise<void>((resolve, reject) => {
      this.chordSampler = new Tone.Sampler({
        urls: sampleUrls,
        baseUrl,
        release: 1,
        volume: Tone.gainToDb(this.currentVolume * 0.5),  // Chords at 50% of main volume
        onload: () => {
          const loadTime = Date.now() - startTime;
          console.info('[Accompaniment] Chord sampler loaded', {
            loadTimeMs: loadTime
          });
          resolve();
        },
        onerror: (err) => {
          console.error('[Accompaniment] Failed to load chord sampler', {
            error: err instanceof Error ? err.message : String(err)
          });
          reject(err);
        }
      }).toDestination();
    });

    this.initialized = true;
    console.info('[Accompaniment] AccompanimentPlayer initialization complete');
  }

  /**
   * Load a song and prepare accompaniment for playback
   */
  loadSong(songData: SongData): void {
    if (!this.initialized || !this.bassSampler || !this.chordSampler) {
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
      // Fallback: no accompaniment (user still plays melody)
      return;
    }

    // Create bass events
    const bassEvents = chords.map((chord: ChordEvent) => {
      const voicing = getChordVoicing(chord.chord);
      if (!voicing) return null;
      return {
        time: chord.time,
        note: Tone.Frequency(voicing.bass, 'midi').toNote(),
        duration: chord.duration * 0.9,  // Slightly shorter for separation
        velocity: 0.6,
      };
    }).filter(Boolean);

    // Create chord events
    const chordEvents = chords.map((chord: ChordEvent) => {
      const voicing = getChordVoicing(chord.chord);
      if (!voicing) return null;
      return {
        time: chord.time + 0.05,  // Slight delay after bass for clarity
        notes: voicing.notes.map(n => Tone.Frequency(n, 'midi').toNote()),
        duration: chord.duration * 0.8,
        velocity: 0.4,
      };
    }).filter(Boolean);

    // Create bass part
    this.bassPart = new Tone.Part((time, event) => {
      if (this.bassSampler && this.config.referenceMelody.enabled) {
        this.bassSampler.triggerAttackRelease(
          event.note,
          event.duration,
          time,
          event.velocity
        );
      }
    }, bassEvents);

    // Create chord part
    this.chordPart = new Tone.Part((time, event) => {
      if (this.chordSampler && this.config.referenceMelody.enabled) {
        // Play all chord tones simultaneously
        event.notes.forEach((note: string) => {
          this.chordSampler!.triggerAttackRelease(
            note,
            event.duration,
            time,
            event.velocity
          );
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

    if (this.bassSampler) {
      this.bassSampler.volume.value = Tone.gainToDb(this.currentVolume * 0.8);
    }
    if (this.chordSampler) {
      this.chordSampler.volume.value = Tone.gainToDb(this.currentVolume * 0.5);
    }
  }

  /**
   * Set volume manually
   */
  setVolume(volume: number): void {
    this.currentVolume = Math.max(0, Math.min(1, volume));

    if (this.bassSampler) {
      this.bassSampler.volume.value = Tone.gainToDb(this.currentVolume * 0.8);
    }
    if (this.chordSampler) {
      this.chordSampler.volume.value = Tone.gainToDb(this.currentVolume * 0.5);
    }

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
    if (this.bassSampler) {
      this.bassSampler.dispose();
      this.bassSampler = null;
    }
    if (this.chordSampler) {
      this.chordSampler.dispose();
      this.chordSampler = null;
    }

    this.initialized = false;
  }
}
