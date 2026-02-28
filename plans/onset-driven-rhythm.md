# Onset-Driven Rhythm Playback (Revised)

## Goal

Replace one-size-fits-all generated rhythm playback with onset-informed dynamics while preserving backward compatibility and preventing regressions in existing projects.

## Why Revision Was Needed

The prior draft had three blockers:

1. Per-bar normalization would force at least one "strong" beat in every bar, including quiet bars.
2. The proposed insertion point (`runChordPipeline`) does not currently have access to raw onset arrays.
3. Verification was subjective ("feels right") with no measurable gate criteria.

This revision fixes all three.

## Scope

In scope:

1. Add optional `strength` to `BeatEvent`.
2. Compute beat-level onset strength once for the final selected beat grid.
3. Drive generated playback from strength with meter-aware rules.
4. Add hard GO/NO-GO gates.

Out of scope:

1. Replacing onset detector with spectral-flux FFT implementation.
2. Changing beat-grid generation or time-signature arbitration logic.
3. UI polish beyond using computed strength in the existing "Hear It" flow.

## File-Level Changes

| File | Change |
|------|--------|
| `src/core/rhythmTypes.ts` | Add `strength?: number` to `BeatEvent` |
| `src/core/rhythmAnalyzeCore.ts` | Add `annotateBeatStrength()` and call it after best time-signature selection |
| `src/core/RhythmPreviewPlayer.ts` | Replace fixed beat pattern logic with strength-driven, meter-aware mapping |

## Phase 1: Beat Strength Annotation

### 1.1 Data model

Add optional field:

```ts
export interface BeatEvent {
  // existing fields...
  /** Onset-derived beat strength, normalized 0-1 for playback dynamics. */
  strength?: number;
}
```

### 1.2 Function contract

In `rhythmAnalyzeCore.ts`, add:

```ts
function annotateBeatStrength(
  beatGrid: BeatGrid,
  onsetTimes: Float32Array,
  onsetStrength: Float32Array
): void
```

Behavior:

1. For each beat, sample onset strength using the strongest onset frame within a fixed window around beat time.
2. Use absolute + relative normalization, not per-bar-max normalization.

Constants (named, top-level):

1. `BEAT_STRENGTH_WINDOW_SEC = 0.06`
2. `BEAT_STRENGTH_GLOBAL_FLOOR_PCT = 0.10` (values below p10 become 0)
3. `BEAT_STRENGTH_GLOBAL_CEIL_PCT = 0.95` (p95 maps to ~1)
4. `BEAT_STRENGTH_BAR_BLEND = 0.35` (weight of bar-local accent signal)

Strength formula:

1. `s_abs`: globally normalized sampled strength using p10/p95 clamp.
2. `s_bar`: within-bar relative strength (`sample / barMax`, with zero-safe guard).
3. `strength = clamp(0,1, (1 - BAR_BLEND)*s_abs + BAR_BLEND*s_bar )`.

Guardrails:

1. If no onset frame in window, sampled value is `0`.
2. If total onset energy is near-zero, set all `strength = 0`.
3. Do not mutate beat times here; annotation only.

### 1.3 Correct insertion point

Call `annotateBeatStrength` in `analyzeFromSamples` after time-signature selection:

1. After `const { beatGrid, chords, detectedKey } = bestResult`
2. Before vocal energy/chord metadata decoration

Rationale:

1. Raw `times/strength` exist in `analyzeFromSamples`.
2. Avoids changing `runChordPipeline` signature.
3. Computes once for the winning beat grid only (not both 3/4 and 4/4 candidates).

## Phase 2: Strength-Driven Generated Playback

### 2.1 Fallback behavior

If `beat.strength` is missing, preserve current fixed-pattern behavior exactly.

### 2.2 Reliability gate for weak analysis

If `beat.confidence < 0.45`, degrade toward legacy behavior for that beat:

1. Blend onset-driven velocity with legacy target at 50/50.
2. Do not allow beat skipping solely from low-strength when confidence is low.

### 2.3 Meter-aware trigger rules

Apply only in generated mode (`RhythmPreviewPlayer`).

For 4/4:

1. Beat 1: always bass + chord.
2. Beat 3: bass if `strength >= 0.30`; chord optional if `strength >= 0.45`.
3. Beats 2/4: chord if `strength >= 0.18`; add bass only if `strength >= 0.62`.
4. Other beats (if present): chord if `strength >= 0.22`.

For 3/4:

1. Beat 1: always bass + chord.
2. Beats 2/3: chord if `strength >= 0.16`.
3. Beats 2/3 bass only if `strength >= 0.78` (rare accent case).

Velocity mapping (shared):

1. Bass velocity: `0.30 + 0.45 * strength`, clamped `[0.25, 0.85]`
2. Chord velocity: `0.18 + 0.42 * strength`, clamped `[0.15, 0.75]`
3. Chord stab duration scales by strength: `0.45..0.85 * beatDuration`

### 2.4 Anti-noise floor

Global skip threshold:

1. If `strength < 0.08`, skip non-anchor events (except beat-1 anchor).

## Phase 3: Verification Gates

Do not proceed to next phase until gate passes.

### Gate A: Annotation integrity

Required evidence:

1. On test songs, `beat.strength` exists for > 99% of beats in newly analyzed timelines.
2. Distribution check: fewer than 25% of beats at `>= 0.95` (prevents bar-max saturation failure).
3. Quiet-intro check: intro bars show median strength at least 40% lower than first vocal-entry bars.

Decision:

1. GO if all pass.
2. NO-GO otherwise; adjust normalization constants only (no playback tuning yet).

### Gate B: Playback behavior (no legacy regression)

Required evidence:

1. Reanalyzed songs:
   1. "Mull of Kintyre": beats 2/3 bass events < 15% of non-beat1 beats.
   2. "Nineteen Hundred and Eighty Five": beats 2/4 chord events > 65%.
2. Legacy projects (no `strength` field): generated event counts and default velocities match pre-change baseline exactly.

Decision:

1. GO if all pass.
2. NO-GO if either style metric or legacy parity fails.

### Gate C: UX sanity pass

Human review checklist:

1. "Hear It" for Mull retains waltz pulse (strong 1, lighter 2-3).
2. "Hear It" for Nineteen Hundred has denser backbeat than Mull.
3. No obvious dropouts in sections with steady drums.

Decision:

1. GO if 3/3 checks pass.
2. NO-GO if any fail; retune thresholds only, keep algorithm shape fixed.

## Migration and Compatibility

1. No schema version bump required (`strength` is optional).
2. Old projects load unchanged.
3. New analyses persist `strength`; old analyses use fallback path.

## Risks and Mitigations

1. Risk: noisy onset extraction over-triggers weak beats.
   1. Mitigation: absolute floor + confidence-aware blending + skip threshold.
2. Risk: meter-specific rules still too rigid for some songs.
   1. Mitigation: thresholds are constants; tune only after Gate B metrics.
3. Risk: accidental behavior drift in legacy projects.
   1. Mitigation: hard parity requirement in Gate B.

## Definition of Done

Done when:

1. `BeatEvent.strength` is computed and persisted on new analyses.
2. Generated playback uses strength + meter-aware logic.
3. Legacy timelines remain behavior-identical.
4. Gates A, B, and C all pass with recorded evidence in commit notes or a short run log.
