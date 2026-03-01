/**
 * Evaluation Harness Types
 *
 * Types for the rhythm detection evaluation pipeline.
 * Used by the offline harness — no DOM or Electron deps.
 */

// ============================================
// Ground Truth
// ============================================

export interface BarAnchor {
  /** Bar number (1-indexed) */
  bar: number;
  /** Time in seconds of bar start */
  timeSec: number;
  /** Source of this anchor: 'computed' from tempo, 'ear' from manual annotation */
  source: 'computed' | 'ear';
}

export interface BeatAnchor {
  /** Bar number (1-indexed) */
  bar: number;
  /** Beat within bar (1-indexed) */
  beatInBar: number;
  /** Time in seconds */
  timeSec: number;
  /** Primary anchor source */
  source: 'midi_beat' | 'derived_from_bar';
  /** True when beat anchors were approximated from bars */
  approximate: boolean;
}

export interface ChordLabel {
  /** Bar number (1-indexed) */
  bar: number;
  /** Chord symbol (e.g. 'F', 'C7', 'Bm') */
  symbol: string;
  /** Source of this label */
  source: 'midi' | 'manual' | 'computed';
}

// ============================================
// Metric Results
// ============================================

export interface BeatMetrics {
  precision: number;
  recall: number;
  f1: number;
  matched: number;
  predicted: number;
  groundTruth: number;
}

export interface DownbeatMetrics extends BeatMetrics {}

export interface BarDriftResult {
  medianMs: number;
  p95Ms: number;
  perBar: Array<{ bar: number; driftMs: number }>;
}

export interface ChordAccuracyResult {
  rootAccuracy: number;
  fullAccuracy: number;
  perBar: Array<{ bar: number; predicted: string; expected: string; rootMatch: boolean; fullMatch: boolean }>;
}

export interface FalseChordChangeResult {
  /** False chord changes per 32 bars */
  per32Bars: number;
  /** Total false chord changes */
  total: number;
  /** Total bars evaluated */
  totalBars: number;
}

export interface DeterminismResult {
  /** Variance of beat times across runs (ms²) */
  beatVariance: number;
  /** Fraction of bars where all runs agree on chord (0-1) */
  chordAgreement: number;
  /** Variance of detected tempo across runs (BPM²) */
  tempoVariance: number;
}

// ============================================
// Song & Report
// ============================================

export interface SongEvalResult {
  songId: string;
  songName: string;
  /** Legacy slot used by existing reports; training eval may set this to all-beat F1. */
  beat: BeatMetrics;
  /** Explicit all-beat metric path (optional for legacy callers). */
  allBeat?: BeatMetrics;
  /** True when all-beat anchors were derived from bars instead of MIDI beats. */
  allBeatApproximate?: boolean;
  downbeat: DownbeatMetrics;
  drift: BarDriftResult;
  chordAccuracy: ChordAccuracyResult;
  falseChordChange: FalseChordChangeResult;
  determinism: DeterminismResult | null;
}

export interface EvalReport {
  generatedAt: string;
  songs: SongEvalResult[];
  aggregate: {
    meanBeatF1: number;
    meanAllBeatF1?: number;
    meanDownbeatF1: number;
    meanRootAccuracy: number;
    meanFullAccuracy: number;
    meanDriftMedianMs: number;
    meanFalseChangePer32: number;
  };
}
