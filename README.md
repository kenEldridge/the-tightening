# The Tightening

A MIDI-driven chord theory tool. Two modes: **Jam** and **Walk**.

## Download

**[Latest release](https://github.com/kenEldridge/the-tightening/releases/latest)** — Windows `.exe` installer.

**[Guides & tutorials](https://derple.dev/tutorials/)** — walk-throughs for every feature on DerpleDex.

---

## Jam mode

Build chord progressions and visualize them on a Circle of Fifths. Play chords on a MIDI keyboard and watch them light up. Edges between chords are color-coded by harmonic relationship type.

## Walk mode

Pick two chords. The app finds the shortest harmonic path between them using Dijkstra over a 36-node music theory graph. Play the path on your MIDI keyboard — each chord lights up as you hit it.

### The graph

36 nodes: 12 major, 12 minor, 12 diminished — one per pitch class, laid out on the circle of fifths.

11 edge types, ordered consonance → dissonance:

| Type | What it means |
|------|--------------|
| **Fifth** | Perfect fifth (V→I or I→V) |
| **Plagal** | Subdominant motion (IV→I) |
| **Diatonic** | Step within a key |
| **Relative** | Relative major/minor pair (e.g. C↔Am) |
| **ii-V-I** | Jazz cadence macro-step |
| **Borrowed** | Modal mixture (bIII, bVI, bVII, iv) |
| **Parallel** | Same root, swapped quality (e.g. C↔Cm) |
| **Dom7** | Dominant seventh resolution |
| **Leading tone** | Semitone resolution to tonic |
| **Chromatic mediant** | Same-quality roots a third apart |
| **Tritone sub** | Substitute dominant resolving by semitone |

### Must-include constraints

Toggle edge types to require them in the path. "Out" and "Back" constraints are independent — the return leg can use completely different harmonic logic than the outbound.

### Cycle presets

Real progressions do loops, not one-way trips. The cycle preset browser shows the most common closed harmonic cycles found across ~290 real song charts, ranked by how many songs contain them.

Each cycle is a key-agnostic edge-type sequence — e.g. `dom7 › fifth` means "go somewhere via a dominant-seventh resolution, then come back via a perfect fifth." The last edge in the sequence is the closing edge (what brings you back to the start).

Clicking a preset:
- Sets the **Out** constraints to the edge types used in the outbound legs
- Sets the **Back** constraint to the closing edge type
- Enables **Return trip** automatically

The "To" dropdown greys out any destination that's unreachable under the current constraints.

### Other features

- **Return trip** — appends the reverse path after the outbound, sharing the middle chord. Out and Back each have their own independent constraints.
- **Endless mode** — after completing a path, waits 1.5s and auto-picks the next destination. The last chord becomes the new starting point.
- **Repeat ×N** — replay the same path N times before advancing in endless mode.

---

## Analysis pipeline

The cycle presets come from a real analysis of ~290 PDF song charts in `music/`. To regenerate:

```
npx tsx analysis/analyze-songs.ts
```

Outputs:
- `analysis/songs.csv` — per-song chord sequences and edge classifications
- `analysis/transitions.csv` — every chord-to-chord transition found
- `analysis/chord_cycles.csv` — closed chord loops appearing in 5+ songs
- `analysis/edge_cycles.csv` — key-agnostic edge-type cycles, rotation-canonicalized
- `src/core/cyclePresets.ts` — top 40 cycles, imported directly into the app

Cycles are rotation-canonicalized — `dom7 fifth` and `fifth dom7` are the same loop viewed from different starting chords, and get merged into one entry with combined counts.

---

## Dev setup

```
npm install
npm run dev
```

## Build installer

```
npm run dist
```

Outputs to `release/`.

## Tests

```
node tests/chord-walk.test.mjs
```
