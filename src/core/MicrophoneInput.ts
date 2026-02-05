/**
 * Microphone Input Module
 *
 * High-level module that combines AudioCapture and PitchDetector
 * to provide a simple interface for detecting piano notes from microphone input.
 *
 * Usage:
 *   const micInput = new MicrophoneInput();
 *   await micInput.initialize();
 *   micInput.start((result) => {
 *     console.log('Detected note:', result.noteName, 'MIDI:', result.midi);
 *   });
 */

import { AudioCapture, type AudioCaptureConfig, type AudioCaptureStatus } from './AudioCapture';
import { PitchDetector, type PitchDetectorConfig, type PitchDetectionResult } from './PitchDetector';

export interface MicrophoneInputConfig {
  audioCapture: Partial<AudioCaptureConfig>;
  pitchDetector: Partial<PitchDetectorConfig>;
  // Debounce time in ms - ignore rapid repeated detections of same note
  debounceMs: number;
  // How long to hold a note before considering it "released" (ms)
  noteHoldMs: number;
}

export const defaultMicrophoneInputConfig: MicrophoneInputConfig = {
  audioCapture: {},
  pitchDetector: {},
  debounceMs: 50,   // Ignore repeated detections within 50ms
  noteHoldMs: 100,  // Note released after 100ms of no detection
};

export interface NoteEvent {
  type: 'on' | 'off';
  midi: number;
  noteName: string;
  frequency: number;
  clarity: number;
  velocity: number; // Simulated from audio amplitude (0-1)
}

export type NoteEventCallback = (event: NoteEvent) => void;

export class MicrophoneInput {
  private config: MicrophoneInputConfig;
  private audioCapture: AudioCapture;
  private pitchDetector: PitchDetector;

  // State tracking
  private isRunning: boolean = false;
  private currentNote: number | null = null;
  private lastNoteTime: number = 0;
  private noteHoldTimeout: ReturnType<typeof setTimeout> | null = null;

  // Callback for note events
  private onNoteCallback: NoteEventCallback | null = null;

  constructor(config: Partial<MicrophoneInputConfig> = {}) {
    this.config = {
      ...defaultMicrophoneInputConfig,
      ...config,
      audioCapture: { ...defaultMicrophoneInputConfig.audioCapture, ...config.audioCapture },
      pitchDetector: { ...defaultMicrophoneInputConfig.pitchDetector, ...config.pitchDetector },
    };

    this.audioCapture = new AudioCapture(this.config.audioCapture);
    this.pitchDetector = new PitchDetector(this.config.pitchDetector);
  }

  /**
   * Initialize microphone input - requests permission
   */
  async initialize(): Promise<boolean> {
    const success = await this.audioCapture.initialize();

    if (success) {
      // Initialize pitch detector with the audio buffer size
      this.pitchDetector.initialize(this.audioCapture.getBufferSize());
    }

    return success;
  }

  /**
   * Start listening for notes
   * @param callback - Called when note on/off events occur
   */
  start(callback: NoteEventCallback): void {
    if (this.isRunning) {
      console.log('[MicrophoneInput] Already running');
      return;
    }

    this.onNoteCallback = callback;
    this.isRunning = true;

    // Start audio capture with our processing callback
    this.audioCapture.start((audioData) => {
      this.processAudio(audioData);
    });

    console.log('[MicrophoneInput] Started');
  }

  /**
   * Stop listening for notes
   */
  stop(): void {
    if (!this.isRunning) {
      return;
    }

    this.audioCapture.stop();
    this.isRunning = false;

    // Clear any pending note-off
    if (this.noteHoldTimeout) {
      clearTimeout(this.noteHoldTimeout);
      this.noteHoldTimeout = null;
    }

    // Send note-off for any held note
    if (this.currentNote !== null && this.onNoteCallback) {
      this.onNoteCallback({
        type: 'off',
        midi: this.currentNote,
        noteName: '',
        frequency: 0,
        clarity: 0,
        velocity: 0,
      });
    }

    this.currentNote = null;
    this.onNoteCallback = null;

    console.log('[MicrophoneInput] Stopped');
  }

