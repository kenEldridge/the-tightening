/**
 * Node Rhythm Analyzer
 *
 * Node.js adapter for headless rhythm analysis.
 * Reads WAV from disk, delegates to the environment-agnostic core.
 */

import type { AnalyzerAdapter, AnalysisOptions, AnalysisResult } from '../core/rhythmTypes';
import { analyzeFromSamples } from '../core/rhythmAnalyzeCore';
import { loadWav } from './wavLoader';

export class NodeRhythmAnalyzer implements AnalyzerAdapter {
  async analyze(audioPath: string, options: AnalysisOptions = {}): Promise<AnalysisResult> {
    console.log('[NodeRhythmAnalyzer] Loading WAV', { audioPath });

    const wav = loadWav(audioPath);

    console.log('[NodeRhythmAnalyzer] WAV loaded', {
      duration: wav.duration.toFixed(1),
      sampleRate: wav.sampleRate,
      samples: wav.samples.length,
    });

    return analyzeFromSamples(wav.samples, wav.sampleRate, wav.duration, options);
  }
}
