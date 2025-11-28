# The Tightening - Adaptive Piano Learning App

## Project Overview

**"The Tightening"** is an innovative Electron-based desktop application that teaches piano through a revolutionary adaptive key mapping approach. Unlike traditional learning tools, this app lets you play ANY key initially and gradually guides you to the correct keys through audio feedback and probabilistic distribution tightening.

## Current Phase: Phase 1 - Core Implementation (COMPLETE ✅)

**Status**: Working! Realistic piano sounds, Tone.js timing fixed, ready for MIDI testing

### Completed ✅
- Central configuration system with all tunable parameters
- Adaptive key mapping algorithm (Gaussian distribution)
- **Audio engine with realistic piano samples** (Salamander Grand Piano)
  - Tone.Sampler with 29 samples from CDN (~4MB)
  - Low-pass filter for timbre degradation (10kHz → 500Hz)
  - Detuning via sampler.detune (±50 cents)
  - Volume reduction preserved
- **Reference melody with real piano sound** (same Salamander samples)
- Progress tracker with auto/manual modes
- Guitar Hero falling notes visualization
- Visual piano keyboard with distribution glow
- Practice controls UI
- MIDI file parser and song loader
- Canon in D (Pachelbel) - public domain MIDI
- **Tone.js Transport timing fixes** (Part scheduling, tempo initialization)

### Next Steps 📋
- Test with real MIDI keyboard (Akai MPK Mini 3)
- Tune audio feedback parameters with actual use
- Tune distribution tightening parameters
- Add more songs to library
- Consider self-hosting samples for offline support

## The Innovation: Adaptive Key Mapping

### Core Concept
**You can ALWAYS play the melody** - the app never says "wrong note". Instead:

1. **Phase 1 (Beginning)**: Press ANY key → plays correct melody note
   - Distribution width: 44 semitones (all 88 keys work)
   - Perfect audio quality regardless of which key you press
   - Immediate success from minute one

2. **Phase 2 (Progressive)**: Distribution gradually tightens
   - Gaussian probability centered on correct keys
   - Wrong keys still play melody BUT:
     - Sound becomes slightly detuned (±50 cents max)
     - Timbre shifts (triangle → sawtooth → square)
     - Volume reduces (up to 50%)
   - Happens over 2-3 hours of practice

3. **Phase 3 (Mastery)**: Only correct keys sound good
   - Distribution width: 0.5 semitones (essentially exact keys)
   - Wrong keys sound noticeably degraded
   - User naturally gravitates to correct keys

### Why This Works
- **No frustration**: Never lose the melody
- **Gentle guidance**: Audio quality nudges toward improvement
- **Natural learning**: Brain associates good sound with correct keys
- **Automatic progression**: System adapts to user skill level

## Tech Stack

### Frontend
- **React 18** - UI framework
- **TypeScript** - Type safety
- **Vite** - Build tool and dev server

### Desktop
- **Electron** - Cross-platform desktop app
- Dev server: `localhost:5173`
- Window size: 1200x800px

### Audio & MIDI
- **Tone.js v15.1.22** - Web Audio API wrapper
  - Piano synthesis with configurable feedback
  - Reference melody playback with Tone.Part
  - Transport for timing/tempo control
- **WebMidi v3** - MIDI device communication
  - Target: Akai MPK Mini 3
  - Captures note on/off events with velocity
- **@tonejs/midi** - MIDI file parsing
  - Extracts melody, tempo, time signature
  - Converts to internal JSON format

### Rendering
- **HTML5 Canvas** - Falling notes (Guitar Hero style)
  - `desynchronized: true` for low latency
  - `alpha: false` for performance
- **SVG** - Piano keyboard visualization
  - Distribution glow showing acceptable range
  - Black/white key rendering

## Project Structure

```
music-learning-app/
├── src/
│   ├── App.tsx                      # Main application integration
│   ├── config/
│   │   └── AppConfig.ts            # Central configuration system
│   ├── components/
│   │   ├── AdaptiveKeyMapper.ts    # Core distribution algorithm
│   │   ├── AudioEngine.ts          # Piano synthesis + feedback
│   │   ├── ReferenceMelody.ts      # Background melody player
│   │   ├── ProgressTracker.ts      # Performance tracking
│   │   ├── FallingNotesCanvas.tsx  # Guitar Hero visualization
│   │   ├── VisualKeyboard.tsx      # Piano keyboard display
│   │   └── PracticeControls.tsx    # UI controls
│   ├── utils/
│   │   └── midiParser.ts           # MIDI file parsing
│   ├── data/
│   │   └── loadSongs.ts            # Song library loader
│   └── main/
│       ├── index.ts                # Electron main process
│       └── preload.ts              # Electron preload script
├── public/
│   └── songs/
│       └── canon-in-d.mid          # Canon in D (Pachelbel)
├── dist-electron/                   # Compiled Electron files
├── package.json
├── vite.config.ts
└── tsconfig.*.json
```

