#!/usr/bin/env npx tsx
/**
 * Build Training Set
 *
 * Extracts ground truth from MIDI files and generates evaluation-ready CSVs.
 * Optionally downloads YouTube audio and runs headless analysis for comparison.
 *
 * Usage:
 *   npx tsx scripts/build-training-set.ts                    # Extract MIDI ground truth only
 *   npx tsx scripts/build-training-set.ts --download         # Also download YouTube audio
 *   npx tsx scripts/build-training-set.ts --analyze          # Download + run headless analysis
 *   npx tsx scripts/build-training-set.ts --song <id>        # Process single song
 */

import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';
import ToneMidi from '@tonejs/midi';
const { Midi } = ToneMidi as any;
import { execSync } from 'child_process';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = path.resolve(__dirname, '..');

interface ManifestSong {
  id: string;
  artist: string;
  title: string;
  midiFile: string;
  midiTempo: number;
  midiTimeSignature: string;
  youtubeUrl: string;
  notes: string;
}

interface MidiGroundTruth {
  id: string;
  artist: string;
  title: string;
  tempo: number;
  tempoChanges: Array<{ time: number; bpm: number }>;
  timeSignature: { numerator: number; denominator: number };
  timeSignatureChanges: Array<{ time: number; numerator: number; denominator: number }>;
  duration: number;
  key: string;
  barAnchors: Array<{ bar: number; time: number }>;
  beats: Array<{ bar: number; beat: number; time: number }>;
  trackCount: number;
  totalNotes: number;
  melodyTrackIndex: number;
  melodyNotes: Array<{ midi: number; time: number; duration: number; velocity: number; name: string }>;
}

const TRAINING_DIR = path.join(ROOT, 'training-data');
const AUDIO_DIR = path.join(TRAINING_DIR, 'audio');
const GT_DIR = path.join(TRAINING_DIR, 'ground-truth');

// ============================================
// MIDI Ground Truth Extraction
// ============================================

function extractGroundTruth(song: ManifestSong): MidiGroundTruth {
  const midiPath = path.resolve(ROOT, song.midiFile);
  if (!fs.existsSync(midiPath)) {
    throw new Error(`MIDI file not found: ${midiPath}`);
  }

  const buf = fs.readFileSync(midiPath);
  const midi = new Midi(buf);

  // Tempo
  const tempoChanges = midi.header.tempos.map(t => ({
    time: t.ticks / midi.header.ppq * (60 / (midi.header.tempos[0]?.bpm || 120)),
    bpm: Math.round(t.bpm * 10) / 10,
  }));
  const primaryTempo = tempoChanges.length > 0 ? tempoChanges[0].bpm : 120;

  // Time signature
  const tsChanges = midi.header.timeSignatures.map(ts => ({
    time: 0, // approximate
    numerator: ts.timeSignature[0],
    denominator: ts.timeSignature[1],
  }));
  const primaryTs = tsChanges.length > 0
    ? { numerator: tsChanges[0].numerator, denominator: tsChanges[0].denominator }
    : { numerator: 4, denominator: 4 };

  // Find melody track (most notes, excluding drums on channel 9)
  let melodyTrackIndex = 0;
  let melodyNoteCount = 0;
  for (let i = 0; i < midi.tracks.length; i++) {
    const track = midi.tracks[i];
    // Skip drum tracks (channel 9 = index 9, 0-based)
    if (track.channel === 9) continue;
    if (track.notes.length > melodyNoteCount) {
      melodyNoteCount = track.notes.length;
      melodyTrackIndex = i;
    }
  }

  const melodyTrack = midi.tracks[melodyTrackIndex];
  const melodyNotes = melodyTrack.notes.map(n => ({
    midi: n.midi,
    time: n.time,
    duration: n.duration,
    velocity: n.velocity,
    name: n.name,
  }));

  // Normalize unusual time signatures to standard ones
  // 16/16 → 4/4, 2/4 stays as-is, etc.
  const normalizedTs = { ...primaryTs };
  if (normalizedTs.numerator > 8 && normalizedTs.denominator > 4) {
    // e.g., 16/16 → 4/4 (divide both by 4)
    const factor = normalizedTs.numerator / 4;
    normalizedTs.numerator = 4;
    normalizedTs.denominator = Math.round(normalizedTs.denominator / factor);
  }

  // Build beat grid from MIDI timing (exact ground truth)
  // beatDuration = one quarter note at the given tempo
  const quarterNoteDuration = 60 / primaryTempo;
  // Scale beat duration by denominator: 4 = quarter, 8 = eighth, etc.
  const beatDuration = quarterNoteDuration * (4 / normalizedTs.denominator);
  const barDuration = beatDuration * normalizedTs.numerator;
  const duration = midi.duration;

  const beats: Array<{ bar: number; beat: number; time: number }> = [];
  const barAnchors: Array<{ bar: number; time: number }> = [];

  let bar = 1;
  let beat = 1;
  for (let time = 0; time < duration; time += beatDuration) {
    beats.push({ bar, beat, time: Math.round(time * 1000) / 1000 });
    if (beat === 1) {
      barAnchors.push({ bar, time: Math.round(time * 1000) / 1000 });
    }
    beat++;
    if (beat > normalizedTs.numerator) {
      beat = 1;
      bar++;
    }
  }

  // Detect key from note distribution (simple heuristic)
  const pitchClassCounts = new Array(12).fill(0);
  for (const n of melodyNotes) {
    pitchClassCounts[n.midi % 12] += n.duration;
  }
  const noteNames = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
  const maxPc = pitchClassCounts.indexOf(Math.max(...pitchClassCounts));
  const key = noteNames[maxPc];

  return {
    id: song.id,
    artist: song.artist,
    title: song.title,
    tempo: primaryTempo,
    tempoChanges,
    timeSignature: normalizedTs,
    timeSignatureChanges: tsChanges,
    duration,
    key,
    barAnchors,
    beats,
    trackCount: midi.tracks.length,
    totalNotes: midi.tracks.reduce((s, t) => s + t.notes.length, 0),
    melodyTrackIndex,
    melodyNotes,
  };
}

