/**
 * Verify interval step invariants for all cycle presets.
 * Run: npx tsx analysis/verify-steps.ts
 */
import { intervalCycleChords, intervalCycleDestination, getAllChordNames, transposeChord } from '../src/core/chordPathfinder';
import type { IntervalStep } from '../src/core/chordPathfinder';
import { CYCLE_PRESETS } from '../src/core/cyclePresets';
import { getChordDefinition, noteToPitchClass } from '../src/core/chordDefinitions';

const all = getAllChordNames();
const starts = [...all.major, ...all.minor, ...all.dim];

/** Determine which starting qualities this step sequence closes from. */
function closingQualitiesFor(steps: IntervalStep[]): Set<'major' | 'minor' | 'dim'> {
  const valid = new Set<'major' | 'minor' | 'dim'>();
  for (const startQ of ['major', 'minor', 'dim'] as const) {
    let q: 'major' | 'minor' | 'dim' = startQ;
    for (const step of steps) {
      q = step.quality === 'same' ? q : (step.quality as 'major' | 'minor' | 'dim');
    }
    if (q === startQ) valid.add(startQ);
  }
  return valid;
}

function normalizeQ(def: ReturnType<typeof getChordDefinition>): 'major' | 'minor' | 'dim' {
  const q = def.quality;
  if (q === 'minor' || q === 'min7') return 'minor';
  if (q === 'dim') return 'dim';
  return 'major';
}

let failures = 0;
let checksRun = 0;

for (const preset of CYCLE_PRESETS) {
  const closingQualities = closingQualitiesFor(preset.steps);

  for (const from of starts) {
    checksRun++;
    const def = getChordDefinition(from);
    const fromQ = normalizeQ(def);

    // Invariant 1: always produces exactly one destination (never throws, never null).
    const dest = intervalCycleDestination(from, preset.steps);
    if (!dest) {
      console.error(`FAIL no-dest: preset="${preset.loop}" from="${from}"`);
      failures++;
      continue;
    }

    // Invariant 2: for starting qualities where the cycle closes, verify it does.
    if (closingQualities.has(fromQ)) {
      const chords = intervalCycleChords(from, preset.steps);
      if (chords[0] !== chords[chords.length - 1]) {
        console.error(`FAIL cycle-close (should close): preset="${preset.loop}" from="${from}" → ${chords.join(' → ')}`);
        failures++;
      }
    }

    // Invariant 3: summing all semitones mod 12 must equal zero (root always returns).
    const sumSemitones = preset.steps.reduce((s, st) => s + st.semitones, 0);
    if (sumSemitones % 12 !== 0) {
      console.error(`FAIL root-doesnt-close: preset="${preset.loop}" sumSemitones=${sumSemitones}`);
      failures++;
    }
  }
}

if (failures === 0) {
  console.log(`✓ ${checksRun} checks across ${CYCLE_PRESETS.length} presets × ${starts.length} starting chords. All invariants pass.`);
} else {
  console.error(`${failures} failures out of ${checksRun} checks.`);
  process.exit(1);
}
