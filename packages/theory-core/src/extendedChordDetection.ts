import { NOTE_NAMES, NOTE_NAMES_FLAT, respellChordName, getChordDefinition } from './chordDefinitions';
import type { EdgeType } from './chordPathfinder';
import type { NoteSpelling } from './chordDefinitions';

export interface HintEdge {
  from: string;        // chord name in 36-node graph (e.g. "C", "Cm")
  to: string;          // chord name in 36-node graph (e.g. "F")
  edgeType: EdgeType;
  label: string;       // tooltip text
}

export interface ExtendedMatch {
  displayName: string;     // e.g. "C7", "Cm7", "Csus4", "Dadd9"
  baseChordName: string;   // graph node this extends (e.g. "C", "Cm", "Cdim")
  qualityLabel: string;    // human label: "dominant 7th"
  hintEdges: HintEdge[];
  rootPc: number;          // pitch class of the root, for inversion labeling
  chordPcs: number[];      // this chord's tones, in root-position order (root, 3rd, 5th, [7th/6th/...])
}

interface QualityDef {
  offsets: number[];
  displaySuffix: string;
  baseQuality: 'major' | 'minor' | 'dim';
  qualityLabel: string;
  hint?: { upSemitones: number; edgeType: EdgeType; label: string };
  /** Skip the cross-quality pitch-signature dedup below (default true = dedup).
   * 6/m6 chords are pitch-class-identical to a m7/m7b5 a third away — that's
   * an intentional ambiguity we want to surface as two readings, not collapse
   * like the aug/dim7/sus4-sus2 enharmonic-root duplicates dedup handles. */
  dedupe?: boolean;
}

const QUALITY_DEFS: QualityDef[] = [
  {
    offsets: [0, 4, 7, 10],
    displaySuffix: '7',
    baseQuality: 'major',
    qualityLabel: 'dominant 7th',
    hint: { upSemitones: 5, edgeType: 'dom7', label: 'V7→I: dominant resolution' },
  },
  {
    offsets: [0, 4, 7, 11],
    displaySuffix: 'maj7',
    baseQuality: 'major',
    qualityLabel: 'major 7th',
  },
  {
    offsets: [0, 3, 7, 10],
    displaySuffix: 'm7',
    baseQuality: 'minor',
    qualityLabel: 'minor 7th',
    hint: { upSemitones: 5, edgeType: 'iiVI', label: 'ii7→V: ii–V move' },
  },
  {
    offsets: [0, 3, 6, 10],
    displaySuffix: 'm7b5',
    baseQuality: 'dim',
    qualityLabel: 'half-diminished',
    hint: { upSemitones: 5, edgeType: 'iiVI', label: 'ø7→V: half-dim ii move' },
  },
  {
    offsets: [0, 3, 6, 9],
    displaySuffix: 'dim7',
    baseQuality: 'dim',
    qualityLabel: 'diminished 7th',
  },
  // add9 / madd9 — triad + major 9th (keeps the 3rd, unlike sus2/sus4)
  {
    offsets: [0, 2, 4, 7],
    displaySuffix: 'add9',
    baseQuality: 'major',
    qualityLabel: 'add 9th',
  },
  {
    offsets: [0, 2, 3, 7],
    displaySuffix: 'madd9',
    baseQuality: 'minor',
    qualityLabel: 'minor add 9th',
  },
  {
    offsets: [0, 4, 8],
    displaySuffix: 'aug',
    baseQuality: 'major',
    qualityLabel: 'augmented',
    hint: { upSemitones: 5, edgeType: 'chromaticMediant', label: 'I+→IV: augmented resolution' },
  },
  {
    offsets: [0, 5, 7],
    displaySuffix: 'sus4',
    baseQuality: 'major',
    qualityLabel: 'suspended 4th',
  },
  {
    offsets: [0, 2, 7],
    displaySuffix: 'sus2',
    baseQuality: 'major',
    qualityLabel: 'suspended 2nd',
  },
  // 6th chords: pitch-class-identical to a m7/m7b5 rooted a major 3rd/6th away
  // (e.g. Eb-G-Bb-C is both Eb6 and Cm7). Deliberately shown side-by-side with
  // that other reading rather than resolved — see baseChordName dedup below.
  {
    offsets: [0, 4, 7, 9],
    displaySuffix: '6',
    baseQuality: 'major',
    qualityLabel: 'added 6th',
    dedupe: false,
  },
  {
    offsets: [0, 3, 7, 9],
    displaySuffix: 'm6',
    baseQuality: 'minor',
    qualityLabel: 'minor 6th',
    dedupe: false,
  },
];

function rootName(pc: number, spelling: NoteSpelling): string {
  return spelling === 'flats' ? NOTE_NAMES_FLAT[pc] : NOTE_NAMES[pc];
}

function baseName(pc: number, quality: 'major' | 'minor' | 'dim', spelling: NoteSpelling): string {
  const r = rootName(pc, spelling);
  if (quality === 'minor') return `${r}m`;
  if (quality === 'dim')   return `${r}dim`;
  return r;
}

