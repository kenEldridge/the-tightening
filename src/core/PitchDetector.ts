/**
 * Pitch Detector Module
 *
 * Detects pitch (fundamental frequency) from audio data and converts to MIDI note.
 * Uses the pitchy library with McLeod Pitch Method for accurate real-time detection.
 */

import { PitchDetector as PitchyDetector } from 'pitchy';

export interface PitchDetectionResult {
  // Detected MIDI note number (0-127)
  midi: number;
  // Note name (e.g., "C4", "A#3")
  noteName: string;
  // Detected frequency in Hz
  frequency: number;
  // Confidence score (0-1, where 1 = very confident)
  clarity: number;
  // How far off from the exact note (in cents, ±50 = half semitone)
  centsOff: number;
}

export interface PitchDetectorConfig {
  // Minimum clarity (0-1) to consider a valid detection
  clarityThreshold: number;
  // Minimum frequency to detect (Hz) - filters out rumble/noise
  minFrequency: number;
  // Maximum frequency to detect (Hz) - piano goes up to ~4186 Hz (C8)
  maxFrequency: number;
}

export const defaultPitchDetectorConfig: PitchDetectorConfig = {
  clarityThreshold: 0.9, // Require high confidence for piano
  minFrequency: 27.5,    // A0 - lowest piano note
  maxFrequency: 4200,    // Just above C8 - highest piano note
};

// Note names for conversion
const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];

/**
 * Convert frequency to MIDI note number
 * MIDI note 69 = A4 = 440 Hz
 */
function frequencyToMidi(frequency: number): number {
  return 12 * Math.log2(frequency / 440) + 69;
}

/**
 * Convert MIDI note to frequency
 */
function midiToFrequency(midi: number): number {
  return 440 * Math.pow(2, (midi - 69) / 12);
}

/**
 * Convert MIDI note to note name with octave
 */
function midiToNoteName(midi: number): string {
  const noteIndex = Math.round(midi) % 12;
  const octave = Math.floor(Math.round(midi) / 12) - 1;
  return `${NOTE_NAMES[noteIndex]}${octave}`;
}

/**
 * Calculate how far off from the exact note (in cents)
 * Positive = sharp, Negative = flat
 */
function calculateCentsOff(frequency: number, targetMidi: number): number {
  const targetFrequency = midiToFrequency(targetMidi);
  return 1200 * Math.log2(frequency / targetFrequency);
}

export class PitchDetector {
  private config: PitchDetectorConfig;
  private detector: ReturnType<typeof PitchyDetector.forFloat32Array> | null = null;
  private inputLength: number = 0;

  constructor(config: Partial<PitchDetectorConfig> = {}) {
    this.config = { ...defaultPitchDetectorConfig, ...config };
  }

  /**
   * Initialize the pitch detector for a given buffer size
   * Must be called before detectPitch()
   */
  initialize(bufferSize: number): void {
    this.inputLength = bufferSize;
    this.detector = PitchyDetector.forFloat32Array(bufferSize);
    console.log('[PitchDetector] Initialized', { bufferSize });
  }

  /**
   * Detect pitch from audio data
   *
   * @param audioData - Float32Array of time-domain audio samples
   * @param sampleRate - Sample rate of the audio data (e.g., 44100)
   * @returns Detection result or null if no clear pitch detected
   */
  detectPitch(audioData: Float32Array, sampleRate: number): PitchDetectionResult | null {
    if (!this.detector) {
      console.warn('[PitchDetector] Not initialized - call initialize() first');
      return null;
    }

    // Ensure input matches expected length
    if (audioData.length !== this.inputLength) {
      console.warn('[PitchDetector] Input length mismatch', {
        expected: this.inputLength,
        received: audioData.length,
      });
      // Reinitialize with new size
      this.initialize(audioData.length);
    }

    // Detect pitch using pitchy
    const [frequency, clarity] = this.detector!.findPitch(audioData, sampleRate);

    // Filter out unclear detections
    if (clarity < this.config.clarityThreshold) {
      return null;
    }

    // Filter out frequencies outside piano range
    if (frequency < this.config.minFrequency || frequency > this.config.maxFrequency) {
      return null;
    }

    // Convert to MIDI
    const midiFloat = frequencyToMidi(frequency);
    const midiRounded = Math.round(midiFloat);

    // Calculate how far off from the exact note
    const centsOff = calculateCentsOff(frequency, midiRounded);

    // Get note name
    const noteName = midiToNoteName(midiRounded);

    return {
      midi: midiRounded,
      noteName,
      frequency,
      clarity,
      centsOff,
    };
  }

  /**
   * Update configuration
   */
  updateConfig(config: Partial<PitchDetectorConfig>): void {
    this.config = { ...this.config, ...config };
  }

  /**
   * Get current configuration
   */
  getConfig(): PitchDetectorConfig {
    return { ...this.config };
  }

  /**
   * Clean up resources
   */
  dispose(): void {
    this.detector = null;
    this.inputLength = 0;
    console.log('[PitchDetector] Disposed');
  }
}

// Export utility functions for use elsewhere
export { frequencyToMidi, midiToFrequency, midiToNoteName };
