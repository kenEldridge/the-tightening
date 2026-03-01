#!/usr/bin/env npx tsx
/**
 * Training Set Evaluation
 *
 * Evaluates the rhythm analyzer against aligned MIDI ground truth from YouTube audio.
 * Uses aligned ground truth (MIDI times transformed to YouTube time) for fair comparison.
 *
 * Usage:
 *   npx tsx scripts/run-training-eval.ts                # Full evaluation
 *   npx tsx scripts/run-training-eval.ts --song <id>    # Single song
 *   npx tsx scripts/run-training-eval.ts --reuse-analysis  # Skip re-analysis, use cached
 */

import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';
import type { AnalysisOptions, BeatEvent, ChordEvent } from '../src/core/rhythmTypes';
import type { BarAnchor, BeatAnchor, ChordLabel, SongEvalResult, EvalReport } from '../src/eval/evaluationTypes';
import { evaluateSong, runFullEvaluation } from '../src/eval/evaluationHarness';
import { reportToMarkdown } from '../src/eval/reportGenerator';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = path.resolve(__dirname, '..');

const TRAINING_DIR = path.join(ROOT, 'training-data');
const AUDIO_DIR = path.join(TRAINING_DIR, 'audio');
const ALIGNMENT_DIR = path.join(TRAINING_DIR, 'alignment');
const ALIGNED_GT_DIR = path.join(TRAINING_DIR, 'aligned-ground-truth');
const ANALYSIS_CACHE_DIR = path.join(TRAINING_DIR, 'analysis-cache');
const EVAL_OUTPUT_DIR = path.join(ROOT, 'eval-output');
const DOCS_DIR = path.join(ROOT, 'docs');

// ============================================
// Types
// ============================================

interface ManifestSong {
  id: string;
  artist: string;
  title: string;
  midiTempo: number;
  midiTimeSignature: string;
  youtubeUrl: string;
  meta: { youtubeTime: number };
}

interface AlignmentArtifact {
  songId: string;
  status: 'aligned_ok' | 'unaligned' | 'unaligned_partial';
  tier: 1 | 2;
  model: 'affine' | 'piecewise_affine';
  params: { a: number; b: number };
  segment: { midiStart: number; midiEnd: number; youtubeStart: number; youtubeEnd: number };
  qualityMode: 'analysis_downbeat' | 'energy_peak' | 'piecewise_energy_peak' | 'token_local_align';
  quality: { anchorsCovered: number; anchorsTotal: number; coverage: number; medianMs: number; p95Ms: number };
  reason: string | null;
  reasonDetail?: string | null;
}

interface AlignedGroundTruth {
  id: string;
  artist: string;
  title: string;
  tempo: number;
  timeSignature: { numerator: number; denominator: number };
  duration: number;
  key: string;
  barAnchors: Array<{ bar: number; time: number }>;
  beats: Array<{ bar: number; beat: number; time: number }>;
  melodyNotes: Array<{ midi: number; time: number; duration: number; velocity: number; name: string }>;
  alignmentModel: string;
  alignmentParams: { a: number; b: number };
}

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

function parseReason(reason: string | null): { reason: AlignmentReasonCode | null; reasonDetail: string | null } {
  if (!reason) return { reason: null, reasonDetail: null };
  const [code, ...rest] = reason.split(':');
  const normalized = code === 'error' ? 'error_runtime' : code;
  const canonical = new Set<AlignmentReasonCode>([
    'audio_not_found',
    'audio_too_short',
    'analysis_too_few_beats',
    'duration_ratio_too_high',
    'insufficient_seeds',
    'coverage_too_low',
    'median_error_too_high',
    'p95_error_too_high',
    'slope_out_of_range',
    'no_valid_tempo_segments',
    'no_segments_aligned',
    'error_runtime',
    'multi_match_ambiguous',
    'extraction_quality_low',
  ]);
  if (canonical.has(normalized as AlignmentReasonCode)) {
    return {
      reason: normalized as AlignmentReasonCode,
      reasonDetail: rest.length > 0 ? rest.join(':') : null,
    };
  }
  return {
    reason: 'error_runtime',
    reasonDetail: reason,
  };
}

