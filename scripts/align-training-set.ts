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
}

interface AlignmentArtifact {
  songId: string;
  status: 'aligned_ok' | 'unaligned' | 'unaligned_partial';
  tier: 1 | 2;
  model: 'affine' | 'piecewise_affine';
  params: { a: number; b: number };
  /** For piecewise: per-segment params */
  segments?: Array<{ midiStart: number; midiEnd: number; a: number; b: number }>;
  segment: { midiStart: number; midiEnd: number; youtubeStart: number; youtubeEnd: number };
  quality: { anchorsCovered: number; anchorsTotal: number; coverage: number; medianMs: number; p95Ms: number };
  reason: string | null;
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
): { anchorsCovered: number; anchorsTotal: number; coverage: number; medianMs: number; p95Ms: number } {
  const errors: number[] = [];
  let covered = 0;
  const matchTolerance = 1.0;

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

/**
 * Validate piecewise alignment: use the correct segment params for each MIDI anchor.
 */
function validatePiecewiseAlignment(
  midiDownbeats: number[],
  ytDownbeats: number[],
  segments: Array<{ midiStart: number; midiEnd: number; a: number; b: number }>,
): { anchorsCovered: number; anchorsTotal: number; coverage: number; medianMs: number; p95Ms: number } {
  const errors: number[] = [];
  let covered = 0;
  const matchTolerance = 1.0;

  for (const mt of midiDownbeats) {
    const predicted = piecewiseTransform(mt, segments);
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
): { anchorsCovered: number; anchorsTotal: number; coverage: number; medianMs: number; p95Ms: number; energyScore: number } {
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
  segments: Array<{ midiStart: number; midiEnd: number; a: number; b: number }>,
): { anchorsCovered: number; anchorsTotal: number; coverage: number; medianMs: number; p95Ms: number; energyScore: number } {
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

function piecewiseTransform(t: number, segments: Array<{ midiStart: number; midiEnd: number; a: number; b: number }>): number {
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
  const quality = validateAlignment(midiDownbeats, ytDownbeats, a, bRefined);
  console.log(`  Quality: coverage=${(quality.coverage * 100).toFixed(0)}%, median=${quality.medianMs.toFixed(0)}ms, p95=${quality.p95Ms.toFixed(0)}ms`);

  // Gate 1 criteria
  if (quality.coverage < 0.90) {
    return makeUnaligned(song.id, 1, `coverage_too_low:${(quality.coverage * 100).toFixed(0)}%`, a, bRefined, quality, gt.duration, wav.duration);
  }
  if (quality.medianMs > 120) {
    return makeUnaligned(song.id, 1, `median_error_too_high:${quality.medianMs.toFixed(0)}ms`, a, bRefined, quality, gt.duration, wav.duration);
  }
  if (quality.p95Ms > 300) {
    return makeUnaligned(song.id, 1, `p95_error_too_high:${quality.p95Ms.toFixed(0)}ms`, a, bRefined, quality, gt.duration, wav.duration);
  }

  return {
    songId: song.id,
    status: 'aligned_ok',
    tier: 1,
    model: 'affine',
    params: { a, b: bRefined },
    segment: {
      midiStart: 0,
      midiEnd: gt.duration,
      youtubeStart: a,
      youtubeEnd: a + bRefined * gt.duration,
    },
    quality,
    reason: null,
  };
}

// ============================================
// Piecewise Affine for Multi-Tempo Songs
// ============================================

async function alignPiecewise(
  song: ManifestSong,
  gt: MidiGroundTruth,
  wav: { samples: Float32Array; sampleRate: number; duration: number },
): Promise<AlignmentArtifact> {
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
    return makeUnaligned(song.id, 1, 'no_valid_tempo_segments');
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
    return makeUnaligned(song.id, 1, 'no_segments_aligned');
  }

  // Validate piecewise alignment using energy
  const midiDownbeats = gt.barAnchors.map(a => a.time);
  const quality = validatePiecewiseByEnergy(midiDownbeats, wav.samples, wav.sampleRate, wav.duration, alignedSegments);
  console.log(`  Piecewise quality: coverage=${(quality.coverage * 100).toFixed(0)}%, median=${quality.medianMs.toFixed(0)}ms, p95=${quality.p95Ms.toFixed(0)}ms, energyScore=${(quality.energyScore * 100).toFixed(0)}%`);

  // Gates for piecewise (complex songs get relaxed thresholds)
  if (quality.coverage < 0.70) {
    return makeUnaligned(song.id, 1, `pw_coverage_too_low:${(quality.coverage * 100).toFixed(0)}%`, 0, 1, quality, gt.duration, wav.duration);
  }
  if (quality.medianMs > 150) {
    return makeUnaligned(song.id, 1, `pw_median_error_too_high:${quality.medianMs.toFixed(0)}ms`, 0, 1, quality, gt.duration, wav.duration);
  }

  const firstSeg = alignedSegments[0];

  return {
    songId: song.id,
    status: 'aligned_ok',
    tier: 1,
    model: 'piecewise_affine',
    params: { a: firstSeg.a, b: firstSeg.b },
    segments: alignedSegments,
    segment: {
      midiStart: 0,
      midiEnd: gt.duration,
      youtubeStart: firstSeg.a + firstSeg.b * 0,
      youtubeEnd: piecewiseTransform(gt.duration, alignedSegments),
    },
    quality,
    reason: null,
  };
}

// ============================================
// Tier 2: Energy Cross-Correlation with Tempo Scaling
// ============================================

async function alignTier2(
  song: ManifestSong,
  gt: MidiGroundTruth,
): Promise<AlignmentArtifact> {
  const audioPath = path.join(AUDIO_DIR, `${song.id}.wav`);

  if (!fs.existsSync(audioPath)) {
    return makeUnaligned(song.id, 2, 'audio_not_found');
  }

  console.log(`  Loading audio...`);
  const wav = loadWav(audioPath);

  if (wav.duration < 30) {
    return makeUnaligned(song.id, 2, 'audio_too_short');
  }

  const midiDownbeats = gt.barAnchors.map(a => a.time);
  console.log(`  MIDI downbeats: ${midiDownbeats.length}`);

  // Check for multi-tempo — use piecewise if needed
  if (hasMultipleTempos(gt)) {
    console.log(`  Multi-tempo Tier 2 — using piecewise affine`);
    return alignPiecewise(song, gt, wav);
  }

  // Step 1: 2D grid search over (offset, tempoScale) using energy
  console.log(`  Searching offset + tempo scale grid...`);
  const { offset, tempoScale, score } = findBestOffsetAndScale(
    midiDownbeats, wav.samples, wav.sampleRate, wav.duration, gt.duration
  );
  console.log(`  Best: offset=${offset.toFixed(2)}s, scale=${tempoScale.toFixed(3)}, energy=${score.toFixed(4)}`);

  // Use offset and scale directly as affine params: t_yt = offset + scale * t_midi
  const a = offset;
  const b = tempoScale;

  // Gate 2: slope within sane range
  if (b < 0.80 || b > 1.30) {
    return makeUnaligned(song.id, 2, `slope_out_of_range:${b.toFixed(3)}`);
  }

  // Validate using audio energy (not analysis downbeats)
  const quality = validateAlignmentByEnergy(midiDownbeats, wav.samples, wav.sampleRate, wav.duration, a, b);
  console.log(`  Energy quality: coverage=${(quality.coverage * 100).toFixed(0)}%, median=${quality.medianMs.toFixed(0)}ms, p95=${quality.p95Ms.toFixed(0)}ms, energyScore=${(quality.energyScore * 100).toFixed(0)}%`);

  // Gate 2 criteria
  if (quality.coverage < 0.60) {
    return makeUnaligned(song.id, 2, `coverage_too_low:${(quality.coverage * 100).toFixed(0)}%`, a, b, quality, gt.duration, wav.duration);
  }
  if (quality.medianMs > 150) {
    return makeUnaligned(song.id, 2, `median_error_too_high:${quality.medianMs.toFixed(0)}ms`, a, b, quality, gt.duration, wav.duration);
  }

  return {
    songId: song.id,
    status: 'aligned_ok',
    tier: 2,
    model: 'affine',
    params: { a, b },
    segment: {
      midiStart: 0,
      midiEnd: gt.duration,
      youtubeStart: a,
      youtubeEnd: a + b * gt.duration,
    },
    quality,
    reason: null,
  };
}

// ============================================
// Helpers
// ============================================

function makeUnaligned(
  songId: string,
  tier: 1 | 2,
  reason: string,
  a?: number,
  b?: number,
  quality?: { anchorsCovered: number; anchorsTotal: number; coverage: number; medianMs: number; p95Ms: number },
  midiDuration?: number,
  audioDuration?: number,
): AlignmentArtifact {
  return {
    songId,
    status: tier === 1 ? 'unaligned' : 'unaligned_partial',
    tier,
    model: 'affine',
    params: { a: a ?? 0, b: b ?? 1 },
    segment: {
      midiStart: 0,
      midiEnd: midiDuration ?? 0,
      youtubeStart: a ?? 0,
      youtubeEnd: (a ?? 0) + (b ?? 1) * (midiDuration ?? 0),
    },
    quality: quality ?? { anchorsCovered: 0, anchorsTotal: 0, coverage: 0, medianMs: Infinity, p95Ms: Infinity },
    reason,
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

    const alignPath = path.join(ALIGNMENT_DIR, `${song.id}.json`);
    fs.writeFileSync(alignPath, JSON.stringify(alignment, null, 2));
    console.log(`  Status: ${alignment.status}${alignment.reason ? ` (${alignment.reason})` : ''}`);

    if (alignment.status === 'aligned_ok') {
      const alignedGt = generateAlignedGroundTruth(gt, alignment);
      const alignedGtPath = path.join(ALIGNED_GT_DIR, `${song.id}.json`);
      fs.writeFileSync(alignedGtPath, JSON.stringify(alignedGt, null, 2));
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
