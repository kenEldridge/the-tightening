/**
 * Autonomous drummer pure-function tests.
 * Run with: node tests/drummer.test.mjs
 *
 * Replicates the pure DSP from src/core/pulseDetector.ts as plain JS
 * (no DOM/React/TS imports), matching the chord-walk.test.mjs convention.
 * If you change the TS, mirror the change here.
 */

let passed = 0;
let failed = 0;

function assert(condition, message) {
  if (condition) {
    passed++;
  } else {
    failed++;
    console.error(`  FAIL: ${message}`);
  }
}

function assertEq(actual, expected, message) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a === e) {
    passed++;
  } else {
    failed++;
    console.error(`  FAIL: ${message} — expected ${e}, got ${a}`);
  }
}

function assertClose(actual, expected, tol, message) {
  if (Math.abs(actual - expected) <= tol) {
    passed++;
  } else {
    failed++;
    console.error(`  FAIL: ${message} — expected ${expected} ±${tol}, got ${actual}`);
  }
}

function section(name) {
  console.log(`\n── ${name} ──`);
}

// ═══════════════════════════════════════════════════════════
// Replicated pure functions (matching src/core/pulseDetector.ts)
// ═══════════════════════════════════════════════════════════

const COLLAPSE_WINDOW_SEC = 0.04;
const HISTORY_SEC = 16;
const MAX_IOI_SEC = 2.0;
const MIN_ONSETS = 8;
const MIN_SPAN_SEC = 2.0;
const BPM_MIN = 70;
const BPM_MAX = 180;
const HIST_BIN_BPM = 2;
const RECENCY_TAU_SEC = 8;
const INTENSITY_WINDOW_SEC = 4;
const DENSITY_NORM = 12;

function recencyWeight(ageSec) {
  return Math.exp(-ageSec / RECENCY_TAU_SEC);
}

function addOnset(onsets, velocity, tSec) {
  const last = onsets[onsets.length - 1];
  if (last && tSec >= last.t && tSec - last.t <= COLLAPSE_WINDOW_SEC) {
    last.chordSize += 1;
    last.velocity = Math.max(last.velocity, velocity);
    return;
  }
  onsets.push({ t: tSec, velocity, chordSize: 1 });
}

function pruneOnsets(onsets, nowSec) {
  while (onsets.length > 0 && nowSec - onsets[0].t > HISTORY_SEC) {
    onsets.shift();
  }
}

function estimateTempo(onsets, nowSec) {
  const bins = new Map();
  let totalW = 0;

  for (let i = 1; i < onsets.length; i++) {
    const ioi = onsets[i].t - onsets[i - 1].t;
    if (ioi <= 0.001 || ioi > MAX_IOI_SEC) continue;
    const w0 = recencyWeight(nowSec - onsets[i].t);
    const base = 60 / ioi;
    for (let k = 1; k <= 4; k++) {
      const cands = k === 1 ? [base] : [base * k, base / k];
      for (const cand of cands) {
        if (cand < BPM_MIN || cand >= BPM_MAX) continue;
        const w = w0 / k;
        const bin = Math.round(cand / HIST_BIN_BPM);
        const entry = bins.get(bin) ?? { w: 0, bpmW: 0 };
        entry.w += w;
        entry.bpmW += cand * w;
        bins.set(bin, entry);
        totalW += w;
      }
    }
  }
  if (totalW <= 0) return null;

  let bestBin = 0;
  let bestScore = -1;
  for (const bin of bins.keys()) {
    let score = 0;
    for (let b = bin - 1; b <= bin + 1; b++) score += bins.get(b)?.w ?? 0;
    if (score > bestScore) {
      bestScore = score;
      bestBin = bin;
    }
  }
  let w = 0;
  let bpmW = 0;
  for (let b = bestBin - 1; b <= bestBin + 1; b++) {
    const entry = bins.get(b);
    if (entry) {
      w += entry.w;
      bpmW += entry.bpmW;
    }
  }
  if (w <= 0) return null;
  return { bpm: bpmW / w, tempoConfidence: bestScore / totalW };
}

function estimatePhase(onsets, periodSec, nowSec) {
  let sx = 0;
  let sy = 0;
  let sw = 0;
  for (const o of onsets) {
    const theta = 2 * Math.PI * (((o.t % periodSec) + periodSec) % periodSec) / periodSec;
    const w = recencyWeight(nowSec - o.t);
    sx += w * Math.cos(theta);
    sy += w * Math.sin(theta);
    sw += w;
  }
  if (sw <= 0) return { phaseSec: 0, R: 0 };
  const R = Math.sqrt(sx * sx + sy * sy) / sw;
  let ang = Math.atan2(sy, sx);
  if (ang < 0) ang += 2 * Math.PI;
  return { phaseSec: (ang / (2 * Math.PI)) * periodSec, R };
}

