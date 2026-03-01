#!/usr/bin/env npx tsx
/**
 * Align Training Set
 *
 * Aligns MIDI ground truth to YouTube audio using:
 *   Tier 1: Global affine fit for close-duration songs (ratio 0.85-1.20)
 *   Tier 1-PW: Piecewise affine for multi-tempo songs (e.g. Bohemian Rhapsody)
 *   Tier 2: Energy cross-correlation with tempo scaling for partial/mismatched songs
 *
 * Usage:
 *   npx tsx scripts/align-training-set.ts              # Align all songs
 *   npx tsx scripts/align-training-set.ts --song <id>  # Single song
 *   npx tsx scripts/align-training-set.ts --tier1-only # Skip Tier 2
 */

import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';
import { loadWav } from '../src/node/wavLoader';
import {
  buildAudioTokens,
  buildMidiTokens,
  extractAudioFeatures,
  type AudioFeatures,
} from './alignment/logTokens';
import { enumerateSeedPairs, enumerateSeedPairsPitchOnly } from './alignment/seedIndex';
import { localAlign, type LocalAlignResult } from './alignment/localAlign';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = path.resolve(__dirname, '..');

const TRAINING_DIR = path.join(ROOT, 'training-data');
const AUDIO_DIR = path.join(TRAINING_DIR, 'audio');
const GT_DIR = path.join(TRAINING_DIR, 'ground-truth');
const ALIGNMENT_DIR = path.join(TRAINING_DIR, 'alignment');
const ALIGNED_GT_DIR = path.join(TRAINING_DIR, 'aligned-ground-truth');

// ============================================
// Types
// ============================================

interface ManifestSong {
  id: string;
  artist: string;
  title: string;
  midiFile: string;
  midiTempo: number;
  midiTimeSignature: string;
  youtubeUrl: string;
  meta: { youtubeTime: number };
  notes: string;
}

interface MidiGroundTruth {
  id: string;
  artist: string;
  title: string;
  tempo: number;
  tempoChanges: Array<{ time: number; bpm: number }>;
  timeSignature: { numerator: number; denominator: number };
  timeSignatureChanges: Array<{ time: number; numerator: number; denominator: number }>;
  duration: number;
  key: string;
  barAnchors: Array<{ bar: number; time: number }>;
  beats: Array<{ bar: number; beat: number; time: number }>;
  trackCount: number;
  totalNotes: number;
  melodyTrackIndex: number;
  melodyNotes: Array<{ midi: number; time: number; duration: number; velocity: number; name: string }>;
  allNotes?: Array<{ midi: number; time: number; duration: number; velocity: number; name: string; track: number; channel: number }>;
}

type AlignmentReasonCode =
  | 'audio_not_found'
  | 'audio_too_short'
  | 'analysis_too_few_beats'
  | 'duration_ratio_too_high'
  | 'insufficient_seeds'
  | 'coverage_too_low'
  | 'median_error_too_high'
  | 'p95_error_too_high'
  | 'slope_out_of_range'
  | 'no_valid_tempo_segments'
  | 'no_segments_aligned'
  | 'error_runtime'
  | 'multi_match_ambiguous'
  | 'extraction_quality_low';

const CANONICAL_REASON_CODES: readonly AlignmentReasonCode[] = [
  'audio_not_found',
  'audio_too_short',
  'analysis_too_few_beats',
  'duration_ratio_too_high',
  'insufficient_seeds',
  'coverage_too_low',
  'median_error_too_high',
  'p95_error_too_high',
  'slope_out_of_range',
  'no_valid_tempo_segments',
  'no_segments_aligned',
  'error_runtime',
  'multi_match_ambiguous',
  'extraction_quality_low',
];

function isAlignmentReasonCode(value: string): value is AlignmentReasonCode {
  return (CANONICAL_REASON_CODES as readonly string[]).includes(value);
}

type QualityMode = 'analysis_downbeat' | 'energy_peak' | 'piecewise_energy_peak' | 'token_local_align';

interface AlignmentQuality {
  anchorsCovered: number;
  anchorsTotal: number;
  coverage: number;
  medianMs: number;
  p95Ms: number;
  matchToleranceSec: number;
  thresholdProximity: {
    coverageMargin: number;
    medianMarginMs: number;
    p95MarginMs: number;
  };
}

interface PiecewiseSegment {
  midiStart: number;
  midiEnd: number;
  a: number;
  b: number;
}

interface BaselineSnapshot {
  qualityMode: 'energy_peak' | 'piecewise_energy_peak';
  coverage: number;
  medianMs: number;
  p95Ms: number;
}

interface AlignmentArtifact {
  songId: string;
  status: 'aligned_ok' | 'unaligned' | 'unaligned_partial';
  tier: 1 | 2;
  model: 'affine' | 'piecewise_affine';
  params: { a: number; b: number };
  segments?: PiecewiseSegment[];
  segment: { midiStart: number; midiEnd: number; youtubeStart: number; youtubeEnd: number };
  qualityMode: QualityMode;
  quality: AlignmentQuality;
  baseline?: BaselineSnapshot;
  reason: AlignmentReasonCode | null;
  reasonDetail: string | null;
  version: 'align-v3';
}

interface AlignedGroundTruth extends MidiGroundTruth {
  alignmentModel: string;
  alignmentParams: { a: number; b: number };
  alignmentSegments?: Array<{ midiStart: number; midiEnd: number; a: number; b: number }>;
}

// ============================================
// Tier Classification
// ============================================

function classifyTier(midiDuration: number, youtubeDuration: number): 1 | 2 {
  const ratio = youtubeDuration / midiDuration;
  return (ratio >= 0.85 && ratio <= 1.20) ? 1 : 2;
}

function hasMultipleTempos(gt: MidiGroundTruth): boolean {
  if (gt.tempoChanges.length <= 1) return false;
  // Check if there's a significant tempo change (>20% difference)
  const tempos = gt.tempoChanges.map(t => t.bpm);
  const minTempo = Math.min(...tempos);
  const maxTempo = Math.max(...tempos);
  return (maxTempo / minTempo) > 1.2;
}

// ============================================
// Audio RMS Energy
// ============================================

function computeRmsEnergy(samples: Float32Array, sampleRate: number, timeSec: number, windowMs: number = 50): number {
  const centerSample = Math.round(timeSec * sampleRate);
  const halfWindow = Math.round((windowMs / 1000) * sampleRate);
  const start = Math.max(0, centerSample - halfWindow);
  const end = Math.min(samples.length, centerSample + halfWindow);
  if (start >= end) return 0;

  let sum = 0;
  for (let i = start; i < end; i++) {
    sum += samples[i] * samples[i];
  }
  return Math.sqrt(sum / (end - start));
}

function computeOnsetStrengthAtTimes(
  samples: Float32Array,
  sampleRate: number,
  times: number[],
): number[] {
  return times.map(t => computeRmsEnergy(samples, sampleRate, t, 50));
}

// ============================================
// Cross-Correlation for Offset Detection
// ============================================

/**
 * Find the best time offset by cross-correlating MIDI bar onset pattern
 * with YouTube audio energy at candidate offsets.
 */
function findBestOffset(
  midiDownbeatTimes: number[],
  samples: Float32Array,
  sampleRate: number,
  audioDuration: number,
  midiDuration: number,
): { offset: number; score: number } {
  // Search range: -10s to +30s offset (YouTube might have intro)
  const searchMin = -10;
  const searchMax = Math.min(30, audioDuration - midiDuration + 10);
  const step = 0.1; // 100ms resolution

  let bestOffset = 0;
  let bestScore = -Infinity;

  for (let offset = searchMin; offset <= searchMax; offset += step) {
    const shiftedTimes = midiDownbeatTimes.map(t => t + offset);
    if (shiftedTimes[0] < 0 || shiftedTimes[shiftedTimes.length - 1] > audioDuration) continue;

    const energies = computeOnsetStrengthAtTimes(samples, sampleRate, shiftedTimes);
    const score = energies.reduce((sum, e) => sum + e, 0);

    if (score > bestScore) {
      bestScore = score;
      bestOffset = offset;
    }
  }

  return { offset: bestOffset, score: bestScore };
}

