#!/usr/bin/env npx tsx
/**
 * On-Demand Song Alignment + Evaluation
 *
 * Runs the full per-song pipeline:
 *   1) Build/refresh MIDI ground truth
 *   2) Align MIDI to audio timeline
 *   3) Evaluate analyzer against aligned ground truth
 *
 * Usage:
 *   npx tsx scripts/run-on-demand-alignment.ts --song <id>
 *   npx tsx scripts/run-on-demand-alignment.ts --song <id> --download
 *   npx tsx scripts/run-on-demand-alignment.ts --song <id> --reuse-analysis
 *   npx tsx scripts/run-on-demand-alignment.ts --song <id> --tier1-only
 */

import { spawnSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = path.resolve(__dirname, '..');

interface CliFlags {
  songId: string;
  download: boolean;
  reuseAnalysis: boolean;
  tier1Only: boolean;
}

function parseArgs(argv: string[]): CliFlags {
  const songIdx = argv.indexOf('--song');
  const songId = songIdx >= 0 ? argv[songIdx + 1] : undefined;

  if (!songId || songId.startsWith('--')) {
    console.error('Usage: npx tsx scripts/run-on-demand-alignment.ts --song <id> [--download] [--reuse-analysis] [--tier1-only]');
    process.exit(1);
  }

  return {
    songId,
    download: argv.includes('--download'),
    reuseAnalysis: argv.includes('--reuse-analysis'),
    tier1Only: argv.includes('--tier1-only'),
  };
}

function runStep(label: string, command: string, args: string[]) {
  console.log(`\n[on-demand] ${label}`);
  console.log(`[on-demand] > ${command} ${args.join(' ')}`);
  const result = process.platform === 'win32'
    ? spawnSync('cmd.exe', ['/d', '/s', '/c', command, ...args], {
      cwd: ROOT,
      stdio: 'inherit',
      windowsHide: true,
    })
    : spawnSync(command, args, {
      cwd: ROOT,
      stdio: 'inherit',
      windowsHide: true,
    });
  if (result.error) {
    console.error(`[on-demand] FAILED: ${label}`);
    console.error(`[on-demand] ${result.error.message}`);
    process.exit(1);
  }
  if (result.status !== 0) {
    console.error(`[on-demand] FAILED: ${label}`);
    process.exit(result.status ?? 1);
  }
}

function assertManifestHasSong(songId: string): void {
  const manifestPath = path.join(ROOT, 'training-data', 'manifest.json');
  if (!fs.existsSync(manifestPath)) {
    console.error(`[on-demand] Missing manifest: ${manifestPath}`);
    process.exit(1);
  }
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8')) as { songs?: Array<{ id?: string }> };
  const hasSong = Array.isArray(manifest.songs) && manifest.songs.some(s => s.id === songId);
  if (!hasSong) {
    console.error(`[on-demand] Song not found in manifest: ${songId}`);
    process.exit(1);
  }
}

function main() {
  const flags = parseArgs(process.argv.slice(2));
  assertManifestHasSong(flags.songId);

  const buildArgs = ['tsx', 'scripts/build-training-set.ts', '--song', flags.songId];
  if (flags.download) buildArgs.push('--download');

  const alignArgs = ['tsx', 'scripts/align-training-set.ts', '--song', flags.songId];
  if (flags.tier1Only) alignArgs.push('--tier1-only');

  const evalArgs = ['tsx', 'scripts/run-training-eval.ts', '--song', flags.songId];
  if (flags.reuseAnalysis) evalArgs.push('--reuse-analysis');

  const npxCmd = 'npx';
  runStep('Build ground truth', npxCmd, buildArgs);
  runStep('Align song', npxCmd, alignArgs);
  runStep('Evaluate song', npxCmd, evalArgs);

  const alignPath = path.join(ROOT, 'training-data', 'alignment', `${flags.songId}.json`);
  const alignedGtPath = path.join(ROOT, 'training-data', 'aligned-ground-truth', `${flags.songId}.json`);
  console.log('\n[on-demand] Completed.');
  console.log(`[on-demand] Alignment artifact: ${alignPath}`);
  console.log(`[on-demand] Aligned ground truth: ${alignedGtPath}`);
  console.log(`[on-demand] Eval report JSON: ${path.join(ROOT, 'eval-output', 'training-eval.json')}`);
}

main();
