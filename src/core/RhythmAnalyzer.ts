/**
 * Rhythm Analyzer
 *
 * In-process beat/chord analysis using Web Audio API.
 * No Python dependency — runs entirely in the renderer.
 *
 * Algorithm:
 * 1. Decode audio to mono PCM
 * 2. Compute spectral flux for onset detection
 * 3. Estimate tempo via autocorrelation of onset function
 * 4. Build beat grid from tempo + first beat
 * 5. Extract chroma features per beat
 * 6. Match chroma to chord templates
 * 7. Smooth chord sequence with transition penalties
 */

import type {
  AnalyzerAdapter,
  AnalysisOptions,
  AnalysisResult,
  BeatEvent,
  BeatGrid,
  ChordEvent,
  ChordVoicingData,
} from './rhythmTypes';
import { CHORD_VOICINGS } from '../data/chordProgressions';

// ============================================
// Audio Utilities
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
// Spectral Analysis
// ============================================

const FFT_SIZE = 4096;
const HOP_SIZE = 2048;

/**
 * Fast chroma extraction using Goertzel algorithm
 * Much faster than full DFT — only computes the 12 bins we need
 */
function extractChroma(frame: Float32Array, sampleRate: number): Float32Array {
  const n = frame.length;
  const chroma = new Float32Array(12);

  // Apply Hann window
  const windowed = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const w = 0.5 * (1 - Math.cos((2 * Math.PI * i) / (n - 1)));
    windowed[i] = frame[i] * w;
  }

  // For each semitone across relevant octaves (C2 to C7 ≈ 65Hz to 2093Hz)
  // Accumulate energy into 12 chroma bins
  for (let octave = 2; octave <= 6; octave++) {
    for (let pitch = 0; pitch < 12; pitch++) {
      const midi = (octave + 1) * 12 + pitch; // MIDI note number
      const freq = 440 * Math.pow(2, (midi - 69) / 12);

      if (freq >= sampleRate / 2) continue; // Skip if above Nyquist

      // Goertzel algorithm for this frequency
      const k = Math.round(freq * n / sampleRate);
      const w0 = (2 * Math.PI * k) / n;
      const coeff = 2 * Math.cos(w0);

      let s0 = 0;
      let s1 = 0;
      let s2 = 0;

      for (let i = 0; i < n; i++) {
        s0 = windowed[i] + coeff * s1 - s2;
        s2 = s1;
        s1 = s0;
      }

      const power = s1 * s1 + s2 * s2 - coeff * s1 * s2;
      chroma[pitch] += Math.max(0, power);
    }
  }

  // Normalize
  let maxVal = 0;
  for (let i = 0; i < 12; i++) {
    if (chroma[i] > maxVal) maxVal = chroma[i];
  }
  if (maxVal > 0) {
    for (let i = 0; i < 12; i++) {
      chroma[i] /= maxVal;
    }
  }

  return chroma;
}

// ============================================
// Beat Detection
// ============================================

/**
 * Compute spectral flux (onset strength) using energy difference between frames
 */
function computeOnsetStrength(
  audio: Float32Array,
  sampleRate: number,
): { times: Float32Array; strength: Float32Array } {
  const frameCount = Math.floor((audio.length - FFT_SIZE) / HOP_SIZE);
  if (frameCount < 2) {
    return { times: new Float32Array(0), strength: new Float32Array(0) };
  }

  const strength = new Float32Array(frameCount);
  const times = new Float32Array(frameCount);

  // Use energy-based onset detection (much faster than full DFT spectral flux)
  let prevEnergy = 0;

  for (let i = 0; i < frameCount; i++) {
    const start = i * HOP_SIZE;
    times[i] = start / sampleRate;

    // Compute frame energy
    let energy = 0;
    for (let j = 0; j < FFT_SIZE; j++) {
      const s = audio[start + j];
      energy += s * s;
    }
    energy /= FFT_SIZE;

    // Half-wave rectified energy difference (only positive changes = onsets)
    strength[i] = Math.max(0, energy - prevEnergy);
    prevEnergy = energy;
  }

  return { times, strength };
}

/**
 * Estimate tempo via autocorrelation of onset strength
 */