/**
 * Find best (offset, tempoScale) pair for Tier 2 songs.
 * Searches a 2D grid: offset from 0 to (audioDuration - midiDuration*0.8),
 * tempo scale from 0.85 to 1.20.
 */
function findBestOffsetAndScale(
  midiDownbeatTimes: number[],
  samples: Float32Array,
  sampleRate: number,
  audioDuration: number,
  midiDuration: number,
): { offset: number; tempoScale: number; score: number } {
  const offsetStep = 0.5; // 500ms resolution (wide search)
  const scaleStep = 0.01;
  const scaleMin = 0.85;
  const scaleMax = 1.25;

  let bestOffset = 0;
  let bestScale = 1.0;
  let bestScore = -Infinity;

  for (let scale = scaleMin; scale <= scaleMax; scale += scaleStep) {
    const scaledDuration = midiDuration * scale;
    const offsetMax = audioDuration - scaledDuration + 5;
    if (offsetMax < -5) continue;

    for (let offset = -5; offset <= offsetMax; offset += offsetStep) {
      // Scale and shift MIDI downbeat times
      const shiftedTimes = midiDownbeatTimes.map(t => offset + t * scale);

      // Skip if out of bounds
      if (shiftedTimes[0] < -1 || shiftedTimes[shiftedTimes.length - 1] > audioDuration + 1) continue;

      // Only score times that fall within audio
      const validTimes = shiftedTimes.filter(t => t >= 0 && t <= audioDuration);
      if (validTimes.length < midiDownbeatTimes.length * 0.5) continue;

      const energies = computeOnsetStrengthAtTimes(samples, sampleRate, validTimes);
      // Normalize by count to avoid bias toward lower offsets with more valid times
      const score = energies.reduce((sum, e) => sum + e, 0) / validTimes.length;

      if (score > bestScore) {
        bestScore = score;
        bestOffset = offset;
        bestScale = scale;
      }
    }
  }

  // Refine with finer grid around best
  const refineOffsetRange = 2.0;
  const refineScaleRange = 0.05;
  for (let scale = bestScale - refineScaleRange; scale <= bestScale + refineScaleRange; scale += 0.002) {
    for (let offset = bestOffset - refineOffsetRange; offset <= bestOffset + refineOffsetRange; offset += 0.1) {
      const shiftedTimes = midiDownbeatTimes.map(t => offset + t * scale);
      const validTimes = shiftedTimes.filter(t => t >= 0 && t <= audioDuration);
      if (validTimes.length < midiDownbeatTimes.length * 0.5) continue;

      const energies = computeOnsetStrengthAtTimes(samples, sampleRate, validTimes);
      const score = energies.reduce((sum, e) => sum + e, 0) / validTimes.length;

      if (score > bestScore) {
        bestScore = score;
        bestOffset = offset;
        bestScale = scale;
      }
    }
  }

  return { offset: bestOffset, tempoScale: bestScale, score: bestScore };
}

// ============================================
// Tempo Ratio from Beat Grids
// ============================================

function computeTempoRatio(
  midiDownbeatTimes: number[],
  ytDownbeatTimes: number[],
): number {
  const midiIntervals = computeIntervals(midiDownbeatTimes);
  const ytIntervals = computeIntervals(ytDownbeatTimes);

  if (midiIntervals.length === 0 || ytIntervals.length === 0) return 1.0;

  return median(ytIntervals) / median(midiIntervals);
}

function computeIntervals(times: number[]): number[] {
  const result: number[] = [];
  for (let i = 1; i < times.length; i++) {
    result.push(times[i] - times[i - 1]);
  }
  return result;
}

function median(arr: number[]): number {
  const sorted = [...arr].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? (sorted[mid - 1] + sorted[mid]) / 2
    : sorted[mid];
}

function percentile(arr: number[], p: number): number {
  const sorted = [...arr].sort((a, b) => a - b);
  const idx = Math.ceil((p / 100) * sorted.length) - 1;
  return sorted[Math.max(0, idx)];
}

interface RawQuality {
  anchorsCovered: number;
  anchorsTotal: number;
  coverage: number;
  medianMs: number;
  p95Ms: number;
}

interface GateThresholds {
  coverageMin: number;
  medianMax: number;
  p95Max: number;
}

const DEFAULT_MATCH_TOLERANCE_SEC = 0.2;

function withQualityMeta(raw: RawQuality, thresholds: GateThresholds): AlignmentQuality {
  return {
    ...raw,
    matchToleranceSec: DEFAULT_MATCH_TOLERANCE_SEC,
    thresholdProximity: {
      coverageMargin: raw.coverage - thresholds.coverageMin,
      medianMarginMs: thresholds.medianMax - raw.medianMs,
      p95MarginMs: thresholds.p95Max - raw.p95Ms,
    },
  };
}

function stableSortObject(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(stableSortObject);
  }
  if (value && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([k, v]) => [k, stableSortObject(v)] as const);
    const out: Record<string, unknown> = {};
    for (const [k, v] of entries) out[k] = v;
    return out;
  }
  return value;
}

function stableStringify(value: unknown): string {
  return JSON.stringify(stableSortObject(value), null, 2);
}

function validateArtifactSchema(artifact: AlignmentArtifact): string[] {
  const errors: string[] = [];
  if (!artifact.songId) errors.push('songId missing');
  if (!['aligned_ok', 'unaligned', 'unaligned_partial'].includes(artifact.status)) errors.push('invalid status');
  if (!['affine', 'piecewise_affine'].includes(artifact.model)) errors.push('invalid model');
  if (!artifact.qualityMode) errors.push('qualityMode missing');
  if (artifact.quality.matchToleranceSec !== DEFAULT_MATCH_TOLERANCE_SEC) errors.push('matchToleranceSec mismatch');
  if (!artifact.reason && artifact.reasonDetail) errors.push('reasonDetail present without reason');
  if (artifact.tier === 2 && !artifact.baseline) errors.push('tier2 baseline missing');
  return errors;
}

function parseReasonWithDetail(input: string): { reason: AlignmentReasonCode; reasonDetail: string | null } {
  const [rawCode, ...rest] = input.split(':');
  const code = rawCode === 'error' ? 'error_runtime' : rawCode;
  if (isAlignmentReasonCode(code)) {
    return {
      reason: code,
      reasonDetail: rest.length > 0 ? rest.join(':') : null,
    };
  }
  return {
    reason: 'error_runtime',
    reasonDetail: input,
  };
}

function fitAffineFromPairs(pairs: Array<{ midiTimeSec: number; audioTimeSec: number }>): { a: number; b: number } | null {
  if (pairs.length < 3) return null;
  const n = pairs.length;
  let sumX = 0;
  let sumY = 0;
  let sumXX = 0;
  let sumXY = 0;
  for (const p of pairs) {
    sumX += p.midiTimeSec;
    sumY += p.audioTimeSec;
    sumXX += p.midiTimeSec * p.midiTimeSec;
    sumXY += p.midiTimeSec * p.audioTimeSec;
  }
  const denom = n * sumXX - sumX * sumX;
  if (Math.abs(denom) < 1e-10) return null;
  const a = (sumY * sumXX - sumX * sumXY) / denom;
  const b = (n * sumXY - sumX * sumY) / denom;
  return { a, b };
}

function passesPreAlignmentExtractionGate(features: AudioFeatures): boolean {
  if (features.onsets.length < 30) return false;
  if (features.medianPitchConfidence < 0.45) return false;
  if (features.onsetDensity < 0.4 || features.onsetDensity > 6.0) return false;
  return true;
}

