#!/usr/bin/env npx tsx
/**
 * Evaluation CLI
 *
 * Usage:
 *   npx tsx scripts/run-eval.ts                         # Evaluate from saved timelines
 *   npx tsx scripts/run-eval.ts --analyze               # Run fresh headless analysis, then evaluate
 *   npx tsx scripts/run-eval.ts --generate-ground-truth # Generate ground truth CSVs
 *   npx tsx scripts/run-eval.ts --snapshot <songId>     # Snapshot a run for determinism testing
 */

import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';
import type { PracticeProjectLite, ChordTimelineArtifact, AnalysisOptions, AnalysisResult } from '../src/core/rhythmTypes';
import type { BarAnchor, ChordLabel } from '../src/eval/evaluationTypes';
import { evaluateSong, runFullEvaluation } from '../src/eval/evaluationHarness';
import { parseBarAnchors, parseChordLabels, barAnchorsToCSV, chordLabelsToCSV } from '../src/eval/csvParser';
import { reportToJSON, reportToMarkdown } from '../src/eval/reportGenerator';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// ============================================
// Config
// ============================================

const PROJECTS_DIR = path.join(
  process.env.APPDATA || path.join(process.env.HOME || '', 'AppData', 'Roaming'),
  'the-tightening',
  'rhythm-projects'
);

const ROOT = path.resolve(__dirname, '..');
const GT_DIR = path.join(ROOT, 'ground-truth');
const EVAL_OUTPUT_DIR = path.join(ROOT, 'eval-output');
const DOCS_DIR = path.join(ROOT, 'docs');
const SNAPSHOT_DIR = path.join(GT_DIR, 'snapshots');

interface SongConfig {
  songId: string;
  songName: string;
  projectFile: string | null; // null = no project yet
  hints?: AnalysisOptions;
}

const SONG_MAP: SongConfig[] = [
  {
    songId: 'mull-of-kintyre',
    songName: 'Wings - Mull Of Kintyre',
    projectFile: 'proj_1772208360394_apk5ua.json',
    hints: { tempoHint: 92, timeSignatureHint: { numerator: 3, denominator: 4 }, keyHint: 'A' },
  },
  {
    songId: 'hey-jude',
    songName: 'Hey Jude - The Beatles',
    projectFile: 'proj_1772208499985_tjxzr9.json',
    hints: { tempoHint: 72, timeSignatureHint: { numerator: 4, denominator: 4 }, keyHint: 'F' },
  },
  {
    songId: 'canon-in-d',
    songName: 'Canon in D - Pachelbel',
    projectFile: 'proj_1772208577561_z4trq8.json',
    hints: { tempoHint: 54, timeSignatureHint: { numerator: 4, denominator: 4 }, keyHint: 'D' },
  },
];

// ============================================
// Ground Truth Generation
// ============================================

function generateHeyJudeGroundTruth(): { anchors: BarAnchor[]; labels: ChordLabel[] } {
  const bpm = 72;
  const beatsPerBar = 4;
  const barDuration = (60 / bpm) * beatsPerBar; // 3.333s

  const versePattern = [
    { chord: 'F', bars: 2 },
    { chord: 'C', bars: 1 },
    { chord: 'C7', bars: 1 },
    { chord: 'F', bars: 2 },
    { chord: 'Bb', bars: 1 },
    { chord: 'F', bars: 1 },
    { chord: 'C7', bars: 1 },
    { chord: 'F', bars: 1 },
  ];

  const outroPattern = [
    { chord: 'F', bars: 2 },
    { chord: 'Eb', bars: 2 },
    { chord: 'Bb', bars: 2 },
    { chord: 'F', bars: 2 },
  ];

  const labels: ChordLabel[] = [];
  const anchors: BarAnchor[] = [];
  let bar = 1;
  let time = 0;

  // 3 verses
  for (let v = 0; v < 3; v++) {
    for (const { chord, bars } of versePattern) {
      for (let b = 0; b < bars; b++) {
        labels.push({ bar, symbol: chord, source: 'midi' });
        anchors.push({ bar, timeSec: time, source: 'computed' });
        bar++;
        time += barDuration;
      }
    }
  }

  // 6 outro repeats
  for (let i = 0; i < 6; i++) {
    for (const { chord, bars } of outroPattern) {
      for (let b = 0; b < bars; b++) {
        labels.push({ bar, symbol: chord, source: 'midi' });
        anchors.push({ bar, timeSec: time, source: 'computed' });
        bar++;
        time += barDuration;
      }
    }
  }

  return { anchors, labels };
}