  /**
   * Process audio data and emit note events
   */
  private processAudio(audioData: Float32Array): void {
    const sampleRate = this.audioCapture.getSampleRate();
    const result = this.pitchDetector.detectPitch(audioData, sampleRate);

    // Debug: log every ~30 frames to show audio is being processed
    if (Math.random() < 0.03) {
      const rms = this.calculateVelocity(audioData);
      console.log('[MicrophoneInput] Processing audio, RMS:', rms.toFixed(3),
        result ? `Detected: ${result.noteName} (${result.clarity.toFixed(2)})` : 'No pitch detected');
    }

    const now = Date.now();

    if (result) {
      // Calculate velocity from audio amplitude (RMS)
      const velocity = this.calculateVelocity(audioData);

      // Check if this is a new note
      if (result.midi !== this.currentNote) {
        // If we had a previous note, send note-off
        if (this.currentNote !== null && this.onNoteCallback) {
          this.onNoteCallback({
            type: 'off',
            midi: this.currentNote,
            noteName: '',
            frequency: 0,
            clarity: 0,
            velocity: 0,
          });
        }

        // Send note-on for new note (with debounce check)
        if (now - this.lastNoteTime >= this.config.debounceMs) {
          this.currentNote = result.midi;
          this.lastNoteTime = now;

          if (this.onNoteCallback) {
            this.onNoteCallback({
              type: 'on',
              midi: result.midi,
              noteName: result.noteName,
              frequency: result.frequency,
              clarity: result.clarity,
              velocity,
            });
          }
        }
      }

      // Reset the note-hold timeout since we're still detecting the note
      this.resetNoteHoldTimeout(result);
    }
  }

  /**
   * Calculate velocity from audio amplitude
   */
  private calculateVelocity(audioData: Float32Array): number {
    // Calculate RMS (root mean square) for amplitude
    let sum = 0;
    for (let i = 0; i < audioData.length; i++) {
      sum += audioData[i] * audioData[i];
    }
    const rms = Math.sqrt(sum / audioData.length);

    // Map RMS to velocity (0-1)
    // Typical RMS values: 0.001 (quiet) to 0.5 (loud)
    // Clamp and scale to 0-1 range
    const minRms = 0.01;
    const maxRms = 0.3;
    const velocity = Math.min(1, Math.max(0, (rms - minRms) / (maxRms - minRms)));

    return velocity;
  }

  /**
   * Reset the note-hold timeout
   * If no pitch is detected for noteHoldMs, send note-off
   */
  private resetNoteHoldTimeout(lastResult: PitchDetectionResult): void {
    if (this.noteHoldTimeout) {
      clearTimeout(this.noteHoldTimeout);
    }

    this.noteHoldTimeout = setTimeout(() => {
      if (this.currentNote !== null && this.onNoteCallback) {
        this.onNoteCallback({
          type: 'off',
          midi: this.currentNote,
          noteName: lastResult.noteName,
          frequency: lastResult.frequency,
          clarity: 0,
          velocity: 0,
        });
        this.currentNote = null;
      }
    }, this.config.noteHoldMs);
  }

  /**
   * Get current status
   */
  getStatus(): AudioCaptureStatus {
    return this.audioCapture.getState().status;
  }

  /**
   * Check if currently listening
   */
  isListening(): boolean {
    return this.isRunning;
  }

  /**
   * Get the currently held note (or null)
   */
  getCurrentNote(): number | null {
    return this.currentNote;
  }

  /**
   * Update configuration
   */
  updateConfig(config: Partial<MicrophoneInputConfig>): void {
    if (config.audioCapture) {
      this.audioCapture.updateConfig(config.audioCapture);
    }
    if (config.pitchDetector) {
      this.pitchDetector.updateConfig(config.pitchDetector);
    }
    if (config.debounceMs !== undefined) {
      this.config.debounceMs = config.debounceMs;
    }
    if (config.noteHoldMs !== undefined) {
      this.config.noteHoldMs = config.noteHoldMs;
    }
  }

  /**
   * Clean up resources
   */
  dispose(): void {
    this.stop();
    this.audioCapture.dispose();
    this.pitchDetector.dispose();
    console.log('[MicrophoneInput] Disposed');
  }
}

// Re-export types for convenience
export type { PitchDetectionResult } from './PitchDetector';
export type { AudioCaptureStatus } from './AudioCapture';