// ============================================
// Affine Refinement (Least Squares)
// ============================================

function refineAffineParams(
  midiDownbeats: number[],
  ytDownbeats: number[],
  roughOffset: number,
  roughB: number,
  tolerance: number = 2.0,
): { a: number; bRefined: number } {
  const matches: Array<{ midiTime: number; ytTime: number }> = [];

  for (const mt of midiDownbeats) {
    const predicted = roughOffset + roughB * mt;
    let bestDist = Infinity;
    let bestYt = -1;
    for (const yt of ytDownbeats) {
      const dist = Math.abs(yt - predicted);
      if (dist < bestDist) {
        bestDist = dist;
        bestYt = yt;
      }
    }
    if (bestDist <= tolerance) {
      matches.push({ midiTime: mt, ytTime: bestYt });
    }
  }

  if (matches.length < 3) {
    return { a: roughOffset, bRefined: roughB };
  }

  // Least squares: ytTime = a + b * midiTime
  const n = matches.length;
  let sumX = 0, sumY = 0, sumXX = 0, sumXY = 0;
  for (const { midiTime, ytTime } of matches) {
    sumX += midiTime;
    sumY += ytTime;
    sumXX += midiTime * midiTime;
    sumXY += midiTime * ytTime;
  }

  const denom = n * sumXX - sumX * sumX;
  if (Math.abs(denom) < 1e-10) {
    return { a: roughOffset, bRefined: roughB };
  }

  const a = (sumY * sumXX - sumX * sumXY) / denom;
  const bRefined = (n * sumXY - sumX * sumY) / denom;

  return { a, bRefined };
}

// ============================================
// Alignment Validation
// ============================================

function validateAlignment(
  midiDownbeats: number[],
  ytDownbeats: number[],
  a: number,
  b: number,
): RawQuality {
  const errors: number[] = [];
  let covered = 0;
  const matchTolerance = DEFAULT_MATCH_TOLERANCE_SEC;

  for (const mt of midiDownbeats) {
    const predicted = a + b * mt;
    let bestDist = Infinity;
    for (const yt of ytDownbeats) {
      const dist = Math.abs(yt - predicted);
      if (dist < bestDist) bestDist = dist;
    }
    if (bestDist <= matchTolerance) {
      covered++;
      errors.push(bestDist * 1000);
    }
  }

  return {
    anchorsCovered: covered,
    anchorsTotal: midiDownbeats.length,
    coverage: midiDownbeats.length > 0 ? covered / midiDownbeats.length : 0,
    medianMs: errors.length > 0 ? median(errors) : Infinity,
    p95Ms: errors.length > 0 ? percentile(errors, 95) : Infinity,
  };
}

// ============================================
// Energy-Based Validation
// ============================================

/**
 * Validate alignment by checking whether transformed MIDI downbeats land on
 * energy peaks in the audio. This is independent of analysis correctness.
 *
 * For each transformed downbeat, we compute energy in a narrow window (±50ms)
 * and compare to the local baseline energy. If the downbeat energy is higher
 * than the local baseline, we count it as "on-beat".
 */
function validateAlignmentByEnergy(
  midiDownbeats: number[],
  samples: Float32Array,
  sampleRate: number,
  audioDuration: number,
  a: number,
  b: number,
): RawQuality & { energyScore: number } {
  let onBeatCount = 0;
  let totalValid = 0;
  const onsetErrors: number[] = [];

  for (const mt of midiDownbeats) {
    const predicted = a + b * mt;
    if (predicted < 0 || predicted > audioDuration) continue;
    totalValid++;

    // Energy at predicted downbeat position
    const peakEnergy = computeRmsEnergy(samples, sampleRate, predicted, 30);

    // Find the nearest local energy peak within ±200ms
    let bestPeakTime = predicted;
    let bestPeakEnergy = peakEnergy;
    for (let dt = -0.2; dt <= 0.2; dt += 0.01) {
      const t = predicted + dt;
      if (t < 0 || t > audioDuration) continue;
      const e = computeRmsEnergy(samples, sampleRate, t, 30);
      if (e > bestPeakEnergy) {
        bestPeakEnergy = e;
        bestPeakTime = t;
      }
    }

    // Compute local baseline energy (±500ms, excluding the peak window)
    const baselineEnergies: number[] = [];
    for (let dt = -0.5; dt <= 0.5; dt += 0.05) {
      if (Math.abs(dt) < 0.1) continue; // skip peak window
      const t = predicted + dt;
      if (t >= 0 && t <= audioDuration) {
        baselineEnergies.push(computeRmsEnergy(samples, sampleRate, t, 30));
      }
    }
    const baseline = baselineEnergies.length > 0
      ? baselineEnergies.reduce((s, e) => s + e, 0) / baselineEnergies.length
      : 0;

    // Count as on-beat if peak energy is significantly above baseline
    if (bestPeakEnergy > baseline * 1.05 || baseline < 0.001) {
      onBeatCount++;
      onsetErrors.push(Math.abs(bestPeakTime - predicted) * 1000);
    }
  }

  return {
    anchorsCovered: onBeatCount,
    anchorsTotal: midiDownbeats.length,
    coverage: totalValid > 0 ? onBeatCount / totalValid : 0,
    medianMs: onsetErrors.length > 0 ? median(onsetErrors) : Infinity,
    p95Ms: onsetErrors.length > 0 ? percentile(onsetErrors, 95) : Infinity,
    energyScore: totalValid > 0 ? onBeatCount / totalValid : 0,
  };
}

/**
 * Energy-based validation for piecewise alignment.
 */
function validatePiecewiseByEnergy(
  midiDownbeats: number[],
  samples: Float32Array,
  sampleRate: number,
  audioDuration: number,
  segments: PiecewiseSegment[],
): RawQuality & { energyScore: number } {
  let onBeatCount = 0;
  let totalValid = 0;
  const onsetErrors: number[] = [];

  for (const mt of midiDownbeats) {
    const predicted = piecewiseTransform(mt, segments);
    if (predicted < 0 || predicted > audioDuration) continue;
    totalValid++;

    const peakEnergy = computeRmsEnergy(samples, sampleRate, predicted, 30);

    let bestPeakTime = predicted;
    let bestPeakEnergy = peakEnergy;
    for (let dt = -0.2; dt <= 0.2; dt += 0.01) {
      const t = predicted + dt;
      if (t < 0 || t > audioDuration) continue;
      const e = computeRmsEnergy(samples, sampleRate, t, 30);
      if (e > bestPeakEnergy) {
        bestPeakEnergy = e;
        bestPeakTime = t;
      }
    }

    const baselineEnergies: number[] = [];
    for (let dt = -0.5; dt <= 0.5; dt += 0.05) {
      if (Math.abs(dt) < 0.1) continue;
      const t = predicted + dt;
      if (t >= 0 && t <= audioDuration) {
        baselineEnergies.push(computeRmsEnergy(samples, sampleRate, t, 30));
      }
    }
    const baseline = baselineEnergies.length > 0
      ? baselineEnergies.reduce((s, e) => s + e, 0) / baselineEnergies.length
      : 0;

    if (bestPeakEnergy > baseline * 1.05 || baseline < 0.001) {
      onBeatCount++;
      onsetErrors.push(Math.abs(bestPeakTime - predicted) * 1000);
    }
  }

  return {
    anchorsCovered: onBeatCount,
    anchorsTotal: midiDownbeats.length,
    coverage: totalValid > 0 ? onBeatCount / totalValid : 0,
    medianMs: onsetErrors.length > 0 ? median(onsetErrors) : Infinity,
    p95Ms: onsetErrors.length > 0 ? percentile(onsetErrors, 95) : Infinity,
    energyScore: totalValid > 0 ? onBeatCount / totalValid : 0,
  };
}

