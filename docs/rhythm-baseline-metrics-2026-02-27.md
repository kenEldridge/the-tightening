# Rhythm Detection Baseline Metrics
Generated: 2026-02-27T16:12:01.188Z

## Aggregate

| Metric | Value |
|--------|-------|
| Mean Beat F1 | 0.165 |
| Mean Downbeat F1 | 0.100 |
| Mean Root Accuracy | 8.1% |
| Mean Full Accuracy | 7.2% |
| Mean Drift (median) | 29513.8 ms |
| Mean False Changes /32 bars | 3.6 |

## Wings - Mull Of Kintyre (`mull-of-kintyre`)

### Beat Detection
- **F1**: 0.427 (P=0.284, R=0.856)
- Matched: 125 / 146 GT, 440 predicted

### Downbeat Detection
- **F1**: 0.258 (P=0.300, R=0.226)
- Matched: 33 / 146 GT, 110 predicted

### Bar Drift
- Median: 35149.3 ms
- P95: 67594.6 ms
- Bars evaluated: 110

### Chord Accuracy
- Root: 0.0%
- Full: 0.0%
- Bars evaluated: 0

### False Chord Changes
- Per 32 bars: 0.0
- Total: 0 / 0 transitions

### Determinism
- *Not evaluated (single run)*

## Hey Jude - The Beatles (`hey-jude`)

### Beat Detection
- **F1**: 0.010 (P=0.006, R=0.038)
- Matched: 3 / 78 GT, 510 predicted

### Downbeat Detection
- **F1**: 0.008 (P=0.006, R=0.013)
- Matched: 1 / 78 GT, 170 predicted

### Bar Drift
- Median: 31355.6 ms
- P95: 61104.9 ms
- Bars evaluated: 78

### Chord Accuracy
- Root: 19.2%
- Full: 16.7%
- Bars evaluated: 78

### False Chord Changes
- Per 32 bars: 10.8
- Total: 26 / 77 transitions

### Determinism
- *Not evaluated (single run)*

## Canon in D - Pachelbel (`canon-in-d`)

### Beat Detection
- **F1**: 0.059 (P=0.032, R=0.358)
- Matched: 29 / 81 GT, 900 predicted

### Downbeat Detection
- **F1**: 0.033 (P=0.022, R=0.062)
- Matched: 5 / 81 GT, 225 predicted

### Bar Drift
- Median: 22036.5 ms
- P95: 41869.4 ms
- Bars evaluated: 81

### Chord Accuracy
- Root: 4.9%
- Full: 4.9%
- Bars evaluated: 81

### False Chord Changes
- Per 32 bars: 0.0
- Total: 0 / 80 transitions

### Determinism
- *Not evaluated (single run)*