function generateCanonInDGroundTruth(): { anchors: BarAnchor[]; labels: ChordLabel[] } {
  const bpm = 54;
  const beatsPerChord = 2;
  const secondsPerBeat = 60 / bpm;
  const chordDuration = beatsPerChord * secondsPerBeat; // 2.222s
  // At 4/4, 2 beats per chord → 2 chords per bar, barDuration = 4.444s
  // But the plan says "one chord per bar" — treat each chord as its own bar
  const barDuration = chordDuration;
  const progression = ['D', 'A', 'Bm', 'F#m', 'G', 'D', 'G', 'A'];
  const totalDuration = 180;

  const labels: ChordLabel[] = [];
  const anchors: BarAnchor[] = [];
  let bar = 1;
  let time = 0;
  let idx = 0;

  while (time < totalDuration) {
    labels.push({ bar, symbol: progression[idx % progression.length], source: 'midi' });
    anchors.push({ bar, timeSec: time, source: 'computed' });
    bar++;
    time += barDuration;
    idx++;
  }

  return { anchors, labels };
}

function generateMullOfKintyreAnchors(): BarAnchor[] {
  // 92.3 BPM, 3/4 time → barDuration = 3 beats * (60/92.3)s ≈ 1.9502s
  const bpm = 92.3;
  const beatsPerBar = 3;
  const barDuration = (60 / bpm) * beatsPerBar;
  const barCount = 146;

  const anchors: BarAnchor[] = [];
  for (let bar = 1; bar <= barCount; bar++) {
    anchors.push({
      bar,
      timeSec: (bar - 1) * barDuration,
      source: 'computed',
    });
  }
  return anchors;
}

function generateGroundTruth(): void {
  fs.mkdirSync(GT_DIR, { recursive: true });

  // Hey Jude
  const heyJude = generateHeyJudeGroundTruth();

  // Canon in D
  const canon = generateCanonInDGroundTruth();

  // Mull of Kintyre — anchors only (no MIDI chord data)
  const mullAnchors = generateMullOfKintyreAnchors();

  // Merge all anchors
  const allAnchors = [
    ...tagSong(heyJude.anchors, 'hey-jude'),
    ...tagSong(canon.anchors, 'canon-in-d'),
    ...tagSong(mullAnchors, 'mull-of-kintyre'),
  ];

  // Merge all chord labels
  const allLabels = [
    ...tagSongLabels(heyJude.labels, 'hey-jude'),
    ...tagSongLabels(canon.labels, 'canon-in-d'),
    // No chord labels for Mull of Kintyre yet
  ];

  // Write CSVs with songId column
  const anchorHeader = ['songId', 'bar', 'timeSec', 'source'];
  const anchorRows = allAnchors.map(a =>
    [a.songId, String(a.bar), a.timeSec.toFixed(4), a.source]
  );
  fs.writeFileSync(
    path.join(GT_DIR, 'bar_anchors.csv'),
    [anchorHeader, ...anchorRows].map(r => r.join(',')).join('\n') + '\n'
  );

  const labelHeader = ['songId', 'bar', 'symbol', 'source'];
  const labelRows = allLabels.map(l =>
    [l.songId, String(l.bar), l.symbol, l.source]
  );
  fs.writeFileSync(
    path.join(GT_DIR, 'chord_labels.csv'),
    [labelHeader, ...labelRows].map(r => r.join(',')).join('\n') + '\n'
  );

  console.log(`Generated bar_anchors.csv: ${allAnchors.length} anchors`);
  console.log(`Generated chord_labels.csv: ${allLabels.length} labels`);
}