function piecewiseTransform(t: number, segments: PiecewiseSegment[]): number {
  // Find the segment this time falls in
  for (const seg of segments) {
    if (t >= seg.midiStart && t <= seg.midiEnd) {
      return seg.a + seg.b * t;
    }
  }
  // Extrapolate from last segment
  const last = segments[segments.length - 1];
  return last.a + last.b * t;
}

// ============================================
// Headless Analysis (shared)
// ============================================

async function runHeadlessAnalysis(audioPath: string, song: ManifestSong, gt: MidiGroundTruth) {
  const { NodeRhythmAnalyzer } = await import('../src/node/NodeRhythmAnalyzer');
  const analyzer = new NodeRhythmAnalyzer();
  const [num, den] = song.midiTimeSignature.split('/').map(Number);
  return analyzer.analyze(audioPath, {
    tempoHint: gt.tempo,
    timeSignatureHint: { numerator: num, denominator: den },
    keyHint: gt.key,
  });
}

// ============================================
// Tier 1: Global Affine Alignment
// ============================================

async function alignTier1(
  song: ManifestSong,
  gt: MidiGroundTruth,
): Promise<AlignmentArtifact> {
  const gate1Thresholds: GateThresholds = { coverageMin: 0.90, medianMax: 120, p95Max: 300 };
  const audioPath = path.join(AUDIO_DIR, `${song.id}.wav`);

  if (!fs.existsSync(audioPath)) {
    return makeUnaligned(song.id, 1, 'audio_not_found');
  }

  console.log(`  Loading audio...`);
  const wav = loadWav(audioPath);

  if (wav.duration < 30) {
    return makeUnaligned(song.id, 1, 'audio_too_short');
  }

  // Check for multi-tempo — route to piecewise if needed
  if (hasMultipleTempos(gt)) {
    console.log(`  Multi-tempo detected — using piecewise affine`);
    return alignPiecewise(song, gt, wav);
  }

  console.log(`  Running headless analysis...`);
  const analysisResult = await runHeadlessAnalysis(audioPath, song, gt);

  const ytBeats = analysisResult.beatGrid.beats;
  if (ytBeats.length < 10) {
    return makeUnaligned(song.id, 1, 'analysis_too_few_beats');
  }

  const midiDownbeats = gt.barAnchors.map(a => a.time);
  const ytDownbeats = ytBeats
    .filter(b => b.beatInBar === 1)
    .map(b => b.time);

  console.log(`  MIDI downbeats: ${midiDownbeats.length}, YouTube downbeats: ${ytDownbeats.length}`);

  // Step 1: Find best offset via cross-correlation with audio energy
  const { offset } = findBestOffset(midiDownbeats, wav.samples, wav.sampleRate, wav.duration, gt.duration);
  console.log(`  Cross-correlation offset: ${offset.toFixed(2)}s`);

  // Step 2: Compute tempo ratio from detected beat grids
  const b = computeTempoRatio(midiDownbeats, ytDownbeats);
  console.log(`  Tempo ratio (b): ${b.toFixed(4)}`);

  // Step 3: Refine with least squares
  const { a, bRefined } = refineAffineParams(midiDownbeats, ytDownbeats, offset, b);
  console.log(`  Refined params: a=${a.toFixed(3)}, b=${bRefined.toFixed(4)}`);

  // Step 4: Validate
  const qualityRaw = validateAlignment(midiDownbeats, ytDownbeats, a, bRefined);
  console.log(`  Quality: coverage=${(qualityRaw.coverage * 100).toFixed(0)}%, median=${qualityRaw.medianMs.toFixed(0)}ms, p95=${qualityRaw.p95Ms.toFixed(0)}ms`);

  // Gate 1 criteria
  if (qualityRaw.coverage < gate1Thresholds.coverageMin) {
    return makeUnaligned(song.id, 1, `coverage_too_low:${(qualityRaw.coverage * 100).toFixed(0)}%`, {
      a,
      b: bRefined,
      qualityRaw,
      thresholds: gate1Thresholds,
      midiDuration: gt.duration,
      qualityMode: 'analysis_downbeat',
    });
  }
  if (qualityRaw.medianMs > gate1Thresholds.medianMax) {
    return makeUnaligned(song.id, 1, `median_error_too_high:${qualityRaw.medianMs.toFixed(0)}ms`, {
      a,
      b: bRefined,
      qualityRaw,
      thresholds: gate1Thresholds,
      midiDuration: gt.duration,
      qualityMode: 'analysis_downbeat',
    });
  }
  if (qualityRaw.p95Ms > gate1Thresholds.p95Max) {
    return makeUnaligned(song.id, 1, `p95_error_too_high:${qualityRaw.p95Ms.toFixed(0)}ms`, {
      a,
      b: bRefined,
      qualityRaw,
      thresholds: gate1Thresholds,
      midiDuration: gt.duration,
      qualityMode: 'analysis_downbeat',
    });
  }

  return makeAligned(
    song.id,
    1,
    'affine',
    { a, b: bRefined },
    {
      midiStart: 0,
      midiEnd: gt.duration,
      youtubeStart: a,
      youtubeEnd: a + bRefined * gt.duration,
    },
    'analysis_downbeat',
    qualityRaw,
    gate1Thresholds,
  );
}

// ============================================
// Piecewise Affine for Multi-Tempo Songs
// ============================================

