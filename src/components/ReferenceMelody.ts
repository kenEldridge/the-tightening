/**
 * Reference Melody Player
 *
 * Plays the reference melody in the background
 * Fades out as user learns (based on accuracy)
 * Uses different timbre from user's piano
 *
 * FUTURE OPTIMIZATION - Time Synchronization:
 * Currently App.tsx polls getCurrentTime() via setInterval (16ms lag).
 * For better audio-visual sync, consider adding callback support:
 * - Option 1: Add onTimeUpdate callback parameter to start()
 * - Option 2: Add registerTimeCallback() method
 * - Option 3: Use Transport.scheduleRepeat internally
 * See implementation plan for details.
 */

import * as Tone from 'tone';
import type { AppConfig } from '../config/AppConfig';
import type { SongData, MelodyNote } from '../utils/midiParser';

export class ReferenceMelodyPlayer {
  private sampler: Tone.Sampler | null = null;
  private part: Tone.Part | null = null;
  private config: AppConfig;
  private currentVolume: number;
  private initialized = false;

  constructor(config: AppConfig) {
    this.config = config;
    this.currentVolume = config.referenceMelody.initialVolume;
  }

  /**
   * Initialize the reference melody sampler
   */
  async initialize(): Promise<void> {
    if (this.initialized) return;

    await Tone.start();

    // Create sampler with same Salamander Grand Piano samples as user
    this.sampler = new Tone.Sampler({
      urls: {
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
      },
      baseUrl: "https://tonejs.github.io/audio/salamander/",
      release: 1,
      volume: Tone.gainToDb(this.currentVolume),
      onload: () => {
        console.log("✅ Reference piano samples loaded successfully");
      },
      onerror: (err) => {
        console.error("❌ Failed to load reference piano samples:", err);
      }
    }).toDestination();

    this.initialized = true;
  }

  /**
   * Load a song and prepare it for playback
   */
  loadSong(songData: SongData): void {
    if (!this.initialized || !this.sampler) {
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
      velocity: note.velocity || 0.8,
    }));

    this.part = new Tone.Part((time, event) => {
      if (this.sampler && this.config.referenceMelody.enabled) {
        this.sampler.triggerAttackRelease(
          event.note,
          event.duration,
          time,
          event.velocity
        );
      }
    }, events);

    this.part.loop = true;
    this.part.loopStart = 0;
    this.part.loopEnd = songData.duration;
  }

  /**
   * Start playback
   */
  start(): void {
    if (!this.part) {
      console.warn('Cannot start: no song loaded');
      return;
    }

    // Reset Transport to beginning
    Tone.Transport.seconds = 0;

    // Start Part at beginning of its timeline (BEFORE starting Transport)
    this.part.start(0);

    // Start Transport if not already started
    if (Tone.Transport.state !== 'started') {
      Tone.Transport.start();
    }
  }

  /**
   * Stop playback
   */
  stop(): void {
    // Stop Part scheduling
    if (this.part) {
      this.part.stop();
    }

    // Stop and reset Transport
    if (Tone.Transport.state !== 'stopped') {
      Tone.Transport.stop();
    }

    // Reset time to beginning
    Tone.Transport.seconds = 0;
  }

  /**
   * Pause playback
   */
  pause(): void {
    if (Tone.Transport.state === 'started') {
      Tone.Transport.pause();
    }
  }

  /**
   * Resume playback
   */
  resume(): void {
    // Transport.start() resumes from paused position automatically
    if (Tone.Transport.state === 'paused') {
      Tone.Transport.start();
    }
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

    // Update sampler volume
    if (this.sampler) {
      this.sampler.volume.value = Tone.gainToDb(this.currentVolume);
    }
  }

  /**
   * Set volume manually
   */
  setVolume(volume: number): void {
    this.currentVolume = Math.max(0, Math.min(1, volume));
    if (this.sampler) {
      this.sampler.volume.value = Tone.gainToDb(this.currentVolume);
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
    // Sampler doesn't need recreation - just update volume if needed
    if (this.sampler && this.currentVolume !== config.referenceMelody.initialVolume) {
      this.setVolume(this.currentVolume);
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

    if (this.sampler) {
      this.sampler.dispose();
      this.sampler = null;
    }

    this.initialized = false;
  }
}
