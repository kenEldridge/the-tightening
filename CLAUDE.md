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

### Core modules (`src/core/`)
- `chordDefinitions.ts` — `getChordDefinition()`, NOTE_NAMES uses sharps (C# not Db), `noteToPitchClass()`, SUFFIX_TO_QUALITY mapping
- `chordParser.ts` — validates chord input strings
- `graphModel.ts` — builds progression graph (nodes keyed by chord name string)
- `chordDetection.ts` — `detectChords(heldMidiNotes, nodes)` via pitch class subset matching
- `forceSimulation.ts` — physics engine for Jam mode graph layout
- `chordPathfinder.ts` — Walk mode pathfinding:
  - 36-node graph: `key-{i}`, `minor-{i}`, `dim-{i}` where i = circle-of-fifths position
  - `FIFTHS_ORDER = [0, 7, 2, 9, 4, 11, 6, 1, 8, 3, 10, 5]`
  - 4 edge types: dom7 (always on, weight 1), relative (0.5), iiVI (0.5), leadingTone (1.0)
  - Leading-tone was written fresh (not in derple-dex source)
  - `chordNameToNodeId()` / `nodeIdToChordName()` for bidirectional mapping
  - Extended chords downgraded: dom7/maj7/sus→major, min7→minor, aug→rejected (null)
  - `getTheoryChordNodes()` — lazy singleton of all 36 chords for MIDI detection in Walk mode

### Components (`src/components/`)
- `ChordGraph.tsx` — Jam mode force-directed SVG graph with drag, MIDI highlighting
- `CircleOfFifths.tsx` — Walk mode visualization, 3 concentric rings (Major R=240, Minor R=180, Dim R=120), triad note spellings in each node, path highlighting with color-coded edges (amber=dom7, purple=relative, green=iiVI, red=leadingTone), MIDI match glow (blue=any, green=correct step). SVG uses viewBox for responsive scaling to any screen size.
- `PathStrip.tsx` — horizontal step-by-step path display in sidebar
- `WalkMode.tsx` — Walk sidebar panel: From/To dropdowns (all 36 chords), edge type toggles, return trip toggle, endless mode toggle, paths completed counter, path display
- `ProgressionInput.tsx` — Jam mode progression entry
- `HeldNotes.tsx` — shows currently held MIDI notes and matched chords
- `MidiStatus.tsx` — MIDI connection indicator

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
- `node tests/chord-walk.test.mjs` — 144 tests (pure JS, no test framework, replicates core logic)
- CI: GitHub Actions on push to master → builds Windows installer → creates GitHub release
- Remote name: `the-tightening` (not `origin`) — github.com/kenEldridge/the-tightening.git
- Release tags: `v{version}-build.{run_number}` (e.g. `v2.2.0-build.42`)

## Related project
- `the-derple-dex` (sibling dir) — Astro blog with Circle of Fifths component. The pathfinding algorithm was ported from `CircleOfFifths.astro` lines ~1255-1374. That source only had dom7/relative/iiVI edges; leading-tone was added fresh here.

### Walk mode features (v2.2.0)
- **Return trip**: toggle appends reverse path B→A after outbound A→B, sharing the middle chord
- **Endless mode**: after path completion, waits 1.5s then auto-picks random next destination. Last chord becomes next `fromChord`. Tracks `pathsCompleted` count.
- Both toggles complement: return trip + endless = always depart from same home base. Endless alone = drift around the circle.
- `WalkState.options` has: `relative`, `iiVI`, `leadingTone`, `returnTrip`, `endless`
- Endless logic lives in App.tsx as a useEffect watching `walkState.completed` + `walkState.options.endless`
- Return trip concatenation lives in WalkMode.tsx's `updateAndFindPath`

## Known limitations / future work
- ii-V-I weight is 0.5 (matches derple source); reviewed theory design suggested 1.9 for "macro step" semantics — revisit later
- aug chords can't map into the 36-node pathfinder
- Walk mode doesn't interact with the Jam graph at all (separate views)
- Could add multi-stop waypoints (A→B→C) as a generalization of return trip
