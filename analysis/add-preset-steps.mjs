/**
 * One-time migration: reads cyclePresets.ts, computes IntervalStep[] for each
 * preset from exampleChords, and writes the updated file back.
 *
 * Run: node analysis/add-preset-steps.mjs
 */
import { readFileSync, writeFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));

// ---- Inline chord arithmetic (mirrors chordPathfinder logic) ----
const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
const FLAT_TO_SHARP = { Db: 'C#', Eb: 'D#', Fb: 'E', Gb: 'F#', Ab: 'G#', Bb: 'A#', Cb: 'B' };

function parseChord(name) {
  let root, suffix;
  if (name.length >= 2 && (name[1] === '#' || name[1] === 'b')) {
    root = name.slice(0, 2);
    suffix = name.slice(2);
  } else {
    root = name[0];
    suffix = name.slice(1);
  }
  const normRoot = FLAT_TO_SHARP[root] ?? root;
  const pc = NOTE_NAMES.indexOf(normRoot);
  let quality;
  if (suffix === 'm' || suffix === 'm7') quality = 'minor';
  else if (suffix === 'dim' || suffix === '°') quality = 'dim';
  else quality = 'major';
  return { pc, quality };
}

function computeSteps(exampleChords) {
  const chords = exampleChords.trim().split(/\s+/);
  return chords.slice(0, -1).map((fromName, i) => {
    const from = parseChord(fromName);
    const to = parseChord(chords[i + 1]);
    const semitones = (to.pc - from.pc + 12) % 12;
    const quality = from.quality === to.quality ? 'same' : to.quality;
    return { semitones, quality };
  });
}

// ---- Read and patch cyclePresets.ts ----
const filePath = join(__dirname, '..', 'src', 'core', 'cyclePresets.ts');
let src = readFileSync(filePath, 'utf8');

// Find each preset object and inject "steps" after "loop"
// Match: "loop": "...",
src = src.replace(/"loop": "([^"]+)",(\s*)"length":/g, (match, loop, ws, offset) => {
  // Find the exampleChords for this preset by looking ahead in the string
  const remainder = src.slice(offset + match.length);
  const ecMatch = remainder.match(/"exampleChords": "([^"]+)"/);
  if (!ecMatch) return match; // can't find it, leave alone

  const steps = computeSteps(ecMatch[1]);
  const stepsJson = JSON.stringify(steps);
  return `"loop": "${loop}",${ws}"steps": ${stepsJson},${ws}"length":`;
});

// Verify no preset was missed (every "loop" should now be followed by "steps")
const loopCount = (src.match(/"loop":/g) || []).length;
const stepsCount = (src.match(/"steps":/g) || []).length;
if (loopCount !== stepsCount) {
  console.error(`WARNING: ${loopCount} loops but only ${stepsCount} steps injected`);
  process.exit(1);
}

writeFileSync(filePath, src, 'utf8');
console.log(`Done. Injected steps into ${stepsCount} presets.`);
