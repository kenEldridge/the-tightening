# Rhythm Detection Baseline Metrics
Generated: 2026-03-01T01:03:00.210Z

## Aggregate

| Metric | Value |
|--------|-------|
| Mean Beat F1 | 0.220 |
| Mean Downbeat F1 | 0.400 |
| Mean Root Accuracy | 0.0% |
| Mean Full Accuracy | 0.0% |
| Mean Drift (median) | 377.9 ms |
| Mean False Changes /32 bars | 0.0 |

## The Beatles - Let It Be (`let-it-be`)

### Beat Detection
- **F1**: 0.398 (P=0.251, R=0.958)
- Matched: 69 / 72 GT, 275 predicted

### Downbeat Detection
- **F1**: 0.979 (P=1.000, R=0.958)
- Matched: 69 / 72 GT, 69 predicted

### Bar Drift
- Median: 3.4 ms
- P95: 60.0 ms
- Bars evaluated: 72

### Chord Accuracy
- Root: 0.0%
- Full: 0.0%
- Bars evaluated: 0

### False Chord Changes
- Per 32 bars: 0.0
- Total: 0 / 0 transitions

### Determinism
- *Not evaluated (single run)*

## John Lennon - Imagine (`imagine`)

### Beat Detection
- **F1**: 0.170 (P=0.108, R=0.397)
- Matched: 23 / 58 GT, 213 predicted

### Downbeat Detection
- **F1**: 0.000 (P=0.000, R=0.000)
- Matched: 0 / 58 GT, 53 predicted

### Bar Drift
- Median: 810.6 ms
- P95: 13558.2 ms
- Bars evaluated: 58

### Chord Accuracy
- Root: 0.0%
- Full: 0.0%
- Bars evaluated: 0

### False Chord Changes
- Per 32 bars: 0.0
- Total: 0 / 0 transitions

### Determinism
- *Not evaluated (single run)*

## Queen - Bohemian Rhapsody (`bohemian-rhapsody`)

### Beat Detection
- **F1**: 0.105 (P=0.086, R=0.136)
- Matched: 29 / 214 GT, 336 predicted

### Downbeat Detection
- **F1**: 0.068 (P=0.077, R=0.061)
- Matched: 13 / 214 GT, 168 predicted

### Bar Drift
- Median: 398.4 ms
- P95: 801.6 ms
- Bars evaluated: 214

### Chord Accuracy
- Root: 0.0%
- Full: 0.0%
- Bars evaluated: 0

### False Chord Changes
- Per 32 bars: 0.0
- Total: 0 / 0 transitions

### Determinism
- *Not evaluated (single run)*

## ABBA - Dancing Queen (`dancing-queen`)

### Beat Detection
- **F1**: 0.400 (P=0.251, R=0.980)
- Matched: 97 / 99 GT, 386 predicted

### Downbeat Detection
- **F1**: 0.990 (P=1.000, R=0.980)
- Matched: 97 / 99 GT, 97 predicted

### Bar Drift
- Median: 12.1 ms
- P95: 66.8 ms
- Bars evaluated: 99

### Chord Accuracy
- Root: 0.0%
- Full: 0.0%
- Bars evaluated: 0

### False Chord Changes
- Per 32 bars: 0.0
- Total: 0 / 0 transitions

### Determinism
- *Not evaluated (single run)*

## Billy Joel - Piano Man (`piano-man`)

### Beat Detection
- **F1**: 0.116 (P=0.072, R=0.295)
- Matched: 28 / 95 GT, 389 predicted

### Downbeat Detection
- **F1**: 0.080 (P=0.070, R=0.095)
- Matched: 9 / 95 GT, 129 predicted

### Bar Drift
- Median: 386.6 ms
- P95: 753.3 ms
- Bars evaluated: 95

### Chord Accuracy
- Root: 0.0%
- Full: 0.0%
- Bars evaluated: 0

### False Chord Changes
- Per 32 bars: 0.0
- Total: 0 / 0 transitions

### Determinism
- *Not evaluated (single run)*

## Ben E. King - Stand By Me (`stand-by-me`)

### Beat Detection
- **F1**: 0.090 (P=0.060, R=0.175)
- Matched: 10 / 57 GT, 166 predicted

### Downbeat Detection
- **F1**: 0.041 (P=0.049, R=0.035)
- Matched: 2 / 57 GT, 41 predicted

### Bar Drift
- Median: 704.6 ms
- P95: 1407.6 ms
- Bars evaluated: 57

### Chord Accuracy
- Root: 0.0%
- Full: 0.0%
- Bars evaluated: 0

### False Chord Changes
- Per 32 bars: 0.0
- Total: 0 / 0 transitions

### Determinism
- *Not evaluated (single run)*

## Beethoven - Fur Elise (`fur-elise`)

### Beat Detection
- **F1**: 0.087 (P=0.071, R=0.112)
- Matched: 13 / 116 GT, 182 predicted

### Downbeat Detection
- **F1**: 0.057 (P=0.083, R=0.043)
- Matched: 5 / 116 GT, 60 predicted

### Bar Drift
- Median: 699.1 ms
- P95: 11296.6 ms
- Bars evaluated: 116

### Chord Accuracy
- Root: 0.0%
- Full: 0.0%
- Bars evaluated: 0

### False Chord Changes
- Per 32 bars: 0.0
- Total: 0 / 0 transitions

### Determinism
- *Not evaluated (single run)*

## Michael Jackson - Billie Jean (`billie-jean`)

### Beat Detection
- **F1**: 0.393 (P=0.244, R=1.000)
- Matched: 141 / 141 GT, 577 predicted

### Downbeat Detection
- **F1**: 0.986 (P=0.972, R=1.000)
- Matched: 141 / 141 GT, 145 predicted

### Bar Drift
- Median: 9.0 ms
- P95: 58.8 ms
- Bars evaluated: 141

### Chord Accuracy
- Root: 0.0%
- Full: 0.0%
- Bars evaluated: 0

### False Chord Changes
- Per 32 bars: 0.0
- Total: 0 / 0 transitions

### Determinism
- *Not evaluated (single run)*

## Alignment Summary

- Total songs: 8
- Aligned: 8
- Skipped: 0

### Alignment Quality

| Song | Tier | Coverage | Median (ms) | P95 (ms) |
|------|------|----------|-------------|----------|
| let-it-be | 1 | 96% | 3 | 55 |
| imagine | 1 | 92% | 75 | 200 |
| bohemian-rhapsody | 1 | 97% | 70 | 190 |
| dancing-queen | 1 | 98% | 12 | 60 |
| piano-man | 2 | 97% | 50 | 190 |
| stand-by-me | 2 | 100% | 40 | 200 |
| fur-elise | 1 | 90% | 70 | 200 |
| billie-jean | 1 | 100% | 9 | 59 |
