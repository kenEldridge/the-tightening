# Music Theory & Psychoacoustics Research

This directory contains exploratory research into music theory, psychoacoustics, and related tools that inform and complement The Tightening's adaptive learning approach.

## Directory Structure

```
research/
├── dissonance/              # Psychoacoustic dissonance research
├── scale_images/            # Pentatonic scale visualizations
├── song-visualizer/         # Song structure visualization tool
└── RESEARCH_NOTES.md       # This file
```

---

## 1. Psychoacoustic Dissonance Research (`dissonance/`)

### What It Is
Python-based research exploring the physical and perceptual basis of musical consonance and dissonance. This investigates **why** certain note combinations sound "good" from a frequency-interaction perspective.

### Key Files
- `dissonance.md` - Detailed explanation of how consonance emerges from frequency interactions
- `poster.py` - Python script generating 3-panel dissonance visualizations
- `dissonance_poster_dark.png` - Main visualization (also in PDF format)
- `dissonance.py` - Core dissonance calculation code

### The Visualization

The main plot (`dissonance_poster_dark.png`) shows three interconnected panels:

**Panel A: Ear-level roughness for a single frequency difference**
- Shows sensory roughness for two pure tones as a function of frequency ratio
- Based on Plomp-Levelt psychoacoustic experiments
- Reflects cochlear frequency resolution at ~200 Hz reference

**Panel B: Total dissonance from all harmonic partial interactions**
- Shows total dissonance when two harmonic spectra combine at different frequency ratios
- Deep minima occur at simple ratios: octave (2:1), perfect fifth (3:2), perfect fourth (4:3)
- Answers: "How rough does this interval sound overall?"

**Panel C: Partial-partial frequency differences (interaction density)**
- Shows WHERE frequency interactions concentrate in the spectrum
- Uses kernel density estimation (KDE) to visualize interaction patterns
- Displays frequency differences within one octave (0-200 Hz)
- Four key intervals plotted: Octave (2:1), Perfect fifth (3:2), Perfect fourth (4:3), Major third (5:4)

### Key Insight (Jan 15, 2026)

**Major thirds (5:4) and perfect fifths (3:2) overlap at 100 Hz in Panel C.**

This means:
- They don't create competing dissonances at different frequencies
- They actually **reinforce** each other's harmonic interactions at 100 Hz
- This helps explain why major triads (root + major third + perfect fifth) sound so unified and stable
- The intervals are **complementary** in the frequency domain, not just non-conflicting

This is exactly why major triads are the foundation of Western harmony - they're acoustically optimal.

### Technical Details
- Reference frequency: f₀ = 200 Hz (approximately G3)
- Number of partials: 30 harmonics
- Roughness model: Simplified Plomp-Levelt with constant critical bandwidth (100 Hz)
- KDE bandwidth: 0.035 for visualization

### Potential Application to The Tightening

This research could inform future enhancements:
- Use Panel B dissonance curves to define "consonance space" more precisely
- Base the adaptive convergence algorithm on actual psychoacoustic models
- Map keyboard presses to frequency ratios and calculate dissonance in real-time
- Provide visual feedback showing where played notes fall on the consonance curve
- Weight note probabilities by consonance (low dissonance = higher probability)

---

## 2. Pentatonic Scale Visualizations (`scale_images/`)

### What It Is
PNG visualizations of pentatonic scales in different keys:
- `A_Min_Pentatonic.png`
- `C_Maj_Pentatonic.png`
- `E_Min_Pentatonic.png`
- `G_Maj_Pentatonic.png`

### Purpose
Part of personal music learning - understanding scale patterns and relationships across keys.

---

## 3. Song Structure Visualizer (`song-visualizer/`)

### What It Is
A React webapp for visualizing song structure as flowchart-style tiles. Break down songs into component pieces (Intro, Verse, Chorus, etc.) with notes and lyrics.

### Key Features
- Visual tiles showing segment names and note sequences
- Hover tooltips with full notes and lyrics
- Drag-and-drop tile positioning
- Connection lines between segments
- Auto-arrange for clean horizontal flow
- Dark mode UI
- Export/import JSON files

### Tech Stack
- React 18 + Vite
- Pure CSS (no UI libraries)
- JSON files for song data in `public/songs/`

### Data Structure
```json
{
  "title": "Song Name",
  "artist": "Artist Name",
  "segments": [
    {
      "id": "seg-intro",
      "name": "Intro",
      "notes": "C G Am F",
      "lyrics": ["Line 1", "Line 2"]
    }
  ],
  "connections": [
    {
      "from": "seg-intro",
      "to": "seg-verse",
      "label": "Intro to Verse"
    }
  ],
  "positions": { "seg-intro": { "x": 50, "y": 200 } }
}
```

### Running It
```bash
cd research/song-visualizer
npm install
npm run dev
# Opens http://localhost:5173
```

### Current Status
- Basic functionality works (tiles, connections, drag-drop)
- Known issues with vertical centering and label positioning (documented in app)
- Built for personal learning: "I know the melody, this is to teach me the structure of the song"

### Difference from The Tightening
- **The Tightening**: Interactive practice tool with MIDI input, adaptive learning, falling notes
- **Song Visualizer**: Static analysis tool for understanding song structure and patterns

---

## Research Philosophy

This research follows a "100 tangents" approach:
- No fixed plan or timeline
- Following curiosity across: coding, music theory, psychoacoustics, practice
- Each exploration informs the others in unexpected ways
- The wandering is intentional - music sits at the intersection of math, physics, perception, neuroscience, programming, and art

### Questions Explored
- Why do certain note combinations sound "good"?
- What is dissonance at the physical level?
- How do simple frequency ratios (like 3:2, 5:4) relate to consonance?
- Could this framework apply to other species' hearing? (Dogs hear up to 45 kHz, fish have different critical bands)
- How do scales emerge from consonance constraints?
- Why do minor chords work if they're more dissonant?
- What about non-Western tuning systems?

---

## Possible Future Explorations

**Comparative hearing research:**
- Generate dissonance plots for other species (dogs, fish, elephants)
- Different critical bands = different "music theory"
- Create "music for fish" based on auditory physiology

**Visualization extensions:**
- Animate dissonance curves across the audible spectrum
- 3D visualization: frequency ratio × frequency × dissonance
- Interactive tool to hear intervals while seeing interaction patterns

**Integration with The Tightening:**
- Real-time dissonance visualization while playing
- Consonance heat map for played note combinations
- Progression suggestions based on psychoacoustic models
- Visual feedback showing where notes fall on consonance curve

**Theory deep-dives:**
- Mathematical relationships between intervals
- How scales emerge from consonance constraints
- Non-Western tuning systems and their psychoacoustic basis
- Role of timbre in perceived consonance

---

## Personal Learning Context

This research emerged from:
1. Building The Tightening without understanding music theory
2. Starting to practice major triads and inversions
3. Asking "why do these sound good?" and diving into the physics
4. Discovering psychoacoustic literature (Plomp-Levelt, etc.)
5. Generating visualizations to understand the deep principles

The cycle: **Build → Practice → Question → Research → Visualize → Build**

---

_Documentation authored by Claude (Jan 15, 2026)_
