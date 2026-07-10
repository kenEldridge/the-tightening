/**
 * Pulse detection from MIDI note-on onsets — pure and timer-free.
 *
 * All timestamps are seconds in ONE clock domain. The drummer engine converts
 * performance.now()-based MIDI timestamps into AudioContext time before they
 * reach this module (see drummerEngine's clockOffset); nothing here may assume
 * a particular epoch, only that every input shares the same one.
 */

export interface Onset {
  t: number;         // seconds
  velocity: number;  // 0–127, max across merged chord notes
  chordSize: number; // how many note-ons merged into this onset
}

export interface PulseEstimate {
  bpm: number;
  periodSec: number;       // 60 / bpm
  phaseSec: number;        // beat grid points lie at t ≡ phaseSec (mod periodSec)
  confidence: number;      // circular-mean R of onset residuals, 0–1
  tempoConfidence: number; // winning histogram bin share, 0–1
  intensity: number;       // 0–1 blend of velocity + density
  onsetCount: number;
}

// Tunable constants
export const COLLAPSE_WINDOW_SEC = 0.04; // note-ons within 40ms of a chord's first note merge
export const HISTORY_SEC = 16;           // rolling onset history
export const MAX_IOI_SEC = 2.0;          // gaps longer than this carry no tempo vote
export const MIN_ONSETS = 8;             // estimates need at least this many onsets…
export const MIN_SPAN_SEC = 2.0;         // …spanning at least this much time
export const BPM_MIN = 70;               // fold window for tempo candidates
export const BPM_MAX = 180;
export const HIST_BIN_BPM = 2;
export const RECENCY_TAU_SEC = 8;        // exponential decay constant for onset weight
export const INTENSITY_WINDOW_SEC = 4;
export const DENSITY_NORM = 12;          // onset-rate × chord-size that saturates density
                                         // (3-note chords at 2/s ≈ 0.5, so normal comping reads mid)

export function recencyWeight(ageSec: number): number {
  return Math.exp(-ageSec / RECENCY_TAU_SEC);
}

/**
 * Record a note-on into the onset list, merging chord notes: a note-on within
 * COLLAPSE_WINDOW_SEC of the current chord's FIRST note joins that onset
 * (anchoring to the chord start keeps a slow strum from merging forever).
 */
export function addOnset(onsets: Onset[], velocity: number, tSec: number): void {
  const last = onsets[onsets.length - 1];
  if (last && tSec >= last.t && tSec - last.t <= COLLAPSE_WINDOW_SEC) {
    last.chordSize += 1;
    last.velocity = Math.max(last.velocity, velocity);
    return;
  }
  onsets.push({ t: tSec, velocity, chordSize: 1 });
}

export function pruneOnsets(onsets: Onset[], nowSec: number): void {
  while (onsets.length > 0 && nowSec - onsets[0].t > HISTORY_SEC) {
    onsets.shift();
  }
}

/**
 * Recency-weighted, folded BPM histogram over inter-onset intervals.
 * Each IOI votes for 60/ioi and its ×2/÷2, ×3/÷3, ×4/÷4 relatives (at 1/k
 * weight) that land inside [BPM_MIN, BPM_MAX), which resolves the period
 * ambiguity syncopation and sparse comping create.
 */
export function estimateTempo(
  onsets: Onset[],
  nowSec: number,
): { bpm: number; tempoConfidence: number } | null {
  const bins = new Map<number, { w: number; bpmW: number }>();
  let totalW = 0;

  for (let i = 1; i < onsets.length; i++) {
    const ioi = onsets[i].t - onsets[i - 1].t;
    if (ioi <= 0.001 || ioi > MAX_IOI_SEC) continue;
    const w0 = recencyWeight(nowSec - onsets[i].t);
    const base = 60 / ioi;
    for (let k = 1; k <= 4; k++) {
      const cands = k === 1 ? [base] : [base * k, base / k];
      for (const cand of cands) {
        if (cand < BPM_MIN || cand >= BPM_MAX) continue;
        const w = w0 / k;
        const bin = Math.round(cand / HIST_BIN_BPM);
        const entry = bins.get(bin) ?? { w: 0, bpmW: 0 };
        entry.w += w;
        entry.bpmW += cand * w;
        bins.set(bin, entry);
        totalW += w;
      }
    }
  }
  if (totalW <= 0) return null;

  // Best bin scored with its immediate neighbors so near-boundary votes count.
  let bestBin = 0;
  let bestScore = -1;
  for (const bin of bins.keys()) {
    let score = 0;
    for (let b = bin - 1; b <= bin + 1; b++) score += bins.get(b)?.w ?? 0;
    if (score > bestScore) {
      bestScore = score;
      bestBin = bin;
    }
  }
  let w = 0;
  let bpmW = 0;
  for (let b = bestBin - 1; b <= bestBin + 1; b++) {
    const entry = bins.get(b);
    if (entry) {
      w += entry.w;
      bpmW += entry.bpmW;
    }
  }
  if (w <= 0) return null;
  return { bpm: bpmW / w, tempoConfidence: bestScore / totalW };
}

