/**
 * Video Analyzer
 *
 * Analyzes extracted audio from videos to detect piano notes.
 * Runs in the renderer process using Web Audio API for decoding.
 */

import { PitchDetector, type PitchDetectorConfig } from './PitchDetector';

// Type for Electron API (subset needed by this module)
declare global {
  interface Window {
    electronAPI?: {
      readAudioFile: (filePath: string) => Promise<string | null>;
    };
  }
}

export interface DetectedNoteEvent {
  midi: number;
  noteName: string;
  startTime: number;  // seconds
  endTime: number;    // seconds
  duration: number;   // seconds
  avgClarity: number;
  avgFrequency: number;
}

export interface AnalysisProgress {
  status: 'loading' | 'decoding' | 'analyzing' | 'complete' | 'error';
  progress: number;  // 0-100
  message?: string;
  currentTime?: number;
  totalDuration?: number;
}

export interface AnalysisResult {
  notes: DetectedNoteEvent[];
  duration: number;
  sampleRate: number;
  analysisTime: number;  // How long analysis took (ms)
}

export interface VideoAnalyzerConfig {
  // Pitch detector config
  pitchDetector: Partial<PitchDetectorConfig>;
  // Analysis window size (samples)
  windowSize: number;
  // Hop size between windows (samples)
  hopSize: number;
  // Minimum note duration to consider (seconds)
  minNoteDuration: number;
  // Minimum clarity to consider a detection valid
  minClarity: number;
  // Gap threshold to merge nearby same-pitch notes (seconds)
  mergeGapThreshold: number;
}

const defaultConfig: VideoAnalyzerConfig = {
  pitchDetector: {
    clarityThreshold: 0.85,
    minFrequency: 65,   // C2
    maxFrequency: 2100, // C7
  },
  windowSize: 2048,
  hopSize: 512,       // 4x overlap
  minNoteDuration: 0.05,  // 50ms minimum
  minClarity: 0.8,
  mergeGapThreshold: 0.1, // Merge notes within 100ms
};

export class VideoAnalyzer {
  private config: VideoAnalyzerConfig;
  private pitchDetector: PitchDetector;
  private audioContext: AudioContext | null = null;

  constructor(config: Partial<VideoAnalyzerConfig> = {}) {
    this.config = {
      ...defaultConfig,
      ...config,
      pitchDetector: { ...defaultConfig.pitchDetector, ...config.pitchDetector },
    };
    this.pitchDetector = new PitchDetector(this.config.pitchDetector);
  }

  /**
   * Analyze an audio file to extract note events
   */
  async analyzeFile(
    filePath: string,
    onProgress?: (progress: AnalysisProgress) => void
  ): Promise<AnalysisResult | null> {
    const startTime = performance.now();

    try {
      // Initialize audio context
      if (!this.audioContext) {
        this.audioContext = new AudioContext();
      }

      onProgress?.({ status: 'loading', progress: 0, message: 'Loading audio file...' });

      // Load audio file via IPC (file:// is blocked by Electron security)
      if (!window.electronAPI?.readAudioFile) {
        throw new Error('readAudioFile not available - not running in Electron');
      }

      const base64Data = await window.electronAPI.readAudioFile(filePath);
      if (!base64Data) {
        throw new Error('Failed to read audio file');
      }

      // Convert base64 to ArrayBuffer
      const binaryString = atob(base64Data);
      const bytes = new Uint8Array(binaryString.length);
      for (let i = 0; i < binaryString.length; i++) {
        bytes[i] = binaryString.charCodeAt(i);
      }
      const arrayBuffer = bytes.buffer;
      onProgress?.({ status: 'decoding', progress: 10, message: 'Decoding audio...' });

      // Decode audio
      const audioBuffer = await this.audioContext.decodeAudioData(arrayBuffer);
      const sampleRate = audioBuffer.sampleRate;
      const duration = audioBuffer.duration;

      console.log('[VideoAnalyzer] Audio decoded', {
        duration: duration.toFixed(2),
        sampleRate,
        channels: audioBuffer.numberOfChannels,
      });

      onProgress?.({
        status: 'analyzing',
        progress: 15,
        message: 'Analyzing audio...',
        totalDuration: duration,
      });

      // Get audio data (mono - average channels if stereo)
      const channelData = this.getMonoData(audioBuffer);

      // Initialize pitch detector
      this.pitchDetector.initialize(this.config.windowSize);

      // Analyze in windows
      const rawDetections = this.analyzeWindows(
        channelData,
        sampleRate,
        duration,
        onProgress
      );

      onProgress?.({ status: 'analyzing', progress: 90, message: 'Processing detections...' });

      // Convert raw detections to note events
      const notes = this.detectionsToNoteEvents(rawDetections, sampleRate);

      const analysisTime = performance.now() - startTime;

      console.log('[VideoAnalyzer] Analysis complete', {
        notesDetected: notes.length,
        duration: duration.toFixed(2),
        analysisTime: (analysisTime / 1000).toFixed(2) + 's',
      });

      onProgress?.({ status: 'complete', progress: 100, message: `Found ${notes.length} notes` });

      return {
        notes,
        duration,
        sampleRate,
        analysisTime,
      };
    } catch (err) {
      const error = err as Error;
      console.error('[VideoAnalyzer] Analysis failed', error);
      onProgress?.({ status: 'error', progress: 0, message: error.message });
      return null;
    }
  }

