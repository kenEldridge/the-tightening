/**
 * Audio Engine
 *
 * Handles piano synthesis with tunable audio feedback
 * Degrades audio quality based on accuracy (distance from correct key)
 *
 * Three feedback mechanisms (all tunable):
 * 1. Detuning - pitch shifts for wrong keys
 * 2. Timbre - filter/harmonic changes
 * 3. Volume - quieter for wrong keys
 */

import * as Tone from 'tone';
import type { AppConfig } from '../config/AppConfig';
import { loggers } from '../utils/logger';

export interface PlayNoteOptions {
  // MIDI note number to play
  note: number;
  // Accuracy score (0-1, where 1 = perfect)
  accuracy: number;
  // Duration in seconds
  duration?: number;
  // Velocity (0-1)
  velocity?: number;
}

export class AudioEngine {
  private sampler: Tone.Sampler | null = null;
  private filter: Tone.Filter | null = null;
  private config: AppConfig;
  private initialized = false;

  constructor(config: AppConfig) {
    this.config = config;
  }

  /**
   * Initialize audio context and synthesizer
   * Must be called after user interaction (browser requirement)
   */
  async initialize(): Promise<void> {
    if (this.initialized) return;

    const startTime = Date.now();
    loggers.audio.info('Initializing AudioEngine...');

    await Tone.start();
    loggers.audio.debug('Tone.js audio context started', {
      state: Tone.context.state,
      sampleRate: Tone.context.sampleRate,
      latency: Tone.context.latencyHint
    });

    // Create low-pass filter for timbre degradation
    this.filter = new Tone.Filter({
      type: 'lowpass',
      frequency: 10000, // Start bright (no filtering)
      rolloff: -24, // Steep rolloff for pronounced effect
    }).toDestination();
    loggers.audio.debug('Low-pass filter created');

    // Create sampler with Salamander Grand Piano samples
    // Wrap in Promise to wait for samples to load
    loggers.audio.debug('Loading Salamander Grand Piano samples from CDN...');
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
        release: 1, // Match original envelope release
        onload: () => {
          const loadTime = Date.now() - startTime;
          loggers.audio.info('User piano samples loaded successfully', {
            sampleCount: 31,
            loadTimeMs: loadTime,
            baseUrl: "https://tonejs.github.io/audio/salamander/"
          });
          resolve();
        },
        onerror: (err) => {
          loggers.audio.error('Failed to load user piano samples', {
            error: err instanceof Error ? err.message : String(err),
            baseUrl: "https://tonejs.github.io/audio/salamander/"
          });
          reject(err);
        }
      }).connect(this.filter);
    });

    this.initialized = true;
    loggers.audio.info('AudioEngine initialization complete');
  }

  /**
   * Play a note with audio feedback based on accuracy
   *
   * @param options - Note playback options
   */
  playNote(options: PlayNoteOptions): void {
    if (!this.sampler || !this.initialized) {
      loggers.audio.warn('AudioEngine not initialized - cannot play note');
      return;
    }

    const {
      note,
      accuracy,
      duration = 0.5,
      velocity = 0.8,
    } = options;

    // Convert MIDI note to note name (Sampler needs names, not frequencies)
    const noteName = Tone.Frequency(note, 'midi').toNote();

    // Apply audio feedback based on accuracy
    this.applyDetuning(accuracy);
    this.applyTimbreShift(accuracy);
    const adjustedVelocity = this.applyVolumeReduction(velocity, accuracy);

    // Play the note
    const now = Tone.now();
    this.sampler.triggerAttackRelease(
      noteName,
      duration,
      now,
      adjustedVelocity
    );

    // Log note playback details (only in debug mode)
    loggers.audio.debug('Note played', {
      note: noteName,
      accuracy: accuracy.toFixed(2),
      detuningCents: this.sampler.detune.value.toFixed(1),
      filterFreq: this.filter ? this.filter.frequency.value.toFixed(0) : 'N/A',
      velocity: adjustedVelocity.toFixed(2),
      duration: duration.toFixed(2)
    });
  }

  /**
   * Apply detuning based on accuracy
   *
   * @param accuracy - Accuracy score (0-1)
   */
  private applyDetuning(accuracy: number): void {
    if (!this.sampler || !this.config.audioFeedback.detuning.enabled) {
      if (this.sampler) this.sampler.detune.value = 0;
      return;
    }

    // Perfect accuracy = no detuning
    if (accuracy >= 0.999) {
      this.sampler.detune.value = 0;
      return;
    }

    const { maxCents, weight } = this.config.audioFeedback.detuning;

    // Calculate detuning amount based on accuracy
    const detuningAmount = this.calculateDegradation(accuracy, weight);

    // Apply detuning (in cents)
    const cents = detuningAmount * maxCents;

    // Randomly detune up or down for more natural sound
    const direction = Math.random() > 0.5 ? 1 : -1;
    const actualCents = cents * direction;

    // Apply detuning directly in cents (much simpler than frequency math!)
    this.sampler.detune.value = actualCents;
  }

  /**
   * Apply timbre shift based on accuracy
   * Uses low-pass filter to make wrong keys sound muffled
   *
   * @param accuracy - Accuracy score (0-1)
   */
  private applyTimbreShift(accuracy: number): void {
    if (!this.filter || !this.config.audioFeedback.timbre.enabled) {
      if (this.filter) this.filter.frequency.value = 10000;
      return;
    }

    // Perfect accuracy = no filtering (bright, full piano sound)
    if (accuracy >= 0.999) {
      this.filter.frequency.value = 10000; // 10kHz - wide open
      return;
    }

    const { weight } = this.config.audioFeedback.timbre;

    // Calculate timbre degradation
    const degradation = this.calculateDegradation(accuracy, weight);

    // Map degradation to filter cutoff frequency
    // Perfect (0) → 10000 Hz (bright, full harmonics)
    // Wrong (1) → 500 Hz (muffled, dark, telephone-like)
    const minFreq = 500;
    const maxFreq = 10000;
    const filterFreq = maxFreq - (degradation * (maxFreq - minFreq));

    this.filter.frequency.value = filterFreq;
  }

  /**
   * Apply volume reduction based on accuracy
   *
   * @param baseVolume - Base velocity (0-1)
   * @param accuracy - Accuracy score (0-1)
   * @returns Adjusted volume (0-1)
   */
  private applyVolumeReduction(baseVolume: number, accuracy: number): number {
    if (!this.config.audioFeedback.volume.enabled) {
      return baseVolume;
    }

    // Perfect accuracy = no volume reduction
    if (accuracy >= 0.999) {
      return baseVolume;
    }

    const { maxReduction, weight } = this.config.audioFeedback.volume;

    // Calculate volume degradation
    const degradation = this.calculateDegradation(accuracy, weight);

    // Apply volume reduction
    const reduction = degradation * maxReduction;
    const adjustedVolume = baseVolume * (1 - reduction);

    return Math.max(0.1, adjustedVolume); // Never go completely silent
  }

  /**
   * Calculate degradation amount based on accuracy and weight
   *
   * @param accuracy - Accuracy score (0-1)
   * @param weight - Effect weight (0-1)
   * @returns Degradation amount (0-1, where 0 = no degradation)
   */
  private calculateDegradation(accuracy: number, weight: number): number {
    // Invert accuracy to get error amount
    const error = 1 - accuracy;

    // Apply degradation curve
    let degradation: number;
    if (this.config.audioFeedback.degradationCurve === 'exponential') {
      // Exponential curve: more forgiving for small errors, harsh for large errors
      degradation = Math.pow(error, 0.5);
    } else {
      // Linear curve
      degradation = error;
    }

    // Apply weight
    return degradation * weight;
  }

  /**
   * Update configuration
   */
  updateConfig(config: AppConfig): void {
    this.config = config;
  }

  /**
   * Stop all currently playing notes
   */
  stopAll(): void {
    if (this.sampler) {
      this.sampler.releaseAll();
    }
  }

  /**
   * Clean up resources
   */
  dispose(): void {
    if (this.sampler) {
      this.sampler.dispose();
      this.sampler = null;
    }
    if (this.filter) {
      this.filter.dispose();
      this.filter = null;
    }
    this.initialized = false;
  }

  /**
   * Get current audio context state
   */
  getState(): 'running' | 'suspended' | 'closed' | 'uninitialized' {
    if (!this.initialized) return 'uninitialized';
    return Tone.context.state;
  }

  /**
   * Get audio latency information (for debugging)
   */
  getLatency(): { base: number; output: number; total: number } {
    const baseLatency = (Tone.context.baseLatency || 0) * 1000;
    const outputLatency = (Tone.context.outputLatency || 0) * 1000;
    return {
      base: baseLatency,
      output: outputLatency,
      total: baseLatency + outputLatency,
    };
  }
}
