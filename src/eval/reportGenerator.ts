/**
 * Report Generator
 *
 * Converts EvalReport to markdown and JSON output.
 */

import type { EvalReport, SongEvalResult } from './evaluationTypes';

export function reportToJSON(report: EvalReport): string {
  return JSON.stringify(report, null, 2);
}

export function reportToMarkdown(report: EvalReport): string {
  const lines: string[] = [];

  lines.push(`# Rhythm Detection Baseline Metrics`);
  lines.push(`Generated: ${report.generatedAt}`);
  lines.push('');

  // Aggregate
  lines.push('## Aggregate');
  lines.push('');
  lines.push('| Metric | Value |');
  lines.push('|--------|-------|');
  lines.push(`| Mean Beat F1 | ${fmt(report.aggregate.meanBeatF1)} |`);
  lines.push(`| Mean Downbeat F1 | ${fmt(report.aggregate.meanDownbeatF1)} |`);
  lines.push(`| Mean Root Accuracy | ${pct(report.aggregate.meanRootAccuracy)} |`);
  lines.push(`| Mean Full Accuracy | ${pct(report.aggregate.meanFullAccuracy)} |`);
  lines.push(`| Mean Drift (median) | ${report.aggregate.meanDriftMedianMs.toFixed(1)} ms |`);
  lines.push(`| Mean False Changes /32 bars | ${report.aggregate.meanFalseChangePer32.toFixed(1)} |`);
  lines.push('');

  // Per-song
  for (const song of report.songs) {
    lines.push(`## ${song.songName} (\`${song.songId}\`)`);
    lines.push('');
    lines.push(songSection(song));
    lines.push('');
  }

  return lines.join('\n');
}

function songSection(s: SongEvalResult): string {
  const lines: string[] = [];

  lines.push('### Beat Detection');
  lines.push(`- **F1**: ${fmt(s.beat.f1)} (P=${fmt(s.beat.precision)}, R=${fmt(s.beat.recall)})`);
  lines.push(`- Matched: ${s.beat.matched} / ${s.beat.groundTruth} GT, ${s.beat.predicted} predicted`);
  lines.push('');

  lines.push('### Downbeat Detection');
  lines.push(`- **F1**: ${fmt(s.downbeat.f1)} (P=${fmt(s.downbeat.precision)}, R=${fmt(s.downbeat.recall)})`);
  lines.push(`- Matched: ${s.downbeat.matched} / ${s.downbeat.groundTruth} GT, ${s.downbeat.predicted} predicted`);
  lines.push('');

  lines.push('### Bar Drift');
  lines.push(`- Median: ${s.drift.medianMs.toFixed(1)} ms`);
  lines.push(`- P95: ${s.drift.p95Ms.toFixed(1)} ms`);
  lines.push(`- Bars evaluated: ${s.drift.perBar.length}`);
  lines.push('');

  lines.push('### Chord Accuracy');
  lines.push(`- Root: ${pct(s.chordAccuracy.rootAccuracy)}`);
  lines.push(`- Full: ${pct(s.chordAccuracy.fullAccuracy)}`);
  lines.push(`- Bars evaluated: ${s.chordAccuracy.perBar.length}`);
  lines.push('');

  lines.push('### False Chord Changes');
  lines.push(`- Per 32 bars: ${s.falseChordChange.per32Bars.toFixed(1)}`);
  lines.push(`- Total: ${s.falseChordChange.total} / ${s.falseChordChange.totalBars} transitions`);
  lines.push('');

  if (s.determinism) {
    lines.push('### Determinism');
    lines.push(`- Beat variance: ${s.determinism.beatVariance.toFixed(2)} ms\u00B2`);
    lines.push(`- Chord agreement: ${pct(s.determinism.chordAgreement)}`);
    lines.push(`- Tempo variance: ${s.determinism.tempoVariance.toFixed(2)} BPM\u00B2`);
  } else {
    lines.push('### Determinism');
    lines.push('- *Not evaluated (single run)*');
  }

  return lines.join('\n');
}

function fmt(n: number): string {
  return n.toFixed(3);
}

function pct(n: number): string {
  return (n * 100).toFixed(1) + '%';
}
