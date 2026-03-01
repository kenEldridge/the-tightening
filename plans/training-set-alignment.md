# Training Set Alignment Plan v3 (Code-Grounded, Gated, Executable)

## Goal

Align MIDI ground truth to YouTube audio time for the 8-song training set with deterministic scripts, explicit skip behavior, and unambiguous evaluation metrics.

Success criteria:

1. At least 5 songs finish as `aligned_ok`.
2. Alignment artifacts are deterministic across reruns.
3. Eval output clearly separates downbeat vs all-beat semantics.

## Code Reality (Current Baseline)

Current code that already exists and must be preserved:

1. `scripts/align-training-set.ts` with Tier 1 (`affine`), Tier 1 piecewise (`piecewise_affine`), and Tier 2 energy search.
2. `scripts/run-training-eval.ts` that reads `training-data/alignment/*.json` and `training-data/aligned-ground-truth/*.json`.
3. `src/eval/evaluationHarness.ts` where `computeBeatFMeasure` currently uses bar anchors (downbeat ground truth), not true beat-level references.

This plan upgrades the current pipeline; it does not replace it.

## Dev-Mode Policy

This plan assumes rapid iteration in development:

1. No backward-compatibility requirement for old alignment artifact schema.
2. Existing `training-data/alignment/*.json` and `training-data/aligned-ground-truth/*.json` may be regenerated and overwritten.
3. Schema migration logic is out of scope unless this moves to release mode.

## Phase Table

| Phase | Goal | Files | Gate | GO / NO-GO |
|---|---|---|---|---|
| 1 | Stabilize artifact schema and reason handling | `scripts/align-training-set.ts`, `scripts/run-training-eval.ts`, `training-data/alignment/*.json` | Gate 1 | GO if schema validation passes for all songs, artifacts are byte-identical on rerun, and reason codes are canonical only |
| 2 | Add log-interval subsequence alignment for Tier 2 with fallback to current energy path | `scripts/alignment/logTokens.ts` (new), `scripts/alignment/seedIndex.ts` (new), `scripts/alignment/localAlign.ts` (new), `scripts/align-training-set.ts` | Gate 2 | GO if Tier 2 improves relative to baseline (with regression guard), or fallback is better than baseline; otherwise skip with canonical reason |
| 3 | Fix eval semantics and report both downbeat + all-beat metrics | `src/eval/evaluationHarness.ts`, `src/eval/evaluationTypes.ts`, `scripts/run-training-eval.ts` | Gate 3 | GO if reports include both metric families, skipped songs do not crash run, and at least 5 songs remain aligned |

## Non-Negotiable Contracts

### 1) Naming and schema stability

Do not change existing literals:

1. `status`: `aligned_ok | unaligned | unaligned_partial`
2. `model`: `affine | piecewise_affine`
3. `tier`: `1 | 2`

### 2) Canonical reason codes

Use `reason` as enum-like code and `reasonDetail` for human-readable context.

Canonical `reason` values:

1. `audio_not_found`
2. `audio_too_short`
3. `analysis_too_few_beats`
4. `duration_ratio_too_high`
5. `insufficient_seeds`
6. `coverage_too_low`
7. `median_error_too_high`
8. `p95_error_too_high`
9. `slope_out_of_range`
10. `no_valid_tempo_segments`
11. `no_segments_aligned`
12. `error_runtime`
13. `multi_match_ambiguous`
14. `extraction_quality_low`

### 3) Quality semantics

Quality fields are defined exactly once:

1. `coverage`: matched anchors / evaluated anchors.
2. `medianMs`: median absolute anchor error in milliseconds.
3. `p95Ms`: 95th percentile absolute anchor error in milliseconds.

Required metadata:

1. `qualityMode`: `analysis_downbeat | energy_peak | piecewise_energy_peak | token_local_align`
2. `matchToleranceSec`: numeric tolerance used for matching.
3. `thresholdProximity`: margins to active gate thresholds.
4. Default `matchToleranceSec` is `0.2s` for coverage counting.

### 4) Eval semantics

`computeBeatFMeasure` is currently downbeat-derived. Phase 3 must make semantics explicit by exposing:

1. downbeat metric path (existing behavior, clearly labeled)
2. true all-beat metric path (beat-level reference)

## Canonical Artifact Schema

Path: `training-data/alignment/<songId>.json`

