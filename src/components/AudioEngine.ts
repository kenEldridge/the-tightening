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
// import { loggers } from '../utils/logger'; // REMOVED - causes renderer blocking

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
  // Clean sampler for high accuracy (direct to destination)
  private cleanSampler: Tone.Sampler | null = null;
  // Effects sampler for low accuracy (through pitch shift and filter)
  private effectsSampler: Tone.Sampler | null = null;
  private pitchShift: Tone.PitchShift | null = null;
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
    console.info('[AudioEngine] Initializing AudioEngine...');

    await Tone.start();
    console.log('[AudioEngine] Tone.js audio context started', {
      state: Tone.context.state,
      sampleRate: Tone.context.sampleRate,
      latency: Tone.context.latencyHint
    });

    // Create low-pass filter for timbre degradation (connects to destination)
    this.filter = new Tone.Filter({
      type: 'lowpass',
      frequency: 10000, // Start bright (no filtering)
      rolloff: -24, // Steep rolloff for pronounced effect
    }).toDestination();
    console.log('[AudioEngine] Low-pass filter created');

    // Create PitchShift for detuning feedback (connects to filter)
    // Note: Tone.Sampler doesn't have a detune property like Synth, so we use PitchShift
    this.pitchShift = new Tone.PitchShift({
      pitch: 0, // No shift initially (in semitones)
      windowSize: 0.1, // Balance between quality and latency
      delayTime: 0,
    });
    this.pitchShift.connect(this.filter);
    console.log('[AudioEngine] PitchShift effect created');

    // Sample URLs (shared between both samplers - browser will cache)
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

    // Create CLEAN sampler (direct to destination - for high accuracy)
    // Signal chain: cleanSampler → Destination
    console.log('[AudioEngine] Loading clean piano sampler (direct path)...');
    await new Promise<void>((resolve, reject) => {
      this.cleanSampler = new Tone.Sampler({
        urls: sampleUrls,
        baseUrl,
        release: 1,
        onload: () => {
          console.info('[AudioEngine] Clean sampler loaded');
          resolve();
        },
        onerror: (err) => {
          console.error('[AudioEngine] Failed to load clean sampler', {
            error: err instanceof Error ? err.message : String(err)
          });
          reject(err);
        }
      }).toDestination(); // Direct to destination - clean path
    });

    // Create EFFECTS sampler (through effects chain - for low accuracy)
    // Signal chain: effectsSampler → PitchShift → Filter → Destination
    console.log('[AudioEngine] Loading effects piano sampler...');
    await new Promise<void>((resolve, reject) => {
      this.effectsSampler = new Tone.Sampler({
        urls: sampleUrls,
        baseUrl,
        release: 1,
        onload: () => {
          const loadTime = Date.now() - startTime;
          console.info('[AudioEngine] Effects sampler loaded', {
            sampleCount: 31,
            loadTimeMs: loadTime
          });
          resolve();
        },
        onerror: (err) => {
          console.error('[AudioEngine] Failed to load effects sampler', {
            error: err instanceof Error ? err.message : String(err)
          });
          reject(err);
        }
      }).connect(this.pitchShift!); // Connect to effects chain
    });

    this.initialized = true;
    console.info('[AudioEngine] AudioEngine initialization complete');
  }

  /**
   * Play a note with audio feedback based on accuracy
   *
   * @param options - Note playback options
   */
  playNote(options: PlayNoteOptions): void {
    if (!this.cleanSampler || !this.effectsSampler || !this.initialized) {
      console.warn('[AudioEngine] AudioEngine not initialized - cannot play note');
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
    const now = Tone.now();

    // HIGH ACCURACY: Use clean sampler (direct to destination, no effects)
    // This ensures user piano sounds identical to reference melody
    if (accuracy >= 0.99) {
      this.cleanSampler.triggerAttackRelease(noteName, duration, now, velocity);

      console.log('[AudioEngine] Note played (CLEAN path)', {
        note: noteName,
        accuracy: accuracy.toFixed(2),
        velocity: velocity.toFixed(2),
        duration: duration.toFixed(2)
      });
      return;
    }

    // LOW ACCURACY: Use effects sampler with degradation
    this.applyDetuning(accuracy);
    this.applyTimbreShift(accuracy);
    const adjustedVelocity = this.applyVolumeReduction(velocity, accuracy);

    this.effectsSampler.triggerAttackRelease(noteName, duration, now, adjustedVelocity);

    console.log('[AudioEngine] Note played (EFFECTS path)', {
      note: noteName,
      accuracy: accuracy.toFixed(2),
      detuningCents: this.pitchShift ? (this.pitchShift.pitch * 100).toFixed(1) : 'N/A',
      filterFreq: this.filter?.frequency ? this.filter.frequency.value.toFixed(0) : 'N/A',
      velocity: adjustedVelocity.toFixed(2),
      duration: duration.toFixed(2)
    });
  }

  /**
   * Apply detuning based on accuracy using PitchShift effect
   * Note: Tone.Sampler doesn't have a detune property, so we use PitchShift
   *
   * @param accuracy - Accuracy score (0-1)
   */
  private applyDetuning(accuracy: number): void {
    if (!this.pitchShift) {
      return;
    }

    if (!this.config.audioFeedback.detuning.enabled) {
      this.pitchShift.pitch = 0;
      return;
    }

    // Perfect accuracy = no detuning
    if (accuracy >= 0.999) {
      this.pitchShift.pitch = 0;
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

    // Convert cents to semitones (100 cents = 1 semitone)
    // PitchShift.pitch is in semitones
    this.pitchShift.pitch = actualCents / 100;
  }

  /**
   * Apply timbre shift based on accuracy
   * Uses low-pass filter to make wrong keys sound muffled
   *
   * @param accuracy - Accuracy score (0-1)
   */
  private applyTimbreShift(accuracy: number): void {
    // Guard against undefined filter or frequency property
    if (!this.filter || !this.filter.frequency) {
      return;
    }

    if (!this.config.audioFeedback.timbre.enabled) {
      this.filter.frequency.value = 10000;
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
    if (this.cleanSampler) {
      this.cleanSampler.releaseAll();
    }
    if (this.effectsSampler) {
      this.effectsSampler.releaseAll();
    }
  }

  /**
   * Clean up resources
   */
  dispose(): void {
    if (this.cleanSampler) {
      this.cleanSampler.dispose();
      this.cleanSampler = null;
    }
    if (this.effectsSampler) {
      this.effectsSampler.dispose();
      this.effectsSampler = null;
    }
    if (this.pitchShift) {
      this.pitchShift.dispose();
      this.pitchShift = null;
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
