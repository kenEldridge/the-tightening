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
// import { loggers } from '../utils/logger'; // REMOVED - causes renderer blocking

export class ReferenceMelodyPlayer {
  // Use PolySynth with soft bell-like sound instead of piano
  // This prevents phasing when user plays along on piano
  private synth: Tone.PolySynth | null = null;
  private part: Tone.Part | null = null;
  private config: AppConfig;
  private currentVolume: number;
  private initialized = false;
  private currentSegment: SongSegment | null = null;
  private isSegmentLoopEnabled = false;
  private songDuration = 0;

  // Ducking state - when user plays, reference ducks to let user be the melody
  private isDucked = false;
  private duckVolumeDb = -20; // About 10% volume when ducked

  constructor(config: AppConfig) {
    this.config = config;
    this.currentVolume = config.referenceMelody.initialVolume;
  }

  /**
   * Initialize the reference melody synth
   */
  async initialize(): Promise<void> {
    if (this.initialized) return;

    console.info('[ReferenceMelody] Initializing ReferenceMelodyPlayer...');

    await Tone.start();

    // Create a soft bell/celeste synth - different timbre than piano
    // This prevents phasing when user plays along on their piano
    console.log('[ReferenceMelody] Creating bell synth for melody guide...');

    this.synth = new Tone.PolySynth(Tone.Synth, {
      oscillator: {
        type: 'triangle'  // Soft, bell-like tone
      },
      envelope: {
        attack: 0.02,     // Quick attack for clear note starts
        decay: 0.4,       // Medium decay
        sustain: 0.15,    // Low sustain for bell-like quality
        release: 1.0      // Long release for smooth fade
      },
      volume: Tone.gainToDb(this.currentVolume)
    }).toDestination();

    this.initialized = true;
    console.info('[ReferenceMelody] ReferenceMelodyPlayer initialization complete (bell synth)');
  }

  /**
   * Load a song and prepare it for playback
   */
  loadSong(songData: SongData): void {
    if (!this.initialized || !this.synth) {
      console.warn('[ReferenceMelody] Cannot load song: ReferenceMelodyPlayer not initialized');
      return;
    }

    console.info('[ReferenceMelody] Loading song', {
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
      if (this.synth && this.config.referenceMelody.enabled) {
        this.synth.triggerAttackRelease(
          event.note,
          event.duration,
          time,
          event.velocity
        );
      }
    }, events);

    this.part.loop = true;
    this.part.loopStart = 0;
    // Subtract tiny offset to prevent double-triggering notes at loop boundary
    this.part.loopEnd = songData.duration - 0.001;
    this.songDuration = songData.duration;

    // Reset segment looping when loading new song
    this.currentSegment = null;
    this.isSegmentLoopEnabled = false;

    console.log('[ReferenceMelody] Tone.Part created', {
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
      console.warn('[ReferenceMelody] Cannot start: no song loaded');
      return;
    }

    // Log Transport state BEFORE starting (critical for debugging timing issues)
    console.info('[ReferenceMelody] Starting reference melody', {
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
    console.log('[ReferenceMelody] Reference melody started', {
      transportStateAfter: Tone.Transport.state,
      transportSeconds: Tone.Transport.seconds
    });
  }

  /**
   * Stop playback
   */
  stop(): void {
    console.info('[ReferenceMelody] Stopping reference melody', {
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

    console.log('[ReferenceMelody] Reference melody stopped', {
      transportState: Tone.Transport.state
    });
  }

  /**
   * Pause playback
   */
  pause(): void {
    if (Tone.Transport.state === 'started') {
      console.info('[ReferenceMelody] Pausing reference melody', {
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
      console.info('[ReferenceMelody] Resuming reference melody', {
        transportSeconds: Tone.Transport.seconds
      });
      Tone.Transport.start();
    }
  }

  /**
   * Seek to a specific time
   */
  seek(timeInSeconds: number): void {
    console.log('[ReferenceMelody] Seeking to time', {
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
      // Loop the selected segment (with tiny offset to prevent double-triggers)
      this.part.loopStart = segment.startTime;
      this.part.loopEnd = segment.endTime - 0.001;
      this.isSegmentLoopEnabled = true;

      console.info('[ReferenceMelody] Enabling segment loop', {
        segmentName: segment.name,
        startTime: segment.startTime.toFixed(2),
        endTime: segment.endTime.toFixed(2),
        duration: (segment.endTime - segment.startTime).toFixed(2),
        transportState: Tone.Transport.state
      });

      // If playing, seek to segment start
      if (Tone.Transport.state === 'started') {
        Tone.Transport.seconds = segment.startTime;
        console.log('[ReferenceMelody] Seeked to segment start');
      }
    } else {
      // Loop entire song (with tiny offset to prevent double-triggers)
      this.part.loopStart = 0;
      this.part.loopEnd = this.songDuration - 0.001;
      this.isSegmentLoopEnabled = false;

      console.info('[ReferenceMelody] Disabling segment loop (looping entire song)', {
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

    // Update synth volume
    if (this.synth) {
      this.synth.volume.value = Tone.gainToDb(this.currentVolume);
    }

    // Log volume fade (only if volume changed significantly)
    if (Math.abs(this.currentVolume - oldVolume) > 0.01) {
      console.log('[ReferenceMelody] Reference melody volume faded', {
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

    if (this.synth) {
      this.synth.volume.value = Tone.gainToDb(this.currentVolume);
    }

    console.info('[ReferenceMelody] Reference melody volume set manually', {
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
   * Duck the reference melody (reduce volume quickly)
   * Called when user starts playing so their piano becomes the melody
   */
  duck(): void {
    if (!this.synth || this.isDucked) return;
    this.isDucked = true;

    // Fast duck (10ms) - instant response when user plays
    this.synth.volume.linearRampTo(this.duckVolumeDb, 0.01);

    console.debug('[ReferenceMelody] Ducked (user playing)', {
      targetDb: this.duckVolumeDb
    });
  }

  /**
   * Unduck the reference melody (restore volume slowly)
   * Called when user stops playing so reference melody fades back in
   */
  unduck(): void {
    if (!this.synth || !this.isDucked) return;
    this.isDucked = false;

    // Slow fade back in (1 second) - smooth transition
    const targetDb = Tone.gainToDb(this.currentVolume);
    this.synth.volume.linearRampTo(targetDb, 1.0);

    console.debug('[ReferenceMelody] Unducked (user stopped)', {
      targetDb: targetDb.toFixed(1)
    });
  }

  /**
   * Check if currently ducked
   */
  isDuckedState(): boolean {
    return this.isDucked;
  }

  /**
   * Set tempo
   */
  setTempo(bpm: number): void {
    const oldBpm = Tone.Transport.bpm.value;
    Tone.Transport.bpm.value = bpm;

    console.info('[ReferenceMelody] Reference melody tempo changed', {
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
    // Synth doesn't need recreation - just update volume if needed
    if (this.synth && this.currentVolume !== config.referenceMelody.initialVolume) {
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

    if (this.synth) {
      this.synth.dispose();
      this.synth = null;
    }

    this.initialized = false;
  }
}