function computeIntensity(onsets, nowSec) {
  const recent = onsets.filter(o => nowSec - o.t <= INTENSITY_WINDOW_SEC);
  if (recent.length === 0) return 0;
  let velSum = 0;
  let chordSum = 0;
  for (const o of recent) {
    velSum += o.velocity;
    chordSum += o.chordSize;
  }
  const avgVel = velSum / recent.length / 127;
  const rate = recent.length / INTENSITY_WINDOW_SEC;
  const avgChord = chordSum / recent.length;
  const density = Math.min(1, (rate * avgChord) / DENSITY_NORM);
  return 0.6 * avgVel + 0.4 * density;
}

function perfMsToAudioTime(perfMs, clockOffset) {
  return perfMs / 1000 + clockOffset;
}

function nextBeatTime(nowSec, phaseSec, periodSec) {
  const n = Math.ceil((nowSec - phaseSec) / periodSec);
  let t = phaseSec + n * periodSec;
  if (t <= nowSec + 1e-9) t += periodSec;
  return t;
}

function phaseErrorSec(t, phaseSec, periodSec) {
  let r = (t - phaseSec) % periodSec;
  if (r < 0) r += periodSec;
  if (r > periodSec / 2) r -= periodSec;
  return r;
}

// Deterministic PRNG for the jitter test (mulberry32).
function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ═══════════════════════════════════════════════════════════
// Tests
// ═══════════════════════════════════════════════════════════

section('chord collapsing');
{
  const onsets = [];
  addOnset(onsets, 80, 1.000);
  addOnset(onsets, 95, 1.010);
  addOnset(onsets, 70, 1.030);
  assertEq(onsets.length, 1, 'three note-ons within 40ms collapse to one onset');
  assertEq(onsets[0].chordSize, 3, 'collapsed onset has chordSize 3');
  assertEq(onsets[0].velocity, 95, 'collapsed onset keeps max velocity');
  assertEq(onsets[0].t, 1.000, 'collapsed onset keeps the chord-start time');

  addOnset(onsets, 60, 1.100);
  assertEq(onsets.length, 2, 'a note-on past the window starts a new onset');

  // Anchor is the chord START: 65ms after start is a new onset even though
  // it is within 40ms of the previous merged note.
  const strum = [];
  addOnset(strum, 80, 2.000);
  addOnset(strum, 80, 2.030);
  addOnset(strum, 80, 2.065);
  assertEq(strum.length, 2, 'slow strum does not merge forever (anchored to chord start)');
}

section('pruning');
{
  const onsets = [];
  addOnset(onsets, 80, 0);
  addOnset(onsets, 80, 10);
  addOnset(onsets, 80, 20);
  pruneOnsets(onsets, 20);
  assertEq(onsets.length, 2, 'onsets older than HISTORY_SEC are pruned');
  assertEq(onsets[0].t, 10, 'oldest surviving onset is within the window');
}

section('tempo estimation — steady stream');
{
  // 120 BPM: onsets every 0.5s for 10s.
  const onsets = [];
  for (let k = 0; k <= 20; k++) addOnset(onsets, 90, k * 0.5);
  const now = 10.0;
  const tempo = estimateTempo(onsets, now);
  assert(tempo !== null, 'steady stream yields a tempo estimate');
  assertClose(tempo.bpm, 120, 2, 'steady 0.5s IOIs estimate ≈120 BPM');

  const phase = estimatePhase(onsets, 60 / tempo.bpm, now);
  assert(phase.R > 0.95, `steady stream has high phase confidence (R=${phase.R.toFixed(3)})`);
}

section('tempo estimation — octave folding');
{
  // Half-time feel: onsets every 1.0s (60 "BPM" raw, below BPM_MIN) must
  // fold into the window as 120 BPM.
  const onsets = [];
  for (let k = 0; k <= 10; k++) addOnset(onsets, 90, k * 1.0);
  const tempo = estimateTempo(onsets, 10.0);
  assert(tempo !== null, 'sub-window IOIs still yield an estimate');
  assertClose(tempo.bpm, 120, 2, '1.0s IOIs fold to ≈120 BPM');
}