// ============================================
// CSV Export (compatible with eval harness)
// ============================================

function exportBarAnchorsCSV(gt: MidiGroundTruth): string {
  const lines = ['songId,bar,time'];
  for (const a of gt.barAnchors) {
    lines.push(`${gt.id},${a.bar},${a.time}`);
  }
  return lines.join('\n') + '\n';
}

function exportBeatsCSV(gt: MidiGroundTruth): string {
  const lines = ['songId,bar,beat,time'];
  for (const b of gt.beats) {
    lines.push(`${gt.id},${b.bar},${b.beat},${b.time}`);
  }
  return lines.join('\n') + '\n';
}

function exportMelodyCSV(gt: MidiGroundTruth): string {
  const lines = ['songId,time,midi,name,duration,velocity'];
  for (const n of gt.melodyNotes) {
    lines.push(`${gt.id},${n.time.toFixed(3)},${n.midi},${n.name},${n.duration.toFixed(3)},${n.velocity.toFixed(3)}`);
  }
  return lines.join('\n') + '\n';
}

// ============================================
// YouTube Audio Download
// ============================================

function normalizeAudio(inputPath: string): boolean {
  const dir = path.dirname(inputPath);
  const ext = path.extname(inputPath);
  const base = path.basename(inputPath, ext);
  const tmpPath = path.join(dir, `${base}_raw${ext}`);

  try {
    // Rename original to _raw, normalize to original name
    fs.renameSync(inputPath, tmpPath);
    const cmd = `ffmpeg -y -i "${tmpPath}" -ac 1 -ar 44100 -sample_fmt s16 "${inputPath}"`;
    execSync(cmd, { stdio: 'pipe', timeout: 60000 });
    if (fs.existsSync(inputPath)) {
      fs.unlinkSync(tmpPath);
      console.log(`    Normalized: mono 44100Hz 16-bit`);
      return true;
    }
    // ffmpeg failed, restore original
    fs.renameSync(tmpPath, inputPath);
    return false;
  } catch (err) {
    console.error(`    Normalization failed:`, (err as Error).message?.substring(0, 100));
    // Restore original if tmp exists
    if (fs.existsSync(tmpPath) && !fs.existsSync(inputPath)) {
      fs.renameSync(tmpPath, inputPath);
    }
    return false;
  }
}

function downloadYouTubeAudio(url: string, outputPath: string): boolean {
  if (!url) return false;
  if (fs.existsSync(outputPath)) {
    console.log(`    Audio already downloaded: ${path.basename(outputPath)}`);
    return true;
  }

  try {
    console.log(`    Downloading audio from YouTube...`);
    const cmd = `python -m yt_dlp -x --audio-format wav --audio-quality 0 -o "${outputPath}" "${url}"`;
    execSync(cmd, { stdio: 'pipe', timeout: 120000 });
    if (!fs.existsSync(outputPath)) return false;

    // Normalize to mono 44100Hz 16-bit PCM
    normalizeAudio(outputPath);
    return true;
  } catch (err) {
    console.error(`    Download failed:`, (err as Error).message?.substring(0, 100));
    return false;
  }
}

// ============================================
// Headless Analysis
// ============================================

