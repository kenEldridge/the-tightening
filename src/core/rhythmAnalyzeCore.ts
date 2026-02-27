/**
 * Rhythm Analyze Core
 *
 * Environment-agnostic analysis logic extracted from RhythmAnalyzer.ts.
 * Pure numeric processing on Float32Array — no browser or Node imports.
 *
 * Algorithm:
 * 1. Compute spectral flux for onset detection
 * 2. Estimate tempo via autocorrelation of onset function
 * 3. Estimate time signature (3/4 vs 4/4) from accent patterns
 * 4. Build beat grid from tempo + first beat + time signature
 * 5. Extract chroma features per beat
 * 6. Match chroma to chord templates (with diatonic boosting)
 * 7. Detect key from chord distribution
 * 8. Re-score chords with key-aware diatonic bias
 * 9. Smooth chord sequence with bar-level majority vote
 * 10. Absorb short anomalous chords
 */

import type {
  AnalysisOptions,
  AnalysisResult,
  BeatEvent,
  BeatGrid,
  ChordEvent,
  ChordVoicingData,
  TimeSignatureDecision,
} from './rhythmTypes';
import { CHORD_VOICINGS } from '../data/chordProgressions';

// ============================================
// Spectral Analysis
// ============================================

const FFT_SIZE = 4096;
const HOP_SIZE = 2048;

// Beat correction tuning constants (centralized for future AnalysisOptions exposure)
const BEAT_NUDGE_WEIGHT = 0.6;
const BEAT_NUDGE_MAX_SHIFT_SEC = 0.08;
const BEAT_NUDGE_SEARCH_WINDOW_SEC = 0.12;
const BEAT_NUDGE_MIN_SPACING_FACTOR = 0.35; // minimum spacing as fraction of beatDuration
const BEAT_CONFIDENCE_FLOOR = 0.3; // confidence for beats with no nearby onset peak

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
 * Extract onset peaks (local maxima above p75 threshold).
 * Returns arrays of peak times and their normalized strengths.
 */
function extractOnsetPeaks(
  times: Float32Array,
  strength: Float32Array,
): { peakTimes: number[]; peakStrengths: number[] } {
  if (strength.length < 3) return { peakTimes: [], peakStrengths: [] };

  // Compute p75 of nonzero strength values as threshold
  const nonzero = Array.from(strength).filter(s => s > 0).sort((a, b) => a - b);
  const threshold = nonzero.length > 0
    ? nonzero[Math.floor(nonzero.length * 0.75)]
    : 0;

  const peakTimes: number[] = [];
  const peakStrengths: number[] = [];

  for (let i = 1; i < strength.length - 1; i++) {
    if (strength[i] >= threshold &&
        strength[i] >= strength[i - 1] &&
        strength[i] >= strength[i + 1]) {
      peakTimes.push(times[i]);
      peakStrengths.push(strength[i]);
    }
  }

  // Normalize peak strengths to 0-1
  const maxPeak = peakStrengths.length > 0 ? Math.max(...peakStrengths) : 1;
  if (maxPeak > 0) {
    for (let i = 0; i < peakStrengths.length; i++) {
      peakStrengths[i] /= maxPeak;
    }
  }

  return { peakTimes, peakStrengths };
}

/**
 * Apply onset-weighted correction to beat times.
 * Nudges each beat toward the nearest strong onset within a search window.
 */