export function detectExtendedChords(heldNotes: Set<number>, spelling: NoteSpelling = 'sharps'): ExtendedMatch[] {
  if (heldNotes.size < 3) return [];

  const heldPcs = new Set(Array.from(heldNotes).map(n => ((n % 12) + 12) % 12));
  const results: ExtendedMatch[] = [];
  // Deduplicate by sorted pitch-class signature (handles aug/dim7 symmetry and sus4/sus2 overlap)
  const seenSigs = new Set<string>();

  for (let rootPc = 0; rootPc < 12; rootPc++) {
    for (const def of QUALITY_DEFS) {
      const chordPcs = def.offsets.map(o => (rootPc + o) % 12);
      if (!chordPcs.every(pc => heldPcs.has(pc))) continue;

      const sig = [...chordPcs].sort((a, b) => a - b).join(',');
      const dedupe = def.dedupe !== false;
      if (dedupe) {
        if (seenSigs.has(sig)) continue;
        seenSigs.add(sig);
      }

      const root = rootName(rootPc, spelling);
      // baseChordName/hintEdges are graph node keys (matched against the
      // canonical-sharp 36-node circle and against matchedChords), so they
      // must stay canonical regardless of the display spelling toggle —
      // only displayName/label are meant for on-screen text.
      const canonicalBase = baseName(rootPc, def.baseQuality, 'sharps');

      const hintEdges: HintEdge[] = [];
      if (def.hint) {
        const targetPc = (rootPc + def.hint.upSemitones) % 12;
        hintEdges.push({
          from: canonicalBase,
          to: rootName(targetPc, 'sharps'),
          edgeType: def.hint.edgeType,
          label: `${root}${def.displaySuffix}: ${def.hint.label}`,
        });
      }

      results.push({
        displayName: `${root}${def.displaySuffix}`,
        baseChordName: canonicalBase,
        qualityLabel: def.qualityLabel,
        hintEdges,
        rootPc,
        chordPcs,
      });
    }
  }

  // Sort: more notes (more specific) first
  results.sort((a, b) => {
    const aDef = QUALITY_DEFS.find(d => a.displayName.endsWith(d.displaySuffix))!;
    const bDef = QUALITY_DEFS.find(d => b.displayName.endsWith(d.displaySuffix))!;
    return (bDef?.offsets.length ?? 0) - (aDef?.offsets.length ?? 0);
  });

  // When the same base chord has both a 4-note and a 3-note match (e.g. Dadd9 and Dsus2
  // from the same held notes), keep only the most specific one per base chord name.
  const byBase = new Map<string, ExtendedMatch>();
  for (const r of results) {
    if (!byBase.has(r.baseChordName)) byBase.set(r.baseChordName, r);
  }

  return [...byBase.values()];
}

export interface ChordMatchEntry {
  name: string;       // spelled display name, e.g. "Cm7", "Eb6" — no inversion marking
  inversion: number;  // 0 = root position; 1/2/3 = which chord tone is in the bass
}

export interface ChordMatchDisplay {
  chords: ChordMatchEntry[];
  qualityLabels: string[];
}

/** Which scale-degree slot (0 = root, 1 = 3rd, 2 = 5th, 3 = 7th/6th…) the bass
 * note occupies in this chord's root-position tone order. Unknown/absent bass
 * (or a bass note that isn't actually one of this chord's tones — e.g. it
 * belongs to an extension outside this particular reading) reads as root
 * position rather than guessing. */
function inversionOf(chordPcs: number[], bassPc: number | undefined): number {
  if (bassPc === undefined) return 0;
  const idx = chordPcs.indexOf(bassPc);
  return idx > 0 ? idx : 0;
}

/**
 * Shared "what chord is this?" display logic for the sidebar (HeldNotes) and
 * the on-circle banner: prefer extended-chord readings (e.g. "Cm7", "Eb6")
 * over the bare triad match they extend, spelled per the user's toggle, and
 * label inversions (bass note ≠ root) when a bass pitch class is given.
 */
export function describeChordMatch(
  matchedChords: string[],
  extendedMatches: ExtendedMatch[],
  spelling: NoteSpelling = 'sharps',
  bassPc?: number,
): ChordMatchDisplay {
  const chords: ChordMatchEntry[] = [];
  const qualityLabels: string[] = [];

  if (extendedMatches.length > 0) {
    const extendedBases = new Set(extendedMatches.map(m => m.baseChordName));
    for (const m of extendedMatches) {
      chords.push({ name: m.displayName, inversion: inversionOf(m.chordPcs, bassPc) });
      qualityLabels.push(m.qualityLabel);
    }
    for (const c of matchedChords) {
      if (extendedBases.has(c)) continue;
      const chordPcs = Array.from(getChordDefinition(c).pitchClasses);
      chords.push({ name: respellChordName(c, spelling), inversion: inversionOf(chordPcs, bassPc) });
    }
  } else {
    for (const c of matchedChords) {
      const def = getChordDefinition(c);
      const chordPcs = Array.from(def.pitchClasses);
      chords.push({ name: respellChordName(c, spelling), inversion: inversionOf(chordPcs, bassPc) });
    }
  }

  return { chords, qualityLabels };
}
