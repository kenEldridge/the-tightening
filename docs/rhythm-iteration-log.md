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
