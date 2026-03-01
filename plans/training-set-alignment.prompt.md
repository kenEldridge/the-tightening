# Prompt for ChatGPT: Training Set Alignment Plan (Code-Grounded Revision)

Write the plan to: `C:\Users\eldri\projects\the-tightening\plans\training-set-alignment.md`

## Task

Produce an executable implementation plan for aligning MIDI ground truth to YouTube audio for evaluation of a deterministic rhythm/chord analyzer.

The plan must be practical, script-first, and gated. If alignment quality is weak, skip the song.

## Mandatory Reality Check (Do Not Ignore)

You must base the plan on the current code behavior, not assumptions:

1. `scripts/build-training-set.ts` writes training assets under `training-data/ground-truth/`.
2. `scripts/run-eval.ts` currently reads from root `ground-truth/` and evaluates a different hardcoded 3-song set.
3. `src/eval/evaluationHarness.ts` currently uses bar anchors as downbeat ground truth and `computeBeatFMeasure` behavior is not true all-beat reference matching.
4. `training-data/manifest.json` is the new 8-song dataset and includes `youtubeUrl` and `meta.youtubeTime`.

Your plan must explicitly reconcile these mismatches.

## Core Objective

Build an alignment pipeline that maps MIDI time to YouTube time so existing metrics (or corrected metrics) can be computed meaningfully for the 8-song training set.

## Constraints

1. No ML training. Deterministic DSP + deterministic alignment only.
2. Script-only (`npx tsx scripts/...`), no Electron/browser dependency.
3. Must handle:
   1. small global tempo drift
   2. intro/outro offsets
   3. partial MIDI vs full recording
   4. repeated/extra sections
4. Keep complexity bounded. Prefer skip over forced bad alignment.
5. Must define hard GO/NO-GO gates with numeric thresholds.

## Alignment Strategy Requirements

The plan must define a 2-tier strategy:

1. Tier 1 (simple, default): global affine alignment (`t_youtube = a + b * t_midi`) for close-duration songs.
2. Tier 2 (partial/mismatch): pattern-based subsequence localization using melody interval/duration signatures, then local affine fit (or piecewise affine if needed).

Do not jump to full DTW as default. Use DTW only as explicit fallback with cost cap.

## Required Phases and Gates

Design the plan in these sessions with strict order:

### Session 1: Foundation + Close-Duration Alignment

Must include:

1. Source suitability pass (URL sanity, duration sanity, likely official/Topic source classification).
2. Data model for alignment artifacts (per-song JSON schema).
3. Global affine fit for close-duration songs.
4. Automatic reject criteria.

Gate 1 (required):

1. For close-duration songs, accept only if:
   1. anchor coverage >= 90%
   2. median anchor error <= 120 ms
   3. p95 anchor error <= 300 ms
2. If a song fails, mark `unaligned` with reason code; do not force fit.

### Session 2: Partial/Mismatched Song Alignment

Must include:

1. MIDI melody signature construction:
   1. pitch interval sequence (semitone deltas)
   2. duration ratio sequence
2. Audio-side candidate extraction strategy (explicitly define what signal is used and why it is script-feasible).
3. Subsequence match scoring and window selection.
4. Local affine fit inside matched window.

Gate 2 (required):

1. For partial songs, accept only if:
   1. matched segment coverage >= 70% of MIDI segment
   2. median anchor error <= 150 ms
   3. p95 anchor error <= 400 ms
   4. fit slope `b` within sane range (for example 0.85 to 1.20 unless flagged as special case)
2. Otherwise mark `unaligned_partial` with reason.

### Session 3: Eval Integration + Reporting

Must include:

1. Integration choice:
   1. either extend `run-eval.ts` with training-set mode
   2. or create dedicated `scripts/run-training-eval.ts`
2. Ground-truth export path/schema reconciliation:
   1. clear single source of truth path
   2. converters if needed
3. Explicit handling of metric semantics:
   1. either preserve current harness behavior and document it
   2. or add corrected beat-level metric path and report both
4. End-to-end report with aligned/skipped counts and per-song reason codes.

Gate 3 (required):

1. At least 5 songs `aligned_ok`.
2. No failed script crashes on skipped songs.
3. Eval report generated with explicit per-song alignment quality fields.

## Required Outputs

Your plan must specify exact file changes (create/modify), with function signatures and output schemas.

At minimum include proposed changes for:

1. `training-data/manifest.json` (status fields, optional alignment metadata)
2. `scripts/build-training-set.ts` (or successor script)
3. `scripts/run-eval.ts` or `scripts/run-training-eval.ts`
4. `src/eval/evaluationHarness.ts` (if metric semantics updated)
5. Any new files under `training-data/alignment/` and `training-data/aligned-ground-truth/`

Define an explicit per-song alignment artifact schema, e.g.:

```json
{
  "songId": "string",
  "status": "aligned_ok|unaligned|unaligned_partial",
  "model": "affine|piecewise_affine",
  "params": { "a": 0.0, "b": 1.0 },
  "segment": { "midiStart": 0.0, "midiEnd": 0.0, "youtubeStart": 0.0, "youtubeEnd": 0.0 },
  "quality": { "coverage": 0.0, "medianMs": 0.0, "p95Ms": 0.0 },
  "reason": "optional_reason_code"
}
```

## Plan Format Requirements

Output markdown must include:

1. Phase-by-phase table (`Phase`, `Goal`, `Files`, `Gate`, `GO/NO-GO criteria`).
2. Concrete command list to run for each phase.
3. Verification checklist per phase.
4. Risk register with mitigation.
5. Clear "Stop conditions" (when to skip a song).

## Non-Negotiables

1. No vague language like "improve alignment quality" without numeric targets.
2. No hidden dependencies on GUI/manual click workflows.
3. If a song is ambiguous, the plan must skip it and continue.
4. Prioritize robust evaluation set quality over maximizing song count.
