/**
 * Audio Engine
 *
 * Uses smplr's SplendidGrandPiano for professional piano sound.
 * Handles audio feedback based on accuracy (for "The Tightening" progression).
 *
 * Phase 1 (full width): All notes sound perfect
 * Later phases: Wrong keys get detuned + quieter
 */

import * as Tone from 'tone';
import { SplendidGrandPiano } from 'smplr';
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
  private piano: SplendidGrandPiano | null = null;
  private config: AppConfig;
  private initialized = false;
  private audioContext: AudioContext | null = null;

  constructor(config: AppConfig) {
    this.config = config;
  }

  /**
   * Initialize audio context and piano
   * Must be called after user interaction (browser requirement)
   */
  async initialize(): Promise<void> {
    if (this.initialized) return;

    const startTime = Date.now();
    console.info('[AudioEngine] Initializing with SplendidGrandPiano...');

    // Start Tone.js context (handles user interaction requirement)
    await Tone.start();

    // Get the raw AudioContext from Tone.js
    this.audioContext = Tone.context.rawContext as AudioContext;

    console.log('[AudioEngine] Audio context ready', {
      state: this.audioContext.state,
      sampleRate: this.audioContext.sampleRate,
    });

    // Create SplendidGrandPiano - professional piano sound out of the box
    console.log('[AudioEngine] Loading SplendidGrandPiano samples...');
    this.piano = new SplendidGrandPiano(this.audioContext, {
      decayTime: 0.8,  // Natural sustain/decay
    });

    // Wait for samples to load
    await this.piano.load;

    const loadTime = Date.now() - startTime;
    console.info('[AudioEngine] SplendidGrandPiano loaded', {
      loadTimeMs: loadTime
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
    if (!this.piano || !this.initialized) {
      console.warn('[AudioEngine] AudioEngine not initialized - cannot play note');
      return;
    }

    const {
      note,
      accuracy,
      duration: rawDuration = 0.5,
      velocity = 0.8,
    } = options;

    // Ensure minimum duration for pleasant sound
    const duration = Math.max(0.3, rawDuration);

    // Convert velocity from 0-1 to 0-127 (smplr uses MIDI velocity)
    const midiVelocity = Math.round(velocity * 127);

    // HIGH ACCURACY (>= 0.99): Perfect clean sound
    if (accuracy >= 0.99) {
      this.piano.start({
        note,
        velocity: midiVelocity,
        duration,
      });

      console.log('[AudioEngine] Note played (CLEAN)', {
        midi: note,
        accuracy: accuracy.toFixed(2),
        velocity: midiVelocity,
        duration: duration.toFixed(3)
      });
      return;
    }

    // LOW ACCURACY: Apply degradation effects
    const detuneCents = this.calculateDetune(accuracy);
    const adjustedVelocity = this.calculateVolume(midiVelocity, accuracy);

    this.piano.start({
      note,
      velocity: adjustedVelocity,
      duration,
      detune: detuneCents,
    });

    console.log('[AudioEngine] Note played (DEGRADED)', {
      midi: note,
      accuracy: accuracy.toFixed(2),
      velocity: adjustedVelocity,
      detuneCents: detuneCents.toFixed(1),
      duration: duration.toFixed(3)
    });
  }

  /**
   * Calculate detuning in cents based on accuracy
   */
  private calculateDetune(accuracy: number): number {
    if (!this.config.audioFeedback.detuning.enabled) {
      return 0;
    }

    const { maxCents, weight } = this.config.audioFeedback.detuning;
    const error = 1 - accuracy;

    // Apply degradation curve
    let degradation: number;
    if (this.config.audioFeedback.degradationCurve === 'exponential') {
      degradation = Math.pow(error, 0.5);
    } else {
      degradation = error;
    }

    const cents = degradation * weight * maxCents;

    // Randomly detune up or down for more natural sound
    const direction = Math.random() > 0.5 ? 1 : -1;
    return cents * direction;
  }

  /**
   * Calculate adjusted velocity based on accuracy
   */
  private calculateVolume(baseVelocity: number, accuracy: number): number {
    if (!this.config.audioFeedback.volume.enabled) {
      return baseVelocity;
    }

    const { maxReduction, weight } = this.config.audioFeedback.volume;
    const error = 1 - accuracy;

    // Apply degradation curve
    let degradation: number;
    if (this.config.audioFeedback.degradationCurve === 'exponential') {
      degradation = Math.pow(error, 0.5);
    } else {
      degradation = error;
    }

    const reduction = degradation * weight * maxReduction;
    const adjustedVelocity = baseVelocity * (1 - reduction);

    // Never go completely silent (minimum 10% velocity)
    return Math.max(Math.round(adjustedVelocity), 13);
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
    if (this.piano) {
      this.piano.stop();
    }
  }

  /**
   * Clean up resources
   */
  dispose(): void {
    if (this.piano) {
      this.piano.stop();
      // smplr doesn't have explicit dispose, but stopping is sufficient
      this.piano = null;
    }
    this.audioContext = null;
    this.initialized = false;
  }

  /**
   * Get current audio context state
   */
  getState(): 'running' | 'suspended' | 'closed' | 'uninitialized' {
    if (!this.initialized || !this.audioContext) return 'uninitialized';
    return this.audioContext.state as 'running' | 'suspended' | 'closed';
  }

  /**
   * Get audio latency information (for debugging)
   */
  getLatency(): { base: number; output: number; total: number } {
    if (!this.audioContext) {
      return { base: 0, output: 0, total: 0 };
    }
    const baseLatency = (this.audioContext.baseLatency || 0) * 1000;
    const outputLatency = (this.audioContext.outputLatency || 0) * 1000;
    return {
      base: baseLatency,
      output: outputLatency,
      total: baseLatency + outputLatency,
    };
  }
}