  /**
   * Convert stereo to mono by averaging channels
   */
  private getMonoData(audioBuffer: AudioBuffer): Float32Array {
    if (audioBuffer.numberOfChannels === 1) {
      return audioBuffer.getChannelData(0);
    }

    const left = audioBuffer.getChannelData(0);
    const right = audioBuffer.getChannelData(1);
    const mono = new Float32Array(left.length);

    for (let i = 0; i < left.length; i++) {
      mono[i] = (left[i] + right[i]) / 2;
    }

    return mono;
  }

  /**
   * Analyze audio in overlapping windows
   */
  private analyzeWindows(
    audioData: Float32Array,
    sampleRate: number,
    duration: number,
    onProgress?: (progress: AnalysisProgress) => void
  ): Array<{ time: number; midi: number; clarity: number; frequency: number }> {
    const detections: Array<{ time: number; midi: number; clarity: number; frequency: number }> = [];

    const totalSamples = audioData.length;
    const windowSize = this.config.windowSize;
    const hopSize = this.config.hopSize;
    const numWindows = Math.floor((totalSamples - windowSize) / hopSize);

    const windowBuffer = new Float32Array(windowSize);

    for (let i = 0; i < numWindows; i++) {
      const startSample = i * hopSize;
      const time = startSample / sampleRate;

      // Extract window
      for (let j = 0; j < windowSize; j++) {
        windowBuffer[j] = audioData[startSample + j];
      }

      // Detect pitch
      const result = this.pitchDetector.detectPitch(windowBuffer, sampleRate);

      if (result && result.clarity >= this.config.minClarity) {
        detections.push({
          time,
          midi: result.midi,
          clarity: result.clarity,
          frequency: result.frequency,
        });
      }

      // Progress update every 5%
      if (i % Math.floor(numWindows / 20) === 0) {
        const progress = 15 + (i / numWindows) * 75;
        onProgress?.({
          status: 'analyzing',
          progress,
          message: `Analyzing: ${time.toFixed(1)}s / ${duration.toFixed(1)}s`,
          currentTime: time,
          totalDuration: duration,
        });
      }
    }

    return detections;
  }

