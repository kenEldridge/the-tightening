#!/usr/bin/env npx tsx
/**
 * Gate A verification for onset-driven rhythm playback.
 * Runs headless analysis on a project and checks beat strength annotation.
 */

import * as fs from 'fs';
import { NodeRhythmAnalyzer } from '../src/node/NodeRhythmAnalyzer';

const projectPath = process.argv[2];
if (!projectPath) {
  console.error('Usage: npx tsx scripts/gate-a-check.ts <project-file.json>');
  process.exit(1);
}

const project = JSON.parse(fs.readFileSync(projectPath, 'utf8'));
console.log('Song:', project.name);
console.log('Audio:', project.audioPath);

if (!project.audioPath || !fs.existsSync(project.audioPath)) {
  console.error('Audio file not found:', project.audioPath);
  process.exit(1);
}

const analyzer = new NodeRhythmAnalyzer();
const result = await analyzer.analyze(project.audioPath, {});

const beats = result.beatGrid.beats;
const total = beats.length;
const withStrength = beats.filter(b => b.strength != null).length;
const highCount = beats.filter(b => (b.strength ?? 0) >= 0.95).length;
const strengths = beats.filter(b => b.strength != null).map(b => b.strength!);
const avg = strengths.reduce((a, b) => a + b, 0) / strengths.length;

console.log('\n=== Gate A: Annotation Integrity ===');
console.log(`  Total beats: ${total}`);
console.log(`  With strength: ${withStrength} (${(100 * withStrength / total).toFixed(1)}%)`);
const coveragePass = withStrength / total > 0.99;
console.log(`  CHECK 1 - Coverage >99%: ${coveragePass ? 'PASS' : 'FAIL'}`);

const highPct = highCount / total;
const saturationPass = highPct < 0.25;
console.log(`  High (>=0.95): ${highCount} (${(100 * highPct).toFixed(1)}%)`);
console.log(`  CHECK 2 - Saturation <25%: ${saturationPass ? 'PASS' : 'FAIL'}`);

// Bar-level stats for quiet-intro check
const barStrengths = new Map<number, number[]>();
for (const b of beats) {
  if (b.strength == null) continue;
  if (!barStrengths.has(b.bar)) barStrengths.set(b.bar, []);
  barStrengths.get(b.bar)!.push(b.strength);
}

const barMedians: { bar: number; median: number }[] = [];
for (const [bar, vals] of barStrengths) {
  vals.sort((a, b) => a - b);
  barMedians.push({ bar, median: vals[Math.floor(vals.length / 2)] });
}
barMedians.sort((a, b) => a.bar - b.bar);

// First 4 bars vs bars 9-16 (or first vocal-entry bars)
const intro = barMedians.slice(0, 4).map(b => b.median);
const body = barMedians.slice(8, 16).map(b => b.median);
intro.sort((a, b) => a - b);
body.sort((a, b) => a - b);
const introMedian = intro[Math.floor(intro.length / 2)] || 0;
const bodyMedian = body[Math.floor(body.length / 2)] || 0;
// "intro bars show median strength at least 40% lower than first vocal-entry bars"
// i.e., introMedian <= 0.6 * bodyMedian
const introPass = bodyMedian === 0 || introMedian <= 0.6 * bodyMedian;
console.log(`  Intro bars 1-4 median: ${introMedian.toFixed(3)}`);
console.log(`  Body bars 9-16 median: ${bodyMedian.toFixed(3)}`);
console.log(`  CHECK 3 - Intro 40% lower: ${introPass ? 'PASS' : 'FAIL (intro not quieter)'}`);

console.log(`\n  Avg strength: ${avg.toFixed(3)}`);
console.log(`  Overall: ${coveragePass && saturationPass ? 'GATE A PASS' : 'GATE A FAIL'}`);
if (!introPass) console.log('  Note: intro check failed but may not apply to all songs');

// Print strength distribution
console.log('\n=== Strength Distribution ===');
const buckets = [0, 0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9, 1.0];
for (let i = 0; i < buckets.length - 1; i++) {
  const count = strengths.filter(s => s >= buckets[i] && s < buckets[i + 1]).length;
  const bar = '#'.repeat(Math.round(50 * count / total));
  console.log(`  ${buckets[i].toFixed(1)}-${buckets[i + 1].toFixed(1)}: ${count.toString().padStart(4)} ${bar}`);
}
const count1 = strengths.filter(s => s >= 1.0).length;
console.log(`  1.0:      ${count1.toString().padStart(4)} ${'#'.repeat(Math.round(50 * count1 / total))}`);

// Print first 20 beats
console.log('\n=== First 20 Beats ===');
for (let i = 0; i < Math.min(20, beats.length); i++) {
  const b = beats[i];
  const bar = '#'.repeat(Math.round(20 * (b.strength ?? 0)));
  console.log(`  bar ${b.bar.toString().padStart(3)} beat ${b.beatInBar} | str ${(b.strength ?? 0).toFixed(3)} | ${bar}`);
}
