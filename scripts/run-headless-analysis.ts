#!/usr/bin/env npx tsx
/**
 * Headless Analysis CLI
 *
 * Run rhythm analysis on a WAV file without the Electron app.
 *
 * Usage:
 *   npx tsx scripts/run-headless-analysis.ts <wav-path> [options]
 *
 * Options:
 *   --tempo <N>        Tempo hint in BPM
 *   --time-sig <3/4|4/4>  Time signature hint
 *   --key <D|Am|F#>    Key hint
 *   --out <path>       Output JSON path (default: stdout)
 */

import * as fs from 'fs';
import { NodeRhythmAnalyzer } from '../src/node/NodeRhythmAnalyzer';
import type { AnalysisOptions } from '../src/core/rhythmTypes';

const args = process.argv.slice(2);

if (args.length === 0 || args.includes('--help')) {
  console.log('Usage: npx tsx scripts/run-headless-analysis.ts <wav-path> [--tempo N] [--time-sig 3/4|4/4] [--key D] [--out path]');
  process.exit(0);
}

const wavPath = args[0];

function getFlag(name: string): string | undefined {
  const idx = args.indexOf(name);
  return idx >= 0 && idx + 1 < args.length ? args[idx + 1] : undefined;
}

const options: AnalysisOptions = {};

const tempoStr = getFlag('--tempo');
if (tempoStr) options.tempoHint = parseFloat(tempoStr);

const tsStr = getFlag('--time-sig');
if (tsStr) {
  const parts = tsStr.split('/');
  if (parts.length === 2) {
    options.timeSignatureHint = {
      numerator: parseInt(parts[0], 10),
      denominator: parseInt(parts[1], 10),
    };
  }
}

const keyStr = getFlag('--key');
if (keyStr) options.keyHint = keyStr;

const outPath = getFlag('--out');

async function main() {
  console.log(`Analyzing: ${wavPath}`);
  if (Object.keys(options).length > 0) {
    console.log('Options:', options);
  }

  const analyzer = new NodeRhythmAnalyzer();
  const result = await analyzer.analyze(wavPath, options);

  const json = JSON.stringify(result, null, 2);

  if (outPath) {
    fs.writeFileSync(outPath, json);
    console.log(`\nResult written to: ${outPath}`);
  } else {
    console.log('\n--- Result ---');
    console.log(json);
  }

  console.log(`\nSummary:`);
  console.log(`  Tempo: ${result.beatGrid.tempo} BPM`);
  console.log(`  Time sig: ${result.beatGrid.timeSignature.numerator}/${result.beatGrid.timeSignature.denominator}`);
  console.log(`  Bars: ${result.beatGrid.barCount}`);
  console.log(`  Beats: ${result.beatGrid.beats.length}`);
  console.log(`  Chords: ${result.chords.length}`);
  console.log(`  Unique chords: ${new Set(result.chords.map(c => c.symbol)).size}`);
  console.log(`  Analysis time: ${result.meta.durationMs.toFixed(0)}ms`);
}

main().catch(err => {
  console.error('Error:', err.message);
  process.exit(1);
});