  /**
   * Convert raw pitch detections to discrete note events
   */
  private detectionsToNoteEvents(
    detections: Array<{ time: number; midi: number; clarity: number; frequency: number }>,
    sampleRate: number
  ): DetectedNoteEvent[] {
    if (detections.length === 0) return [];

    const noteEvents: DetectedNoteEvent[] = [];
    const hopDuration = this.config.hopSize / sampleRate;

    let currentNote: {
      midi: number;
      startTime: number;
      endTime: number;
      claritySum: number;
      frequencySum: number;
      count: number;
    } | null = null;

    for (const detection of detections) {
      if (currentNote === null) {
        // Start new note
        currentNote = {
          midi: detection.midi,
          startTime: detection.time,
          endTime: detection.time + hopDuration,
          claritySum: detection.clarity,
          frequencySum: detection.frequency,
          count: 1,
        };
      } else if (detection.midi === currentNote.midi) {
        // Continue current note
        currentNote.endTime = detection.time + hopDuration;
        currentNote.claritySum += detection.clarity;
        currentNote.frequencySum += detection.frequency;
        currentNote.count++;
      } else {
        // Note changed - save current and start new
        const duration = currentNote.endTime - currentNote.startTime;
        if (duration >= this.config.minNoteDuration) {
          noteEvents.push({
            midi: currentNote.midi,
            noteName: this.midiToNoteName(currentNote.midi),
            startTime: currentNote.startTime,
            endTime: currentNote.endTime,
            duration,
            avgClarity: currentNote.claritySum / currentNote.count,
            avgFrequency: currentNote.frequencySum / currentNote.count,
          });
        }

        currentNote = {
          midi: detection.midi,
          startTime: detection.time,
          endTime: detection.time + hopDuration,
          claritySum: detection.clarity,
          frequencySum: detection.frequency,
          count: 1,
        };
      }
    }

    // Don't forget the last note
    if (currentNote) {
      const duration = currentNote.endTime - currentNote.startTime;
      if (duration >= this.config.minNoteDuration) {
        noteEvents.push({
          midi: currentNote.midi,
          noteName: this.midiToNoteName(currentNote.midi),
          startTime: currentNote.startTime,
          endTime: currentNote.endTime,
          duration,
          avgClarity: currentNote.claritySum / currentNote.count,
          avgFrequency: currentNote.frequencySum / currentNote.count,
        });
      }
    }

    // Merge notes with small gaps
    return this.mergeCloseNotes(noteEvents);
  }

  /**
   * Merge notes of the same pitch that are close together
   */
  private mergeCloseNotes(notes: DetectedNoteEvent[]): DetectedNoteEvent[] {
    if (notes.length <= 1) return notes;

    const merged: DetectedNoteEvent[] = [];
    let current = notes[0];

    for (let i = 1; i < notes.length; i++) {
      const next = notes[i];

      if (
        next.midi === current.midi &&
        next.startTime - current.endTime <= this.config.mergeGapThreshold
      ) {
        // Merge notes
        current = {
          ...current,
          endTime: next.endTime,
          duration: next.endTime - current.startTime,
          avgClarity: (current.avgClarity + next.avgClarity) / 2,
          avgFrequency: (current.avgFrequency + next.avgFrequency) / 2,
        };
      } else {
        merged.push(current);
        current = next;
      }
    }

    merged.push(current);
    return merged;
  }

  /**
   * Convert MIDI number to note name
   */
  private midiToNoteName(midi: number): string {
    const noteNames = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
    const octave = Math.floor(midi / 12) - 1;
    const note = noteNames[midi % 12];
    return `${note}${octave}`;
  }

  /**
   * Update configuration
   */
  updateConfig(config: Partial<VideoAnalyzerConfig>): void {
    this.config = {
      ...this.config,
      ...config,
      pitchDetector: { ...this.config.pitchDetector, ...config.pitchDetector },
    };
    if (config.pitchDetector) {
      this.pitchDetector.updateConfig(config.pitchDetector);
    }
  }

  /**
   * Clean up resources
   */
  dispose(): void {
    this.pitchDetector.dispose();
    if (this.audioContext) {
      this.audioContext.close();
      this.audioContext = null;
    }
  }
}

// Singleton instance
let analyzerInstance: VideoAnalyzer | null = null;

export function getVideoAnalyzer(): VideoAnalyzer {
  if (!analyzerInstance) {
    analyzerInstance = new VideoAnalyzer();
  }
  return analyzerInstance;
}