/**
 * Circular mean of onset times mod the beat period. R (0–1) measures how
 * tightly onsets cluster on one grid phase — this is the stability signal
 * that gates both learning→following and following→leading.
 */
export function estimatePhase(
  onsets: Onset[],
  periodSec: number,
  nowSec: number,
): { phaseSec: number; R: number } {
  let sx = 0;
  let sy = 0;
  let sw = 0;
  for (const o of onsets) {
    const theta = 2 * Math.PI * (((o.t % periodSec) + periodSec) % periodSec) / periodSec;
    const w = recencyWeight(nowSec - o.t);
    sx += w * Math.cos(theta);
    sy += w * Math.sin(theta);
    sw += w;
  }
  if (sw <= 0) return { phaseSec: 0, R: 0 };
  const R = Math.sqrt(sx * sx + sy * sy) / sw;
  let ang = Math.atan2(sy, sx);
  if (ang < 0) ang += 2 * Math.PI;
  return { phaseSec: (ang / (2 * Math.PI)) * periodSec, R };
}

/**
 * Intensity 0–1: 60% average velocity, 40% density (onset rate × chord size,
 * saturating at DENSITY_NORM), over the last INTENSITY_WINDOW_SEC.
 */
export function computeIntensity(onsets: Onset[], nowSec: number): number {
  const recent = onsets.filter(o => nowSec - o.t <= INTENSITY_WINDOW_SEC);
  if (recent.length === 0) return 0;
  let velSum = 0;
  let chordSum = 0;
  for (const o of recent) {
    velSum += o.velocity;
    chordSum += o.chordSize;
  }
  const avgVel = velSum / recent.length / 127;
  const rate = recent.length / INTENSITY_WINDOW_SEC;
  const avgChord = chordSum / recent.length;
  const density = Math.min(1, (rate * avgChord) / DENSITY_NORM);
  return 0.6 * avgVel + 0.4 * density;
}

/** Convert a performance.now()-clock timestamp (ms) into AudioContext seconds. */
export function perfMsToAudioTime(perfMs: number, clockOffset: number): number {
  return perfMs / 1000 + clockOffset;
}

/** First beat-grid time strictly after `nowSec` for a grid at phaseSec (mod periodSec). */
export function nextBeatTime(nowSec: number, phaseSec: number, periodSec: number): number {
  const n = Math.ceil((nowSec - phaseSec) / periodSec);
  let t = phaseSec + n * periodSec;
  if (t <= nowSec + 1e-9) t += periodSec;
  return t;
}

/**
 * Signed distance (seconds) from time `t` to the NEAREST grid point, in
 * (-periodSec/2, periodSec/2]. Positive means `t` is late (after the grid).
 */
export function phaseErrorSec(t: number, phaseSec: number, periodSec: number): number {
  let r = (t - phaseSec) % periodSec;
  if (r < 0) r += periodSec;
  if (r > periodSec / 2) r -= periodSec;
  return r;
}

export interface PulseDetector {
  recordNoteOn(velocity: number, tSec: number): void;
  estimate(nowSec: number): PulseEstimate | null;
  getIntensity(nowSec: number): number;
  onsetCount(): number;
  reset(): void;
}

export function createPulseDetector(): PulseDetector {
  let onsets: Onset[] = [];

  return {
    recordNoteOn(velocity, tSec) {
      addOnset(onsets, velocity, tSec);
      pruneOnsets(onsets, tSec);
    },
    estimate(nowSec) {
      pruneOnsets(onsets, nowSec);
      if (onsets.length < MIN_ONSETS) return null;
      const span = onsets[onsets.length - 1].t - onsets[0].t;
      if (span < MIN_SPAN_SEC) return null;
      const tempo = estimateTempo(onsets, nowSec);
      if (!tempo) return null;
      const periodSec = 60 / tempo.bpm;
      const ph = estimatePhase(onsets, periodSec, nowSec);
      return {
        bpm: tempo.bpm,
        periodSec,
        phaseSec: ph.phaseSec,
        confidence: ph.R,
        tempoConfidence: tempo.tempoConfidence,
        intensity: computeIntensity(onsets, nowSec),
        onsetCount: onsets.length,
      };
    },
    getIntensity(nowSec) {
      return computeIntensity(onsets, nowSec);
    },
    onsetCount() {
      return onsets.length;
    },
    reset() {
      onsets = [];
    },
  };
}