function estimateTempo(
  strength: Float32Array,
  hopRate: number,
  tempoHint?: number,
): number {
  const n = strength.length;
  if (n < 10) return tempoHint || 120;

  // Autocorrelation for lags corresponding to 40-220 BPM
  const minBpm = 40;
  const maxBpm = 220;
  const minLag = Math.floor(hopRate * 60 / maxBpm);
  const maxLag = Math.ceil(hopRate * 60 / minBpm);

  let bestLag = Math.round(hopRate * 60 / (tempoHint || 120));
  let bestCorr = -Infinity;

  for (let lag = minLag; lag <= Math.min(maxLag, n - 1); lag++) {
    let corr = 0;
    let count = 0;
    for (let i = 0; i < n - lag; i++) {
      corr += strength[i] * strength[i + lag];
      count++;
    }
    corr /= count;

    // Slight preference for tempos near hint
    if (tempoHint) {
      const lagBpm = hopRate * 60 / lag;
      const ratio = lagBpm / tempoHint;
      // Boost if near 1x or 2x the hint
      if (Math.abs(ratio - 1) < 0.1 || Math.abs(ratio - 2) < 0.1 || Math.abs(ratio - 0.5) < 0.1) {
        corr *= 1.2;
      }
    }

    if (corr > bestCorr) {
      bestCorr = corr;
      bestLag = lag;
    }
  }

  const bpm = hopRate * 60 / bestLag;

  // Prefer tempos in 60-180 range (double or halve if outside)
  let finalBpm = bpm;
  while (finalBpm < 60) finalBpm *= 2;
  while (finalBpm > 180) finalBpm /= 2;

  return Math.round(finalBpm * 10) / 10;
}

/**
 * Find first beat position using onset strength peaks
 */
function findFirstBeat(
  times: Float32Array,
  strength: Float32Array,
  tempo: number,
  hopRate: number,
): number {
  const beatPeriod = 60 / tempo;
  const searchWindow = Math.min(Math.ceil(beatPeriod * hopRate), strength.length);

  // Find strongest onset in first beat period
  let bestIdx = 0;
  let bestStr = 0;
  for (let i = 0; i < searchWindow; i++) {
    if (strength[i] > bestStr) {
      bestStr = strength[i];
      bestIdx = i;
    }
  }

  return times[bestIdx] || 0;
}

/**
 * Build a uniform beat grid from tempo and first beat
 */
function buildBeatGrid(
  tempo: number,
  firstBeat: number,
  duration: number,
  timeSignature: { numerator: number; denominator: number },
): BeatGrid {
  const beatDuration = 60 / tempo;
  const beats: BeatEvent[] = [];
  let bar = 1;
  let beatInBar = 1;

  for (let time = firstBeat; time < duration; time += beatDuration) {
    beats.push({
      time,
      bar,
      beatInBar,
      tempoLocal: tempo,
      confidence: 0.8,
    });

    beatInBar++;
    if (beatInBar > timeSignature.numerator) {
      beatInBar = 1;
      bar++;
    }
  }

  return {
    tempo,
    timeSignature,
    beats,
    barCount: bar - (beatInBar === 1 ? 0 : 1),
  };
}

// ============================================
// Chord Detection
// ============================================

/** Chord template: 12-element binary vector (1 = pitch class present) */
interface ChordTemplate {
  symbol: string;
  template: number[];
}

/**
 * Build chord templates for matching
 * Each template is a 12-bin chroma vector (C=0, C#=1, ... B=11)
 */