```json
{
  "songId": "let-it-be",
  "status": "aligned_ok",
  "tier": 1,
  "model": "affine",
  "params": { "a": 0.0, "b": 1.0 },
  "segments": [],
  "segment": {
    "midiStart": 0.0,
    "midiEnd": 243.0,
    "youtubeStart": 0.0,
    "youtubeEnd": 243.0
  },
  "qualityMode": "analysis_downbeat",
  "quality": {
    "anchorsCovered": 120,
    "anchorsTotal": 123,
    "coverage": 0.976,
    "medianMs": 62,
    "p95Ms": 180,
    "matchToleranceSec": 0.2,
    "thresholdProximity": {
      "coverageMargin": 0.076,
      "medianMarginMs": 58,
      "p95MarginMs": 120
    }
  },
  "baseline": {
    "qualityMode": "energy_peak",
    "coverage": 0.58,
    "medianMs": 190,
    "p95Ms": 430
  },
  "reason": null,
  "reasonDetail": null,
  "version": "align-v3"
}
```

1. For `model = "affine"`:
   1. `params` is required and contains `{ a, b }`.
   2. `segments` is omitted or empty.
2. For `model = "piecewise_affine"`:
   1. `segments` is required, non-empty, sorted by `midiStart`, and non-overlapping.
   2. Each segment uses `{ a, b, midiStart, midiEnd }`.
   3. `params` stores a global summary affine fit for reporting only and is not used for time mapping.
3. Baseline persistence semantics:
   1. For any Tier 2 attempt, `baseline` must be written even when `status` is `unaligned_partial`.
   2. For Tier 1-only paths, `baseline` may be omitted.
   3. Delta checks on rerun read `baseline` from the latest artifact; if missing, baseline is recomputed before candidate scoring.

## Function-Level Work Items

### Phase 1 signatures

In `scripts/align-training-set.ts`:

```ts
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

interface AlignmentQualityV3 {
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
  a: number;
  b: number;
  midiStart: number;
  midiEnd: number;
}

function makeUnaligned(
  songId: string,
  tier: 1 | 2,
  reason: AlignmentReasonCode,
  reasonDetail?: string,
  params?: { a?: number; b?: number },
  quality?: AlignmentQualityV3
): AlignmentArtifactV3;
```

In `scripts/run-training-eval.ts`:

```ts
function parseReason(reason: string | null): { reason: AlignmentReasonCode | null; reasonDetail: string | null };
function trainingReportToMarkdown(report: TrainingEvalReportV3): string;
```

### Phase 2 signatures

New files:

1. `scripts/alignment/logTokens.ts`
2. `scripts/alignment/seedIndex.ts`
3. `scripts/alignment/localAlign.ts`

```ts
interface AudioOnset {
  timeSec: number;
  dominantMidi: number;
  pitchConfidence: number;
  onsetStrength: number;
}

interface AudioFeatures {
  sampleRate: 44100;
  bitDepth: 16;
  channels: 1;
  durationSec: number;
  onsets: AudioOnset[];
  onsetDensity: number;
  medianPitchConfidence: number;
}

interface Token {
  deltaPitch: number;      // integer semitone delta, 1-semitone resolution, clamp [-12, 12], 25 distinct values
  deltaRhythmBin: number;  // bucket index from quantizeDeltaRhythmBin(log2(currIOI / prevIOI)) within the same stream
  timeSec: number;
}

interface LocalAlignMatch {
  midiIdx: number;
  audioIdx: number;
  midiTimeSec: number;
  audioTimeSec: number;
}

interface LocalAlignResult {
  matches: LocalAlignMatch[];
  score: number;
  secondBestScore: number;
  blockCount: number;
  confidence: number;
}

function buildMidiTokens(gt: MidiGroundTruth): Token[];
function buildAudioTokens(audioFeatures: AudioFeatures): Token[];
function quantizeDeltaRhythmBin(log2LocalIoiRatio: number): 0 | 1 | 2 | 3 | 4;
function buildSeedIndex(tokens: Token[], k: number): Map<string, number[]>;
function localAlign(
  midiTokens: Token[],
  audioTokens: Token[],
  seedPairs: Array<{ midiIdx: number; audioIdx: number }>
): LocalAlignResult;
```

1. Audio tokenization input is normalized mono WAV at 44,100 Hz, 16-bit PCM.
2. Onsets are extracted with spectral-flux peak picking:
   1. STFT frame size 2048, hop size 512.
   2. Adaptive threshold from local median flux over a 0.25s window.
   3. Minimum onset spacing 0.05s.