// ============================================
// Ground Truth Format Bridge
// ============================================

/**
 * Convert aligned ground truth to BarAnchors for the eval harness.
 *
 * CRITICAL: The eval harness's computeBarDrift matches by bar NUMBER, not time.
 * For Tier 1 close-duration songs, MIDI bar 1 ≈ analysis bar 1, so numbers work.
 * For Tier 2 partial songs (MIDI covers only part of YouTube), MIDI bar 1 might
 * correspond to analysis bar 80. We must remap bar numbers to match the analysis
 * bar numbering, using time proximity to find the corresponding analysis bar.
 */
function alignedToBarAnchors(
  gt: AlignedGroundTruth,
  analysisBeats?: Array<{ bar: number; beatInBar: number; time: number }>,
): BarAnchor[] {
  if (!analysisBeats) {
    // Simple case: use original bar numbers
    return gt.barAnchors.map(a => ({
      bar: a.bar,
      timeSec: a.time,
      source: 'computed' as const,
    }));
  }

  // Build analysis downbeat map: time → bar number
  const analysisDownbeats = analysisBeats
    .filter(b => b.beatInBar === 1)
    .map(b => ({ bar: b.bar, time: b.time }));

  return gt.barAnchors.map(anchor => {
    // Find the closest analysis downbeat by time
    let bestBar = anchor.bar;
    let bestDist = Infinity;
    for (const db of analysisDownbeats) {
      const dist = Math.abs(db.time - anchor.time);
      if (dist < bestDist) {
        bestDist = dist;
        bestBar = db.bar;
      }
    }
    return {
      bar: bestBar,
      timeSec: anchor.time,
      source: 'computed' as const,
    };
  });
}

/**
 * Filter analysis beats to only those within the aligned segment's time window.
 * This prevents extra beats from inflating the predicted count.
 */
function filterBeatsToSegment(
  beats: BeatEvent[],
  segment: { youtubeStart: number; youtubeEnd: number },
  margin: number = 5, // seconds of slack
): BeatEvent[] {
  const start = segment.youtubeStart - margin;
  const end = segment.youtubeEnd + margin;
  return beats.filter(b => b.time >= start && b.time <= end);
}

function alignedToBeatAnchors(gt: AlignedGroundTruth): { anchors: BeatAnchor[]; approximate: boolean } {
  if (gt.beats.length > 0) {
    return {
      anchors: gt.beats
        .map(b => ({
          bar: b.bar,
          beatInBar: b.beat,
          timeSec: b.time,
          source: 'midi_beat' as const,
          approximate: false,
        }))
        .sort((a, b) => a.timeSec - b.timeSec),
      approximate: false,
    };
  }

  const numerator = Math.max(1, gt.timeSignature?.numerator ?? 4);
  const bars = [...gt.barAnchors].sort((a, b) => a.time - b.time);
  const anchors: BeatAnchor[] = [];

  for (let i = 0; i < bars.length; i++) {
    const barStart = bars[i].time;
    const prevBarStart = i > 0 ? bars[i - 1].time : barStart;
    const nextBarStart = i + 1 < bars.length
      ? bars[i + 1].time
      : barStart + Math.max(0.001, barStart - prevBarStart);
    const beatDur = Math.max(0.001, (nextBarStart - barStart) / numerator);
    for (let beatInBar = 1; beatInBar <= numerator; beatInBar++) {
      anchors.push({
        bar: bars[i].bar,
        beatInBar,
        timeSec: barStart + (beatInBar - 1) * beatDur,
        source: 'derived_from_bar',
        approximate: true,
      });
    }
  }

  return { anchors, approximate: true };
}

function alignedToChordLabels(_gt: AlignedGroundTruth): ChordLabel[] {
  // MIDI ground truth doesn't have bar-level chord labels directly.
  return [];
}

