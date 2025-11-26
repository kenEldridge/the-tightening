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
  private synth: Tone.PolySynth | null = null;
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

    await Tone.start();

    // Create polyphonic piano synthesizer
    this.synth = new Tone.PolySynth(Tone.Synth, {
      oscillator: {
        type: 'triangle',
      },
      envelope: {
        attack: 0.005,
        decay: 0.1,
        sustain: 0.3,
        release: 1,
      },
    }).toDestination();

    this.initialized = true;
  }

  /**
   * Play a note with audio feedback based on accuracy
   *
   * @param options - Note playback options
   */
  playNote(options: PlayNoteOptions): void {
    if (!this.synth || !this.initialized) {
      console.warn('AudioEngine not initialized');
      return;
    }

    const {
      note,
      accuracy,
      duration = 0.5,
      velocity = 0.8,
    } = options;

    // Convert MIDI note to frequency
    const baseFrequency = Tone.Frequency(note, 'midi').toFrequency();

    // Apply audio feedback based on accuracy
    const frequency = this.applyDetuning(baseFrequency, accuracy);
    const volume = this.applyVolumeReduction(velocity, accuracy);

    // Apply timbre changes
    this.applyTimbreShift(accuracy);

    // Play the note
    const now = Tone.now();
    this.synth.triggerAttackRelease(
      frequency,
      duration,
      now,
      volume
    );
  }

  /**
   * Apply detuning based on accuracy
   *
   * @param baseFrequency - Base frequency in Hz
   * @param accuracy - Accuracy score (0-1)
   * @returns Detuned frequency in Hz
   */
  private applyDetuning(baseFrequency: number, accuracy: number): number {
    if (!this.config.audioFeedback.detuning.enabled) {
      return baseFrequency;
    }

    // Perfect accuracy = no detuning
    if (accuracy >= 0.999) {
      return baseFrequency;
    }

    const { maxCents, weight } = this.config.audioFeedback.detuning;

    // Calculate detuning amount based on accuracy
    const detuningAmount = this.calculateDegradation(accuracy, weight);

    // Apply detuning (in cents)
    const cents = detuningAmount * maxCents;

    // Randomly detune up or down for more natural sound
    const direction = Math.random() > 0.5 ? 1 : -1;
    const actualCents = cents * direction;

    // Convert cents to frequency multiplier
    // 100 cents = 1 semitone = frequency * 2^(1/12)
    const semitones = actualCents / 100;
    const frequencyMultiplier = Math.pow(2, semitones / 12);

    return baseFrequency * frequencyMultiplier;
  }

  /**
   * Apply timbre shift based on accuracy
   * Modifies the synthesizer's filter and harmonics
   *
   * @param accuracy - Accuracy score (0-1)
   */
  private applyTimbreShift(accuracy: number): void {
    if (!this.synth || !this.config.audioFeedback.timbre.enabled) {
      return;
    }

    // Perfect accuracy = no timbre change
    if (accuracy >= 0.999) {
      // Reset to default
      this.synth.set({
        oscillator: { type: 'triangle' },
      });
      return;
    }

    const { weight } = this.config.audioFeedback.timbre;

    // Calculate timbre degradation
    const degradation = this.calculateDegradation(accuracy, weight);

    // Adjust oscillator type based on degradation
    // Perfect = triangle (warm piano-like)
    // Wrong = more square/sawtooth (harsh, buzzy)
    if (degradation > 0.7) {
      this.synth.set({ oscillator: { type: 'square' } });
    } else if (degradation > 0.4) {
      this.synth.set({ oscillator: { type: 'sawtooth' } });
    } else {
      this.synth.set({ oscillator: { type: 'triangle' } });
    }
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
    if (this.synth) {
      this.synth.releaseAll();
    }
  }

  /**
   * Clean up resources
   */
  dispose(): void {
    if (this.synth) {
      this.synth.dispose();
      this.synth = null;
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
