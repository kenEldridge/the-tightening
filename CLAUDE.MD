# The Tightening - Adaptive Piano Learning App

## Project Overview

**"The Tightening"** is an innovative Electron-based desktop application that teaches piano through a revolutionary adaptive key mapping approach. Unlike traditional learning tools, this app lets you play ANY key initially and gradually guides you to the correct keys through audio feedback and probabilistic distribution tightening.

## Current Status (Nov 28, 2024)

**Phase 1 COMPLETE + Enhancements**

### Working Features
- Professional piano sound via **smplr SplendidGrandPiano**
- MIDI keyboard input (Akai MPK Mini 3 tested)
- Accompaniment mode (chords play while user plays melody)
- **Melody guide plays 1 octave lower** for bass+melody harmony (configurable)
- Adaptive key mapping with Gaussian distribution
- Audio degradation for wrong keys (detuning + volume)
- Progress tracking with **confusion matrix** (hits/misses/extras)
- Lyrics display with meaningful song sections
- Guitar Hero falling notes visualization
- Visual piano keyboard with distribution glow
- Song library: Hey Jude, Canon in D

### The Core Innovation

**You can ALWAYS play the melody** - the app never says "wrong note". Instead:

1. **Phase 1 (Beginning)**: Press ANY key → plays correct melody note
   - Distribution width: 44 semitones (all keys work)
   - Perfect audio quality regardless of which key
   - Immediate success from minute one

2. **Phase 2 (Progressive)**: Distribution gradually tightens
   - Gaussian probability centered on correct keys
   - Wrong keys still play melody BUT sound degraded:
     - Detuning (±50 cents)
     - Volume reduction (up to 50%)
   - Happens over 2-3 hours of practice

3. **Phase 3 (Mastery)**: Only correct keys sound good
   - Distribution width: 0.5 semitones (essentially exact keys)
   - Wrong keys sound noticeably degraded
   - User naturally gravitates to correct keys

## Tech Stack

### Frontend
- **React 18** - UI framework
- **TypeScript** - Type safety
- **Vite** - Build tool and dev server

### Desktop
- **Electron** - Cross-platform desktop app
- Dev server: `localhost:5173`
- Window size: 1200x800px

### Audio
- **smplr (SplendidGrandPiano)** - Professional sampled piano sound
- **Tone.js v15.1.22** - Transport/timing only (not for synthesis)
  - Tone.Transport for song playback timing
  - Tone.Part for scheduled chord events

### MIDI
- **Native `midi` package** - MIDI device communication (via Electron IPC)
- **@tonejs/midi** - MIDI file parsing

### Rendering
- **HTML5 Canvas** - Falling notes visualization
- **SVG** - Piano keyboard display

## Project Structure

```
the-tightening/
├── src/
│   ├── App.tsx                          # Main application integration
│   ├── main.tsx                         # React entry point
│   ├── config/
│   │   └── AppConfig.ts                 # Central configuration system
│   ├── components/
│   │   ├── AdaptiveKeyMapper.ts         # Core distribution algorithm
│   │   ├── AudioEngine.ts               # Piano playback (smplr)
│   │   ├── AccompanimentPlayer.ts       # Chord accompaniment (smplr)
│   │   ├── ReferenceMelody.ts           # Melody guide (smplr, plays octave lower)
│   │   ├── ProgressTracker.ts           # Performance + confusion matrix
│   │   ├── FallingNotesCanvas.tsx       # Guitar Hero visualization
│   │   ├── VisualKeyboard.tsx           # Piano keyboard display
│   │   ├── PracticeControls.tsx         # UI controls + stats
│   │   ├── LyricsDisplay.tsx            # Section lyrics display
│   │   └── TheTighteningLogo.tsx        # Logo component
│   ├── utils/
│   │   ├── midiParser.ts                # MIDI file parsing
│   │   └── logger.ts                    # Logging utility
│   ├── data/
│   │   ├── loadSongs.ts                 # Song library loader
│   │   ├── songMetadata.ts              # Manual sections + lyrics
│   │   └── chordProgressions.ts         # Chord data for accompaniment
│   └── main/
│       ├── index.ts                     # Electron main process
│       └── preload.ts                   # Electron preload (MIDI bridge)
├── public/
│   └── songs/
│       ├── hey-jude.mid                 # Hey Jude (The Beatles)
│       └── canon-in-d.mid               # Canon in D (Pachelbel)
├── dist-electron/                        # Compiled Electron files
├── package.json
├── vite.config.ts
└── tsconfig.*.json
```

## Key Components

### AudioEngine (`src/components/AudioEngine.ts`)
**Purpose**: Play piano notes with accuracy-based degradation

**Technology**: smplr SplendidGrandPiano (professional sampled piano)

**Features**:
- Professional piano sound out of the box
- Detuning based on accuracy (±50 cents max)
- Volume reduction for wrong keys
- Low latency playback

**Methods**:
- `initialize()`: Load piano samples
- `playNote({note, accuracy, duration, velocity})`: Play with feedback
- `stopAll()`: Stop all notes

### AccompanimentPlayer (`src/components/AccompanimentPlayer.ts`)
**Purpose**: Play chord accompaniment so user can play melody

