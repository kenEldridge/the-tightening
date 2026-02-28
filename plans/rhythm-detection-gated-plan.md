# Rhythm/Chord Detection Improvement Plan (Executable, Gated v2)

Date: 2026-02-27
Owner: Rhythm architecture + implementation team
Scope: Improve rhythm/chord detection quality with strict gate control and high human moderation.

## Current-State Acknowledgment (Do Not Rebuild What Exists)
Already implemented and treated as baseline:
1. Scoped lyric corrections (`line`, `section_occurrence`, `section_class`, `global`)
2. Scope chooser UI and correction persistence in `timeline.edits[]`
3. Reanalyze intent preservation via post-baseline correction application
4. Anti-oscillation behavior for existing lyric correction resolver (`line` accumulation, latest-wins for broader scopes)

Phase 4 in this plan is not a rewrite of the above. It is specifically about feeding correction intent into the analysis model itself (beat/chord inference), not only post-hoc lyric shifting.

## Operating Rules (Non-Negotiable)
1. No phase overlap. A phase cannot begin until its gate is marked PASS in writing.
2. Every gate requires both machine evidence and human review sign-off.
3. If a gate fails, work returns to the same phase with a revised micro-plan.
4. Any metric regression beyond allowed bounds is an automatic NO-GO.
5. All gate artifacts must be committed under `plans/` or `docs/` before advancing.
6. Phase 5 and Phase 6 are skeletal by design and must be re-scoped after Gate 3 retrospective.

## Cadence and Compute Intervals
- Default micro-interval size: 0.5 to 1.5 dev-days.
- Exception: Phase 1 is expected to take 2 to 3 focused dev-days due to manual annotation.
- Human moderation minimum: one focused review session per gate.
- Checkpoint rhythm: build -> evaluate -> review -> decide (GO/NO-GO).

## Global Acceptance Metrics
These metrics are tracked from Gate 1 onward and used in later gates.
1. Beat F-measure
2. Downbeat F-measure
3. Bar-start drift (median and p95 ms vs manual anchors)
4. Chord root accuracy
5. Full chord quality accuracy (root + quality)
6. False chord-change rate (spurious changes per 32 bars)
7. Determinism (variance across repeat runs with same inputs)

---

## Phase 1: Evaluation Harness and Baseline (Must happen first)
Objective: Establish reliable measurement so all later claims are provable.

### Fixture Definition
Tier A is locked now:
1. `Mull of Kintyre` (3/4 stress case, vocal entry placement sensitivity)
2. `Hey Jude` (4/4 baseline, long repeated refrain)
3. `Canon in D` (instrumental control case for rhythm/chord behavior without vocal cues)

Tier B:
1. Five additional songs with style diversity
2. Must include at least one repeated-chorus vocal song beyond Tier A

### Ground-Truth Schema (Explicit)
Ground-truth files must use this format:
1. `bar_anchors.csv`
   - `song_id`
   - `bar_number` (1-based)
   - `bar_start_sec`
   - `source` (`manual`, `published`)
   - `annotator`
   - `notes`
2. `chord_labels.csv`
   - `song_id`
   - `bar_number` (1-based)
   - `beat_in_bar` (1-based, default 1 for bar-level labels)
   - `chord_symbol`
   - `granularity` (`bar`, `beat`)
   - `source` (`manual`, `published`)
   - `ambiguity_note` (free text, required when contested)
   - `annotator`

### Work Package
1. Build or confirm offline evaluation harness for rhythm and chord outputs.
2. Capture manual ground truth:
   - Bar starts for at least first 64 bars on Tier A
   - Chord labels for at least 32 bars on Tier A
3. Produce baseline report from current analyzer.

### Required Artifacts
1. `docs/rhythm-baseline-fixtures.md`
2. `docs/rhythm-baseline-metrics-2026-02-27.md`
3. Machine-readable metrics output (JSON or CSV) checked in
4. Ground-truth CSV files following the schema above

### Gate 1 PASS Criteria
1. Harness runs end-to-end on all Tier A songs without manual patching.
2. Repeat run variance is near-zero (deterministic or explicitly explained).
3. Baseline metrics published for every global metric listed above.
4. Human sign-off confirms anchors and chord labels are credible enough for go/no-go comparisons.