// ============================================
// Headless Analysis (with caching)
// ============================================

async function runAnalysis(
  songId: string,
  audioPath: string,
  hints: AnalysisOptions,
  reuseCache: boolean,
) {
  fs.mkdirSync(ANALYSIS_CACHE_DIR, { recursive: true });
  const cachePath = path.join(ANALYSIS_CACHE_DIR, `${songId}.json`);

  if (reuseCache && fs.existsSync(cachePath)) {
    console.log(`  Using cached analysis`);
    return JSON.parse(fs.readFileSync(cachePath, 'utf8'));
  }

  console.log(`  Running headless analysis...`);
  const { NodeRhythmAnalyzer } = await import('../src/node/NodeRhythmAnalyzer');
  const analyzer = new NodeRhythmAnalyzer();
  const result = await analyzer.analyze(audioPath, hints);

  // Cache the result
  fs.writeFileSync(cachePath, JSON.stringify({
    beatGrid: result.beatGrid,
    chords: result.chords,
    meta: result.meta,
  }, null, 2));

  return result;
}

// ============================================
// Extended Report with Alignment Quality
// ============================================

interface TrainingEvalReport extends EvalReport {
  aggregate: EvalReport['aggregate'] & {
    meanAllBeatF1?: number;
  };
  alignmentSummary: {
    totalSongs: number;
    alignedCount: number;
    skippedCount: number;
    skippedSongs: Array<{ songId: string; reason: string; reasonDetail?: string }>;
  };
  perSongAlignment: Array<{
    songId: string;
    status: AlignmentArtifact['status'];
    tier: 1 | 2;
    model: AlignmentArtifact['model'];
    qualityMode: AlignmentArtifact['qualityMode'];
    coverage?: number;
    medianMs?: number;
    p95Ms?: number;
  }>;
}

function generateTrainingReport(
  results: SongEvalResult[],
  alignments: AlignmentArtifact[],
  skipped: Array<{ songId: string; reason: string; reasonDetail?: string }>,
): TrainingEvalReport {
  const baseReport = runFullEvaluation(results);

  return {
    ...baseReport,
    alignmentSummary: {
      totalSongs: alignments.length + skipped.length,
      alignedCount: alignments.filter(a => a.status === 'aligned_ok').length,
      skippedCount: skipped.length,
      skippedSongs: skipped,
    },
    perSongAlignment: alignments
      .map(a => ({
        songId: a.songId,
        status: a.status,
        tier: a.tier,
        model: a.model,
        qualityMode: a.qualityMode,
        coverage: a.status === 'aligned_ok' ? a.quality.coverage : undefined,
        medianMs: a.status === 'aligned_ok' ? a.quality.medianMs : undefined,
        p95Ms: a.status === 'aligned_ok' ? a.quality.p95Ms : undefined,
      })),
  };
}

function trainingReportToMarkdown(report: TrainingEvalReport): string {
  // Start with the base report
  let md = reportToMarkdown(report);

  // Add alignment summary section
  const lines: string[] = [
    '',
    '## Alignment Summary',
    '',
    `- Total songs: ${report.alignmentSummary.totalSongs}`,
    `- Aligned: ${report.alignmentSummary.alignedCount}`,
    `- Skipped: ${report.alignmentSummary.skippedCount}`,
    `- Mean Downbeat F1: ${report.aggregate.meanDownbeatF1.toFixed(3)}`,
    `- Mean All-Beat F1: ${report.aggregate.meanAllBeatF1 !== undefined ? report.aggregate.meanAllBeatF1.toFixed(3) : 'n/a'}`,
    '',
  ];

  if (report.alignmentSummary.skippedSongs.length > 0) {
    lines.push('### Skipped Songs');
    lines.push('');
    lines.push('| Song | Reason | Detail |');
    lines.push('|------|--------|--------|');
    for (const s of report.alignmentSummary.skippedSongs) {
      lines.push(`| ${s.songId} | ${s.reason} | ${s.reasonDetail ?? ''} |`);
    }
    lines.push('');
  }

  if (report.perSongAlignment.length > 0) {
    lines.push('### Alignment Quality');
    lines.push('');
    lines.push('| Song | Status | Tier | Model | Quality Mode | Coverage | Median (ms) | P95 (ms) |');
    lines.push('|------|--------|------|-------|--------------|----------|-------------|----------|');
    for (const a of report.perSongAlignment) {
      const coverage = a.coverage !== undefined ? `${(a.coverage * 100).toFixed(0)}%` : '';
      const median = a.medianMs !== undefined ? a.medianMs.toFixed(0) : '';
      const p95 = a.p95Ms !== undefined ? a.p95Ms.toFixed(0) : '';
      lines.push(`| ${a.songId} | ${a.status} | ${a.tier} | ${a.model} | ${a.qualityMode} | ${coverage} | ${median} | ${p95} |`);
    }
    lines.push('');
  }

  md += lines.join('\n');
  return md;
}