3. Dominant pitch per onset is estimated with autocorrelation over a 120ms window after onset:
   1. Band-limit to 80-1000 Hz.
   2. Convert F0 to MIDI with `69 + 12 * log2(f0 / 440)`.
   3. Store nearest integer MIDI note in `dominantMidi`.
4. `pitchConfidence` is the normalized autocorrelation peak value in `[0, 1]`.
5. Pre-alignment quality gate:
   1. `onsets.length >= 30`
   2. `medianPitchConfidence >= 0.45`
   3. `onsetDensity` in `[0.40, 6.00]` onsets/sec
6. If the pre-alignment quality gate fails, emit reason code `extraction_quality_low`.
7. `deltaPitch` is quantized to integer semitones by rounding, then clamped to `[-12, 12]`.
8. `log2LocalIoiRatio = log2(currIOI / prevIOI)` and is computed independently within each stream.
9. Token matching compares stream-local rhythm-bin trajectories after seeding; no cross-stream IOI ratio is used during token construction.
10. `deltaRhythmBin` boundaries use powers of `sqrt(2)`:
   1. Bin `0` (`very_compressed`): `log2LocalIoiRatio < -1.0`
   2. Bin `1` (`compressed`): `-1.0 <= log2LocalIoiRatio < -0.5`
   3. Bin `2` (`near_equal`): `-0.5 <= log2LocalIoiRatio <= 0.5`
   4. Bin `3` (`expanded`): `0.5 < log2LocalIoiRatio <= 1.0`
   5. Bin `4` (`very_expanded`): `log2LocalIoiRatio > 1.0`

### Phase 3 signatures

In `src/eval/evaluationHarness.ts` and `src/eval/evaluationTypes.ts`:

```ts
interface BeatAnchor {
  bar: number;
  beatInBar: number;
  timeSec: number;
  source: 'midi_beat' | 'derived_from_bar';
  approximate: boolean;
}

function computeDownbeatFMeasure(
  beats: BeatEvent[],
  anchors: BarAnchor[],
  toleranceMs?: number
): DownbeatMetrics;

function computeAllBeatFMeasure(
  beats: BeatEvent[],
  beatAnchors: BeatAnchor[],
  toleranceMs?: number
): BeatMetrics;
```

In `scripts/run-training-eval.ts`:

```ts
interface TrainingEvalReportV3 extends EvalReport {
  aggregate: EvalReport['aggregate'] & {
    meanAllBeatF1?: number;
  };
  alignmentSummary: {
    totalSongs: number;
    alignedCount: number;
    skippedCount: number;
    skippedSongs: Array<{ songId: string; reason: string; reasonDetail?: string }>;
  };
}
```

## Session-by-Session Execution

### Phase 1: Stabilize Existing Pipeline

Required work:

1. Migrate reason strings from ad-hoc `"reason:detail"` into structured `reason` + `reasonDetail`.
2. Add `qualityMode`, `matchToleranceSec`, and `thresholdProximity`.
3. Keep deterministic JSON write order.
4. Validate every artifact against one schema in script.

Commands:

1. `npx tsx scripts/build-training-set.ts`
2. `npx tsx scripts/align-training-set.ts`
3. `npx tsx scripts/align-training-set.ts` (repeat determinism check)
4. `npx tsx scripts/run-training-eval.ts --reuse-analysis`

Gate 1:

1. 100% artifacts pass schema validation.
2. Rerun with same inputs is byte-identical for `training-data/alignment/*.json`.
3. No unknown reason codes in output.

### Phase 2: Log-Interval Tier 2 Upgrade

Required work:

1. Build token streams for MIDI and audio with interval/rhythm bins.
2. Seed by k-gram index (`k=4`, fallback `k=3`).
3. Run local alignment (Smith-Waterman with affine gaps) on seeded windows.
4. Fit local affine map from matched anchors.
5. Fallback to existing energy Tier 2 when confidence is weak.
6. Capture a per-song Tier 2 baseline snapshot before new method is enabled:
   1. `coverage_baseline`
   2. `medianMs_baseline`
   3. `p95Ms_baseline`
7. Baseline snapshot storage uses Option A:
   1. Persist baseline values in each alignment artifact as `baseline`.
   2. Baseline values are read by Gate 2 delta checks in subsequent runs.
   3. Baseline persists for both `aligned_ok` and `unaligned_partial` Tier 2 outputs.

Default scoring:

1. exact token match: `+3`
2. pitch-only match: `+1`
3. near-pitch (`+/-1` semitone): `0`
4. mismatch: `-2`
5. gap open: `-5`
6. gap extend: `-1`

Commands:

1. `npx tsx scripts/align-training-set.ts --song piano-man`
2. `npx tsx scripts/align-training-set.ts --song stand-by-me`
3. `npx tsx scripts/align-training-set.ts`

Gate 2:

1. Token-local eligibility check:
   1. `confidence >= 0.40`
   2. `blockCount >= 2`
   3. `matches.length >= 12`
2. Token-local ambiguity check (token path only):
   1. Top-scoring non-overlapping block must satisfy `score >= 1.30 * secondBestScore`.
   2. If this fails, token-local path is marked ambiguous.
3. If token-local path is ineligible or ambiguous, run `energy_peak` fallback before final GO/NO-GO.
4. For whichever path is being considered (token-local or fallback), candidate must beat baseline on at least one primary metric:
   1. `coverage_delta >= +0.05`, or
   2. `medianMs_delta <= -20`, or
   3. `p95Ms_delta <= -40`.
5. For whichever path is being considered (token-local or fallback), candidate must not regress beyond guardrails:
   1. `coverage_delta >= -0.02`
   2. `medianMs_delta <= +20`
   3. `p95Ms_delta <= +40`
6. Keep existing slope sanity guard unless explicitly whitelisted: `b` in `[0.80, 1.30]`.
7. If token-local fails Gate 2 delta/regression checks, run fallback and apply rules 4-6 to fallback result.
8. If token-local is ambiguous and fallback also fails, emit reason code `multi_match_ambiguous`.
9. If all strategies fail, mark `unaligned_partial` with canonical reason.

### Phase 3: Eval Semantics and Reporting

Required work:

1. Keep current downbeat metric behavior but label it explicitly.
2. Add true all-beat metric path using aligned beat anchors.
3. Report both metric sets in JSON and markdown.
4. Include per-song alignment context (`status`, `tier`, `model`, `qualityMode`, `coverage`, `medianMs`, `p95Ms`).
5. Beat-anchor source contract:
   1. Primary source is aligned MIDI beat ground truth from `aligned-ground-truth/<songId>.json` `beats[]`.
   2. Fallback source is bar subdivision using MIDI time signature numerator (`N` equal subdivisions per bar).
   3. When fallback subdivision is used, set `source = "derived_from_bar"` and `approximate = true`.
   4. Reports must label all-beat metrics as approximate for songs using derived beat anchors.

Commands:

1. `npx tsx scripts/run-training-eval.ts`
2. `npx tsx scripts/run-training-eval.ts --reuse-analysis`

Gate 3:

1. At least 5 songs are `aligned_ok`.
2. Skipped songs never crash eval.
3. Final report always includes aligned count, skipped count, skipped reason breakdown, downbeat summary, and all-beat summary.

## Verification Checklist

1. `segment.youtubeStart < segment.youtubeEnd` for all songs.
2. Anchor mapping is monotonic in time for aligned artifacts.
3. `reason` always from canonical list.
4. Artifacts are deterministic across two reruns.
5. Eval report is generated even when some songs are skipped.

## Stop Conditions (Skip Fast)

Skip immediately if any condition is true:

1. audio file missing or unusably short
2. duration ratio too extreme for reliable fit
3. extraction pre-gate fails (`onsets.length`, `medianPitchConfidence`, or `onsetDensity` out of bounds)
4. seed density insufficient and fallback also fails
5. slope remains out of range after one retune pass
6. all quality gates fail for every available mode
7. no wall-clock timeout stop in this dev plan; long-running searches are allowed to complete

## Risk Register

1. Wrong YouTube recording selected for a song.
   Mitigation: source suitability check and explicit manifest notes.
2. Partial MIDI maps to repeated sections ambiguously.
   Mitigation: require `score >= 1.30 * secondBestScore` for top non-overlapping match; otherwise use fallback and emit `multi_match_ambiguous` if unresolved.
3. Metric confusion persists.
   Mitigation: always publish both downbeat and all-beat metrics with labels.
4. Reason taxonomy drifts over time.
   Mitigation: enforce reason enum validation before writing artifacts.

## Definition of Done

Done when all conditions are true:

1. Gates 1, 2, and 3 pass.
2. At least 5 songs are `aligned_ok`.
3. End-to-end run is deterministic and reproducible.
4. Reports are explicit about measured scope and skipped scope.