**Key Insight**: Old approach (reference plays melody, user plays melody = interference). New approach (reference plays CHORDS, user plays melody = complete music).

**Features**:
- Same SplendidGrandPiano for consistent sound
- Bass + chord voicings from `chordProgressions.ts`
- Tone.Part scheduling for precise timing
- Section looping support

### AdaptiveKeyMapper (`src/components/AdaptiveKeyMapper.ts`)
**Purpose**: Maps any pressed key to correct melody note

**Algorithm**: Gaussian distribution
- `accuracy = e^(-distance² / (2σ²))`
- Width starts at 44 (all keys), tightens to 0.5 (exact keys)
- Grace period: width >= 40 = perfect sound always

**Methods**:
- `mapKeyToMelody(pressed, correct)`: Main mapping
- `tightenDistribution(amount)`: Progressive narrowing
- `getProgress()`: 0-1 mastery percentage

### ProgressTracker (`src/components/ProgressTracker.ts`)
**Purpose**: Monitor performance and control progression

**Tracks**:
- Total notes played
- Average/recent accuracy
- Current/best streak
- Practice time
- **Confusion Matrix**: hits, misses, extras

**Confusion Matrix Definitions**:
- **HITS**: Key pressed during active note window
- **MISSES**: Note window passed without any key press
- **EXTRAS**: Key pressed during gap (no active note)

### LyricsDisplay (`src/components/LyricsDisplay.tsx`)
**Purpose**: Show current section and lyrics

**Features**:
- Section name (Verse 1, Chorus, etc.)
- Progress bar through section
- Lyrics text for current section

### PracticeControls (`src/components/PracticeControls.tsx`)
**Purpose**: UI control panel

**Features**:
- Play/Pause/Stop/Reset
- Song selection dropdown
- Section selection with loop toggle
- Performance stats
- **Confusion matrix display** (hits/misses/extras)
- Tempo slider
- Distribution width slider
- Reference volume slider

## Song System

### Song Library (`src/data/loadSongs.ts`)
- **Hey Jude** (The Beatles) - Primary test song
- **Canon in D** (Pachelbel) - Public domain

### Song Metadata (`src/data/songMetadata.ts`)
Manual section definitions with lyrics:
```typescript
interface SongSection {
  id: string;
  name: string;           // "Verse 1", "Chorus"
  startTime: number;
  endTime: number;
  lyrics?: string;
}
```

### Chord Progressions (`src/data/chordProgressions.ts`)
Chord data for accompaniment:
- Hey Jude: F-C-C7-F-Bb-F-C7-F pattern
- Canon in D: D-A-Bm-F#m-G-D-G-A pattern

### SongData Format
```typescript
{
  name: string;
  tempo: number;
  timeSignature: {numerator, denominator};
  duration: number;
  notes: [{midi, time, duration, velocity, name}];
  range: {min, max};
  segments: SongSegment[];  // Manual sections with lyrics
}
```

## Configuration

**Location**: `src/config/AppConfig.ts`

### Key Settings
- `distribution.initialWidth`: 44 (all keys work)
- `distribution.finalWidth`: 0.5 (exact keys only)
- `audioFeedback.detuning.maxCents`: 50
- `audioFeedback.volume.maxReduction`: 0.5
- `progression.autoMode`: true
- `progression.accuracyThreshold`: 0.7
- `gameplay.currentSong`: 'hey-jude'

## Development

### Prerequisites
- Node.js (latest LTS)
- MIDI keyboard (Akai MPK Mini 3 tested)

### Installation
```bash
npm install
```

### Running
```bash
npm run dev
```
**IMPORTANT**: Never start the app automatically. User starts/stops manually.

### Log File Location
`C:\Users\eldri\AppData\Roaming\the-tightening\logs\main.log`

Claude should read this file directly for error messages.

## Known Fixes Applied

1. **Stale closure bug**: Fixed with `currentTimeRef` for MIDI callbacks
2. **Cliff edge at width=44**: Extended grace period to width >= 40
3. **Toy piano sound**: Replaced Tone.js Sampler with smplr SplendidGrandPiano
4. **Same note every time**: Fixed getCurrentNote to use ref instead of stale state
5. **Playing along sounds bad**: Changed from melody reference to chord accompaniment

## Architecture Decisions

### Why smplr instead of Tone.js Sampler?
- Professional sound out of the box
- No reinventing piano synthesis
- MIT licensed, ~537KB
- Author of soundfont-player recommends it

### Why Accompaniment instead of Melody Reference?
- Old: Reference plays melody + user plays melody = two melodies = sounds bad
- New: Reference plays chords + user plays melody = complete music

### Why Confusion Matrix?
- Simple accuracy % doesn't tell full story
- Need to know: Did they hit notes? Miss notes? Press extra keys?
- Enables better feedback and analysis

## Future Ideas

- More songs with lyrics
- Hand separation (left/right)
- Sight-reading mode
- Session history graphs
- Problem key heatmap

## Credits

- Developed by Ken Eldridge
- Powered by Claude (Anthropic)
- Piano samples: smplr SplendidGrandPiano
- Songs: Hey Jude (The Beatles), Canon in D (Pachelbel)
