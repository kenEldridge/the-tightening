/**
 * Drum patterns — three intensity tiers of 16-step (16th-note, 4/4) grids.
 * Pure data + a selector, kept separate from synthesis and the state machine
 * so a future mode 2 ("drummer leads") can reuse them unchanged.
 *
 * Step velocities are 0–1 pattern accents; the engine scales them by the
 * live intensity before they reach the voices.
 */

export const STEPS_PER_BAR = 16;
export const STEPS_PER_BEAT = 4;

export interface DrumStep {
  kick?: number;
  snare?: number;
  hat?: number;     // closed hihat
  openHat?: number; // open hihat (replaces closed on that step)
}

function bar(hits: Record<number, DrumStep>): DrumStep[] {
  const steps: DrumStep[] = [];
  for (let i = 0; i < STEPS_PER_BAR; i++) steps.push(hits[i] ?? {});
  return steps;
}

// Tier 0 — sparse: kick 1 & 3, snare 2 & 4, hats on quarters.
const TIER_SPARSE = bar({
  0:  { kick: 1.0, hat: 0.5 },
  4:  { snare: 0.9, hat: 0.5 },
  8:  { kick: 0.9, hat: 0.5 },
  12: { snare: 0.9, hat: 0.5 },
});

// Tier 1 — groove: 8th-note hats with beat accents, extra kick push into beat 3.
const TIER_GROOVE = bar({
  0:  { kick: 1.0, hat: 0.6 },
  2:  { hat: 0.4 },
  4:  { snare: 0.9, hat: 0.6 },
  6:  { hat: 0.4 },
  8:  { kick: 0.9, hat: 0.6 },
  10: { kick: 0.7, hat: 0.4 },
  12: { snare: 0.9, hat: 0.6 },
  14: { hat: 0.4 },
});

// Tier 2 — busy: 16th hats, syncopated kick, ghost snares, open hat at the turn.
const TIER_BUSY = bar({
  0:  { kick: 1.0, hat: 0.6 },
  1:  { hat: 0.35 },
  2:  { hat: 0.35 },
  3:  { kick: 0.6, hat: 0.35 },
  4:  { snare: 0.9, hat: 0.6 },
  5:  { hat: 0.35 },
  6:  { hat: 0.35 },
  7:  { snare: 0.3, hat: 0.35 },
  8:  { kick: 0.9, hat: 0.6 },
  9:  { hat: 0.35 },
  10: { kick: 0.7, hat: 0.35 },
  11: { hat: 0.35 },
  12: { snare: 0.9, hat: 0.6 },
  13: { hat: 0.35 },
  14: { openHat: 0.6 },
  15: { snare: 0.3, hat: 0.35 },
});

export const PATTERN_TIERS: DrumStep[][] = [TIER_SPARSE, TIER_GROOVE, TIER_BUSY];

// Thresholds are deliberately high: normal comping should live in the sparse
// and groove tiers — the busy tier is reserved for really digging in.
export function patternForIntensity(intensity: number): DrumStep[] {
  if (intensity < 0.5) return PATTERN_TIERS[0];
  if (intensity < 0.85) return PATTERN_TIERS[1];
  return PATTERN_TIERS[2];
}