async function runAnalysis(audioPath: string, hints: { tempoHint?: number; timeSignatureHint?: { numerator: number; denominator: number }; keyHint?: string }) {
  const { NodeRhythmAnalyzer } = await import('../src/node/NodeRhythmAnalyzer');
  const analyzer = new NodeRhythmAnalyzer();
  return analyzer.analyze(audioPath, hints);
}

// ============================================
// Main
// ============================================

async function main() {
  const args = process.argv.slice(2);
  const doDownload = args.includes('--download') || args.includes('--analyze');
  const doAnalyze = args.includes('--analyze');
  const songFilter = args.includes('--song') ? args[args.indexOf('--song') + 1] : null;

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

  // Ensure directories exist
  fs.mkdirSync(AUDIO_DIR, { recursive: true });
  fs.mkdirSync(GT_DIR, { recursive: true });

  // Aggregate CSV files
  let allBarAnchors = 'songId,bar,time\n';
  let allBeats = 'songId,bar,beat,time\n';

  console.log(`Processing ${songs.length} songs...\n`);

  for (const song of songs) {
    console.log(`=== ${song.artist} - ${song.title} (${song.id}) ===`);

    // 1. Extract MIDI ground truth
    try {
      const gt = extractGroundTruth(song);
      console.log(`  MIDI: ${gt.tempo} BPM, ${gt.timeSignature.numerator}/${gt.timeSignature.denominator}, ${gt.duration.toFixed(0)}s, key=${gt.key}`);
      console.log(`  Beats: ${gt.beats.length}, Bars: ${gt.barAnchors.length}, Melody notes: ${gt.melodyNotes.length}`);

      // Save per-song ground truth
      const gtPath = path.join(GT_DIR, `${song.id}.json`);
      fs.writeFileSync(gtPath, JSON.stringify(gt, null, 2));

      // Save per-song CSVs
      fs.writeFileSync(path.join(GT_DIR, `${song.id}_bar_anchors.csv`), exportBarAnchorsCSV(gt));
      fs.writeFileSync(path.join(GT_DIR, `${song.id}_beats.csv`), exportBeatsCSV(gt));
      fs.writeFileSync(path.join(GT_DIR, `${song.id}_melody.csv`), exportMelodyCSV(gt));

      // Append to aggregate CSVs (skip header)
      const anchorsLines = exportBarAnchorsCSV(gt).split('\n').slice(1).join('\n');
      const beatsLines = exportBeatsCSV(gt).split('\n').slice(1).join('\n');
      allBarAnchors += anchorsLines;
      allBeats += beatsLines;

      // 2. Download YouTube audio
      if (doDownload && song.youtubeUrl) {
        const audioPath = path.join(AUDIO_DIR, `${song.id}.wav`);
        const ok = downloadYouTubeAudio(song.youtubeUrl, audioPath);
        if (ok) console.log(`  Audio: ${audioPath}`);
      } else if (doDownload && !song.youtubeUrl) {
        console.log(`  Skipping download — no YouTube URL`);
      }

      // 3. Run headless analysis
      if (doAnalyze && song.youtubeUrl) {
        const audioPath = path.join(AUDIO_DIR, `${song.id}.wav`);
        if (fs.existsSync(audioPath)) {
          console.log(`  Running headless analysis...`);
          const [num, den] = song.midiTimeSignature.split('/').map(Number);
          const result = await runAnalysis(audioPath, {
            tempoHint: gt.tempo,
            timeSignatureHint: { numerator: num, denominator: den },
            keyHint: gt.key,
          });
          const analysisPath = path.join(GT_DIR, `${song.id}_analysis.json`);
          fs.writeFileSync(analysisPath, JSON.stringify({
            beatGrid: result.beatGrid,
            chordCount: result.chords.length,
            chords: result.chords.map(c => ({ symbol: c.symbol, barStart: c.barStart, barEnd: c.barEnd, confidence: c.confidence })),
            meta: result.meta,
          }, null, 2));
          console.log(`  Analysis: ${result.beatGrid.tempo} BPM, ${result.beatGrid.barCount} bars, ${result.chords.length} chords`);
        } else {
          console.log(`  Skipping analysis — no audio file`);
        }
      }
    } catch (err) {
      console.error(`  ERROR: ${(err as Error).message}`);
    }

    console.log();
  }

  // Write aggregate CSVs
  fs.writeFileSync(path.join(GT_DIR, 'all_bar_anchors.csv'), allBarAnchors);
  fs.writeFileSync(path.join(GT_DIR, 'all_beats.csv'), allBeats);

  console.log(`Ground truth written to: ${GT_DIR}`);
  console.log(`Songs processed: ${songs.length}`);
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