async function alignPiecewise(
  song: ManifestSong,
  gt: MidiGroundTruth,
  wav: { samples: Float32Array; sampleRate: number; duration: number },
  tier: 1 | 2 = 1,
  baseline?: BaselineSnapshot,
): Promise<AlignmentArtifact> {
  const thresholds: GateThresholds = { coverageMin: 0.70, medianMax: 150, p95Max: 400 };
  // Build tempo segments from tempoChanges
  // Filter to significant changes (>20% tempo shift) to avoid rubato noise
  const significantChanges: Array<{ time: number; bpm: number }> = [gt.tempoChanges[0]];
  for (let i = 1; i < gt.tempoChanges.length; i++) {
    const prev = significantChanges[significantChanges.length - 1];
    const curr = gt.tempoChanges[i];
    if (Math.abs(curr.bpm - prev.bpm) / prev.bpm > 0.20) {
      significantChanges.push(curr);
    }
  }

  console.log(`  Tempo segments: ${significantChanges.map(c => `${c.bpm}BPM@${c.time.toFixed(1)}s`).join(' → ')}`);

  // Define MIDI time ranges for each tempo segment
  const tempoSegments: Array<{ midiStart: number; midiEnd: number; bpm: number }> = [];
  for (let i = 0; i < significantChanges.length; i++) {
    const start = significantChanges[i].time;
    const end = i + 1 < significantChanges.length ? significantChanges[i + 1].time : gt.duration;
    // Only keep segments with meaningful duration (>5s)
    if (end - start > 5) {
      tempoSegments.push({ midiStart: start, midiEnd: end, bpm: significantChanges[i].bpm });
    }
  }

  if (tempoSegments.length === 0) {
    return makeUnaligned(song.id, tier, 'no_valid_tempo_segments', {
      midiDuration: gt.duration,
      qualityMode: 'piecewise_energy_peak',
      thresholds,
      baseline: tier === 2 ? baseline : undefined,
    });
  }

  // Align segments sequentially — each segment's search starts from where
  // the previous one ended, giving continuity
  const alignedSegments: Array<{ midiStart: number; midiEnd: number; a: number; b: number }> = [];
  let expectedYtStart = 0; // where we expect the next segment to start in YouTube

  for (let si = 0; si < tempoSegments.length; si++) {
    const seg = tempoSegments[si];
    const segDownbeats = gt.barAnchors
      .filter(a => a.time >= seg.midiStart && a.time < seg.midiEnd)
      .map(a => a.time);

    if (segDownbeats.length < 3) {
      console.log(`  Segment ${seg.bpm}BPM (${seg.midiStart.toFixed(0)}-${seg.midiEnd.toFixed(0)}s): too few downbeats (${segDownbeats.length}), skipping`);
      // Advance expected position based on MIDI duration
      expectedYtStart += (seg.midiEnd - seg.midiStart);
      continue;
    }

    // Search for offset+scale using 2D grid, constrained to expected YouTube position
    // Shift downbeats so they start at 0 for the grid search
    const segDuration = seg.midiEnd - seg.midiStart;
    const relativeDownbeats = segDownbeats.map(t => t - seg.midiStart);

    // Search range: expectedYtStart ± 20s, scale 0.85-1.25
    let bestOffset = expectedYtStart;
    let bestScale = 1.0;
    let bestScore = -Infinity;

    const searchMin = Math.max(0, expectedYtStart - 20);
    const searchMax = Math.min(wav.duration - segDuration * 0.8, expectedYtStart + 30);

    for (let scale = 0.85; scale <= 1.25; scale += 0.01) {
      for (let offset = searchMin; offset <= searchMax; offset += 0.5) {
        const shiftedTimes = relativeDownbeats.map(t => offset + t * scale);
        const validTimes = shiftedTimes.filter(t => t >= 0 && t <= wav.duration);
        if (validTimes.length < relativeDownbeats.length * 0.5) continue;

        const energies = computeOnsetStrengthAtTimes(wav.samples, wav.sampleRate, validTimes);
        const score = energies.reduce((sum, e) => sum + e, 0) / validTimes.length;

        if (score > bestScore) {
          bestScore = score;
          bestOffset = offset;
          bestScale = scale;
        }
      }
    }

    // Refine with finer grid
    for (let scale = bestScale - 0.05; scale <= bestScale + 0.05; scale += 0.002) {
      for (let offset = bestOffset - 2; offset <= bestOffset + 2; offset += 0.1) {
        const shiftedTimes = relativeDownbeats.map(t => offset + t * scale);
        const validTimes = shiftedTimes.filter(t => t >= 0 && t <= wav.duration);
        if (validTimes.length < relativeDownbeats.length * 0.5) continue;

        const energies = computeOnsetStrengthAtTimes(wav.samples, wav.sampleRate, validTimes);
        const score = energies.reduce((sum, e) => sum + e, 0) / validTimes.length;

        if (score > bestScore) {
          bestScore = score;
          bestOffset = offset;
          bestScale = scale;
        }
      }
    }

    // Convert to affine params: t_yt = a + b * t_midi
    // t_yt = bestOffset + bestScale * (t_midi - seg.midiStart)
    // t_yt = (bestOffset - bestScale * seg.midiStart) + bestScale * t_midi
    const a = bestOffset - bestScale * seg.midiStart;
    const b = bestScale;

    console.log(`  Segment ${seg.bpm}BPM (${seg.midiStart.toFixed(0)}-${seg.midiEnd.toFixed(0)}s): offset=${bestOffset.toFixed(1)}, scale=${bestScale.toFixed(3)}, a=${a.toFixed(2)}, b=${b.toFixed(4)}`);

    alignedSegments.push({ midiStart: seg.midiStart, midiEnd: seg.midiEnd, a, b });

    // Update expected position for next segment
    expectedYtStart = bestOffset + bestScale * segDuration;
  }

  if (alignedSegments.length === 0) {
    return makeUnaligned(song.id, tier, 'no_segments_aligned', {
      midiDuration: gt.duration,
      qualityMode: 'piecewise_energy_peak',
      thresholds,
      baseline: tier === 2 ? baseline : undefined,
    });
  }

  // Validate piecewise alignment using energy
  const midiDownbeats = gt.barAnchors.map(a => a.time);
  const qualityRaw = validatePiecewiseByEnergy(midiDownbeats, wav.samples, wav.sampleRate, wav.duration, alignedSegments);
  const tier2Baseline = tier === 2
    ? (baseline ?? {
      qualityMode: 'piecewise_energy_peak',
      coverage: qualityRaw.coverage,
      medianMs: qualityRaw.medianMs,
      p95Ms: qualityRaw.p95Ms,
    })
    : undefined;
  console.log(`  Piecewise quality: coverage=${(qualityRaw.coverage * 100).toFixed(0)}%, median=${qualityRaw.medianMs.toFixed(0)}ms, p95=${qualityRaw.p95Ms.toFixed(0)}ms, energyScore=${(qualityRaw.energyScore * 100).toFixed(0)}%`);

  // Gates for piecewise (complex songs get relaxed thresholds)
  if (qualityRaw.coverage < thresholds.coverageMin) {
    return makeUnaligned(song.id, tier, `coverage_too_low:piecewise:${(qualityRaw.coverage * 100).toFixed(0)}%`, {
      a: 0,
      b: 1,
      qualityRaw,
      thresholds,
      midiDuration: gt.duration,
      qualityMode: 'piecewise_energy_peak',
      model: 'piecewise_affine',
      segments: alignedSegments,
      baseline: tier2Baseline,
    });
  }
  if (qualityRaw.medianMs > thresholds.medianMax) {
    return makeUnaligned(song.id, tier, `median_error_too_high:piecewise:${qualityRaw.medianMs.toFixed(0)}ms`, {
      a: 0,
      b: 1,
      qualityRaw,
      thresholds,
      midiDuration: gt.duration,
      qualityMode: 'piecewise_energy_peak',
      model: 'piecewise_affine',
      segments: alignedSegments,
      baseline: tier2Baseline,
    });
  }
  if (qualityRaw.p95Ms > thresholds.p95Max) {
    return makeUnaligned(song.id, tier, `p95_error_too_high:piecewise:${qualityRaw.p95Ms.toFixed(0)}ms`, {
      a: 0,
      b: 1,
      qualityRaw,
      thresholds,
      midiDuration: gt.duration,
      qualityMode: 'piecewise_energy_peak',
      model: 'piecewise_affine',
      segments: alignedSegments,
      baseline: tier2Baseline,
    });
  }

  const firstSeg = alignedSegments[0];

  return makeAligned(
    song.id,
    tier,
    'piecewise_affine',
    { a: firstSeg.a, b: firstSeg.b },
    {
      midiStart: 0,
      midiEnd: gt.duration,
      youtubeStart: firstSeg.a + firstSeg.b * 0,
      youtubeEnd: piecewiseTransform(gt.duration, alignedSegments),
    },
    'piecewise_energy_peak',
    qualityRaw,
    thresholds,
    {
      segments: alignedSegments,
      baseline: tier2Baseline,
    },
  );
}

// ============================================
// Tier 2: Energy Cross-Correlation with Tempo Scaling
// ============================================

function toBaselineSnapshot(qualityMode: BaselineSnapshot['qualityMode'], qualityRaw: RawQuality): BaselineSnapshot {
  return {
    qualityMode,
    coverage: qualityRaw.coverage,
    medianMs: qualityRaw.medianMs,
    p95Ms: qualityRaw.p95Ms,
  };
}

function evaluateDeltaVsBaseline(
  candidate: RawQuality,
  baseline: BaselineSnapshot,
): {
  improves: boolean;
  regressionOk: boolean;
  deltas: { coverageDelta: number; medianDeltaMs: number; p95DeltaMs: number };
} {
  const coverageDelta = candidate.coverage - baseline.coverage;
  const medianDeltaMs = candidate.medianMs - baseline.medianMs;
  const p95DeltaMs = candidate.p95Ms - baseline.p95Ms;
  const improves =
    coverageDelta >= 0.05 ||
    medianDeltaMs <= -20 ||
    p95DeltaMs <= -40;
  const regressionOk =
    coverageDelta >= -0.02 &&
    medianDeltaMs <= 20 &&
    p95DeltaMs <= 40;
  return {
    improves,
    regressionOk,
    deltas: { coverageDelta, medianDeltaMs, p95DeltaMs },
  };
}