### Gate 1 Review Checklist (Human)
- [ ] Fixtures reflect target songs, not synthetic easy cases.
- [ ] Ground truth quality is acceptable for go/no-go use.
- [ ] Baseline report is understandable and reproducible.

Decision: GO / NO-GO

---

## Phase 2: Beat/Downbeat Reliability Upgrade
Objective: Improve structural timing reliability before deeper chord-model complexity.

### Algorithm Path (Explicit)
Adaptive beat tracking in this plan means:
1. Multi-band onset function (replace pure energy-difference onset strength as primary signal).
2. Piecewise tempo tracking:
   - Estimate local tempo in overlapping windows (target window: 8 bars, 50% overlap).
   - Apply tempo continuity penalty between adjacent windows.
3. Beat sequence optimization:
   - Choose beat times by maximizing onset alignment score minus tempo-change penalty.
   - Keep monotonic spacing constraints.
4. Downbeat inference:
   - Evaluate 3/4 and 4/4 bar-phase hypotheses using accent plus harmonic-change cues.
   - Select hypothesis by total sequence score with deterministic tie-break rules.

### Work Package
1. Implement algorithm path above with diagnostics.
2. Preserve current analyzer as fallback flag for A/B regression checks.
3. Produce before/after metric report against Gate 1 baseline.

### Required Artifacts
1. `docs/rhythm-phase2-design.md` (constants, scoring terms, tie-breaks)
2. `docs/rhythm-phase2-results.md` (baseline deltas)

### Gate 2 PASS Criteria (Conditional on Baseline)
Beat F-measure target on Tier A:
1. If baseline < 0.70, require +0.10 absolute improvement.
2. If baseline >= 0.70 and < 0.85, require +0.06 absolute improvement.
3. If baseline >= 0.85, require +0.03 absolute improvement and p95 bar-start drift reduction >= 20%.

Downbeat F-measure target on Tier A:
1. If baseline < 0.60, require +0.12 absolute improvement.
2. If baseline >= 0.60 and < 0.80, require +0.08 absolute improvement.
3. If baseline >= 0.80, require +0.04 absolute improvement and p95 bar-start drift < 130 ms.

Additional constraints:
1. Bar-start drift median improves by >= 25% on Tier A.
2. No Tier B song regresses by > 0.05 absolute in beat or downbeat F-measure.
3. Determinism preserved for fixed input and hints.

### Gate 2 Review Checklist (Human)
- [ ] Visual timeline inspection confirms fewer mid-song bar drifts.
- [ ] 3/4 vs 4/4 decisions are explainable from diagnostics.
- [ ] At least one previously bad song now places first vocal section near expected bar.

Decision: GO / NO-GO

---

## Phase 3: Chord Decoder Upgrade (Staged Risk)
Objective: Improve chord quality while controlling complexity and compute cost.

### Phase 3A: Lightweight Sequence Modeling First
Work package:
1. Expand chord vocabulary incrementally (maj/min/7/sus/dim minimum).
2. Add transition-aware rescoring without full HMM:
   - Penalize unlikely root jumps
   - Penalize rapid quality flips
   - Reward in-key functional continuity
3. Keep confidence calibration and transparent diagnostics.

Required artifacts:
1. `docs/rhythm-phase3a-model.md`
2. `docs/rhythm-phase3a-results.md`

Gate 3A PASS criteria:
1. Chord root accuracy improves by >= 0.06 absolute on Tier A.
2. Full chord quality accuracy improves by >= 0.04 absolute on Tier A.
3. False chord-change rate decreases by >= 0.15 relative on Tier A.
4. No Tier B song regresses by > 0.05 absolute in root accuracy.

Decision: GO / NO-GO

### Phase 3B: Full Viterbi/HMM Only If Needed
Trigger condition:
1. Execute Phase 3B only if Gate 3A is NO-GO.

Work package:
1. Add full sequence decoder (Viterbi/HMM) with explicit state and transition design.
2. Compare decoder complexity, runtime, and accuracy against 3A approach.

Required artifacts:
1. `docs/rhythm-phase3b-model.md`
2. `docs/rhythm-phase3b-results.md`

Gate 3B PASS criteria:
1. Closes all missing metrics from Gate 3A.
2. Runtime cost increase is documented and accepted in human review.

Decision: GO / NO-GO

---

## Phase 4: Constraint-Coupled Reanalysis (Build on Existing Corrections)
Objective: Feed correction intent into analysis inference, not only post-hoc lyric placement.