## Configuration System

**Location**: `src/config/AppConfig.ts`

All app behavior is controlled by a single configuration object:

### Distribution Settings
- `initialWidth`: 44 semitones (all keys)
- `finalWidth`: 0.5 semitones (exact keys)
- `autoTighteningRate`: 0.01 (very gradual)
- `manualWidthOverride`: null (or 0-44 for manual control)

### Audio Feedback Parameters
**Detuning** (pitch shift):
- `enabled`: true
- `maxCents`: 50 (half semitone)
- `weight`: 0.4

**Timbre** (harmonic changes):
- `enabled`: true
- `filterReduction`: 2000 Hz
- `harmonicsReduction`: 0.5
- `weight`: 0.3

**Volume** (loudness reduction):
- `enabled`: true
- `maxReduction`: 0.5 (50% quieter)
- `weight`: 0.3

**Degradation Curve**: 'exponential' or 'linear'

### Reference Melody
- `enabled`: true
- `initialVolume`: 0.4
- `fadeRate`: 0.01 (very gradual)
- `minVolume`: 0.05
- `instrument`: 'music-box' | 'soft-piano' | 'synth-pad'
- `manualVolumeOverride`: null (or 0-1)

### Progression
- `autoMode`: true
- `accuracyThreshold`: 0.7 (70% to trigger tightening)
- `consistencyWindow`: 20 notes
- `persistProgress`: true (localStorage)

### Visual
- `distributionMode`: 'C' (both falling notes and keyboard)
- `colors`: configurable palette
- `fallingNoteSpeed`: 2 pixels/frame
- `rangePadding`: 3 semitones beyond song range

### Gameplay
- `currentSong`: 'canon-in-d'
- `tempoMultiplier`: 1.0
- `allowTempoChange`: true

## Key Components

### AdaptiveKeyMapper (`src/components/AdaptiveKeyMapper.ts`)
**Purpose**: Maps any pressed key to the correct melody note

**Algorithm**:
- Gaussian distribution: `accuracy = e^(-distance² / (2σ²))`
- Returns `{melodyNote, pressedKey, distance, accuracy}`
- Automatically tightens distribution based on performance

**Methods**:
- `mapKeyToMelody(pressed, correct)`: Main mapping function
- `tightenDistribution(amount)`: Progressive narrowing
- `getProgress()`: 0-1 mastery percentage
- `getAcceptableKeyRange(note)`: For visual feedback

### AudioEngine (`src/components/AudioEngine.ts`)
**Purpose**: Piano synthesis with degradable audio quality

**Features**:
- PolySynth with triangle wave oscillator
- Three tunable feedback mechanisms
- Combines detuning + timbre + volume based on accuracy
- Real-time parameter updates

**Methods**:
- `initialize()`: Start audio context
- `playNote({note, accuracy, duration, velocity})`: Main playback
- `stopAll()`: Release all notes
- `getLatency()`: Debug info

### ReferenceMelodyPlayer (`src/components/ReferenceMelody.ts`)
**Purpose**: Background melody that fades as user learns