function tagSong(anchors: BarAnchor[], songId: string) {
  return anchors.map(a => ({ ...a, songId }));
}

function tagSongLabels(labels: ChordLabel[], songId: string) {
  return labels.map(l => ({ ...l, songId }));
}

// ============================================
// CSV Reading (with songId column)
// ============================================

function readAnchorsForSong(songId: string): BarAnchor[] {
  const csvPath = path.join(GT_DIR, 'bar_anchors.csv');
  if (!fs.existsSync(csvPath)) return [];
  const text = fs.readFileSync(csvPath, 'utf8');
  const lines = text.trim().split('\n');
  return lines.slice(1)
    .map(line => line.split(',').map(c => c.trim()))
    .filter(cols => cols[0] === songId)
    .map(([, bar, timeSec, source]) => ({
      bar: parseInt(bar, 10),
      timeSec: parseFloat(timeSec),
      source: (source || 'computed') as 'computed' | 'ear',
    }));
}

function readLabelsForSong(songId: string): ChordLabel[] {
  const csvPath = path.join(GT_DIR, 'chord_labels.csv');
  if (!fs.existsSync(csvPath)) return [];
  const text = fs.readFileSync(csvPath, 'utf8');
  const lines = text.trim().split('\n');
  return lines.slice(1)
    .map(line => line.split(',').map(c => c.trim()))
    .filter(cols => cols[0] === songId)
    .map(([, bar, symbol, source]) => ({
      bar: parseInt(bar, 10),
      symbol,
      source: (source || 'computed') as 'midi' | 'manual' | 'computed',
    }));
}

// ============================================
// Project Loading
// ============================================

function loadProject(filename: string): PracticeProjectLite | null {
  const projPath = path.join(PROJECTS_DIR, filename);
  if (!fs.existsSync(projPath)) {
    console.warn(`Project file not found: ${projPath}`);
    return null;
  }
  return JSON.parse(fs.readFileSync(projPath, 'utf8'));
}

// ============================================
// Snapshot
// ============================================

function snapshotRun(songId: string): void {
  const config = SONG_MAP.find(s => s.songId === songId);
  if (!config || !config.projectFile) {
    console.error(`No project file configured for song: ${songId}`);
    process.exit(1);
  }

  const project = loadProject(config.projectFile);
  if (!project?.timeline) {
    console.error(`Project has no timeline: ${config.projectFile}`);
    process.exit(1);
  }

  fs.mkdirSync(SNAPSHOT_DIR, { recursive: true });

  // Find next run number
  const existing = fs.readdirSync(SNAPSHOT_DIR).filter(f => f.startsWith(`${songId}_run_`));
  const nextNum = existing.length + 1;
  const filename = `${songId}_run_${String(nextNum).padStart(3, '0')}.json`;

  fs.writeFileSync(
    path.join(SNAPSHOT_DIR, filename),
    JSON.stringify(project.timeline, null, 2)
  );
  console.log(`Saved snapshot: ${filename}`);
}

// ============================================
// Load Snapshots for Determinism
// ============================================

function loadSnapshots(songId: string): ChordTimelineArtifact[] {
  if (!fs.existsSync(SNAPSHOT_DIR)) return [];
  const files = fs.readdirSync(SNAPSHOT_DIR).filter(f => f.startsWith(`${songId}_run_`));
  return files.map(f =>
    JSON.parse(fs.readFileSync(path.join(SNAPSHOT_DIR, f), 'utf8'))
  );
}

// ============================================
// Headless Analysis
// ============================================

async function runHeadlessAnalysis(config: SongConfig): Promise<AnalysisResult | null> {
  if (!config.projectFile) {
    console.log(`  Skipping headless — no project file`);
    return null;
  }

  const project = loadProject(config.projectFile);
  if (!project?.audioPath) {
    console.log(`  Skipping headless — no audio path in project`);
    return null;
  }

  if (!fs.existsSync(project.audioPath)) {
    console.log(`  Skipping headless — audio file not found: ${project.audioPath}`);
    return null;
  }

  // Lazy import to avoid loading Node adapter when not needed
  const { NodeRhythmAnalyzer } = await import('../src/node/NodeRhythmAnalyzer');
  const analyzer = new NodeRhythmAnalyzer();
  return analyzer.analyze(project.audioPath, config.hints || {});
}