function applyBeatNudging(
  beatGrid: BeatGrid,
  peakTimes: number[],
  peakStrengths: number[],
): void {
  if (peakTimes.length === 0) return;

  const beatDuration = 60 / beatGrid.tempo;
  const W = Math.min(BEAT_NUDGE_SEARCH_WINDOW_SEC, 0.25 * beatDuration);
  const minSpacing = BEAT_NUDGE_MIN_SPACING_FACTOR * beatDuration;

  for (const beat of beatGrid.beats) {
    const predicted = beat.time;

    // Find strongest peak within [-W, +W]
    let bestPeakIdx = -1;
    let bestPeakStr = 0;
    for (let p = 0; p < peakTimes.length; p++) {
      const diff = peakTimes[p] - predicted;
      if (diff < -W) continue;
      if (diff > W) break; // peakTimes are sorted
      if (peakStrengths[p] > bestPeakStr) {
        bestPeakStr = peakStrengths[p];
        bestPeakIdx = p;
      }
    }

    if (bestPeakIdx >= 0) {
      const delta = peakTimes[bestPeakIdx] - predicted;
      const nudge = BEAT_NUDGE_WEIGHT * delta;
      const clampedNudge = Math.max(-BEAT_NUDGE_MAX_SHIFT_SEC, Math.min(BEAT_NUDGE_MAX_SHIFT_SEC, nudge));
      beat.time = predicted + clampedNudge;

      // Per-beat confidence: high onset support + low correction penalty
      const correctionPenalty = Math.abs(clampedNudge) / BEAT_NUDGE_MAX_SHIFT_SEC;
      beat.confidence = Math.max(BEAT_CONFIDENCE_FLOOR, bestPeakStr * (1 - 0.3 * correctionPenalty));
    } else {
      // No peak found — keep predicted time, low confidence
      beat.confidence = BEAT_CONFIDENCE_FLOOR;
    }
  }

  // Enforce monotonic beat order with minimum spacing
  for (let i = 1; i < beatGrid.beats.length; i++) {
    const prev = beatGrid.beats[i - 1];
    const curr = beatGrid.beats[i];
    if (curr.time - prev.time < minSpacing) {
      curr.time = prev.time + minSpacing;
    }
  }
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
 * Estimate time signature (3/4 vs 4/4) from accent patterns.
 *
 * The idea: in 3/4, every 3rd beat is strong; in 4/4, every 4th beat is strong.
 * We check which grouping produces a higher ratio of strong-beat energy to weak-beat energy.
 */
function estimateTimeSignature(
  strength: Float32Array,
  hopRate: number,
  tempo: number,
): { numerator: number; denominator: number } {
  const beatLag = Math.round(hopRate * 60 / tempo);
  if (beatLag < 1 || strength.length < beatLag * 12) {
    return { numerator: 4, denominator: 4 }; // Default
  }

  // Score groupings of 3 and 4
  function scoreGrouping(groupSize: number): number {
    let strongEnergy = 0;
    let weakEnergy = 0;
    let strongCount = 0;
    let weakCount = 0;

    for (let beatIdx = 0; beatIdx * beatLag < strength.length; beatIdx++) {
      const frameIdx = beatIdx * beatLag;
      if (frameIdx >= strength.length) break;

      // Sum energy in a small window around the beat
      let energy = 0;
      const halfWin = Math.max(1, Math.floor(beatLag * 0.15));
      for (let j = -halfWin; j <= halfWin; j++) {
        const idx = frameIdx + j;
        if (idx >= 0 && idx < strength.length) {
          energy += strength[idx];
        }
      }

      if (beatIdx % groupSize === 0) {
        strongEnergy += energy;
        strongCount++;
      } else {
        weakEnergy += energy;
        weakCount++;
      }
    }

    // Ratio of strong to weak — higher means this grouping fits better
    const avgStrong = strongCount > 0 ? strongEnergy / strongCount : 0;
    const avgWeak = weakCount > 0 ? weakEnergy / weakCount : 1;
    return avgWeak > 0 ? avgStrong / avgWeak : 1;
  }

  const score3 = scoreGrouping(3);
  const score4 = scoreGrouping(4);

  console.log('[RhythmAnalyzer] Time signature scores', {
    '3/4': score3.toFixed(3),
    '4/4': score4.toFixed(3),
  });

  // Need a clear margin to pick 3/4 over the 4/4 default
  if (score3 > score4 * 1.05) {
    return { numerator: 3, denominator: 4 };
  }
  return { numerator: 4, denominator: 4 };
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
      confidence: BEAT_CONFIDENCE_FLOOR, // will be updated by applyBeatNudging
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
// Music Theory: Key Detection & Diatonic Chords
// ============================================

/** Note name to pitch class (0-11, C=0) */
const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];

const FLAT_TO_SHARP_MAP: Record<string, string> = {
  'Db': 'C#', 'Eb': 'D#', 'Fb': 'E', 'Gb': 'F#', 'Ab': 'G#', 'Bb': 'A#', 'Cb': 'B',
};

function noteToPitchClass(name: string): number {
  const sharp = FLAT_TO_SHARP_MAP[name] || name;
  const idx = NOTE_NAMES.indexOf(sharp);
  return idx >= 0 ? idx : -1;
}

/**
 * For each major key, the diatonic triads built on scale degrees I-VII.
 * Returns the chord symbols that "belong" to that key.
 *
 * E.g., key of C major: C, Dm, Em, F, G, Am, Bdim
 * We include dom7 on the V chord since it's extremely common.
 */
function getDiatonicChords(keyRoot: number): Set<string> {
  // Major scale intervals from root: 0,2,4,5,7,9,11
  const scaleIntervals = [0, 2, 4, 5, 7, 9, 11];
  // Quality per degree: I=maj, ii=min, iii=min, IV=maj, V=maj, vi=min, vii=dim
  const qualities = ['', 'm', 'm', '', '', 'm', 'dim'];

  const chords = new Set<string>();
  for (let deg = 0; deg < 7; deg++) {
    const pc = (keyRoot + scaleIntervals[deg]) % 12;
    const name = NOTE_NAMES[pc];
    const quality = qualities[deg];
    chords.add(name + quality);

    // Add dom7 on the V chord (very common)
    if (deg === 4) {
      chords.add(name + '7');
    }
  }

  // Also add the flat-named equivalents
  const flatNames: Record<string, string> = {
    'C#': 'Db', 'D#': 'Eb', 'F#': 'Gb', 'G#': 'Ab', 'A#': 'Bb',
  };
  const additions: string[] = [];
  for (const chord of chords) {
    // Extract root and suffix
    let root: string;
    let suffix: string;
    if (chord.length >= 2 && chord[1] === '#') {
      root = chord.slice(0, 2);
      suffix = chord.slice(2);
    } else {
      root = chord[0];
      suffix = chord.slice(1);
    }
    const flat = flatNames[root];
    if (flat) additions.push(flat + suffix);
  }
  additions.forEach(c => chords.add(c));

  return chords;
}

/**
 * Krumhansl-Schmuckler key profiles.
 * These represent the expected distribution of pitch classes for major and minor keys.
 * Correlation with observed chroma gives a reliable key estimate.
 */
const KS_MAJOR_PROFILE = [6.35, 2.23, 3.48, 2.33, 4.38, 4.09, 2.52, 5.19, 2.39, 3.66, 2.29, 2.88];
const KS_MINOR_PROFILE = [6.33, 2.68, 3.52, 5.38, 2.60, 3.53, 2.54, 4.75, 3.98, 2.69, 3.34, 3.17];

/**
 * Compute Pearson correlation between two arrays.
 */
function pearsonCorrelation(a: number[], b: number[]): number {
  const n = a.length;
  let sumA = 0, sumB = 0, sumA2 = 0, sumB2 = 0, sumAB = 0;
  for (let i = 0; i < n; i++) {
    sumA += a[i]; sumB += b[i];
    sumA2 += a[i] * a[i]; sumB2 += b[i] * b[i];
    sumAB += a[i] * b[i];
  }
  const num = n * sumAB - sumA * sumB;
  const den = Math.sqrt((n * sumA2 - sumA * sumA) * (n * sumB2 - sumB * sumB));
  return den > 0 ? num / den : 0;
}

/**
 * Detect key using Krumhansl-Schmuckler pitch-class profile correlation.
 * Returns scores for all 24 keys (12 major + 12 minor).
 */
function detectKeyFromChroma(
  chromaHistogram: Float32Array,
): { keyRoot: number; keyName: string; isMinor: boolean; correlation: number } {
  const hist = Array.from(chromaHistogram);
  let bestRoot = 0;
  let bestCorr = -Infinity;
  let bestMinor = false;

  for (let root = 0; root < 12; root++) {
    // Rotate profile so index 0 = root
    const majorRotated = KS_MAJOR_PROFILE.map((_, i) => KS_MAJOR_PROFILE[(i - root + 12) % 12]);
    const minorRotated = KS_MINOR_PROFILE.map((_, i) => KS_MINOR_PROFILE[(i - root + 12) % 12]);

    const corrMajor = pearsonCorrelation(hist, majorRotated);
    const corrMinor = pearsonCorrelation(hist, minorRotated);

    if (corrMajor > bestCorr) {
      bestCorr = corrMajor;
      bestRoot = root;
      bestMinor = false;
    }
    if (corrMinor > bestCorr) {
      bestCorr = corrMinor;
      bestRoot = root;
      bestMinor = true;
    }
  }

  return {
    keyRoot: bestRoot,
    keyName: NOTE_NAMES[bestRoot] + (bestMinor ? 'm' : ''),
    isMinor: bestMinor,
    correlation: bestCorr,
  };
}

/**
 * Detect the most likely key using two methods and blending:
 * 1. Chord-based: count diatonic chords per key (existing approach)
 * 2. Chroma-based: Krumhansl-Schmuckler correlation on pitch-class histogram
 *
 * The two methods vote together. If they agree, confidence is high.
 * If they disagree, the chroma-based result wins (more robust).
 */
function detectKey(
  rawChords: Array<{ symbol: string; confidence: number }>,
  chromaHistogram?: Float32Array,
  keyHint?: string,
): { keyRoot: number; keyName: string; diatonicChords: Set<string> } {
  // If user provided a key hint, use it directly
  if (keyHint) {
    const isMinor = keyHint.endsWith('m') && keyHint.length > 1;
    const rootName = isMinor ? keyHint.slice(0, -1) : keyHint;
    let pc = noteToPitchClass(rootName);
    if (pc < 0) pc = 0; // Fallback
    // If minor, convert to relative major (up 3 semitones)
    const majorRoot = isMinor ? (pc + 3) % 12 : pc;
    const diatonic = getDiatonicChords(majorRoot);
    console.log('[RhythmAnalyzer] Key from hint', {
      hint: keyHint,
      majorKey: NOTE_NAMES[majorRoot],
      diatonic: [...diatonic].join(', '),
    });
    return { keyRoot: majorRoot, keyName: NOTE_NAMES[majorRoot], diatonicChords: diatonic };
  }

  // Method 1: Chord-based key scoring (existing)
  const chordScores: number[] = new Array(12).fill(0);
  for (let root = 0; root < 12; root++) {
    const diatonic = getDiatonicChords(root);
    for (const { symbol, confidence } of rawChords) {
      const normalized = normalizeChordSymbol(symbol);
      if (diatonic.has(symbol) || diatonic.has(normalized)) {
        chordScores[root] += confidence;
      }
    }
  }

  // Normalize chord scores to 0-1
  const maxChordScore = Math.max(...chordScores, 1);
  const normChordScores = chordScores.map(s => s / maxChordScore);

  // Method 2: K-S chroma correlation (if histogram available)
  let ksResult: { keyRoot: number; isMinor: boolean; correlation: number } | null = null;
  const ksScores: number[] = new Array(12).fill(0);

  if (chromaHistogram) {
    ksResult = detectKeyFromChroma(chromaHistogram);
    const hist = Array.from(chromaHistogram);

    // Compute correlation for each major key for blending
    for (let root = 0; root < 12; root++) {
      const majorRotated = KS_MAJOR_PROFILE.map((_, i) => KS_MAJOR_PROFILE[(i - root + 12) % 12]);
      const minorRotated = KS_MINOR_PROFILE.map((_, i) => KS_MINOR_PROFILE[(i - root + 12) % 12]);
      // Use the relative major root for minor keys
      const corrMajor = pearsonCorrelation(hist, majorRotated);
      const corrMinor = pearsonCorrelation(hist, minorRotated);
      // Map minor key to its relative major for diatonic chord lookup
      ksScores[root] = Math.max(corrMajor, corrMinor);
    }

    // Normalize K-S scores to 0-1
    const maxKs = Math.max(...ksScores, 0.001);
    for (let i = 0; i < 12; i++) ksScores[i] = Math.max(0, ksScores[i]) / maxKs;
  }

  // Blend: 40% chord-based + 60% chroma-based (chroma is more robust)
  const CHORD_WEIGHT = chromaHistogram ? 0.4 : 1.0;
  const CHROMA_WEIGHT = chromaHistogram ? 0.6 : 0.0;

  let bestRoot = 0;
  let bestScore = -Infinity;

  for (let root = 0; root < 12; root++) {
    const blended = normChordScores[root] * CHORD_WEIGHT + ksScores[root] * CHROMA_WEIGHT;
    if (blended > bestScore) {
      bestScore = blended;
      bestRoot = root;
    }
  }

  // If K-S detected minor, use relative major for diatonic chord set
  let majorRoot = bestRoot;
  if (ksResult && ksResult.isMinor && ksResult.keyRoot === bestRoot) {
    majorRoot = (bestRoot + 3) % 12;
  }

  const diatonic = getDiatonicChords(majorRoot);
  console.log('[RhythmAnalyzer] Key detected', {
    chordMethod: NOTE_NAMES[chordScores.indexOf(Math.max(...chordScores))],
    ksMethod: ksResult ? `${NOTE_NAMES[ksResult.keyRoot]}${ksResult.isMinor ? 'm' : ''} (r=${ksResult.correlation.toFixed(3)})` : 'N/A',
    blendedWinner: NOTE_NAMES[bestRoot],
    majorRoot: NOTE_NAMES[majorRoot],
    diatonic: [...diatonic].join(', '),
  });

  return { keyRoot: majorRoot, keyName: NOTE_NAMES[majorRoot], diatonicChords: diatonic };
}

/** Normalize a chord symbol to sharp-based naming for comparison */
function normalizeChordSymbol(symbol: string): string {
  // Extract root (1 or 2 chars) and suffix
  let root: string;
  let suffix: string;
  if (symbol.length >= 2 && (symbol[1] === '#' || symbol[1] === 'b')) {
    root = symbol.slice(0, 2);
    suffix = symbol.slice(2);
  } else {
    root = symbol[0];
    suffix = symbol.slice(1);
  }
  const sharp = FLAT_TO_SHARP_MAP[root];
  if (sharp) return sharp + suffix;
  return symbol;
}

// ============================================
// Chord Detection (with key-aware scoring)
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

  for (let root = 0; root < 12; root++) {
    const rootName = NOTE_NAMES[root];

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
  const flatAliases: Record<string, string> = {
    'Db': 'C#', 'Eb': 'D#', 'Fb': 'E', 'Gb': 'F#', 'Ab': 'G#', 'Bb': 'A#', 'Cb': 'B',
  };
  for (const [flat, sharp] of Object.entries(flatAliases)) {
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
 * Match a chroma vector to the best chord template.
 * If diatonicChords is provided, diatonic matches get a confidence boost.
 */
function matchChroma(
  chroma: Float32Array,
  diatonicChords?: Set<string>,
): { symbol: string; confidence: number } {
  let bestSymbol = 'N'; // No chord
  let bestScore = 0;

  // Diatonic boost factor: makes in-key chords ~30% more attractive
  const DIATONIC_BOOST = 1.3;

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
    let similarity = denom > 0 ? dot / denom : 0;

    // Boost diatonic chords
    if (diatonicChords) {
      const normalized = normalizeChordSymbol(symbol);
      if (diatonicChords.has(symbol) || diatonicChords.has(normalized)) {
        similarity *= DIATONIC_BOOST;
      }
    }

    if (similarity > bestScore) {
      bestScore = similarity;
      bestSymbol = symbol;
    }
  }

  return { symbol: bestSymbol, confidence: bestScore };
}

/**
 * Extract chroma per beat and match chords (two-pass: first detect key, then re-score)
 */
function detectChordsPerBeat(
  audio: Float32Array,
  sampleRate: number,
  beatGrid: BeatGrid,
  keyHint?: string,
): {
  chords: Array<{ bar: number; beat: number; time: number; symbol: string; confidence: number }>;
  detectedKey: string;
} {
  // First pass: unbiased chord detection (or with hint)
  const chromas: Array<{ bar: number; beat: number; time: number; chroma: Float32Array }> = [];

  for (const beat of beatGrid.beats) {
    const startSample = Math.floor(beat.time * sampleRate);
    const endSample = Math.min(startSample + FFT_SIZE, audio.length);

    if (endSample - startSample < FFT_SIZE / 2) continue;

    const frame = new Float32Array(FFT_SIZE);
    const available = endSample - startSample;
    for (let i = 0; i < available; i++) {
      frame[i] = audio[startSample + i];
    }

    const chroma = extractChroma(frame, sampleRate);
    chromas.push({ bar: beat.bar, beat: beat.beatInBar, time: beat.time, chroma });
  }

  // First pass (unbiased) to detect key
  const firstPassChords = chromas.map(c => {
    const match = matchChroma(c.chroma);
    return { ...match };
  });

  // Build aggregate chroma histogram for K-S key detection
  const chromaHistogram = new Float32Array(12);
  for (const c of chromas) {
    for (let i = 0; i < 12; i++) {
      chromaHistogram[i] += c.chroma[i];
    }
  }

  // Detect key from first-pass results + chroma histogram
  const { keyName, diatonicChords } = detectKey(firstPassChords, chromaHistogram, keyHint);

  // Second pass: re-score with diatonic bias
  const results: Array<{ bar: number; beat: number; time: number; symbol: string; confidence: number }> = [];

  for (const c of chromas) {
    const match = matchChroma(c.chroma, diatonicChords);
    results.push({
      bar: c.bar,
      beat: c.beat,
      time: c.time,
      symbol: match.symbol,
      confidence: match.confidence,
    });
  }

  return { chords: results, detectedKey: keyName };
}

// ============================================
// Chord Pitch-Class Helpers
// ============================================

/** Get the set of pitch classes (0-11) for a chord symbol */
function chordPitchClasses(symbol: string): Set<number> {
  // Parse root
  let root: string;
  let suffix: string;
  if (symbol.length >= 2 && (symbol[1] === '#' || symbol[1] === 'b')) {
    root = symbol.slice(0, 2);
    suffix = symbol.slice(2);
  } else if (symbol.length >= 1) {
    root = symbol[0];
    suffix = symbol.slice(1);
  } else {
    return new Set();
  }

  const rootPc = noteToPitchClass(root);
  if (rootPc < 0) return new Set();

  const pcs = new Set<number>();
  pcs.add(rootPc);

  if (suffix === 'm' || suffix === 'min') {
    pcs.add((rootPc + 3) % 12); // minor 3rd
    pcs.add((rootPc + 7) % 12); // perfect 5th
  } else if (suffix === '7') {
    pcs.add((rootPc + 4) % 12); // major 3rd
    pcs.add((rootPc + 7) % 12); // perfect 5th
    pcs.add((rootPc + 10) % 12); // minor 7th
  } else if (suffix === 'dim') {
    pcs.add((rootPc + 3) % 12); // minor 3rd
    pcs.add((rootPc + 6) % 12); // diminished 5th
  } else {
    // Major triad
    pcs.add((rootPc + 4) % 12); // major 3rd
    pcs.add((rootPc + 7) % 12); // perfect 5th
  }

  return pcs;
}

// ============================================
// Chord Smoothing (with music theory)
// ============================================

/**
 * Smooth raw per-beat chord detections into bar-level chord events.
 * Uses majority voting per bar, then absorbs anomalous short chords.
 */
function smoothChords(
  rawChords: Array<{ bar: number; beat: number; time: number; symbol: string; confidence: number }>,
  beatGrid: BeatGrid,
  diatonicChords?: Set<string>,
): ChordEvent[] {
  if (rawChords.length === 0) return [];

  // Group by bar
  const barGroups = new Map<number, typeof rawChords>();
  for (const chord of rawChords) {
    const group = barGroups.get(chord.bar) || [];
    group.push(chord);
    barGroups.set(chord.bar, group);
  }

  // Majority vote per bar (with diatonic tiebreaker)
  const barChords: Array<{ bar: number; symbol: string; confidence: number; time: number; endTime: number }> = [];

  for (const [bar, group] of barGroups) {
    // Weighted vote by confidence
    const votes = new Map<string, number>();
    for (const { symbol, confidence } of group) {
      votes.set(symbol, (votes.get(symbol) || 0) + confidence);
    }

    // Find top two candidates
    const sorted = [...votes.entries()].sort((a, b) => b[1] - a[1]);
    let bestSymbol = sorted[0]?.[0] || 'N';

    // If top two are close (within 15%) and one is diatonic, prefer the diatonic one
    if (sorted.length >= 2 && diatonicChords) {
      const [sym1, score1] = sorted[0];
      const [sym2, score2] = sorted[1];
      if (score2 > score1 * 0.85) {
        const sym1Diatonic = diatonicChords.has(sym1) || diatonicChords.has(normalizeChordSymbol(sym1));
        const sym2Diatonic = diatonicChords.has(sym2) || diatonicChords.has(normalizeChordSymbol(sym2));
        if (!sym1Diatonic && sym2Diatonic) {
          bestSymbol = sym2;
        }
      }
    }

    const bestVotes = votes.get(bestSymbol) || 0;
    const avgConf = bestVotes / group.length;
    const startTime = group[0].time;
    const beatDuration = 60 / beatGrid.tempo;
    const endTime = startTime + beatGrid.timeSignature.numerator * beatDuration;

    barChords.push({ bar, symbol: bestSymbol, confidence: avgConf, time: startTime, endTime });
  }

  // Sort by bar
  barChords.sort((a, b) => a.bar - b.bar);

  // Absorb single-bar anomalies: if a bar chord differs from both neighbors
  // and its confidence is below its neighbors' average, replace it
  for (let i = 1; i < barChords.length - 1; i++) {
    const prev = barChords[i - 1];
    const curr = barChords[i];
    const next = barChords[i + 1];

    if (prev.symbol === next.symbol && curr.symbol !== prev.symbol) {
      // Current bar disagrees with both neighbors
      const neighborAvgConf = (prev.confidence + next.confidence) / 2;
      if (curr.confidence < neighborAvgConf * 1.1) {
        // Absorb: replace with neighbor chord
        barChords[i] = { ...curr, symbol: prev.symbol, confidence: neighborAvgConf * 0.9 };
      }
    }
  }

  // ---- Chord Consolidation ----
  // Most pop/folk songs use 3-6 chords. Rare chords are almost certainly
  // detection errors. Find the "core" set and replace outliers.
  const chordBarCount = new Map<string, number>();
  for (const bc of barChords) {
    chordBarCount.set(bc.symbol, (chordBarCount.get(bc.symbol) || 0) + 1);
  }
  const totalBars = barChords.length;
  const MIN_FREQUENCY = 0.05; // Must appear in at least 5% of bars to be "core"
  const coreChords = new Set<string>();
  for (const [sym, count] of chordBarCount) {
    if (count / totalBars >= MIN_FREQUENCY) {
      coreChords.add(sym);
    }
  }

  if (coreChords.size > 0 && coreChords.size < chordBarCount.size) {
    // Replace rare chords with nearest core chord (by shared pitch classes)
    const coreArray = [...coreChords];

    console.log('[RhythmAnalyzer] Consolidating chords', {
      total: chordBarCount.size,
      core: coreArray.join(', '),
      removed: [...chordBarCount.keys()].filter(s => !coreChords.has(s)).join(', '),
    });

    for (let i = 0; i < barChords.length; i++) {
      if (!coreChords.has(barChords[i].symbol)) {
        // Find nearest core chord by pitch-class overlap
        const rarePcs = chordPitchClasses(barChords[i].symbol);
        let bestCore = coreArray[0];
        let bestOverlap = -1;
        for (const core of coreArray) {
          const corePcs = chordPitchClasses(core);
          let overlap = 0;
          for (const pc of rarePcs) {
            if (corePcs.has(pc)) overlap++;
          }
          if (overlap > bestOverlap) {
            bestOverlap = overlap;
            bestCore = core;
          }
        }
        barChords[i] = { ...barChords[i], symbol: bestCore, confidence: barChords[i].confidence * 0.8 };
      }
    }
  }

  // One chord event per bar (no merging — preserves visual inspection)
  const result: ChordEvent[] = [];
  for (let i = 0; i < barChords.length; i++) {
    result.push(toChordEvent(barChords[i], i + 1, beatGrid));
  }

  return result;
}

function toChordEvent(
  raw: { bar: number; symbol: string; confidence: number; time: number; endTime: number },
  id: number,
  beatGrid: BeatGrid,
): ChordEvent {
  const beatDuration = 60 / beatGrid.tempo;
  const barDuration = beatDuration * beatGrid.timeSignature.numerator;
  const barSpan = Math.max(1, Math.round((raw.endTime - raw.time) / barDuration));

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
// Vocal Activity Detection
// ============================================

/**
 * Detect vocal energy per bar.
 *
 * Human vocals sit primarily in 300Hz-3kHz. By comparing energy in that
 * band to total energy, we get a ratio that's high when someone is singing
 * and low during purely instrumental sections.
 *
 * Uses Goertzel to probe a handful of frequencies in the vocal band.
 */
function detectVocalEnergyPerBar(
  audio: Float32Array,
  sampleRate: number,
  beatGrid: BeatGrid,
): Map<number, number> {
  const barEnergy = new Map<number, number>(); // bar -> vocal ratio

  // Vocal band frequencies to probe (roughly 300Hz to 3kHz, spaced logarithmically)
  const vocalFreqs = [300, 400, 550, 750, 1000, 1400, 2000, 2800];
  // Low/instrument frequencies for comparison
  const lowFreqs = [80, 110, 150, 220];

  // Group beats by bar, use the first beat of each bar as the analysis point
  const barFirstBeats = new Map<number, number>(); // bar -> time
  for (const beat of beatGrid.beats) {
    if (!barFirstBeats.has(beat.bar)) {
      barFirstBeats.set(beat.bar, beat.time);
    }
  }

  const frameSize = FFT_SIZE;

  for (const [bar, time] of barFirstBeats) {
    const startSample = Math.floor(time * sampleRate);
    const endSample = Math.min(startSample + frameSize, audio.length);
    if (endSample - startSample < frameSize / 2) continue;

    const frame = new Float32Array(frameSize);
    const available = endSample - startSample;
    for (let i = 0; i < available; i++) {
      frame[i] = audio[startSample + i];
    }

    // Apply Hann window
    for (let i = 0; i < frameSize; i++) {
      frame[i] *= 0.5 * (1 - Math.cos((2 * Math.PI * i) / (frameSize - 1)));
    }

    // Compute energy in vocal band
    let vocalPower = 0;
    for (const freq of vocalFreqs) {
      vocalPower += goertzelPower(frame, frameSize, freq, sampleRate);
    }

    // Compute energy in low band
    let lowPower = 0;
    for (const freq of lowFreqs) {
      lowPower += goertzelPower(frame, frameSize, freq, sampleRate);
    }

    // Ratio: vocal / (vocal + low). High = vocals present.
    const totalPower = vocalPower + lowPower;
    const ratio = totalPower > 0 ? vocalPower / totalPower : 0;

    barEnergy.set(bar, ratio);
  }

  return barEnergy;
}

/** Goertzel power at a single frequency */
function goertzelPower(frame: Float32Array, n: number, freq: number, sampleRate: number): number {
  const k = Math.round(freq * n / sampleRate);
  const w0 = (2 * Math.PI * k) / n;
  const coeff = 2 * Math.cos(w0);

  let s0 = 0, s1 = 0, s2 = 0;
  for (let i = 0; i < n; i++) {
    s0 = frame[i] + coeff * s1 - s2;
    s2 = s1;
    s1 = s0;
  }

  return Math.max(0, s1 * s1 + s2 * s2 - coeff * s1 * s2);
}

// ============================================
// Chord Pipeline (reusable for dual time-sig evaluation)
// ============================================

interface ChordPipelineResult {
  beatGrid: BeatGrid;
  chords: ChordEvent[];
  detectedKey: string;
  qualityScore: number;
  uniqueChords: number;
  lowConfidenceRatio: number;
  anomalyCount: number;
}

/**
 * Run the full chord detection pipeline for a given time signature.
 * Returns chords plus a quality score for comparison.
 */
function runChordPipeline(
  audio: Float32Array,
  sampleRate: number,
  tempo: number,
  firstBeat: number,
  duration: number,
  timeSignature: { numerator: number; denominator: number },
  keyHint?: string,
  onsetPeaks?: { peakTimes: number[]; peakStrengths: number[] },
): ChordPipelineResult {
  const beatGrid = buildBeatGrid(tempo, firstBeat, duration, timeSignature);

  // Apply onset-weighted beat correction if peaks are available
  if (onsetPeaks) {
    applyBeatNudging(beatGrid, onsetPeaks.peakTimes, onsetPeaks.peakStrengths);
  }

  const { chords: rawChords, detectedKey } = detectChordsPerBeat(
    audio, sampleRate, beatGrid, keyHint,
  );

  const keyPc = noteToPitchClass(detectedKey);
  const diatonicChords = keyPc >= 0 ? getDiatonicChords(keyPc) : undefined;

  const chords = smoothChords(rawChords, beatGrid, diatonicChords);

  // Compute quality metrics
  const uniqueChords = new Set(chords.map(c => c.symbol)).size;
  const lowConfCount = chords.filter(c => c.confidence < 0.3).length;
  const lowConfidenceRatio = chords.length > 0 ? lowConfCount / chords.length : 1;

  // Count anomalies: bars where chord differs from both neighbors
  let anomalyCount = 0;
  for (let i = 1; i < chords.length - 1; i++) {
    if (chords[i].symbol !== chords[i - 1].symbol && chords[i].symbol !== chords[i + 1].symbol) {
      anomalyCount++;
    }
  }
  const anomalyRatio = chords.length > 2 ? anomalyCount / (chords.length - 2) : 0;

  // Combined quality score (higher = better)
  // Fewer unique chords is better (penalize > 6 unique, reward 3-6)
  const uniquePenalty = uniqueChords <= 6 ? 0 : (uniqueChords - 6) * 0.05;
  // Lower low-confidence ratio is better
  // Lower anomaly ratio is better
  const qualityScore = 1.0 - uniquePenalty - lowConfidenceRatio * 0.3 - anomalyRatio * 0.4;

  return {
    beatGrid,
    chords,
    detectedKey,
    qualityScore,
    uniqueChords,
    lowConfidenceRatio,
    anomalyCount,
  };
}

// ============================================
// Main Entry Point
// ============================================

/**
 * Analyze decoded audio samples. Environment-agnostic — works in both
 * browser (via RhythmAnalyzer) and Node (via NodeRhythmAnalyzer).
 */
export async function analyzeFromSamples(
  audio: Float32Array,
  sampleRate: number,
  duration: number,
  options: AnalysisOptions = {},
): Promise<AnalysisResult> {
  const start = typeof performance !== 'undefined' ? performance.now() : Date.now();

  console.log('[RhythmAnalyzer] Starting analysis', { duration: duration.toFixed(1), sampleRate, samples: audio.length, options });

  // 1. Compute onset strength
  const { times, strength } = computeOnsetStrength(audio, sampleRate);
  const hopRate = sampleRate / HOP_SIZE;

  console.log('[RhythmAnalyzer] Onset strength computed', { frames: strength.length });

  // 1b. Extract onset peaks for beat nudging
  const onsetPeaks = extractOnsetPeaks(times, strength);
  console.log('[RhythmAnalyzer] Onset peaks extracted', { count: onsetPeaks.peakTimes.length });

  // 2. Estimate tempo
  const tempo = estimateTempo(strength, hopRate, options.tempoHint);
  console.log('[RhythmAnalyzer] Tempo estimated', { bpm: tempo });

  // 3. Find first beat
  const firstBeat = findFirstBeat(times, strength, tempo, hopRate);

  // 4. Determine time signature
  let bestResult: ChordPipelineResult;
  let tsDecision: TimeSignatureDecision | undefined;

  if (options.timeSignatureHint) {
    // Hint takes highest priority
    bestResult = runChordPipeline(
      audio, sampleRate, tempo, firstBeat, duration,
      options.timeSignatureHint, options.keyHint, onsetPeaks,
    );
    console.log('[RhythmAnalyzer] Using time signature hint', {
      ts: `${options.timeSignatureHint.numerator}/${options.timeSignatureHint.denominator}`,
    });
  } else {
    // Dual evaluation: try both 3/4 and 4/4, pick the winner
    const result44 = runChordPipeline(
      audio, sampleRate, tempo, firstBeat, duration,
      { numerator: 4, denominator: 4 }, options.keyHint, onsetPeaks,
    );
    const result34 = runChordPipeline(
      audio, sampleRate, tempo, firstBeat, duration,
      { numerator: 3, denominator: 4 }, options.keyHint, onsetPeaks,
    );

    // Also factor in accent-pattern score as a tiebreaker
    const accentTs = estimateTimeSignature(strength, hopRate, tempo);
    const accentBoost = 0.03; // small nudge toward accent-detected time sig

    const score44 = result44.qualityScore + (accentTs.numerator === 4 ? accentBoost : 0);
    const score34 = result34.qualityScore + (accentTs.numerator === 3 ? accentBoost : 0);

    const accentPref = `${accentTs.numerator}/${accentTs.denominator}`;

    console.log('[RhythmAnalyzer] Dual time-sig evaluation', {
      '4/4': {
        quality: result44.qualityScore.toFixed(3),
        withAccent: score44.toFixed(3),
        unique: result44.uniqueChords,
        lowConf: result44.lowConfidenceRatio.toFixed(3),
        anomalies: result44.anomalyCount,
      },
      '3/4': {
        quality: result34.qualityScore.toFixed(3),
        withAccent: score34.toFixed(3),
        unique: result34.uniqueChords,
        lowConf: result34.lowConfidenceRatio.toFixed(3),
        anomalies: result34.anomalyCount,
      },
      accentPreference: accentPref,
    });

    // Deterministic tie-break: when scores are equal, prefer 4/4 (more common)
    bestResult = score34 > score44 ? result34 : result44;
    const winnerScore = score34 > score44 ? score34 : score44;
    const loserScore = score34 > score44 ? score44 : score34;

    tsDecision = {
      score34,
      score44,
      accentPreference: accentPref,
      winnerMargin: winnerScore - loserScore,
      winner: `${bestResult.beatGrid.timeSignature.numerator}/${bestResult.beatGrid.timeSignature.denominator}`,
    };

    console.log('[RhythmAnalyzer] Time signature chosen', {
      ts: tsDecision.winner,
      score: winnerScore.toFixed(3),
      margin: tsDecision.winnerMargin.toFixed(4),
    });
  }

  const { beatGrid, chords, detectedKey } = bestResult;

  console.log('[RhythmAnalyzer] Beat grid built', {
    beats: beatGrid.beats.length,
    bars: beatGrid.barCount,
    ts: `${beatGrid.timeSignature.numerator}/${beatGrid.timeSignature.denominator}`,
  });

  console.log('[RhythmAnalyzer] Smoothed chords', {
    count: chords.length,
    unique: new Set(chords.map(c => c.symbol)).size,
    symbols: [...new Set(chords.map(c => c.symbol))].join(', '),
  });

  // 5. Detect vocal energy per bar (for lyrics alignment)
  const vocalEnergyMap = detectVocalEnergyPerBar(audio, sampleRate, beatGrid);
  for (const chord of chords) {
    chord.vocalEnergy = vocalEnergyMap.get(chord.barStart) ?? 0;
  }

  const durationMs = (typeof performance !== 'undefined' ? performance.now() : Date.now()) - start;

  return {
    beatGrid,
    chords,
    meta: {
      analysisVersion: 'rhythm-analyzer-v4',
      configHash: `fft${FFT_SIZE}_hop${HOP_SIZE}_key${detectedKey}_ts${beatGrid.timeSignature.numerator}_nudge${BEAT_NUDGE_WEIGHT}`,
      durationMs,
      timeSignatureDecision: tsDecision,
    },
  };
}
