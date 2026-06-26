# Design Notes — Things That Look Wrong But Aren't

A record of non-obvious design decisions, audit findings, and "this confused me" moments that turned out to be correct. Exists so we don't re-litigate these in future sessions.

---

## Non-simple cycle presets are intentional

**The question:** `dia › dia › dia › dia` from C produces C → D → C → D → C. That's just two chords. Why is that 4 steps and not 2?

**The answer:** It's correct and intentional. The musical content IS two-chord alternation, and the songs in the dataset confirm it:

- "Every Breath You Take" — D♭ F D♭ F D♭
- "Under the Bridge" — C♯m B C♯m B C♯m
- "Beat It" — C♯ B C♯ B C♯
- "High and Dry" — E F♯m E F♯m E
- "Africa" — G♯m A G♯m A G♯m

The difference between `dia dia` (2 steps) and `dia dia dia dia` (4 steps) is the **repeat count** — songs using the 4-step variant go through the chord change twice before resolving. The MIDI walk requires playing all 4 hops, which matches the song structure.

The n−1 distinct chords rule applies to **simple cycles** only. These are deliberately non-simple. The circle-of-fifths overlay shows arrows bouncing back and forth, which looks redundant but is accurate.

---

## A pair of chords IS an edge (the interval arithmetic insight)

**The question:** What's the difference between a pair of chords and an edge in the graph?

**The answer:** Nothing — they are the same thing. The 36-node graph's edge-type labels (dom7, diatonic, relative, etc.) are a *naming layer* on top of interval arithmetic. The underlying primitive is always: root movement in semitones + target quality.

The graph has a transposition symmetry: all 12 major nodes behave identically (same edge structure, just transposed). Named edge types are just a way to label which interval shapes are musically significant. If you have two chords, the edge between them is fully determined by the semitone offset and quality change — whether that relationship has a named type or not.

This insight is what motivated the "interval arithmetic as the primitive" epic (#17): presets defined as named-edge sequences failed for cross-quality starting chords because some named edges don't exist for certain quality combinations. Interval arithmetic always produces a result from any starting chord.

---

## Cycle presets use interval arithmetic, not BFS

**The question:** Why do cycle presets use `intervalCycleChords()` instead of the same `findExactCyclePath()` BFS used for individual paths?

**The answer:** BFS over named edge types fails for cross-quality starting chords. Example: the "dom7 fifth" preset (dom7 edge then fifth edge) was defined for major chords. From a dim starting chord, no "dom7" edge existed out of that node, so `getCycleEndpoints()` returned an empty set — the To dropdown showed nothing.

Interval arithmetic bypasses this: `transposeChord(chord, semitones, quality)` is always defined for any starting chord. The preset is stored as `IntervalStep[]` (semitones + target quality), computed from the preset's `exampleChords` string. The step sequence is applied mechanically, regardless of whether named edges exist.

Edge-type labels for the PathStrip/overlay come from `preset.loop.split(' ')` — NOT from `getDirectEdgeTypes()`. This separation is load-bearing: `getDirectEdgeTypes` can return nothing for cross-quality moves, and `edgeTypeShortLabel()` crashes on unknown types.

---

## Return trip always lands on `from`, not the arithmetic closing chord

**The question / bug:** For cross-quality cycle presets (diatonic, relative, borrowed) started from a mismatched quality chord, the interval arithmetic closing step lands on a *different-quality* root. Example: "diatonic diatonic" from C (major) gives C → B♭ → Cm instead of C → B♭ → C.

**The answer:** The arithmetic is correct, but UX wins. "Return trip" means return to exactly `from`. We force `chordNames = [...outChords, from]` regardless of what the closing step's quality would produce arithmetically.

For same-quality presets (the common case: dom7, fifth, etc.), this makes no difference — the arithmetic already returns to `from`. For cross-quality presets from mismatched starting quality, we override the closing quality. The path is still musically valid; it just ends where the user expects.

---

## Key-shift is a display-only transform

**The question:** Why doesn't the key-shift change `walkState.fromChord` / `toChord`? Shouldn't the canonical state reflect what the user sees?

**The answer:** No, because canonical chord names must stay stable for MIDI detection, path computation, and option `value` attributes in dropdowns. If canonical names shifted, MIDI matching would break (the MIDI system sees the theory names, not the displayed ones).

The shift is applied at render time only:
- `ChordSelect` labels: `transposeChord(name, keyShift, 'same')` for display; `value={name}` stays canonical
- When the user picks a chord from a shifted dropdown, the `value` attribute carries the canonical name — no un-shifting needed
- `keyShift` lives in App.tsx state, not in `walkState`

---

## The 36-node graph: why not 12 nodes?

**The question:** Chords are just pitch-class sets. Why have 36 nodes (12 major + 12 minor + 12 dim) instead of 12 pitch classes?

**The answer:** Quality matters for harmonic function. C major and C minor are different chords with different harmonic roles — they participate in different edge relationships. A "relative" edge goes from Am to C (minor to major), not from any C to any A. Collapsing to 12 nodes would lose all quality information and make edge-type classification impossible.

The 36-node structure also means the graph is *not* fully symmetric across quality boundaries — some edge types (e.g., the "diatonic" type as defined here) only connect nodes of certain qualities. This is where the original BFS cycle bug came from.

Node ID convention: `key-{i}` (major), `minor-{i}` (minor), `dim-{i}` (dim), where `i` is the FIFTHS_ORDER position (not pitch class). Minor nodes are positioned at their relative major's fifths slot; dim nodes are positioned at the slot where their root + 1 = the major root pitch class.

---

## Cycle sum-of-semitones must be 0 mod 12, but quality closure is separate

**The question:** If all preset steps sum to 0 semitones mod 12, does the cycle always close?

**The answer:** The ROOT always returns. But the QUALITY may not match the starting quality if any step has an absolute quality target (not `'same'`). For a cycle to close completely from a given starting quality, two conditions must both hold:

1. `sum(all semitones) % 12 === 0` — root returns (true for all valid presets)
2. The quality chain ends at the starting quality — only guaranteed when all steps have `quality: 'same'`

Same-quality-only presets (`dom7 fifth`, `fifth`, `V4 P5`, etc.) close from ALL 36 starting chords. Cross-quality presets (`diatonic`, `relative`, `borrowed`) only close from the quality that matches their example chord's starting quality. From other qualities, the arithmetic still produces a valid path, but it doesn't form a perfect cycle.

See `analysis/verify-steps.ts` for the invariant tests.
