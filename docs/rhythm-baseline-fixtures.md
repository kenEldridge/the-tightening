# Rhythm Baseline Fixtures

Inventory of songs and data available for evaluation.

## Tier A Songs

| Song | Project File | Audio | Analyzed | GT Anchors | GT Chords |
|------|-------------|-------|----------|------------|-----------|
| Mull of Kintyre | `proj_1772138230701_smcv6t.json` | Yes | Yes (v4) | 146 bars (computed) | None |
| Hey Jude | None | Needs import | No | 78 bars (computed) | 78 bars (from MIDI) |
| Canon in D | None | Needs import | No | 81 bars (computed) | 81 bars (from MIDI) |

## Analysis Details

### Mull of Kintyre
- **Tempo**: 92.3 BPM (3/4 time)
- **Duration**: 286 seconds
- **Analyzer**: rhythm-analyzer-v4
- **Config**: `fft4096_hop2048_keyD_ts3_nudge0.6`
- **Beats detected**: 440 (146 bars × 3 beats)
- **Chords detected**: 147

### Hey Jude
- **Expected tempo**: 72 BPM (4/4 time)
- **Structure**: 3 verses (10 bars each) + 6 outro repeats (8 bars each)
- **Total bars**: 78
- **Chords from MIDI**: F, C, C7, Bb, Eb

### Canon in D
- **Expected tempo**: 54 BPM (4/4 time)
- **Structure**: 8-chord repeating progression
- **Total bars**: 81 (at 2.222s per chord/bar)
- **Chords from MIDI**: D, A, Bm, F#m, G

## Baseline Results (2026-02-27)

Only Mull of Kintyre evaluated (only song with analyzed project).

| Metric | Mull of Kintyre |
|--------|----------------|
| Beat F1 | 0.427 |
| Downbeat F1 | 0.853 |
| Drift median | 46.4 ms |
| Drift P95 | 89.2 ms |
| Root accuracy | N/A (no GT chords) |
| Determinism | N/A (single run) |

**Note**: Beat F1 is low because all 440 beats are compared against 146 bar-start-only anchors. Downbeat F1 (0.853) is the meaningful metric given bar-start ground truth only.

## Next Steps

1. Import Hey Jude and Canon in D audio into the app
2. Run analysis on both
3. Re-run evaluation for full 3-song baseline
4. Manually verify computed anchors against audio (ear verification)
5. Run 3+ analyses of Mull of Kintyre for determinism testing
