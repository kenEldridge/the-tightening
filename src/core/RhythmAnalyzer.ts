/**
 * Rhythm Analyzer (Browser Adapter)
 *
 * Browser/Electron entry point for rhythm analysis.
 * Decodes audio via Web Audio API, then delegates to the
 * environment-agnostic core in rhythmAnalyzeCore.ts.
 */

import type {
  AnalyzerAdapter,
  AnalysisOptions,
  AnalysisResult,
} from './rhythmTypes';
import { analyzeFromSamples } from './rhythmAnalyzeCore';

// ============================================
// Audio Utilities (Browser-only)
// ============================================

async function loadAudioBuffer(audioPath: string): Promise<AudioBuffer> {
  if (!window.electronAPI?.readAudioFile) {
    throw new Error('readAudioFile not available');
  }

  const base64 = await window.electronAPI.readAudioFile(audioPath);
  if (!base64) throw new Error('Failed to read audio file');

  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }

  const ctx = new OfflineAudioContext(1, 1, 44100);
  return ctx.decodeAudioData(bytes.buffer as ArrayBuffer);
}

function toMono(buffer: AudioBuffer): Float32Array {
  if (buffer.numberOfChannels === 1) return buffer.getChannelData(0);
  const left = buffer.getChannelData(0);
  const right = buffer.getChannelData(1);
  const mono = new Float32Array(left.length);
  for (let i = 0; i < left.length; i++) {
    mono[i] = (left[i] + right[i]) * 0.5;
  }
  return mono;
}

// ============================================
// Main Analyzer (Browser Adapter)
// ============================================

export class RhythmAnalyzer implements AnalyzerAdapter {
  async analyze(audioPath: string, options: AnalysisOptions = {}): Promise<AnalysisResult> {
    console.log('[RhythmAnalyzer] Loading audio', { audioPath });

    const audioBuffer = await loadAudioBuffer(audioPath);
    const sampleRate = audioBuffer.sampleRate;
    const duration = audioBuffer.duration;
    const audio = toMono(audioBuffer);

    console.log('[RhythmAnalyzer] Audio loaded', {
      duration: duration.toFixed(1),
      sampleRate,
      samples: audio.length,
    });

    return analyzeFromSamples(audio, sampleRate, duration, options);
  }
}