### Work Package
1. Map existing correction scopes to analyzable constraints:
   - Line constraints as local anchor windows
   - Section constraints as regional offsets
   - Global constraints as song-wide priors
2. Inject constraints into beat and chord inference scoring before final decode.
3. Keep existing post-hoc correction application as fallback safety layer.
4. Add diagnostics for each constraint:
   - honored
   - softened
   - rejected (with reason)

### Required Artifacts
1. `docs/rhythm-phase4-constraint-model.md`
2. `docs/rhythm-phase4-results.md`

### Gate 4 PASS Criteria
1. On rerun after user corrections, >= 0.90 of constrained targets remain aligned.
2. No oscillation across 3 repeated reanalyses with identical inputs.
3. Scope isolation works: line edits do not unintentionally shift section/global targets.
4. Constraint diagnostics are available for every rejected or softened constraint.

### Gate 4 Review Checklist (Human)
- [ ] "Adjust then reanalyze" feels additive, not adversarial.
- [ ] Corrections for repeated section instances resolve to intended occurrence.
- [ ] At least 2 real project sessions validate workflow stability.

Decision: GO / NO-GO

---

## Phase 5: External Evidence Adapter (Skeleton, Re-scope After Gate 3)
Objective: Decide if external priors are worth integrating based on post-Phase-3 reality.

Execution policy:
1. Do not implement production external fusion until a Gate 3 retrospective re-scopes this phase.

Work package (discovery only):
1. Build provider matrix (coverage, confidence, legal and policy constraints).
2. Prototype adapter interface and confidence gate design (no production coupling yet).
3. Define hard fallback behavior for low-confidence or unavailable provider data.

Required artifacts:
1. `docs/rhythm-phase5-provider-matrix.md`
2. `docs/rhythm-phase5-rescope.md`

Gate 5 PASS criteria:
1. Team decides GO or NO-GO for production implementation with written rationale.
2. Legal and policy constraints are explicitly accepted or rejected.
3. No production path is blocked by external dependency assumptions.

Decision: GO / NO-GO

---

## Phase 6: Hybrid Arbitration Policy (Skeleton, Post-Phase-5 Only)
Objective: Define how internal evidence, external priors, and user constraints interact.

Execution policy:
1. Only starts if Gate 5 is GO.

Work package:
1. Define precedence policy and conflict resolution:
   - user constraints
   - internal model confidence
   - external priors
   - heuristic fallback
2. Define provenance tags for every final decision.
3. Validate policy on Tier A before any wider rollout.

Required artifacts:
1. `docs/rhythm-phase6-arbitration-policy.md`
2. `docs/rhythm-phase6-results.md`

Gate 6 PASS criteria:
1. Hybrid mode outperforms internal-only on aggregate Tier A metrics.
2. No major failure mode increase (oscillation, gross bar misalignment, collapse to single chord).
3. Wrong decisions are diagnosable in under 10 minutes per case using provenance logs.

Decision: GO / NO-GO

---

## Phase 7: Ship Gate
Objective: Release only after reliability and workflow trust are both proven.

### Work Package
1. End-to-end regression sweep on Tier A and Tier B.
2. Migration and backward compatibility validation for saved projects.
3. Final UX sanity pass on correction and reanalyze loop.

### Required Artifacts
1. `docs/rhythm-ship-readiness.md`
2. Final metric delta report vs Gate 1 baseline

### Gate 7 PASS Criteria
1. All prior gates remain green with final integrated build.
2. No critical regressions in persistence, reopen, or reanalyze behavior.
3. User acceptance review signed off.

### Gate 7 Review Checklist (Human)
- [ ] Ready for broader daily use.
- [ ] Known limitations documented.
- [ ] Rollback strategy defined.

Decision: SHIP / HOLD

---

## Gate Decision Record Template
Use this at the end of every gate:

```md
### Gate X Decision (YYYY-MM-DD)
- Decision: GO | NO-GO
- Evidence docs:
  - ...
- Metrics summary:
  - ...
- Human reviewer(s): ...
- Risks accepted:
  - ...
- Required follow-ups before next gate:
  - ...
```

## Immediate Next Action
Start Phase 1 only. Do not start Phase 2 implementation until Gate 1 is explicitly marked GO in writing.