function qualityFailureReason(quality: RawQuality, thresholds: GateThresholds): string | null {
  if (quality.coverage < thresholds.coverageMin) {
    return `coverage_too_low:${(quality.coverage * 100).toFixed(0)}%`;
  }
  if (quality.medianMs > thresholds.medianMax) {
    return `median_error_too_high:${quality.medianMs.toFixed(0)}ms`;
  }
  if (quality.p95Ms > thresholds.p95Max) {
    return `p95_error_too_high:${quality.p95Ms.toFixed(0)}ms`;
  }
  return null;
}

function computeTier2CoarseBaseline(
  midiDownbeats: number[],
  wav: { samples: Float32Array; sampleRate: number; duration: number },
  midiDuration: number,
): { a: number; b: number; qualityRaw: RawQuality } {
  const coarse = findBestOffset(midiDownbeats, wav.samples, wav.sampleRate, wav.duration, midiDuration);
  const a = coarse.offset;
  const b = 1.0;
  const quality = validateAlignmentByEnergy(midiDownbeats, wav.samples, wav.sampleRate, wav.duration, a, b);
  return {
    a,
    b,
    qualityRaw: {
      anchorsCovered: quality.anchorsCovered,
      anchorsTotal: quality.anchorsTotal,
      coverage: quality.coverage,
      medianMs: quality.medianMs,
      p95Ms: quality.p95Ms,
    },
  };
}

