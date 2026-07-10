# The Tightening — Chord Walk

## What this is
Electron + React + TypeScript app for MIDI chord exploration. Two modes:

- **Jam mode**: Build chord progressions, visualize as force-directed graph, detect chords via MIDI in real time
- **Walk mode** (v2.1.0, enhanced v2.2.0): Pick two chords, find shortest harmonic path via Dijkstra over 36-node theory graph, play the path on MIDI with progress tracking. Return trip toggle for cyclical paths. Endless mode auto-picks random next destination after completion.

## Architecture

### Modes
- App starts on a landing page (`mode === 'home'`) with hero cards
- Clicking a card sets `mode` to `'jam'` or `'walk'`
- Title "Chord Walk" in header is a home link back to landing page
- Jam/Walk toggle buttons in header for direct switching

### Core modules (`packages/theory-core/src/`, npm workspace package `theory-core`)
- `chordDefinitions.ts` — `getChordDefinition()`, NOTE_NAMES uses sharps (C# not Db), `noteToPitchClass()`, SUFFIX_TO_QUALITY mapping
- `chordParser.ts` — validates chord input strings
- `graphModel.ts` — builds progression graph (nodes keyed by chord name string)
- `chordDetection.ts` — `detectChords(heldMidiNotes, nodes)` via pitch class subset matching
- `forceSimulation.ts` — physics engine for Jam mode graph layout
- `chordPathfinder.ts` — Walk mode pathfinding:
  - 36-node graph: `key-{i}`, `minor-{i}`, `dim-{i}` where i = circle-of-fifths position
  - `FIFTHS_ORDER = [0, 7, 2, 9, 4, 11, 6, 1, 8, 3, 10, 5]`
  - 11 edge types ordered consonance→dissonance (v2.4.0): fifth (1.0), plagal (1.05), diatonic (1.1), relative (0.5), iiVI (0.5), borrowed (1.35), parallel (1.4), dom7 (1.0), leadingTone (1.0), chromaticMediant (1.7), tritoneSub (1.6)
  - All 11 are constrainable as "must include" filters (`CONSTRAINABLE_TYPES = EDGE_TYPES`)
  - `EDGE_TYPE_INFO` (in `edgeTypeStyles.ts`) holds label/shortLabel/color/description per type; colors run a green→red consonance-to-dissonance gradient
  - `pitchClassToNodeId(prefix, pc)` helper builds the new edge families
  - Leading-tone, plagal, diatonic, borrowed, parallel, chromaticMediant, tritoneSub written fresh (not in derple-dex source)
  - `chordNameToNodeId()` / `nodeIdToChordName()` for bidirectional mapping
  - Extended chords downgraded: dom7/maj7/sus→major, min7→minor, aug→rejected (null)
  - `getTheoryChordNodes()` — lazy singleton of all 36 chords for MIDI detection in Walk mode

### Components (`src/components/`)
- `ChordGraph.tsx` — Jam mode force-directed SVG graph with drag, MIDI highlighting
- `CircleOfFifths.tsx` — shared visualization for BOTH modes (v2.4.0), 3 concentric rings (Major R=240, Minor R=180, Dim R=120), triad note spellings in each node. Edges color-coded by type via the consonance→dissonance gradient; hover `<title>` shows the edge-type label + description. Walk renders the path overlay; Jam renders its progression edges on the same circle via `classifyJamEdge()` (direct edge type, else falls back to the pathfinder's classification). MIDI match glow (blue=any, green=correct step). SVG uses viewBox for responsive scaling to any screen size.
- `PathStrip.tsx` — horizontal step-by-step path display in sidebar
- `WalkMode.tsx` — Walk sidebar panel: From/To dropdowns (all 36 chords), edge type toggles, return trip toggle, endless mode toggle, paths completed counter, path display
- `ProgressionInput.tsx` — Jam mode progression entry
- `HeldNotes.tsx` — shows currently held MIDI notes and matched chords
- `MidiStatus.tsx` — MIDI connection indicator
- `AudioRecorder.tsx` — sidebar panel that records a chosen audio **input** device to a 16-bit PCM WAV (in-app `<audio>` playback + download). FP-10 sends MIDI only over USB, so audio comes from a separate line-in ("USB Audio Device"); the panel just captures whatever input is selected. Uses Web Audio (`getUserMedia` → `MediaStreamSource` → `ScriptProcessorNode`, pumped through a gain-0 node so it isn't monitored aloud) and a hand-rolled WAV encoder. Requires the media-permission handler in `src/main/index.ts` (`setPermissionRequestHandler`/`setPermissionCheckHandler` allow-all — safe; window only loads our own UI). Not MIDI-synced; it's a raw audio capture of the line-in.
- `DidYouKnow.tsx` — "Did you know?" learning panel pinned to the sidebar bottom (`margin-top: auto`); cycles to a random insight on "Next tip". Data in `packages/theory-core/src/insights.ts` (`INSIGHTS`: `{ category, text, relatedEdges? }[]`). `relatedEdges` is unused for now — a hook for future contextual tips keyed to the current path's edge types.

### Key conventions
- Chord names are the primary ID everywhere (node IDs, edge keys like "G->D")
- NOTE_NAMES uses sharps throughout: `['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B']`
- Flats normalized via FLAT_TO_SHARP map
- Walk mode state is session-only (not persisted in save files)
- Save/load only handles Jam mode progressions + node positions

### Node ID mapping (critical detail)
- major: `chordNameToNodeId("C")` → `key-0` (FIFTHS_ORDER.indexOf(pitchClass))
- minor: positioned at relative major's fifths slot. Am (root A=9) → relMaj C (pc 0) → `minor-0`
- dim: `dim-i` root = `(FIFTHS_ORDER[i] + 11) % 12`. Bdim (root B=11) → `(11+1)%12=0` → `dim-0`

## Build & release
- `npm run dev` — Vite + Electron dev mode
- `npm run build` — TypeScript + Vite production build
- `npm test` — replica suite (`tests/chord-walk.test.mjs`, pure JS, no test framework, replicates core logic) + import-based suite (`tests/theory-core.test.ts`, run via tsx, imports the actual `theory-core` package)
- CI: GitHub Actions (`.github/workflows/release.yml`):
  - push to `master` → `npm run build` + `node tests/chord-walk.test.mjs` only (no release)
  - push a `v*` tag → also builds the Windows installer and publishes a GitHub release
- Remote name: `origin` — github.com/kenEldridge/the-tightening.git
- To release: bump `package.json` version, commit, then `git tag vX.Y.Z && git push the-tightening vX.Y.Z`. Release name/tag = the pushed tag (`github.ref_name`).

## Related project
- `the-derple-dex` (sibling dir) — Astro blog with Circle of Fifths component. The pathfinding algorithm was ported from `CircleOfFifths.astro` lines ~1255-1374. That source only had dom7/relative/iiVI edges; leading-tone was added fresh here.

### Walk mode features (v2.2.0)
- **Return trip**: toggle appends reverse path B→A after outbound A→B, sharing the middle chord. The return leg has its OWN "must include" constraints (`WalkState.returnOptions`), independent of the outbound `options`. The "Must include" UI has Out/Back tabs (`activeTab` local state in WalkMode); Back defaults to nothing.
- **Endless mode**: after path completion (× `repeatCount`), waits 1.5s then auto-advances. In cycle-preset mode it rebuilds from a fresh preset via `buildIntervalCyclePath`; otherwise it random-picks a next destination via Dijkstra. With return trip on it departs from the home base (`fromChord`) again; otherwise last chord becomes next `fromChord`.
- **Random edge pattern** (`options.randomPattern`): in endless mode, each advance picks a random `CYCLE_PRESETS` entry (skipping ones whose destination equals the start) instead of repeating the same pattern.
- **Defaults** (`defaultWalkState()` in App.tsx): start on `C`, first cycle preset selected, `returnTrip`/`endless`/`randomPattern` all on — so it wanders through varied patterns anchored at C. `buildIntervalCyclePath` is shared by WalkMode (manual/preset) and the App endless effect.
- Both toggles complement: return trip + endless = always depart from same home base. Endless alone = drift around the circle.
- `WalkState.options` is `Partial<Record<EdgeType, boolean>>` plus `returnTrip` + `endless` (v2.4.0; was a fixed `relative`/`iiVI`/`leadingTone` shape). `WalkState.returnOptions` (v2.6.0) holds the return leg's independent edge-type constraints.
- Endless logic lives in App.tsx as a useEffect watching `walkState.completed` + `walkState.options.endless`
- Return trip concatenation lives in WalkMode.tsx's `updateAndFindPath`

### Mood filter (v3.4.0)
- `packages/theory-core/src/mood.ts` — `WalkMood = 'any' | 'happy' | 'melancholy' | 'dramatic'`. A feel/genre lever over the endless-mode wander.
- Two mechanisms, both needed: (1) **palette** — `presetsForMood(mood)` restricts the random cycle-preset draw to presets whose harmonic moves match the mood; (2) **anchor** — `moodTonicQuality(mood)` pins the home base to a quality (happy→major, melancholy→minor) so quality-preserving (`'same'`) presets don't drift the walk out of the requested feel. Anchoring is the key fix: without it, once endless recenter lands on a minor tonic the whole walk stays minor regardless of pattern.
- `classifyPresetMood(preset)` buckets each preset from its edge set + forced step qualities (tonic-independent): dark edges (borrowed/parallel/leadingTone/chromaticMediant/tritoneSub) or forced dim → dramatic; soft edges (relative/iiVI) or forced minor → melancholy; else (only fifth/dom7/diatonic, no minor/dim) → happy. Current split of the 40 presets: 12 happy / 18 melancholy / 10 dramatic.
- Wired in: `WalkState.mood`; `App.tsx` endless effect passes `presetsForMood`/`moodTonicQuality` into `pickNextCycleAdvance` (which now takes `tonicQuality`); `WalkMode.tsx` mood picker re-anchors the tonic and jumps to the mood's top preset so the change is heard immediately.
- **Default is `'happy'`** (was effectively `'any'`) — the out-of-box wander is now bright/major. Sim over 4000 advances: happy = 100% major; any = 56% maj / 35% min / 9% dim.

### Edge-type taxonomy (v2.4.0)
- Expanded from 5 to 11 harmonic relationship types, all selectable as "must include" path constraints
- New families in `buildPathGraph()`: plagal (IV→I), diatonic (in-key neighbors), borrowed (bIII/bVI/bVII/iv modal mixture), parallel (same root, swapped quality), chromaticMediant (same-quality roots a third apart), tritoneSub (substitute dominant resolving by semitone)
- Walk sidebar "Must include" toggles render from `EDGE_TYPE_ORDER` in a 2-col grid, each with a color swatch + tooltip
- The Jam graph now visualizes on the shared Circle of Fifths with edges classified into these types (no longer a separate force-directed-only view)

## Known limitations / future work
- ii-V-I weight is 0.5 (matches derple source); reviewed theory design suggested 1.9 for "macro step" semantics — revisit later
- aug chords can't map into the 36-node pathfinder
- Could add multi-stop waypoints (A→B→C) as a generalization of return trip
