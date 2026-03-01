# Rhythm Detection Baseline Metrics
Generated: 2026-02-28T20:36:58.133Z

## Aggregate

| Metric | Value |
|--------|-------|
| Mean Beat F1 | 0.032 |
| Mean Downbeat F1 | 0.036 |
| Mean Root Accuracy | 18.1% |
| Mean Full Accuracy | 16.8% |
| Mean Drift (median) | 4044.9 ms |
| Mean False Changes /32 bars | 5.4 |

## Hey Jude - The Beatles (`hey-jude`)

### Beat Detection
- **F1**: 0.010 (P=0.006, R=0.038)
- Matched: 3 / 78 GT, 510 predicted

### Downbeat Detection
- **F1**: 0.029 (P=0.023, R=0.038)
- Matched: 3 / 78 GT, 128 predicted

### Bar Drift
- Median: 399.2 ms
- P95: 733.5 ms
- Bars evaluated: 78

### Chord Accuracy
- Root: 11.5%
- Full: 9.0%
- Bars evaluated: 78

### False Chord Changes
- Per 32 bars: 10.8
- Total: 26 / 77 transitions

### Determinism
- *Not evaluated (single run)*

## Canon in D - Pachelbel (`canon-in-d`)

### Beat Detection
- **F1**: 0.054 (P=0.030, R=0.235)
- Matched: 19 / 81 GT, 623 predicted

### Downbeat Detection
- **F1**: 0.042 (P=0.032, R=0.062)
- Matched: 5 / 81 GT, 156 predicted

### Bar Drift
- Median: 7690.6 ms
- P95: 14612.1 ms
- Bars evaluated: 81

### Chord Accuracy
- Root: 24.7%
- Full: 24.7%
- Bars evaluated: 81

### False Chord Changes
- Per 32 bars: 0.0
- Total: 0 / 80 transitions

### Determinism
- *Not evaluated (single run)*
