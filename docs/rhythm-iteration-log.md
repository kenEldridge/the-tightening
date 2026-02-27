# Rhythm Iteration Log

## Session 2026-02-27

### Baseline
| Metric | Mull | Hey Jude | Canon |
|---|---|---|---|
| Beat F1 | 0.427 | 0.010 | 0.054 |
| Downbeat F1 | 0.853 | 0.029 | 0.042 |
| Drift median | 46ms | 399ms | 7691ms |
| Root acc | n/a | 11.5% | 24.7% |
| Full acc | n/a | 9.0% | 24.7% |

### Iteration 1
- Hypothesis: Increase hint boost from 1.2→1.5 and skip 60-180 BPM clamping when hint provided
- Change: `rhythmAnalyzeCore.ts` lines 274-276 + 288-290
- Result:
  - Canon tempo went from 99.4→49.7 BPM (overshot). Drift exploded 7.7s→99s.
- Gate: REVERT
- Note: Removing clamping lets autocorrelation find sub-60 BPM lags that beat even the boosted hint.

### Iteration 2
- Hypothesis: Use tempoHint directly, bypass autocorrelation entirely
- Change: `rhythmAnalyzeCore.ts` line 1251 — `const tempo = options.tempoHint || estimateTempo(...)`
- Result:
  - Beat F1 (Tier A aggregate): Mull 0.427→0.072, Hey Jude 0.010→0.241, Canon 0.054→0.386
  - Downbeat F1: Mull 0.853→0.034, Hey Jude 0.029→0.689, Canon 0.042→0.494
  - Drift median: Mull 46→508ms, Hey Jude 399→46ms, Canon 7691→88889ms
  - Root acc: Hey Jude 11.5→15.4%, Canon 24.7→22.2%
  - Full acc: Hey Jude 9.0→14.1%, Canon 24.7→22.2%
- Gate: REVERT — Mull downbeat F1 regression 0.853→0.034 (>>0.02 threshold)
- Note: Mull hint of 92 is slightly worse than autocorrelation's 92.3. Canon drift still terrible even at correct tempo — problem is `firstBeat` alignment, not tempo.

### Session Result
0 KEEP changes. 2 consecutive failures → early stop (rule 1.4).

### Next Session Queue
Investigate `findFirstBeat` — the beat grid's phase offset is the dominant error source. Even when tempo is correct (Hey Jude 72 vs 71.8, Mull 92 vs 92.3), drift accumulates because the grid start is wrong. The first beat finder needs to be more robust, possibly using onset peaks rather than just energy thresholds.

---

## Session 2026-02-27 #2

### Baseline
Same as session 1 (no KEEP changes).

### Iteration 1
- Hypothesis: `findFirstBeat` only searches first beat-period. Try multiple candidate phases from first 4 beat-periods, score by how many grid beats align with onset peaks over 30s.
- Change: `rhythmAnalyzeCore.ts` `findFirstBeat` function (lines 365-385) — complete rewrite with candidate scoring
- Result:
  - Beat F1: Mull 0.427→0.000, Hey Jude 0.010→0.058, Canon 0.054→0.054
  - Downbeat F1: Mull 0.853→0.000, Hey Jude 0.029→0.166, Canon 0.042→0.042
  - Drift: Mull 46→2136ms, Hey Jude 399→3244ms, Canon 7691→7691ms
- Gate: REVERT — Mull catastrophic regression, all metrics worse
- Note: Scoring used raw onset strength at every frame (not just peaks), flooding candidates. Picked wrong phase.

### Iteration 2
- Hypothesis: Constrain autocorrelation to ±5% of tempoHint to avoid 99.4 BPM on Canon (hint=54)
- Change: `rhythmAnalyzeCore.ts` `estimateTempo` — narrow lag range + BPM filter + skip clamping when hint provided
- Result:
  - Beat F1: Mull 0.427→0.427, Hey Jude 0.010→0.010, Canon 0.054→0.044
  - Downbeat F1: Mull 0.853→0.853, Hey Jude 0.029→0.029, Canon 0.042→0.037
  - Drift: Mull 46→46ms, Hey Jude 399→399ms, Canon 7691→96798ms
- Gate: REVERT — Canon regressed on all metrics despite tempo moving from 99.4→51.7
- Note: Getting the tempo closer to correct (51.7 vs 99.4) made things WORSE because the grid phase is wrong. At 99.4 BPM some beats coincidentally aligned with GT anchors; at 51.7 BPM with wrong phase, nothing aligns. Confirms: **the ground truth for Canon is the problem, not the analyzer**. The GT assumes constant 54 BPM starting at t=0, but the YouTube recording likely has intro silence, tempo variation, or a different starting offset.

### Session Result
0 KEEP changes. 2 consecutive failures → early stop (rule 1.4).

### Next Session Queue
The analyzer cannot be meaningfully improved against Canon's ground truth until the ground truth is verified against the actual audio. Options:
1. **Listen to the Canon recording** and manually create ear-verified bar anchors (mark the GT source as 'ear' not 'computed').
2. **Add a firstBeatHint** option so the user can specify the offset of the first downbeat, removing one more variable from the equation.
3. **Focus iteration on Mull only** (the one song with reasonable baseline metrics) to improve beat F1 from 0.427 without regressing downbeat F1 (0.853).
