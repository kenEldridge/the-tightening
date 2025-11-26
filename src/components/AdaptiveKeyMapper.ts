/**
 * Adaptive Key Mapper
 *
 * Core innovation: Maps ANY key press to the correct melody note,
 * with a probability distribution that gradually tightens around the correct keys.
 *
 * Phase 1 (Beginning): Uniform distribution - all keys work
 * Phase 2 (Progressive): Gaussian distribution tightens around correct keys
 * Phase 3 (Mastery): Delta function - only correct keys work
 */

import type { AppConfig } from '../config/AppConfig';

export interface KeyMappingResult {
  // The melody note that should play
  melodyNote: number;
  // The key that was actually pressed
  pressedKey: number;
  // Distance from correct key (in semitones, 0 = perfect)
  distance: number;
  // Accuracy score (0-1, where 1 = perfect)
  accuracy: number;
}

export class AdaptiveKeyMapper {
  private currentDistributionWidth: number;
  private config: AppConfig;

  constructor(config: AppConfig) {
    this.config = config;
    this.currentDistributionWidth = config.distribution.initialWidth;
  }

  /**
   * Map a pressed key to the correct melody note
   *
   * @param pressedMidiKey - The MIDI key number that was pressed (0-127)
   * @param correctMelodyNote - The correct MIDI note for this moment (0-127)
   * @returns Mapping result with melody note and accuracy info
   */
  mapKeyToMelody(
    pressedMidiKey: number,
    correctMelodyNote: number
  ): KeyMappingResult {
    // Calculate distance from correct key (in semitones)
    const distance = Math.abs(pressedMidiKey - correctMelodyNote);

    // Calculate accuracy based on Gaussian distribution
    const accuracy = this.calculateAccuracy(distance);

    return {
      melodyNote: correctMelodyNote, // Always play the melody note
      pressedKey: pressedMidiKey,
      distance,
      accuracy,
    };
  }

  /**
   * Calculate accuracy score based on distance from correct key
   * Uses Gaussian distribution centered on correct key
   *
   * @param distance - Distance in semitones from correct key
   * @returns Accuracy score (0-1, where 1 = perfect)
   */
  private calculateAccuracy(distance: number): number {
    // Use manual override if set, otherwise use current width
    const width = this.config.distribution.manualWidthOverride !== null
      ? this.config.distribution.manualWidthOverride
      : this.currentDistributionWidth;

    // If width is very large (Phase 1), all keys are equally good
    if (width >= 44) {
      return 1.0;
    }

    // Gaussian distribution: e^(-distance^2 / (2 * sigma^2))
    const sigma = width / 2; // Standard deviation
    const accuracy = Math.exp(-(distance * distance) / (2 * sigma * sigma));

    // Clamp to [0, 1]
    return Math.max(0, Math.min(1, accuracy));
  }

  /**
   * Tighten the distribution (used for automatic progression)
   *
   * @param amount - Amount to tighten (optional, uses config rate if not provided)
   */
  tightenDistribution(amount?: number): void {
    const tighteningAmount = amount ?? this.config.distribution.autoTighteningRate;

    this.currentDistributionWidth = Math.max(
      this.config.distribution.finalWidth,
      this.currentDistributionWidth - tighteningAmount
    );
  }

  /**
   * Manually set distribution width (for manual mode)
   *
   * @param width - New width (in semitones)
   */
  setDistributionWidth(width: number): void {
    this.currentDistributionWidth = Math.max(
      this.config.distribution.finalWidth,
      Math.min(this.config.distribution.initialWidth, width)
    );
  }

  /**
   * Get current distribution width
   */
  getDistributionWidth(): number {
    return this.config.distribution.manualWidthOverride !== null
      ? this.config.distribution.manualWidthOverride
      : this.currentDistributionWidth;
  }

  /**
   * Get current progress (0-1, where 0 = beginning, 1 = mastery)
   */
  getProgress(): number {
    const width = this.getDistributionWidth();
    const initial = this.config.distribution.initialWidth;
    const final = this.config.distribution.finalWidth;

    // Linear interpolation from initial to final
    const progress = 1 - (width - final) / (initial - final);

    return Math.max(0, Math.min(1, progress));
  }

  /**
   * Reset distribution to initial state
   */
  reset(): void {
    this.currentDistributionWidth = this.config.distribution.initialWidth;
  }

  /**
   * Update configuration
   */
  updateConfig(config: AppConfig): void {
    this.config = config;
  }

  /**
   * Get acceptable key range for visual feedback
   * Returns MIDI key range that has >10% acceptance probability
   *
   * @param correctMelodyNote - The correct MIDI note
   * @returns Range of acceptable keys { min, max }
   */
  getAcceptableKeyRange(correctMelodyNote: number): { min: number; max: number } {
    const width = this.getDistributionWidth();

    // If width is very large, return full keyboard range
    if (width >= 44) {
      return { min: 0, max: 127 };
    }

    // For Gaussian, ~99.7% of values are within ±3σ
    // For visual feedback, use ±2σ (95% of values)
    const rangeWidth = Math.ceil(width * 2);

    return {
      min: Math.max(0, correctMelodyNote - rangeWidth),
      max: Math.min(127, correctMelodyNote + rangeWidth),
    };
  }

  /**
   * Serialize state for saving progress
   */
  serialize(): object {
    return {
      currentDistributionWidth: this.currentDistributionWidth,
    };
  }

  /**
   * Restore state from saved progress
   */
  deserialize(state: any): void {
    if (state.currentDistributionWidth !== undefined) {
      this.currentDistributionWidth = state.currentDistributionWidth;
    }
  }
}
