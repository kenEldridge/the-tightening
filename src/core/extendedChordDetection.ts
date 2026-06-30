import { NOTE_NAMES, NOTE_NAMES_FLAT } from './chordDefinitions';
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
}

interface QualityDef {
  offsets: number[];
  displaySuffix: string;
  baseQuality: 'major' | 'minor' | 'dim';
  qualityLabel: string;
  hint?: { upSemitones: number; edgeType: EdgeType; label: string };
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
      if (seenSigs.has(sig)) continue;
      seenSigs.add(sig);

      const root = rootName(rootPc, spelling);
      const base = baseName(rootPc, def.baseQuality, spelling);

      const hintEdges: HintEdge[] = [];
      if (def.hint) {
        const targetPc = (rootPc + def.hint.upSemitones) % 12;
        hintEdges.push({
          from: base,
          to: rootName(targetPc, spelling),
          edgeType: def.hint.edgeType,
          label: `${root}${def.displaySuffix}: ${def.hint.label}`,
        });
      }

      results.push({
        displayName: `${root}${def.displaySuffix}`,
        baseChordName: base,
        qualityLabel: def.qualityLabel,
        hintEdges,
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