function buildChordTemplates(): ChordTemplate[] {
  const templates: ChordTemplate[] = [];
  const noteNames = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];

  // Also support flat naming
  const flatToSharp: Record<string, string> = {
    'Db': 'C#', 'Eb': 'D#', 'Fb': 'E', 'Gb': 'F#', 'Ab': 'G#', 'Bb': 'A#', 'Cb': 'B',
  };

  for (let root = 0; root < 12; root++) {
    const rootName = noteNames[root];

    // Major: root + 4 + 7
    const major = new Array(12).fill(0);
    major[root] = 1;
    major[(root + 4) % 12] = 1;
    major[(root + 7) % 12] = 1;
    templates.push({ symbol: rootName, template: major });

    // Minor: root + 3 + 7
    const minor = new Array(12).fill(0);
    minor[root] = 1;
    minor[(root + 3) % 12] = 1;
    minor[(root + 7) % 12] = 1;
    templates.push({ symbol: `${rootName}m`, template: minor });

    // Dominant 7: root + 4 + 7 + 10
    const dom7 = new Array(12).fill(0);
    dom7[root] = 1;
    dom7[(root + 4) % 12] = 1;
    dom7[(root + 7) % 12] = 1;
    dom7[(root + 10) % 12] = 1;
    templates.push({ symbol: `${rootName}7`, template: dom7 });
  }

  // Add flat-named aliases for common chords
  for (const [flat, sharp] of Object.entries(flatToSharp)) {
    const sharpMajor = templates.find(t => t.symbol === sharp);
    if (sharpMajor) {
      templates.push({ symbol: flat, template: [...sharpMajor.template] });
    }
    const sharpMinor = templates.find(t => t.symbol === `${sharp}m`);
    if (sharpMinor) {
      templates.push({ symbol: `${flat}m`, template: [...sharpMinor.template] });
    }
  }

  return templates;
}

const CHORD_TEMPLATES = buildChordTemplates();

/**
 * Match a chroma vector to the best chord template
 */
function matchChroma(chroma: Float32Array): { symbol: string; confidence: number } {
  let bestSymbol = 'N'; // No chord
  let bestScore = 0;

  for (const { symbol, template } of CHORD_TEMPLATES) {
    // Cosine similarity
    let dot = 0;
    let normA = 0;
    let normB = 0;
    for (let i = 0; i < 12; i++) {
      dot += chroma[i] * template[i];
      normA += chroma[i] * chroma[i];
      normB += template[i] * template[i];
    }

    const denom = Math.sqrt(normA) * Math.sqrt(normB);
    const similarity = denom > 0 ? dot / denom : 0;

    if (similarity > bestScore) {
      bestScore = similarity;
      bestSymbol = symbol;
    }
  }

  return { symbol: bestSymbol, confidence: bestScore };
}

/**
 * Extract chroma per beat and match chords
 */
function detectChordsPerBeat(
  audio: Float32Array,
  sampleRate: number,
  beatGrid: BeatGrid,
): Array<{ bar: number; beat: number; time: number; symbol: string; confidence: number }> {
  const results: Array<{ bar: number; beat: number; time: number; symbol: string; confidence: number }> = [];

  for (const beat of beatGrid.beats) {
    const startSample = Math.floor(beat.time * sampleRate);
    const endSample = Math.min(startSample + FFT_SIZE, audio.length);

    if (endSample - startSample < FFT_SIZE / 2) continue;

    // Extract frame at this beat
    const frame = new Float32Array(FFT_SIZE);
    const available = endSample - startSample;
    for (let i = 0; i < available; i++) {
      frame[i] = audio[startSample + i];
    }

    const chroma = extractChroma(frame, sampleRate);
    const match = matchChroma(chroma);

    results.push({
      bar: beat.bar,
      beat: beat.beatInBar,
      time: beat.time,
      symbol: match.symbol,
      confidence: match.confidence,
    });
  }

  return results;
}

// ============================================
// Chord Smoothing
// ============================================

/**
 * Smooth raw per-beat chord detections into bar-level chord events.
 * Uses majority voting per bar with transition penalty.
 */
