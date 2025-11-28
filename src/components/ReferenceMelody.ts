/**
 * Reference Melody Player
 *
 * Plays the reference melody in the background using SplendidGrandPiano.
 * Key insight: Plays melody 1-2 octaves LOWER than user to create
 * natural bass+melody harmony instead of phase collision.
 *
 * Fades out as user learns (based on accuracy).
 * Ducks when user plays so their piano is the lead voice.
 */

import * as Tone from 'tone';
import { SplendidGrandPiano } from 'smplr';
import type { AppConfig } from '../config/AppConfig';
import type { SongData, MelodyNote, SongSegment } from '../utils/midiParser';

export class ReferenceMelodyPlayer {
  private piano: SplendidGrandPiano | null = null;
  private part: Tone.Part | null = null;
  private config: AppConfig;
  private currentVolume: number;
  private initialized = false;
  private currentSegment: SongSegment | null = null;
  private isSegmentLoopEnabled = false;
  private songDuration = 0;
  private audioContext: AudioContext | null = null;

  // Ducking state - when user plays, reference ducks to let user be the melody
  private isDucked = false;
  private duckLevel = 0.15; // 15% volume when ducked

  constructor(config: AppConfig) {
    this.config = config;
    this.currentVolume = config.referenceMelody.initialVolume;
  }

  /**
   * Initialize the reference melody piano
   */
  async initialize(): Promise<void> {
    if (this.initialized) return;

    const startTime = Date.now();
    console.info('[ReferenceMelody] Initializing with SplendidGrandPiano...');

    await Tone.start();

    // Get the raw AudioContext from Tone.js
    this.audioContext = Tone.context.rawContext as AudioContext;

    // Create SplendidGrandPiano - same quality as user's piano
    console.log('[ReferenceMelody] Loading SplendidGrandPiano samples...');
    this.piano = new SplendidGrandPiano(this.audioContext, {
      decayTime: 1.0, // Slightly shorter than accompaniment for clarity
    });

    await this.piano.load;

    const loadTime = Date.now() - startTime;
    console.info('[ReferenceMelody] SplendidGrandPiano loaded', {
      loadTimeMs: loadTime
    });

    this.initialized = true;
    console.info('[ReferenceMelody] ReferenceMelodyPlayer initialization complete');
  }

  /**
   * Load a song and prepare it for playback
   */
  loadSong(songData: SongData): void {
    if (!this.initialized || !this.piano) {
      console.warn('[ReferenceMelody] Cannot load song: ReferenceMelodyPlayer not initialized');
      return;
    }

    const octaveOffset = this.config.referenceMelody.octaveOffset;

    console.info('[ReferenceMelody] Loading song', {
      name: songData.name,
      tempo: songData.tempo,
      duration: songData.duration.toFixed(2),
      noteCount: songData.notes.length,
      octaveOffset: octaveOffset,
      timeSignature: `${songData.timeSignature.numerator}/${songData.timeSignature.denominator}`,
      range: `${songData.range.min}-${songData.range.max}`
    });

    // Stop and dispose existing part
    this.stop();
    if (this.part) {
      this.part.dispose();
    }

    // Store reference to piano for closure
    const piano = this.piano;
    const getVolume = () => this.isDucked ? this.duckLevel : this.currentVolume;
    const isEnabled = () => this.config.referenceMelody.enabled;

    // Create Tone.Part from melody notes with octave transposition
    const events = songData.notes.map((note: MelodyNote) => {
      // Transpose down by octaveOffset, but clamp to valid piano range (MIDI 21-108)
      const transposedNote = Math.max(21, Math.min(108, note.midi + octaveOffset));

      return {
        time: note.time,
        note: transposedNote,
        duration: note.duration,
        velocity: (note.velocity || 0.8) * 0.6, // 60% of original - supportive, not dominant
      };
    });

    this.part = new Tone.Part((time, event) => {
      if (piano && isEnabled()) {
        // Calculate velocity based on current volume (ducking applied)
        const velocity = Math.round(event.velocity * 127 * getVolume());

        piano.start({
          note: event.note,
          velocity,
          duration: event.duration,
          time: time,
        });
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
      loop: this.part.loop,
      octaveOffset: octaveOffset
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

    // Stop any playing notes
    if (this.piano) {
      this.piano.stop();
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
    if (this.isDucked) return;
    this.isDucked = true;

    console.debug('[ReferenceMelody] Ducked (user playing)', {
      duckLevel: this.duckLevel
    });
  }

  /**
   * Unduck the reference melody (restore volume)
   * Called when user stops playing so reference melody fades back in
   */
  unduck(): void {
    if (!this.isDucked) return;
    this.isDucked = false;

    console.debug('[ReferenceMelody] Unducked (user stopped)', {
      restoredVolume: this.currentVolume.toFixed(2)
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
  }

  /**
   * Get current octave offset
   */
  getOctaveOffset(): number {
    return this.config.referenceMelody.octaveOffset;
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

    if (this.piano) {
      this.piano.stop();
      this.piano = null;
    }

    this.audioContext = null;
    this.initialized = false;
  }
}