// ============================================
// Main Evaluation
// ============================================

async function runEval(useHeadless: boolean): Promise<void> {
  fs.mkdirSync(EVAL_OUTPUT_DIR, { recursive: true });
  fs.mkdirSync(DOCS_DIR, { recursive: true });

  if (useHeadless) {
    console.log('Mode: fresh headless analysis');
  } else {
    console.log('Mode: saved timelines');
  }

  const results = [];

  for (const config of SONG_MAP) {
    console.log(`\nEvaluating: ${config.songName}`);

    // Load ground truth
    const anchors = readAnchorsForSong(config.songId);
    const labels = readLabelsForSong(config.songId);

    if (anchors.length === 0) {
      console.log(`  Skipping — no bar anchors found`);
      continue;
    }

    let beats;
    let chords;

    if (useHeadless) {
      // Fresh headless analysis
      const analysisResult = await runHeadlessAnalysis(config);
      if (!analysisResult) continue;
      beats = analysisResult.beatGrid.beats;
      chords = analysisResult.chords;
    } else {
      // Saved timeline
      if (!config.projectFile) {
        console.log(`  Skipping — no project file (song not yet analyzed)`);
        continue;
      }

      const project = loadProject(config.projectFile);
      if (!project?.timeline) {
        console.log(`  Skipping — project has no timeline`);
        continue;
      }

      beats = project.timeline.beatGrid.beats;
      chords = project.timeline.chords;
    }

    const snapshots = loadSnapshots(config.songId);

    console.log(`  Beats: ${beats.length}, Chords: ${chords.length}`);
    console.log(`  GT anchors: ${anchors.length}, GT labels: ${labels.length}`);
    console.log(`  Snapshots for determinism: ${snapshots.length}`);

    const result = evaluateSong(
      config.songId,
      config.songName,
      beats,
      chords,
      anchors,
      labels,
      snapshots.length >= 2 ? snapshots : null
    );

    results.push(result);

    console.log(`  Beat F1: ${result.beat.f1.toFixed(3)}`);
    console.log(`  Downbeat F1: ${result.downbeat.f1.toFixed(3)}`);
    console.log(`  Drift median: ${result.drift.medianMs.toFixed(1)}ms`);
    if (labels.length > 0) {
      console.log(`  Root accuracy: ${(result.chordAccuracy.rootAccuracy * 100).toFixed(1)}%`);
      console.log(`  Full accuracy: ${(result.chordAccuracy.fullAccuracy * 100).toFixed(1)}%`);
      console.log(`  False changes /32: ${result.falseChordChange.per32Bars.toFixed(1)}`);
    }
  }

  if (results.length === 0) {
    console.log('\nNo songs evaluated. Run --generate-ground-truth first.');
    return;
  }

  const report = runFullEvaluation(results);

  // Write JSON
  const jsonPath = path.join(EVAL_OUTPUT_DIR, 'baseline.json');
  fs.writeFileSync(jsonPath, reportToJSON(report));
  console.log(`\nJSON report: ${jsonPath}`);

  // Write Markdown
  const mdContent = reportToMarkdown(report);
  const mdPath = path.join(DOCS_DIR, 'rhythm-baseline-metrics-2026-02-27.md');
  fs.writeFileSync(mdPath, mdContent);
  console.log(`Markdown report: ${mdPath}`);
}

// ============================================
// CLI
// ============================================

const args = process.argv.slice(2);

if (args.includes('--generate-ground-truth')) {
  generateGroundTruth();
} else if (args.includes('--snapshot')) {
  const idx = args.indexOf('--snapshot');
  const songId = args[idx + 1];
  if (!songId) {
    console.error('Usage: --snapshot <songId>');
    process.exit(1);
  }
  snapshotRun(songId);
} else {
  const useHeadless = args.includes('--analyze');
  runEval(useHeadless).catch(err => {
    console.error('Evaluation failed:', err);
    process.exit(1);
  });
}