function smoothChords(
  rawChords: Array<{ bar: number; beat: number; time: number; symbol: string; confidence: number }>,
  beatGrid: BeatGrid,
): ChordEvent[] {
  if (rawChords.length === 0) return [];

  // Group by bar
  const barGroups = new Map<number, typeof rawChords>();
  for (const chord of rawChords) {
    const group = barGroups.get(chord.bar) || [];
    group.push(chord);
    barGroups.set(chord.bar, group);
  }

  // Majority vote per bar
  const barChords: Array<{ bar: number; symbol: string; confidence: number; time: number; endTime: number }> = [];

  for (const [bar, group] of barGroups) {
    // Weighted vote by confidence
    const votes = new Map<string, number>();
    for (const { symbol, confidence } of group) {
      votes.set(symbol, (votes.get(symbol) || 0) + confidence);
    }

    let bestSymbol = 'N';
    let bestVotes = 0;
    for (const [symbol, weight] of votes) {
      if (weight > bestVotes) {
        bestVotes = weight;
        bestSymbol = symbol;
      }
    }

    const avgConf = bestVotes / group.length;
    const startTime = group[0].time;
    const beatDuration = 60 / beatGrid.tempo;
    const endTime = startTime + beatGrid.timeSignature.numerator * beatDuration;

    barChords.push({ bar, symbol: bestSymbol, confidence: avgConf, time: startTime, endTime });
  }

  // Sort by bar
  barChords.sort((a, b) => a.bar - b.bar);

  // Merge consecutive bars with same chord
  const merged: ChordEvent[] = [];
  let current = barChords[0];
  let eventId = 1;

  for (let i = 1; i < barChords.length; i++) {
    const next = barChords[i];
    if (next.symbol === current.symbol) {
      // Extend
      current = {
        ...current,
        endTime: next.endTime,
        confidence: (current.confidence + next.confidence) / 2,
      };
    } else {
      // Emit and start new
      merged.push(toChordEvent(current, eventId++));
      current = next;
    }
  }
  merged.push(toChordEvent(current, eventId));

  return merged;
}

function toChordEvent(
  raw: { bar: number; symbol: string; confidence: number; time: number; endTime: number },
  id: number,
): ChordEvent {
  const beatDuration = 60 / 120; // Will be overridden by actual tempo
  const barSpan = Math.round((raw.endTime - raw.time) / (beatDuration * 4)) || 1;

  return {
    id: `chord_${id}`,
    startTime: raw.time,
    endTime: raw.endTime,
    barStart: raw.bar,
    barEnd: raw.bar + barSpan - 1,
    symbol: raw.symbol,
    confidence: raw.confidence,
    source: 'audio',
    voicing: lookupVoicing(raw.symbol),
  };
}

function lookupVoicing(symbol: string): ChordVoicingData | null {
  const voicing = CHORD_VOICINGS[symbol];
  if (!voicing) return null;
  return { bass: voicing.bass, notes: [...voicing.notes] };
}

// ============================================
// Main Analyzer
// ============================================

export class RhythmAnalyzer implements AnalyzerAdapter {
  async analyze(audioPath: string, options: AnalysisOptions = {}): Promise<AnalysisResult> {
    const start = performance.now();

    console.log('[RhythmAnalyzer] Starting analysis', { audioPath, options });

    // 1. Load and decode audio
    const audioBuffer = await loadAudioBuffer(audioPath);
    const sampleRate = audioBuffer.sampleRate;
    const duration = audioBuffer.duration;
    const audio = toMono(audioBuffer);

    console.log('[RhythmAnalyzer] Audio loaded', {
      duration: duration.toFixed(1),
      sampleRate,
      samples: audio.length,
    });

    // 2. Compute onset strength
    const { times, strength } = computeOnsetStrength(audio, sampleRate);
    const hopRate = sampleRate / HOP_SIZE;

    console.log('[RhythmAnalyzer] Onset strength computed', { frames: strength.length });

    // 3. Estimate tempo
    const tempo = estimateTempo(strength, hopRate, options.tempoHint);
    console.log('[RhythmAnalyzer] Tempo estimated', { bpm: tempo });

    // 4. Find first beat
    const firstBeat = findFirstBeat(times, strength, tempo, hopRate);

    // 5. Build beat grid
    const timeSignature = options.timeSignatureHint || { numerator: 4, denominator: 4 };
    const beatGrid = buildBeatGrid(tempo, firstBeat, duration, timeSignature);

    console.log('[RhythmAnalyzer] Beat grid built', {
      beats: beatGrid.beats.length,
      bars: beatGrid.barCount,
    });

    // 6. Detect chords per beat
    const rawChords = detectChordsPerBeat(audio, sampleRate, beatGrid);
    console.log('[RhythmAnalyzer] Raw chord detections', { count: rawChords.length });

    // 7. Smooth chords
    const chords = smoothChords(rawChords, beatGrid);
    console.log('[RhythmAnalyzer] Smoothed chords', { count: chords.length });

    const durationMs = performance.now() - start;

    return {
      beatGrid,
      chords,
      meta: {
        analysisVersion: 'rhythm-analyzer-v1',
        configHash: `fft${FFT_SIZE}_hop${HOP_SIZE}`,
        durationMs,
      },
    };
  }
}