async function alignTier2(
  song: ManifestSong,
  gt: MidiGroundTruth,
): Promise<AlignmentArtifact> {
  const thresholds: GateThresholds = { coverageMin: 0.70, medianMax: 150, p95Max: 400 };
  const audioPath = path.join(AUDIO_DIR, `${song.id}.wav`);

  if (!fs.existsSync(audioPath)) {
    return makeUnaligned(song.id, 2, 'audio_not_found', {
      midiDuration: gt.duration,
      qualityMode: 'energy_peak',
      thresholds,
    });
  }

  console.log(`  Loading audio...`);
  const wav = loadWav(audioPath);

  if (wav.duration < 30) {
    return makeUnaligned(song.id, 2, 'audio_too_short', {
      midiDuration: gt.duration,
      qualityMode: 'energy_peak',
      thresholds,
    });
  }

  const midiDownbeats = gt.barAnchors.map(a => a.time);
  console.log(`  MIDI downbeats: ${midiDownbeats.length}`);

  // Check for multi-tempo — use piecewise if needed
  if (hasMultipleTempos(gt)) {
    console.log(`  Multi-tempo Tier 2 — using piecewise affine`);
    return alignPiecewise(song, gt, wav, 2, undefined);
  }

  const coarseBaseline = computeTier2CoarseBaseline(midiDownbeats, wav, gt.duration);
  console.log(
    `  Baseline coarse: offset=${coarseBaseline.a.toFixed(2)}s, scale=${coarseBaseline.b.toFixed(3)}, coverage=${(coarseBaseline.qualityRaw.coverage * 100).toFixed(0)}%, median=${coarseBaseline.qualityRaw.medianMs.toFixed(0)}ms, p95=${coarseBaseline.qualityRaw.p95Ms.toFixed(0)}ms`,
  );

  // Baseline: current energy search candidate.
  console.log(`  Baseline energy search: offset + tempo scale grid...`);
  const { offset, tempoScale, score } = findBestOffsetAndScale(
    midiDownbeats, wav.samples, wav.sampleRate, wav.duration, gt.duration
  );
  console.log(`  Baseline: offset=${offset.toFixed(2)}s, scale=${tempoScale.toFixed(3)}, energy=${score.toFixed(4)}`);

  const baselineQuality = validateAlignmentByEnergy(midiDownbeats, wav.samples, wav.sampleRate, wav.duration, offset, tempoScale);
  const fallbackQualityRaw: RawQuality = {
    anchorsCovered: baselineQuality.anchorsCovered,
    anchorsTotal: baselineQuality.anchorsTotal,
    coverage: baselineQuality.coverage,
    medianMs: baselineQuality.medianMs,
    p95Ms: baselineQuality.p95Ms,
  };
  const baselineForDelta = toBaselineSnapshot('energy_peak', coarseBaseline.qualityRaw);
  // Enforce Gate 2 deltas even on a cold run so first and second runs are identical.
  const requireImprovementGate = true;

  // Token-local candidate path.
  let tokenCandidate:
    | {
      params: { a: number; b: number };
      qualityRaw: RawQuality;
      local: LocalAlignResult;
    }
    | null = null;
  let tokenFailureReason: AlignmentReasonCode | null = null;
  let tokenFailureDetail: string | null = null;

  const audioFeatures = extractAudioFeatures(wav.samples, wav.sampleRate);
  console.log(
    `  Token features: onsets=${audioFeatures.onsets.length}, medianPitchConfidence=${audioFeatures.medianPitchConfidence.toFixed(3)}, onsetDensity=${audioFeatures.onsetDensity.toFixed(3)}`,
  );
  if (!passesPreAlignmentExtractionGate(audioFeatures)) {
    tokenFailureReason = 'extraction_quality_low';
    tokenFailureDetail = `onsets=${audioFeatures.onsets.length}, medianPitchConfidence=${audioFeatures.medianPitchConfidence.toFixed(3)}, onsetDensity=${audioFeatures.onsetDensity.toFixed(3)}`;
  } else {
    const midiTokens = buildMidiTokens(gt);
    const audioTokens = buildAudioTokens(audioFeatures);
    console.log(`  Token counts: midi=${midiTokens.length}, audio=${audioTokens.length}`);
    let kUsed = 4;
    let seedMode: 'full' | 'pitch_only' = 'full';
    let seedPairs = enumerateSeedPairs(midiTokens, audioTokens, 4);
    if (seedPairs.length < 12) {
      kUsed = 3;
      seedPairs = enumerateSeedPairs(midiTokens, audioTokens, 3);
    }
    if (seedPairs.length < 8) {
      seedMode = 'pitch_only';
      kUsed = 3;
      seedPairs = enumerateSeedPairsPitchOnly(midiTokens, audioTokens, 3);
    }
    console.log(`  Seed search: mode=${seedMode}, k=${kUsed}, pairs=${seedPairs.length}`);

    if (seedPairs.length < 8) {
      tokenFailureReason = 'insufficient_seeds';
      tokenFailureDetail = `mode=${seedMode}, k=${kUsed}, seeds=${seedPairs.length}, midiTokens=${midiTokens.length}, audioTokens=${audioTokens.length}`;
    } else {
      const local = localAlign(midiTokens, audioTokens, seedPairs);
      console.log(
        `  Local align: score=${local.score.toFixed(2)}, secondBest=${local.secondBestScore.toFixed(2)}, blocks=${local.blockCount}, matches=${local.matches.length}, confidence=${local.confidence.toFixed(3)}`,
      );
      const eligible = local.confidence >= 0.40 && local.blockCount >= 2 && local.matches.length >= 12;
      const ambiguous = local.secondBestScore > 0 && local.score < 1.30 * local.secondBestScore;

      if (!eligible) {
        tokenFailureReason = 'insufficient_seeds';
        tokenFailureDetail = `confidence=${local.confidence.toFixed(3)}, blocks=${local.blockCount}, matches=${local.matches.length}`;
      } else if (ambiguous) {
        tokenFailureReason = 'multi_match_ambiguous';
        tokenFailureDetail = `score=${local.score.toFixed(2)}, secondBest=${local.secondBestScore.toFixed(2)}`;
      } else {
        const fit = fitAffineFromPairs(local.matches.map(m => ({
          midiTimeSec: m.midiTimeSec,
          audioTimeSec: m.audioTimeSec,
        })));
        if (!fit) {
          tokenFailureReason = 'insufficient_seeds';
          tokenFailureDetail = `matches=${local.matches.length} but affine fit failed`;
        } else if (fit.b < 0.80 || fit.b > 1.30) {
          tokenFailureReason = 'slope_out_of_range';
          tokenFailureDetail = fit.b.toFixed(3);
        } else {
          const tokenQuality = validateAlignmentByEnergy(
            midiDownbeats,
            wav.samples,
            wav.sampleRate,
            wav.duration,
            fit.a,
            fit.b,
          );
          tokenCandidate = {
            params: { a: fit.a, b: fit.b },
            qualityRaw: {
              anchorsCovered: tokenQuality.anchorsCovered,
              anchorsTotal: tokenQuality.anchorsTotal,
              coverage: tokenQuality.coverage,
              medianMs: tokenQuality.medianMs,
              p95Ms: tokenQuality.p95Ms,
            },
            local,
          };
          console.log(
            `  Token candidate: a=${fit.a.toFixed(3)}, b=${fit.b.toFixed(4)}, coverage=${(tokenCandidate.qualityRaw.coverage * 100).toFixed(0)}%, median=${tokenCandidate.qualityRaw.medianMs.toFixed(0)}ms, p95=${tokenCandidate.qualityRaw.p95Ms.toFixed(0)}ms`,
          );
        }
      }
    }
  }

  if (tokenCandidate) {
    const qualityFail = qualityFailureReason(tokenCandidate.qualityRaw, thresholds);
    const delta = evaluateDeltaVsBaseline(tokenCandidate.qualityRaw, baselineForDelta);
    console.log(
      `  Token deltas: coverage=${delta.deltas.coverageDelta.toFixed(3)}, median=${delta.deltas.medianDeltaMs.toFixed(1)}ms, p95=${delta.deltas.p95DeltaMs.toFixed(1)}ms, improves=${delta.improves}, regressionOk=${delta.regressionOk}`,
    );
    const deltaPass = delta.regressionOk && (!requireImprovementGate || delta.improves);
    if (!qualityFail && deltaPass) {
      console.log(
        `  Token-local accepted: coverage=${(tokenCandidate.qualityRaw.coverage * 100).toFixed(0)}%, median=${tokenCandidate.qualityRaw.medianMs.toFixed(0)}ms, p95=${tokenCandidate.qualityRaw.p95Ms.toFixed(0)}ms`,
      );
      return makeAligned(
        song.id,
        2,
        'affine',
        tokenCandidate.params,
        {
          midiStart: 0,
          midiEnd: gt.duration,
          youtubeStart: tokenCandidate.params.a,
          youtubeEnd: tokenCandidate.params.a + tokenCandidate.params.b * gt.duration,
        },
        'token_local_align',
        tokenCandidate.qualityRaw,
        thresholds,
        {
          baseline: baselineForDelta,
        },
      );
    }
    tokenFailureReason = tokenFailureReason ?? (qualityFail ? parseReasonWithDetail(qualityFail).reason : 'coverage_too_low');
    tokenFailureDetail =
      tokenFailureDetail ??
      (qualityFail
        ? qualityFail
        : `delta coverage=${delta.deltas.coverageDelta.toFixed(3)}, median=${delta.deltas.medianDeltaMs.toFixed(1)}ms, p95=${delta.deltas.p95DeltaMs.toFixed(1)}ms`);
  }

  const fallbackReason = qualityFailureReason(fallbackQualityRaw, thresholds);
  const fallbackDelta = evaluateDeltaVsBaseline(fallbackQualityRaw, baselineForDelta);
  console.log(
    `  Fallback deltas: coverage=${fallbackDelta.deltas.coverageDelta.toFixed(3)}, median=${fallbackDelta.deltas.medianDeltaMs.toFixed(1)}ms, p95=${fallbackDelta.deltas.p95DeltaMs.toFixed(1)}ms, improves=${fallbackDelta.improves}, regressionOk=${fallbackDelta.regressionOk}`,
  );
  const fallbackDeltaPass = fallbackDelta.regressionOk && (!requireImprovementGate || fallbackDelta.improves);
  const fallbackSlopeOk = tempoScale >= 0.80 && tempoScale <= 1.30;
  if (fallbackSlopeOk && !fallbackReason && fallbackDeltaPass) {
    console.log(
      `  Fallback energy accepted: coverage=${(fallbackQualityRaw.coverage * 100).toFixed(0)}%, median=${fallbackQualityRaw.medianMs.toFixed(0)}ms, p95=${fallbackQualityRaw.p95Ms.toFixed(0)}ms`,
    );
    return makeAligned(
      song.id,
      2,
      'affine',
      { a: offset, b: tempoScale },
      {
        midiStart: 0,
        midiEnd: gt.duration,
        youtubeStart: offset,
        youtubeEnd: offset + tempoScale * gt.duration,
      },
      'energy_peak',
      fallbackQualityRaw,
      thresholds,
      {
        baseline: baselineForDelta,
      },
    );
  }

  if (tokenFailureReason === 'multi_match_ambiguous') {
    console.log(`  Token failure: ${tokenFailureReason}${tokenFailureDetail ? ` (${tokenFailureDetail})` : ''}`);
    return makeUnaligned(song.id, 2, 'multi_match_ambiguous', {
      a: offset,
      b: tempoScale,
      midiDuration: gt.duration,
      qualityRaw: fallbackQualityRaw,
      thresholds,
      qualityMode: 'energy_peak',
      baseline: baselineForDelta,
    });
  }

  if (!fallbackSlopeOk) {
    console.log(`  Fallback failure: slope_out_of_range (${tempoScale.toFixed(3)})`);
    return makeUnaligned(song.id, 2, `slope_out_of_range:${tempoScale.toFixed(3)}`, {
      a: offset,
      b: tempoScale,
      midiDuration: gt.duration,
      qualityRaw: fallbackQualityRaw,
      thresholds,
      qualityMode: 'energy_peak',
      baseline: baselineForDelta,
    });
  }

  const fallbackFailure = fallbackReason
    ?? `coverage_too_low:delta coverage=${fallbackDelta.deltas.coverageDelta.toFixed(3)}, median=${fallbackDelta.deltas.medianDeltaMs.toFixed(1)}ms, p95=${fallbackDelta.deltas.p95DeltaMs.toFixed(1)}ms`;
  if (tokenFailureReason === 'extraction_quality_low' && !fallbackReason) {
    console.log(`  Token failure: ${tokenFailureReason}${tokenFailureDetail ? ` (${tokenFailureDetail})` : ''}`);
    return makeUnaligned(song.id, 2, `extraction_quality_low:${tokenFailureDetail ?? 'token pre-gate failed'}`, {
      a: offset,
      b: tempoScale,
      midiDuration: gt.duration,
      qualityRaw: fallbackQualityRaw,
      thresholds,
      qualityMode: 'energy_peak',
      baseline: baselineForDelta,
    });
  }

  if (tokenFailureReason) {
    console.log(`  Token failure: ${tokenFailureReason}${tokenFailureDetail ? ` (${tokenFailureDetail})` : ''}`);
  }
  if (fallbackReason) {
    console.log(`  Fallback failure: ${fallbackReason}`);
  }

  return makeUnaligned(song.id, 2, fallbackFailure, {
    a: offset,
    b: tempoScale,
    midiDuration: gt.duration,
    qualityRaw: fallbackQualityRaw,
    thresholds,
    qualityMode: 'energy_peak',
    baseline: baselineForDelta,
  });
}

// ============================================
// Helpers
// ============================================