section('phase confidence — jittered stream');
{
  // 120 BPM with heavy uniform jitter (±35% of the period): tempo may still
  // be found, but phase-lock confidence must fall below the following gate.
  const FOLLOW_CONFIDENCE = 0.6; // mirrors drummerEngine.ts
  const rand = mulberry32(42);
  const onsets = [];
  for (let k = 0; k <= 20; k++) {
    const jitter = (rand() * 2 - 1) * 0.35 * 0.5;
    addOnset(onsets, 90, k * 0.5 + jitter);
  }
  const phase = estimatePhase(onsets, 0.5, 10.0);
  assert(
    phase.R < FOLLOW_CONFIDENCE,
    `heavy jitter drops confidence below the following gate (R=${phase.R.toFixed(3)})`
  );
}

section('phase estimation — known offset');
{
  // Beats at t = 0.125 + k·0.5 → circular mean phase ≈ 0.125.
  const onsets = [];
  for (let k = 0; k < 20; k++) addOnset(onsets, 90, 0.125 + k * 0.5);
  const { phaseSec, R } = estimatePhase(onsets, 0.5, 10.0);
  assertClose(phaseSec, 0.125, 0.005, 'phase-shifted onsets recover the 0.125s offset');
  assert(R > 0.99, 'perfectly regular onsets give R ≈ 1');
}

section('intensity formula');
{
  // 8 onsets in the 4s window, avg velocity 100, avg chordSize 3:
  // rate = 2/s, density = min(1, 2·3/12) = 0.5
  // intensity = 0.6·(100/127) + 0.4·0.5 = 0.672441…
  const onsets = [];
  for (let k = 0; k < 8; k++) {
    onsets.push({ t: 6.5 + k * 0.5, velocity: 100, chordSize: 3 });
  }
  const got = computeIntensity(onsets, 10.0);
  assertClose(got, 0.6 * (100 / 127) + 0.4 * 0.5, 1e-9, 'intensity matches the documented formula');

  assertEq(computeIntensity([], 10.0), 0, 'no onsets → zero intensity');
  assertEq(
    computeIntensity([{ t: 1.0, velocity: 100, chordSize: 1 }], 10.0),
    0,
    'onsets outside the 4s window do not count'
  );
}

section('clock domain — perf-time onsets to audio-time beats');
{
  // AudioContext at 2.0s when performance.now() reads 1000ms:
  // clockOffset = 2.0 - 1.0 = 1.0.
  const clockOffset = 2.0 - 1000 / 1000;
  assertEq(perfMsToAudioTime(1500, clockOffset), 2.5, 'perf 1500ms converts to audio-time 2.5s');

  // Onsets every 0.5s starting at perf 1000ms, converted into audio-time.
  const onsets = [];
  for (let k = 0; k <= 16; k++) {
    addOnset(onsets, 90, perfMsToAudioTime(1000 + k * 500, clockOffset));
  }
  const now = perfMsToAudioTime(9000, clockOffset); // audio-time 9.0
  const tempo = estimateTempo(onsets, now);
  assertClose(tempo.bpm, 120, 2, 'converted onsets still estimate 120 BPM');
  const period = 60 / tempo.bpm;
  const { phaseSec } = estimatePhase(onsets, period, now);

  // Onsets sit at audio-times 2.0, 2.5, 3.0, … — grid phase ≈ 0 (mod 0.5).
  // The next scheduled downbeat after audio-time 9.01 must be ≈ 9.5.
  const beat = nextBeatTime(9.01, phaseSec, period);
  assertClose(beat, 9.5, 0.02, 'scheduled beat lands on the audio-clock grid, not the perf clock');
}

section('nextBeatTime / phaseErrorSec');
{
  assertClose(nextBeatTime(2.61, 0.125, 0.5), 2.625, 1e-9, 'next beat after 2.61 on a 0.125+k·0.5 grid is 2.625');
  assertClose(nextBeatTime(2.625, 0.125, 0.5), 3.125, 1e-9, 'a beat exactly at now advances to the next one');
  assertClose(phaseErrorSec(2.63, 0.125, 0.5), 0.005, 1e-9, 'slightly late → small positive error');
  assertClose(phaseErrorSec(2.62, 0.125, 0.5), -0.005, 1e-9, 'slightly early → small negative error');
  assertClose(phaseErrorSec(2.375, 0.125, 0.5), 0.25, 1e-9, 'half-period off maps to +period/2 (boundary)');
}

// ═══════════════════════════════════════════════════════════

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