// ============================================
// Main
// ============================================

async function main() {
  const args = process.argv.slice(2);
  const songFilter = args.includes('--song') ? args[args.indexOf('--song') + 1] : null;
  const reuseAnalysis = args.includes('--reuse-analysis');

  // Load manifest
  const manifestPath = path.join(TRAINING_DIR, 'manifest.json');
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  let songs: ManifestSong[] = manifest.songs;

  if (songFilter) {
    songs = songs.filter(s => s.id === songFilter);
    if (songs.length === 0) {
      console.error(`Song not found: ${songFilter}`);
      process.exit(1);
    }
  }

  fs.mkdirSync(EVAL_OUTPUT_DIR, { recursive: true });
  fs.mkdirSync(DOCS_DIR, { recursive: true });

  const results: SongEvalResult[] = [];
  const alignments: AlignmentArtifact[] = [];
  const skipped: Array<{ songId: string; reason: string; reasonDetail?: string }> = [];

  console.log(`Evaluating ${songs.length} songs from training set...\n`);

  for (const song of songs) {
    console.log(`=== ${song.artist} - ${song.title} (${song.id}) ===`);

    // Load alignment artifact
    const alignPath = path.join(ALIGNMENT_DIR, `${song.id}.json`);
    if (!fs.existsSync(alignPath)) {
      console.log(`  Skipping — no alignment artifact. Run align-training-set.ts first.`);
      skipped.push({ songId: song.id, reason: 'no_alignment_artifact' });
      console.log();
      continue;
    }

    const alignment: AlignmentArtifact = JSON.parse(fs.readFileSync(alignPath, 'utf8'));
    alignments.push(alignment);

    if (alignment.status !== 'aligned_ok') {
      console.log(`  Skipping — alignment status: ${alignment.status} (${alignment.reason})`);
      const parsed = parseReason(alignment.reason);
      skipped.push({
        songId: song.id,
        reason: parsed.reason ?? alignment.status,
        reasonDetail: alignment.reasonDetail ?? parsed.reasonDetail ?? undefined,
      });
      console.log();
      continue;
    }

    // Load aligned ground truth
    const alignedGtPath = path.join(ALIGNED_GT_DIR, `${song.id}.json`);
    if (!fs.existsSync(alignedGtPath)) {
      console.log(`  Skipping — no aligned ground truth`);
      skipped.push({ songId: song.id, reason: 'no_aligned_ground_truth' });
      console.log();
      continue;
    }

    const alignedGt: AlignedGroundTruth = JSON.parse(fs.readFileSync(alignedGtPath, 'utf8'));

    // Load or run analysis on YouTube audio
    const audioPath = path.join(AUDIO_DIR, `${song.id}.wav`);
    if (!fs.existsSync(audioPath)) {
      console.log(`  Skipping — audio file not found`);
      skipped.push({ songId: song.id, reason: 'audio_not_found' });
      console.log();
      continue;
    }

    const [num, den] = song.midiTimeSignature.split('/').map(Number);
    const analysisResult = await runAnalysis(song.id, audioPath, {
      tempoHint: song.midiTempo,
      timeSignatureHint: { numerator: num, denominator: den },
    }, reuseAnalysis);

    const allBeats = analysisResult.beatGrid.beats as BeatEvent[];
    const allChords = analysisResult.chords as ChordEvent[];

    // Filter analysis to aligned segment window (critical for Tier 2 / partial songs)
    const beats = filterBeatsToSegment(allBeats, alignment.segment);
    const chords = allChords.filter((c: ChordEvent) =>
      c.startTime >= alignment.segment.youtubeStart - 5 &&
      c.startTime <= alignment.segment.youtubeEnd + 5
    );

    // Remap bar numbers using time proximity to analysis downbeats.
    const anchors = alignedToBarAnchors(alignedGt, beats);
    const beatAnchorInfo = alignedToBeatAnchors(alignedGt);
    const labels = alignedToChordLabels(alignedGt);

    console.log(`  Beats: ${beats.length}/${allBeats.length} (in segment), Chords: ${chords.length}`);
    console.log(`  GT downbeats: ${anchors.length}, GT all-beat anchors: ${beatAnchorInfo.anchors.length}${beatAnchorInfo.approximate ? ' (approx)' : ''}`);
    console.log(`  Alignment: tier=${alignment.tier}, coverage=${(alignment.quality.coverage * 100).toFixed(0)}%, median=${alignment.quality.medianMs.toFixed(0)}ms`);
    console.log(`  Segment: yt ${alignment.segment.youtubeStart.toFixed(1)}-${alignment.segment.youtubeEnd.toFixed(1)}s`);

    const result = evaluateSong(
      song.id,
      `${song.artist} - ${song.title}`,
      beats,
      chords,
      anchors,
      labels,
      null, // no determinism snapshots
      {
        beatAnchors: beatAnchorInfo.anchors,
        allBeatApproximate: beatAnchorInfo.approximate,
      },
    );

    results.push(result);

    console.log(`  All-beat F1: ${result.beat.f1.toFixed(3)}${result.allBeatApproximate ? ' (approx)' : ''}`);
    console.log(`  Downbeat F1: ${result.downbeat.f1.toFixed(3)}`);
    console.log(`  Drift median: ${result.drift.medianMs.toFixed(1)}ms`);
    if (labels.length > 0) {
      console.log(`  Root accuracy: ${(result.chordAccuracy.rootAccuracy * 100).toFixed(1)}%`);
    }
    console.log();
  }

  if (results.length === 0) {
    console.log('No songs evaluated. Run align-training-set.ts first.');
    return;
  }

  // Generate report
  const report = generateTrainingReport(results, alignments, skipped);

  // Write JSON
  const jsonPath = path.join(EVAL_OUTPUT_DIR, 'training-eval.json');
  fs.writeFileSync(jsonPath, JSON.stringify(report, null, 2));
  console.log(`JSON report: ${jsonPath}`);

  // Write Markdown
  const today = new Date().toISOString().slice(0, 10);
  const mdPath = path.join(DOCS_DIR, `training-eval-${today}.md`);
  fs.writeFileSync(mdPath, trainingReportToMarkdown(report));
  console.log(`Markdown report: ${mdPath}`);

  // Summary
  console.log(`\n=== Evaluation Summary ===`);
  console.log(`Songs evaluated: ${results.length}`);
  console.log(`Songs skipped: ${skipped.length}`);
  console.log(`Mean All-beat F1: ${report.aggregate.meanAllBeatF1 !== undefined ? report.aggregate.meanAllBeatF1.toFixed(3) : 'n/a'}`);
  console.log(`Mean Downbeat F1: ${report.aggregate.meanDownbeatF1.toFixed(3)}`);
  console.log(`Mean Drift: ${report.aggregate.meanDriftMedianMs.toFixed(1)}ms`);
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
