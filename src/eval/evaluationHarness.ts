/**
 * Evaluation Harness
 *
 * Pure metric functions for measuring rhythm detection quality.
 * No DOM, Electron, or browser deps — runs in Node via vitest or CLI.
 *
 * Imports only types from rhythmTypes.ts.
 */

import type { BeatEvent, ChordEvent, ChordTimelineArtifact } from '../core/rhythmTypes';
import type {
  BarAnchor,
  BeatAnchor,
  ChordLabel,
  BeatMetrics,
  DownbeatMetrics,
  BarDriftResult,
  ChordAccuracyResult,
  FalseChordChangeResult,
  DeterminismResult,
  SongEvalResult,
  EvalReport,
} from './evaluationTypes';

// ============================================
// Chord Root Extraction
// ============================================

/**
 * Extract root note from chord symbol. E.g. 'C7' → 'C', 'F#m' → 'F#', 'Bb' → 'Bb'
 */
export function extractChordRoot(symbol: string): string {
  const match = symbol.match(/^([A-Ga-g][#b]?)/);
  return match ? match[1].charAt(0).toUpperCase() + match[1].slice(1) : symbol;
}

// ============================================
// Beat F-Measure (mir_eval greedy matching)
// ============================================

/**
 * Compute beat-level precision, recall, F1.
 * Uses greedy 1:1 matching (mir_eval convention):
 * Sort both arrays by time. For each ground truth time, find closest
 * unmatched predicted time within tolerance.
 */
export function computeBeatFMeasure(
  beats: BeatEvent[],
  anchors: BarAnchor[],
  toleranceMs: number = 70
): BeatMetrics {
  const toleranceSec = toleranceMs / 1000;
  const predicted = beats.map(b => b.time).sort((a, b) => a - b);
  const groundTruth = anchorsToDownbeatTimes(anchors);

  // For beat-level: we compare all predicted beats against bar-start anchors
  // expanded to all beats. But anchors are bar starts only.
  // Use anchors as-is (they represent bar start times = downbeats).
  // To evaluate ALL beats, we'd need beat-level ground truth.
  // For now, compare predicted downbeats vs anchor times.
  const matched = greedyMatch(predicted, groundTruth, toleranceSec);

  return {
    precision: predicted.length > 0 ? matched / predicted.length : 0,
    recall: groundTruth.length > 0 ? matched / groundTruth.length : 0,
    f1: fScore(matched, predicted.length, groundTruth.length),
    matched,
    predicted: predicted.length,
    groundTruth: groundTruth.length,
  };
}

/**
 * Compute downbeat-level F1 (only beats with beatInBar=1).
 */
export function computeDownbeatFMeasure(
  beats: BeatEvent[],
  anchors: BarAnchor[],
  toleranceMs: number = 70
): DownbeatMetrics {
  const toleranceSec = toleranceMs / 1000;
  const downbeats = beats.filter(b => b.beatInBar === 1).map(b => b.time).sort((a, b) => a - b);
  const groundTruth = anchorsToDownbeatTimes(anchors);

  const matched = greedyMatch(downbeats, groundTruth, toleranceSec);

  return {
    precision: downbeats.length > 0 ? matched / downbeats.length : 0,
    recall: groundTruth.length > 0 ? matched / groundTruth.length : 0,
    f1: fScore(matched, downbeats.length, groundTruth.length),
    matched,
    predicted: downbeats.length,
    groundTruth: groundTruth.length,
  };
}

/**
 * Compute true all-beat F1 against beat-level anchors.
 */
export function computeAllBeatFMeasure(
  beats: BeatEvent[],
  beatAnchors: BeatAnchor[],
  toleranceMs: number = 70
): BeatMetrics {
  const toleranceSec = toleranceMs / 1000;
  const predicted = beats.map(b => b.time).sort((a, b) => a - b);
  const groundTruth = beatAnchorsToTimes(beatAnchors);
  const matched = greedyMatch(predicted, groundTruth, toleranceSec);

  return {
    precision: predicted.length > 0 ? matched / predicted.length : 0,
    recall: groundTruth.length > 0 ? matched / groundTruth.length : 0,
    f1: fScore(matched, predicted.length, groundTruth.length),
    matched,
    predicted: predicted.length,
    groundTruth: groundTruth.length,
  };
}

// ============================================
// Bar Drift
// ============================================

/**
 * Compute bar-level timing drift between predicted downbeats and ground truth anchors.
 * For each anchor bar, find the closest predicted downbeat for that bar number
 * and compute the signed drift.
 */
export function computeBarDrift(
  beats: BeatEvent[],
  anchors: BarAnchor[]
): BarDriftResult {
  const downbeatsByBar = new Map<number, number>();
  for (const b of beats) {
    if (b.beatInBar === 1) {
      downbeatsByBar.set(b.bar, b.time);
    }
  }

  const perBar: Array<{ bar: number; driftMs: number }> = [];

  for (const anchor of anchors) {
    const predictedTime = downbeatsByBar.get(anchor.bar);
    if (predictedTime !== undefined) {
      const driftMs = (predictedTime - anchor.timeSec) * 1000;
      perBar.push({ bar: anchor.bar, driftMs });
    }
  }

  if (perBar.length === 0) {
    return { medianMs: 0, p95Ms: 0, perBar: [] };
  }

  const absDrifts = perBar.map(p => Math.abs(p.driftMs)).sort((a, b) => a - b);
  const medianMs = percentile(absDrifts, 0.5);
  const p95Ms = percentile(absDrifts, 0.95);

  return { medianMs, p95Ms, perBar };
}

// ============================================
// Chord Accuracy
// ============================================

/**
 * Compute chord accuracy: root-only and full symbol match per bar.
 */
export function computeChordAccuracy(
  chords: ChordEvent[],
  labels: ChordLabel[]
): ChordAccuracyResult {
  const perBar: ChordAccuracyResult['perBar'] = [];
  let rootMatches = 0;
  let fullMatches = 0;

  for (const label of labels) {
    const predicted = findChordAtBar(chords, label.bar);
    if (!predicted) continue;

    const predRoot = extractChordRoot(predicted).toLowerCase();
    const labelRoot = extractChordRoot(label.symbol).toLowerCase();
    const rootMatch = predRoot === labelRoot;
    const fullMatch = normalizeChord(predicted) === normalizeChord(label.symbol);

    if (rootMatch) rootMatches++;
    if (fullMatch) fullMatches++;

    perBar.push({
      bar: label.bar,
      predicted,
      expected: label.symbol,
      rootMatch,
      fullMatch,
    });
  }

  const total = perBar.length;
  return {
    rootAccuracy: total > 0 ? rootMatches / total : 0,
    fullAccuracy: total > 0 ? fullMatches / total : 0,
    perBar,
  };
}

// ============================================
// False Chord Change Rate
// ============================================

/**
 * Count bars where the predicted chord changes but ground truth doesn't.
 * Rate normalized to per-32-bars.
 */
export function computeFalseChordChangeRate(
  chords: ChordEvent[],
  labels: ChordLabel[]
): FalseChordChangeResult {
  if (labels.length < 2) {
    return { per32Bars: 0, total: 0, totalBars: labels.length };
  }

  let falseChanges = 0;
  const totalBars = labels.length - 1; // transitions between consecutive bars

  for (let i = 1; i < labels.length; i++) {
    const prevLabel = labels[i - 1];
    const currLabel = labels[i];
    const gtChanged = normalizeChord(prevLabel.symbol) !== normalizeChord(currLabel.symbol);

    const prevPred = findChordAtBar(chords, prevLabel.bar);
    const currPred = findChordAtBar(chords, currLabel.bar);

    if (prevPred && currPred) {
      const predChanged = normalizeChord(prevPred) !== normalizeChord(currPred);
      if (predChanged && !gtChanged) {
        falseChanges++;
      }
    }
  }

  const per32Bars = totalBars > 0 ? (falseChanges / totalBars) * 32 : 0;

  return { per32Bars, total: falseChanges, totalBars };
}

// ============================================
// Determinism
// ============================================

/**
 * Compare multiple analysis runs for the same song.
 * Returns null if fewer than 2 runs provided.
 */
export function computeDeterminism(
  runs: ChordTimelineArtifact[]
): DeterminismResult | null {
  if (runs.length < 2) return null;

  // Tempo variance
  const tempos = runs.map(r => r.beatGrid.tempo);
  const tempoVariance = variance(tempos);

  // Beat time variance: for each beat index, compute variance across runs
  const maxBeats = Math.min(...runs.map(r => r.beatGrid.beats.length));
  const beatVariances: number[] = [];
  for (let i = 0; i < maxBeats; i++) {
    const times = runs.map(r => r.beatGrid.beats[i].time * 1000); // convert to ms
    beatVariances.push(variance(times));
  }
  const beatVariance = beatVariances.length > 0
    ? beatVariances.reduce((a, b) => a + b, 0) / beatVariances.length
    : 0;

  // Chord agreement: for each bar, check if all runs agree
  const maxBars = Math.min(...runs.map(r => r.beatGrid.barCount));
  let agreeCount = 0;
  for (let bar = 1; bar <= maxBars; bar++) {
    const symbols = runs.map(r => {
      const chord = r.chords.find(c => c.barStart <= bar && c.barEnd >= bar);
      return chord ? normalizeChord(chord.symbol) : '';
    });
    if (symbols.every(s => s === symbols[0])) agreeCount++;
  }
  const chordAgreement = maxBars > 0 ? agreeCount / maxBars : 0;

  return { beatVariance, chordAgreement, tempoVariance };
}

// ============================================
// High-level evaluators
// ============================================

export function evaluateSong(
  songId: string,
  songName: string,
  beats: BeatEvent[],
  chords: ChordEvent[],
  anchors: BarAnchor[],
  labels: ChordLabel[],
  runs: ChordTimelineArtifact[] | null,
  options?: { beatAnchors?: BeatAnchor[]; allBeatApproximate?: boolean }
): SongEvalResult {
  const downbeat = computeDownbeatFMeasure(beats, anchors);
  const allBeat = options?.beatAnchors
    ? computeAllBeatFMeasure(beats, options.beatAnchors)
    : undefined;

  return {
    songId,
    songName,
    beat: allBeat ?? computeBeatFMeasure(beats, anchors),
    allBeat,
    allBeatApproximate: options?.allBeatApproximate,
    downbeat,
    drift: computeBarDrift(beats, anchors),
    chordAccuracy: computeChordAccuracy(chords, labels),
    falseChordChange: computeFalseChordChangeRate(chords, labels),
    determinism: runs ? computeDeterminism(runs) : null,
  };
}

export function runFullEvaluation(songs: SongEvalResult[]): EvalReport {
  const n = songs.length || 1;
  const withAllBeat = songs.filter(s => s.allBeat !== undefined);
  const nAllBeat = withAllBeat.length || 1;
  return {
    generatedAt: new Date().toISOString(),
    songs,
    aggregate: {
      meanBeatF1: songs.reduce((s, r) => s + r.beat.f1, 0) / n,
      meanAllBeatF1: withAllBeat.length > 0
        ? withAllBeat.reduce((s, r) => s + (r.allBeat?.f1 ?? 0), 0) / nAllBeat
        : undefined,
      meanDownbeatF1: songs.reduce((s, r) => s + r.downbeat.f1, 0) / n,
      meanRootAccuracy: songs.reduce((s, r) => s + r.chordAccuracy.rootAccuracy, 0) / n,
      meanFullAccuracy: songs.reduce((s, r) => s + r.chordAccuracy.fullAccuracy, 0) / n,
      meanDriftMedianMs: songs.reduce((s, r) => s + r.drift.medianMs, 0) / n,
      meanFalseChangePer32: songs.reduce((s, r) => s + r.falseChordChange.per32Bars, 0) / n,
    },
  };
}

// ============================================
// Internal helpers
// ============================================

function anchorsToDownbeatTimes(anchors: BarAnchor[]): number[] {
  return anchors.map(a => a.timeSec).sort((a, b) => a - b);
}

function beatAnchorsToTimes(anchors: BeatAnchor[]): number[] {
  return anchors.map(a => a.timeSec).sort((a, b) => a - b);
}

/**
 * Greedy 1:1 matching (mir_eval convention).
 * For each ground truth time, find closest unmatched predicted time within tolerance.
 */
function greedyMatch(predicted: number[], groundTruth: number[], toleranceSec: number): number {
  const used = new Set<number>();
  let matched = 0;

  for (const gt of groundTruth) {
    let bestIdx = -1;
    let bestDist = Infinity;

    for (let i = 0; i < predicted.length; i++) {
      if (used.has(i)) continue;
      const dist = Math.abs(predicted[i] - gt);
      if (dist <= toleranceSec && dist < bestDist) {
        bestDist = dist;
        bestIdx = i;
      }
    }

    if (bestIdx >= 0) {
      used.add(bestIdx);
      matched++;
    }
  }

  return matched;
}

function fScore(matched: number, predicted: number, groundTruth: number): number {
  const p = predicted > 0 ? matched / predicted : 0;
  const r = groundTruth > 0 ? matched / groundTruth : 0;
  return p + r > 0 ? (2 * p * r) / (p + r) : 0;
}

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  const idx = Math.ceil(p * sorted.length) - 1;
  return sorted[Math.max(0, Math.min(idx, sorted.length - 1))];
}

function findChordAtBar(chords: ChordEvent[], bar: number): string | null {
  const chord = chords.find(c => c.barStart <= bar && c.barEnd >= bar);
  return chord ? chord.symbol : null;
}

function normalizeChord(symbol: string): string {
  return symbol.trim().toLowerCase();
}

function variance(values: number[]): number {
  if (values.length < 2) return 0;
  const mean = values.reduce((a, b) => a + b, 0) / values.length;
  return values.reduce((s, v) => s + (v - mean) ** 2, 0) / values.length;
}
