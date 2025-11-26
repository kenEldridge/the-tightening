/**
 * Reference Melody Player
 *
 * Plays the reference melody in the background
 * Fades out as user learns (based on accuracy)
 * Uses different timbre from user's piano
 */

import * as Tone from 'tone';
import type { AppConfig } from '../config/AppConfig';
import type { SongData, MelodyNote } from '../utils/midiParser';

export class ReferenceMelodyPlayer {
  private synth: Tone.Synth | null = null;
  private part: Tone.Part | null = null;
  private config: AppConfig;
  private currentVolume: number;
  private initialized = false;

  constructor(config: AppConfig) {
    this.config = config;
    this.currentVolume = config.referenceMelody.initialVolume;
  }

  /**
   * Initialize the reference melody synthesizer
   */
  async initialize(): Promise<void> {
    if (this.initialized) return;

    await Tone.start();

    // Create synthesizer with different timbre than user's piano
    this.synth = this.createInstrument(this.config.referenceMelody.instrument);
    this.initialized = true;
  }

  /**
   * Create the appropriate instrument based on config
   */
  private createInstrument(instrument: string): Tone.Synth {
    const baseOptions = {
      volume: Tone.gainToDb(this.currentVolume),
    };

    switch (instrument) {
      case 'music-box':
        return new Tone.Synth({
          ...baseOptions,
          oscillator: {
            type: 'sine',
          },
          envelope: {
            attack: 0.001,
            decay: 0.2,
            sustain: 0,
            release: 0.3,
          },
        }).toDestination();

      case 'soft-piano':
        return new Tone.Synth({
          ...baseOptions,
          oscillator: {
            type: 'triangle',
          },
          envelope: {
            attack: 0.01,
            decay: 0.3,
            sustain: 0.2,
            release: 1.5,
          },
        }).toDestination();

      case 'synth-pad':
        return new Tone.Synth({
          ...baseOptions,
          oscillator: {
            type: 'sawtooth',
          },
          envelope: {
            attack: 0.3,
            decay: 0.5,
            sustain: 0.7,
            release: 2,
          },
        }).toDestination();

      default:
        return new Tone.Synth(baseOptions).toDestination();
    }
  }

  /**
   * Load a song and prepare it for playback
   */
  loadSong(songData: SongData): void {
    if (!this.initialized || !this.synth) {
      console.warn('ReferenceMelodyPlayer not initialized');
      return;
    }

    // Stop and dispose existing part
    this.stop();
    if (this.part) {
      this.part.dispose();
    }

    // Create Tone.Part from melody notes
    const events = songData.notes.map((note: MelodyNote) => ({
      time: note.time,
      note: Tone.Frequency(note.midi, 'midi').toNote(),
      duration: note.duration,
    }));

    this.part = new Tone.Part((time, event) => {
      if (this.synth && this.config.referenceMelody.enabled) {
        this.synth.triggerAttackRelease(event.note, event.duration, time);
      }
    }, events);

    this.part.loop = true;
    this.part.loopEnd = songData.duration;
  }

  /**
   * Start playback
   */
  start(): void {
    if (this.part) {
      Tone.Transport.start();
      this.part.start(0);
    }
  }

  /**
   * Stop playback
   */
  stop(): void {
    if (this.part) {
      this.part.stop();
    }
    Tone.Transport.stop();
  }

  /**
   * Pause playback
   */
  pause(): void {
    Tone.Transport.pause();
  }

  /**
   * Resume playback
   */
  resume(): void {
    Tone.Transport.start();
  }

  /**
   * Seek to a specific time
   */
  seek(timeInSeconds: number): void {
    Tone.Transport.seconds = timeInSeconds;
  }

  /**
   * Fade volume based on user accuracy
   * Called by ProgressTracker
   *
   * @param accuracy - Average user accuracy (0-1)
   */
  fadeBasedOnAccuracy(accuracy: number): void {
    if (!this.config.referenceMelody.enabled) return;

    // Calculate target volume based on accuracy
    // Higher accuracy = lower reference melody volume
    const targetVolume = this.config.referenceMelody.initialVolume * (1 - accuracy);

    // Apply minimum volume
    this.currentVolume = Math.max(
      this.config.referenceMelody.minVolume,
      targetVolume
    );

    // Apply manual override if set
    if (this.config.referenceMelody.manualVolumeOverride !== null) {
      this.currentVolume = this.config.referenceMelody.manualVolumeOverride;
    }

    // Update synth volume
    if (this.synth) {
      this.synth.volume.value = Tone.gainToDb(this.currentVolume);
    }
  }

  /**
   * Set volume manually
   */
  setVolume(volume: number): void {
    this.currentVolume = Math.max(0, Math.min(1, volume));
    if (this.synth) {
      this.synth.volume.value = Tone.gainToDb(this.currentVolume);
    }
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

    // If instrument changed, recreate synth
    if (this.synth && this.initialized) {
      const currentVolume = this.currentVolume;
      this.synth.dispose();
      this.synth = this.createInstrument(config.referenceMelody.instrument);
      this.setVolume(currentVolume);
    }
  }

  /**
   * Clean up resources
   */
  dispose(): void {
    this.stop();

    if (this.part) {
      this.part.dispose();
      this.part = null;
    }

    if (this.synth) {
      this.synth.dispose();
      this.synth = null;
    }

    this.initialized = false;
  }
}
