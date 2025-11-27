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
import type { SongData, MelodyNote, SongSegment } from '../utils/midiParser';
import { loggers } from '../utils/logger';

export class ReferenceMelodyPlayer {
  private sampler: Tone.Sampler | null = null;
  private part: Tone.Part | null = null;
  private config: AppConfig;
  private currentVolume: number;
  private initialized = false;
  private currentSegment: SongSegment | null = null;
  private isSegmentLoopEnabled = false;
  private songDuration = 0;

  constructor(config: AppConfig) {
    this.config = config;
    this.currentVolume = config.referenceMelody.initialVolume;
  }

  /**
   * Initialize the reference melody sampler
   */
  async initialize(): Promise<void> {
    if (this.initialized) return;

    const startTime = Date.now();
    loggers.reference.info('Initializing ReferenceMelodyPlayer...');

    await Tone.start();

    // Create sampler with same Salamander Grand Piano samples as user
    // Wrap in Promise to wait for samples to load
    loggers.reference.debug('Loading reference piano samples from CDN...');
    await new Promise<void>((resolve, reject) => {
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
          const loadTime = Date.now() - startTime;
          loggers.reference.info('Reference piano samples loaded successfully', {
            sampleCount: 31,
            loadTimeMs: loadTime,
            initialVolume: this.currentVolume,
            baseUrl: "https://tonejs.github.io/audio/salamander/"
          });
          resolve();
        },
        onerror: (err) => {
          loggers.reference.error('Failed to load reference piano samples', {
            error: err instanceof Error ? err.message : String(err),
            baseUrl: "https://tonejs.github.io/audio/salamander/"
          });
          reject(err);
        }
      }).toDestination();
    });

    this.initialized = true;
    loggers.reference.info('ReferenceMelodyPlayer initialization complete');
  }

  /**
   * Load a song and prepare it for playback
   */
  loadSong(songData: SongData): void {
    if (!this.initialized || !this.sampler) {
      loggers.reference.warn('Cannot load song: ReferenceMelodyPlayer not initialized');
      return;
    }

    loggers.reference.info('Loading song', {
      name: songData.name,
      tempo: songData.tempo,
      duration: songData.duration.toFixed(2),
      noteCount: songData.notes.length,
      timeSignature: `${songData.timeSignature.numerator}/${songData.timeSignature.denominator}`,
      range: `${songData.range.min}-${songData.range.max}`
    });

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
    this.songDuration = songData.duration;

    // Reset segment looping when loading new song
    this.currentSegment = null;
    this.isSegmentLoopEnabled = false;

    loggers.reference.debug('Tone.Part created', {
      eventCount: events.length,
      loopStart: this.part.loopStart,
      loopEnd: this.part.loopEnd,
      loop: this.part.loop
    });
  }

  /**
   * Start playback
   */
  start(): void {
    if (!this.part) {
      loggers.reference.warn('Cannot start: no song loaded');
      return;
    }

    // Log Transport state BEFORE starting (critical for debugging timing issues)
    loggers.reference.info('Starting reference melody', {
      transportStateBefore: Tone.Transport.state,
      transportSeconds: Tone.Transport.seconds,
      tempo: Tone.Transport.bpm.value,
      partLoopStart: this.part.loopStart,
      partLoopEnd: this.part.loopEnd,
      partLoop: this.part.loop,
      segmentLoopEnabled: this.isSegmentLoopEnabled,
      currentSegment: this.currentSegment ?
        `${this.currentSegment.startTime.toFixed(2)}s-${this.currentSegment.endTime.toFixed(2)}s` :
        'none'
    });

    // Reset Transport to beginning
    Tone.Transport.seconds = 0;

    // Start Part at beginning of its timeline (BEFORE starting Transport)
    this.part.start(0);

    // Start Transport if not already started
    if (Tone.Transport.state !== 'started') {
      Tone.Transport.start();
    }

    // Log Transport state AFTER starting
    loggers.reference.debug('Reference melody started', {
      transportStateAfter: Tone.Transport.state,
      transportSeconds: Tone.Transport.seconds
    });
  }

  /**
   * Stop playback
   */
  stop(): void {
    loggers.reference.info('Stopping reference melody', {
      transportState: Tone.Transport.state,
      transportSeconds: Tone.Transport.seconds
    });

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

    loggers.reference.debug('Reference melody stopped', {
      transportState: Tone.Transport.state
    });
  }

  /**
   * Pause playback
   */
  pause(): void {
    if (Tone.Transport.state === 'started') {
      loggers.reference.info('Pausing reference melody', {
        transportSeconds: Tone.Transport.seconds
      });
      Tone.Transport.pause();
    }
  }

  /**
   * Resume playback
   */
  resume(): void {
    // Transport.start() resumes from paused position automatically
    if (Tone.Transport.state === 'paused') {
      loggers.reference.info('Resuming reference melody', {
        transportSeconds: Tone.Transport.seconds
      });
      Tone.Transport.start();
    }
  }

  /**
   * Seek to a specific time
   */
  seek(timeInSeconds: number): void {
    loggers.reference.debug('Seeking to time', {
      fromSeconds: Tone.Transport.seconds,
      toSeconds: timeInSeconds
    });
    Tone.Transport.seconds = timeInSeconds;
  }

  /**
   * Enable looping of a specific segment
   */
  setLoopSegment(segment: SongSegment | null): void {
    this.currentSegment = segment;

    if (!this.part) return;

    if (segment) {
      // Loop the selected segment
      this.part.loopStart = segment.startTime;
      this.part.loopEnd = segment.endTime;
      this.isSegmentLoopEnabled = true;

      loggers.reference.info('Enabling segment loop', {
        segmentName: segment.name,
        startTime: segment.startTime.toFixed(2),
        endTime: segment.endTime.toFixed(2),
        duration: (segment.endTime - segment.startTime).toFixed(2),
        transportState: Tone.Transport.state
      });

      // If playing, seek to segment start
      if (Tone.Transport.state === 'started') {
        Tone.Transport.seconds = segment.startTime;
        loggers.reference.debug('Seeked to segment start');
      }
    } else {
      // Loop entire song
      this.part.loopStart = 0;
      this.part.loopEnd = this.songDuration;
      this.isSegmentLoopEnabled = false;

      loggers.reference.info('Disabling segment loop (looping entire song)', {
        songDuration: this.songDuration.toFixed(2)
      });
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
   * Called by ProgressTracker
   *
   * @param accuracy - Average user accuracy (0-1)
   */
  fadeBasedOnAccuracy(accuracy: number): void {
    if (!this.config.referenceMelody.enabled) return;

    const oldVolume = this.currentVolume;

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

    // Log volume fade (only if volume changed significantly)
    if (Math.abs(this.currentVolume - oldVolume) > 0.01) {
      loggers.reference.debug('Reference melody volume faded', {
        accuracy: accuracy.toFixed(3),
        oldVolume: oldVolume.toFixed(3),
        newVolume: this.currentVolume.toFixed(3),
        targetVolume: targetVolume.toFixed(3),
        manualOverride: this.config.referenceMelody.manualVolumeOverride !== null
      });
    }
  }

  /**
   * Set volume manually
   */
  setVolume(volume: number): void {
    const oldVolume = this.currentVolume;
    this.currentVolume = Math.max(0, Math.min(1, volume));

    if (this.sampler) {
      this.sampler.volume.value = Tone.gainToDb(this.currentVolume);
    }

    loggers.reference.info('Reference melody volume set manually', {
      oldVolume: oldVolume.toFixed(3),
      newVolume: this.currentVolume.toFixed(3)
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
    const oldBpm = Tone.Transport.bpm.value;
    Tone.Transport.bpm.value = bpm;

    loggers.reference.info('Reference melody tempo changed', {
      oldBpm: oldBpm.toFixed(1),
      newBpm: bpm.toFixed(1)
    });
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