function makeUnaligned(
  songId: string,
  tier: 1 | 2,
  reasonInput: AlignmentReasonCode | string,
  options: {
    a?: number;
    b?: number;
    qualityRaw?: RawQuality;
    thresholds?: GateThresholds;
    midiDuration?: number;
    qualityMode?: QualityMode;
    baseline?: BaselineSnapshot;
    model?: 'affine' | 'piecewise_affine';
    segments?: PiecewiseSegment[];
  } = {},
): AlignmentArtifact {
  const parsed = parseReasonWithDetail(String(reasonInput));
  const reason = parsed.reason;
  const reasonDetail = parsed.reasonDetail;
  const a = options.a ?? 0;
  const b = options.b ?? 1;
  const midiDuration = options.midiDuration ?? 0;
  const raw = options.qualityRaw ?? {
    anchorsCovered: 0,
    anchorsTotal: 0,
    coverage: 0,
    medianMs: Infinity,
    p95Ms: Infinity,
  };
  const thresholds = options.thresholds ?? {
    coverageMin: 0,
    medianMax: Number.POSITIVE_INFINITY,
    p95Max: Number.POSITIVE_INFINITY,
  };

  return {
    songId,
    status: tier === 1 ? 'unaligned' : 'unaligned_partial',
    tier,
    model: options.model ?? 'affine',
    params: { a, b },
    segments: options.segments,
    segment: {
      midiStart: 0,
      midiEnd: midiDuration,
      youtubeStart: a,
      youtubeEnd: a + b * midiDuration,
    },
    qualityMode: options.qualityMode ?? (tier === 1 ? 'analysis_downbeat' : 'energy_peak'),
    quality: withQualityMeta(raw, thresholds),
    baseline: tier === 2 ? options.baseline : undefined,
    reason,
    reasonDetail,
    version: 'align-v3',
  };
}

function makeAligned(
  songId: string,
  tier: 1 | 2,
  model: 'affine' | 'piecewise_affine',
  params: { a: number; b: number },
  segment: { midiStart: number; midiEnd: number; youtubeStart: number; youtubeEnd: number },
  qualityMode: QualityMode,
  qualityRaw: RawQuality,
  thresholds: GateThresholds,
  extras?: { segments?: PiecewiseSegment[]; baseline?: BaselineSnapshot },
): AlignmentArtifact {
  return {
    songId,
    status: 'aligned_ok',
    tier,
    model,
    params,
    segments: extras?.segments,
    segment,
    qualityMode,
    quality: withQualityMeta(qualityRaw, thresholds),
    baseline: tier === 2 ? extras?.baseline : undefined,
    reason: null,
    reasonDetail: null,
    version: 'align-v3',
  };
}

// ============================================
// Generate Aligned Ground Truth
// ============================================

function generateAlignedGroundTruth(
  gt: MidiGroundTruth,
  alignment: AlignmentArtifact,
): AlignedGroundTruth {
  let transform: (t: number) => number;

  if (alignment.model === 'piecewise_affine' && alignment.segments) {
    transform = (t: number) => piecewiseTransform(t, alignment.segments!);
  } else {
    const { a, b } = alignment.params;
    transform = (t: number) => a + b * t;
  }

  // For duration scaling, use average b across segments or the single b
  const avgB = alignment.segments
    ? alignment.segments.reduce((sum, s) => sum + s.b, 0) / alignment.segments.length
    : alignment.params.b;

  return {
    ...gt,
    barAnchors: gt.barAnchors.map(anchor => ({
      ...anchor,
      time: Math.round(transform(anchor.time) * 1000) / 1000,
    })),
    beats: gt.beats.map(beat => ({
      ...beat,
      time: Math.round(transform(beat.time) * 1000) / 1000,
    })),
    melodyNotes: gt.melodyNotes.map(note => ({
      ...note,
      time: Math.round(transform(note.time) * 1000) / 1000,
      duration: Math.round(note.duration * avgB * 1000) / 1000,
    })),
    allNotes: gt.allNotes?.map(note => ({
      ...note,
      time: Math.round(transform(note.time) * 1000) / 1000,
      duration: Math.round(note.duration * avgB * 1000) / 1000,
    })),
    duration: transform(gt.duration),
    alignmentModel: alignment.model,
    alignmentParams: alignment.params,
    alignmentSegments: alignment.segments,
  };
}

// ============================================
// Main
// ============================================

async function main() {
  const args = process.argv.slice(2);
  const tier1Only = args.includes('--tier1-only');
  const songFilter = args.includes('--song') ? args[args.indexOf('--song') + 1] : null;

  const manifestPath = path.join(TRAINING_DIR, 'manifest.json');
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  let songs: ManifestSong[] = manifest.songs;

  if (songFilter) {
    songs = songs.filter(s => s.id === songFilter);
    if (songs.length === 0) {
      console.error(`Song not found: ${songFilter}`);
      process.exit(1);
    }
  }

  fs.mkdirSync(ALIGNMENT_DIR, { recursive: true });
  fs.mkdirSync(ALIGNED_GT_DIR, { recursive: true });

  const results: AlignmentArtifact[] = [];

  console.log(`Aligning ${songs.length} songs${tier1Only ? ' (Tier 1 only)' : ''}...\n`);

  for (const song of songs) {
    console.log(`=== ${song.artist} - ${song.title} (${song.id}) ===`);

    const gtPath = path.join(GT_DIR, `${song.id}.json`);
    if (!fs.existsSync(gtPath)) {
      console.log(`  Skipping — no ground truth file. Run build-training-set.ts first.`);
      continue;
    }
    const gt: MidiGroundTruth = JSON.parse(fs.readFileSync(gtPath, 'utf8'));

    const tier = classifyTier(gt.duration, song.meta.youtubeTime);
    const ratio = (song.meta.youtubeTime / gt.duration).toFixed(2);
    console.log(`  Duration: MIDI=${gt.duration.toFixed(0)}s, YouTube=${song.meta.youtubeTime}s, ratio=${ratio}, tier=${tier}`);

    if (tier === 2 && tier1Only) {
      console.log(`  Skipping — Tier 2 (--tier1-only)`);
      console.log();
      continue;
    }

    const durationRatio = song.meta.youtubeTime / gt.duration;
    if (durationRatio > 3.0) {
      console.log(`  Skipping — duration ratio too high (${durationRatio.toFixed(2)} > 3.0)`);
      results.push(makeUnaligned(song.id, tier, `duration_ratio_too_high:${durationRatio.toFixed(2)}`));
      continue;
    }

    let alignment: AlignmentArtifact;
    try {
      if (tier === 1) {
        alignment = await alignTier1(song, gt);
      } else {
        alignment = await alignTier2(song, gt);
      }
    } catch (err) {
      console.error(`  ERROR: ${(err as Error).message}`);
      alignment = makeUnaligned(song.id, tier, `error:${(err as Error).message.substring(0, 100)}`);
    }

    results.push(alignment);

    const schemaErrors = validateArtifactSchema(alignment);
    if (schemaErrors.length > 0) {
      throw new Error(`schema_invalid:${song.id}:${schemaErrors.join(';')}`);
    }

    const alignPath = path.join(ALIGNMENT_DIR, `${song.id}.json`);
    fs.writeFileSync(alignPath, `${stableStringify(alignment)}\n`);
    console.log(`  Status: ${alignment.status}${alignment.reason ? ` (${alignment.reason})` : ''}`);

    if (alignment.status === 'aligned_ok') {
      const alignedGt = generateAlignedGroundTruth(gt, alignment);
      const alignedGtPath = path.join(ALIGNED_GT_DIR, `${song.id}.json`);
      fs.writeFileSync(alignedGtPath, `${stableStringify(alignedGt)}\n`);
      console.log(`  Aligned ground truth written`);
    }

    console.log();
  }

  // Summary
  console.log('=== Summary ===');
  const aligned = results.filter(r => r.status === 'aligned_ok');
  const unaligned = results.filter(r => r.status !== 'aligned_ok');
  console.log(`Aligned OK: ${aligned.length}`);
  console.log(`Unaligned: ${unaligned.length}`);
  for (const r of unaligned) {
    console.log(`  ${r.songId}: ${r.reason}`);
  }
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