**Features**:
- Tone.Part for precise MIDI playback
- Three instrument timbres (different from user's piano)
- Auto-fade based on accuracy
- Manual volume override

**Methods**:
- `loadSong(songData)`: Parse and prepare MIDI
- `start/stop/pause/resume()`: Playback control
- `setTempo(bpm)`: Tempo adjustment
- `fadeBasedOnAccuracy(accuracy)`: Auto-volume

### ProgressTracker (`src/components/ProgressTracker.ts`)
**Purpose**: Monitor performance and control progression

**Tracks**:
- Total notes played
- Average accuracy (all time)
- Recent accuracy (last N notes)
- Current/best streak
- Practice time
- Progress percentage

**Features**:
- Auto-progression (tightens when accuracy > threshold)
- Manual progression controls
- Save/load from localStorage
- Reference melody fade coordination

### UI Components

**FallingNotesCanvas** - Guitar Hero visualization
- Notes fall from top to bottom
- Glow width shows distribution acceptance range
- 60fps canvas animation
- Look-ahead: 3 seconds

**VisualKeyboard** - Piano display
- SVG rendering (faster than canvas for static elements)
- Limited range (song ± padding, not all 88 keys)
- Distribution glow (Gaussian gradient)
- Black/white key distinction
- Shows pressed keys and correct note

**PracticeControls** - Control panel
- Play/Pause/Stop/Reset
- Tempo slider (40-200 BPM)
- Distribution width slider (manual mode)
- Reference volume slider
- Auto-progression toggle
- Performance stats dashboard

## Song Library

**Current Songs**:
- Canon in D (Pachelbel) - 3.2KB MIDI file

**Source**: MidiFindcom (public domain)

**Format**: Standard MIDI files parsed to:
```typescript
{
  name: string
  tempo: number (BPM)
  timeSignature: {numerator, denominator}
  duration: number (seconds)
  notes: [{midi, time, duration, velocity, name}]
  range: {min, max} (MIDI note numbers)
}
```

**TODO**: Add more songs
- Für Elise (Beethoven)
- Ode to Joy (Beethoven)
- Twinkle Twinkle Little Star
- Amazing Grace
- Greensleeves

## Development Setup

### Prerequisites
- Node.js (latest LTS)
- MIDI keyboard (Akai MPK Mini 3 or compatible)
- Git

### Installation
```bash
npm install
```

### Running the App
```bash
npm run dev
```
This starts both Vite (frontend) and Electron (desktop wrapper) automatically.

### Common npm Scripts
- `npm run dev` - Start development server + Electron
- `npm run build` - Build for production
- `npm run lint` - Run ESLint

## Known Issues & Fixes

### Issue 1: TypeScript Import Errors (FIXED)
**Problem**: Runtime errors - `module does not provide export named 'AppConfig'`

**Cause**: Importing TypeScript interfaces as values

**Fix**: Use `import type` for interfaces:
```typescript
// ❌ Wrong
import { AppConfig } from './config/AppConfig';

// ✅ Correct
import type { AppConfig } from './config/AppConfig';
import { loadConfig, saveConfig } from './config/AppConfig';
```

### Issue 2: Tone.js Transport Errors (IN PROGRESS)
**Problem**: Console errors about Transport timing

**Status**: App renders but reference melody playback may be affected

**Next Step**: Debug Tone.Part initialization and Transport.start()

## Testing Notes (Nov 25, 2024)

### What's Working ✅
- App loads in Electron window
- Title and UI render correctly
- Falling notes visualization displays
- Piano keyboard renders with correct range
- MIDI device connects (MPK Mini 3)
- Song loads (Canon in D)
- Configuration system functional

### What Needs Testing ⚠️
- Reference melody playback (Tone.js errors)
- Adaptive key mapping with real MIDI input
- Audio feedback quality (detuning, timbre, volume)
- Distribution tightening over time
- Progress tracking and persistence
- Manual controls (tempo, distribution, volume)

## Design Philosophy

### Iterative Development
All parameters are tunable because we expect to iterate:
- Audio feedback weights may need adjustment
- Distribution tightening rate needs real-world testing
- Reference melody fade curve is a guess
- Visual feedback intensity is subjective

### No Over-Engineering
- Simple piano synthesis (not sampled)
- Basic waveforms (triangle, sawtooth, square)
- Gaussian distribution (not complex ML)
- localStorage (not database)

Keep it simple, make it work, iterate based on real use.

## Future Ideas (Post-MVP)

### Song Features
- Multi-track songs (melody + accompaniment)
- Chord support (not just single notes)
- Custom song import
- Difficulty ratings

### Learning Features
- Hand separation (left/right)
- Sight-reading mode (no audio hints)
- Speed training (increasing tempo)
- Accuracy challenges

### Analytics
- Session history graphs
- Heatmap of problem keys
- Learning rate calculation
- Optimal practice time recommendations

### Social
- Share progress
- Leaderboards
- Custom playlists

## Project Name: "The Tightening"

**Tagline**: "From any key to the right key"

The name reflects the core mechanic - the gradual tightening of the probability distribution that guides learners from complete freedom to precise accuracy.

## Repository

**GitHub**: https://github.com/kenEldridge/the-tightening

## License

TBD

## Credits

- Developed by Ken Eldridge
- Powered by Claude (Anthropic)
- Canon in D by Johann Pachelbel (public domain)
- MIDI file from MidiFind.com

## Dev Testing

**Primary test song: Hey Jude** - Do NOT modify the hey-jude.mid file