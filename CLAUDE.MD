# The Tightening - Adaptive Piano Learning App

## Project Overview

**"The Tightening"** is an innovative Electron-based desktop application that teaches piano through a revolutionary adaptive key mapping approach. Unlike traditional learning tools, this app lets you play ANY key initially and gradually guides you to the correct keys through audio feedback and probabilistic distribution tightening.

## Current Status (Feb 8, 2026)

**Phase 1 COMPLETE + YouTube Practice Mode**

### Working Features
- Professional piano sound via **smplr SplendidGrandPiano**
- MIDI keyboard input (Akai MPK Mini 3 tested)
- Accompaniment mode (chords play while user plays melody)
- **Melody guide plays 1 octave lower** for bass+melody harmony (configurable)
- Adaptive key mapping with Gaussian distribution
- Audio degradation for wrong keys (detuning + volume)
- Progress tracking with **confusion matrix** (hits/misses/extras)
- Lyrics display with meaningful song sections
- **Guitar Hero falling notes** - notes fall directly onto keyboard
- **Impact effects** - visual ripple/flash when notes land
- Visual piano keyboard with distribution glow
- **Collapsible sidebar** - maximize screen space for practice
- **Responsive layout** - fills available screen space
- **Smart song search** - 51K+ MIDI files with aggressive deduplication
- Song library: **33K unique songs** (51K files with variants grouped)

### YouTube Practice Mode (NEW)
- **Import from YouTube** - Paste any piano tutorial URL
- **Claude Vision OCR** - Reads sheet music directly from video frames
- **Frame extraction** - Syncs hand position video with notes
- **Scrolling note display** - Horizontal timeline with NOW marker
- **Auto-scroll notes list** - Right panel keeps current notes visible
- **Visual keyboard sync** - Highlights current notes during playback
- **Test mode** - `npm run dev:test` loads cached data for rapid iteration

### Debug Infrastructure (NEW)
- **Screenshot capture** - IPC-based capture at key moments
- **Log monitoring** - All renderer logs written to `main.log`
- **Cached OCR** - Results stored per video/segment for reuse

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
- **HTML5 Canvas** - Falling notes with impact effects
- **SVG** - Piano keyboard with glow effects
- **React.memo** - Memoized components for performance

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
│   │   ├── SongSearch.tsx               # Song search with grouping
│   │   ├── TheTighteningLogo.tsx        # Logo component
│   │   ├── YouTubeImporter.tsx          # YouTube video import + OCR
│   │   ├── PracticeFrameDisplay.tsx     # Video frame + notes playback
│   │   └── ScrollingSheetMusic.tsx      # Horizontal scrolling notes
│   ├── core/
│   │   ├── SheetMusicOCR.ts             # Claude Vision API for reading notation
│   │   ├── VideoAnalyzer.ts             # Audio pitch detection (backup)
│   │   └── MicrophoneInput.ts           # Mic input for pitch detection
│   ├── test/
│   │   ├── TestPracticeMode.tsx         # Standalone test with cached data
│   │   └── fixtures/testSegment.ts      # Test data configuration
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

### Song Search & Library

**51,559 MIDI files** indexed with smart deduplication:

- **Searchable index**: `public/song-index.json` (~21 MB)
- **Aggressive grouping**: All songs with same name grouped (ignores folder/artist)
- **Variant detection**: Key variations (-C120), versions (2, 3), formats (MM GM/XG)
- **Primary selection**: Best version shown, others accessible via "+X ver" badge

Build/rebuild index: `npm run build-index`

### Included Collections
- **50000midifiles.zip** - Extracted to 46,853 files
- **Classical Archives** - 4,704 classical pieces
- Built-in songs: Hey Jude, Canon in D

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
6. **8-bit melody guide sound**: ReferenceMelody now uses SplendidGrandPiano
7. **Same-octave collision**: Melody guide plays 1 octave lower (configurable)
8. **Confusing vertical distribution glow**: Removed from falling notes, kept on keyboard
9. **Unclear hit point**: Notes now fall directly onto keyboard keys
10. **Fixed layout wastes space**: Responsive flexbox layout fills screen
11. **Excessive re-renders**: Config was being loaded 60x/second during playback - fixed with lazy initializer
12. **Screenshot path wrong**: Was saving to `AppData/projects/` instead of `projects/` - needed 3 parent traversals not 2
13. **Notes list scrolls off**: Current "NOW" notes would scroll off top - added auto-scroll to keep current note centered

## UI Layout

The app uses a responsive flexbox layout:

```
┌─────────────────────────────────────────────┬─────────┐
│  Logo + Status (compact header)             │ [◀/▶]   │
├─────────────────────────────────────────────┤ Sidebar │
│                                             │         │
│  FALLING NOTES (fills available height)     │ Play/   │
│  - Notes fall into lanes aligned with keys  │ Pause   │
│  - Impact effects when notes land           │ Stats   │
│           ↓  ↓  ↓  ↓  ↓                    │ Tempo   │
├─────────────────────────────────────────────┤ etc     │
│  KEYBOARD (notes land directly on keys)     │         │
│  - Distribution glow shown on keys          │         │
│  - Keys light up when notes arrive          │         │
├─────────────────────────────────────────────┤         │
│  LYRICS / SECTION                           │         │
└─────────────────────────────────────────────┴─────────┘
```

**Key Design Decisions:**
- Notes fall to keyboard (no separate hit line)
- Sidebar collapses to maximize practice space
- Distribution glow on keyboard (horizontal = intuitive)
- Impact effects provide satisfying visual feedback

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

## YouTube Practice Mode

### How It Works
1. **Import**: Paste YouTube tutorial URL (e.g., piano tutorials with sheet music)
2. **Download**: yt-dlp extracts video + audio
3. **Frame Extraction**: FFmpeg captures frames at note timestamps
4. **OCR Analysis**: Claude Vision reads sheet music from frames
5. **Practice**: Scrolling notes synced to video frames and audio

### Test Mode
Run `npm run dev:test` to bypass YouTube and use cached data:
- Loads from `extracted-audio/cache/{videoId}.json`
- Uses frames from `extracted-audio/frames/{videoId}/`
- OCR results cached per segment: `{videoId}_ocr_{start}_{end}`

### Screenshot Debugging
The app can capture screenshots at key moments via IPC:
```typescript
window.electronAPI.debugScreenshot('label')  // Capture with label
window.electronAPI.debugScreenshotReset()    // Clear old captures
```
Captures saved to: `visuals_for_claude/captures/`

### Sheet Music OCR
Uses Claude Vision API (requires `VITE_ANTHROPIC_API_KEY` in `.env`):
- Analyzes 3 sample frames (beginning, middle, end)
- Extracts: notes, key signature, time signature, chords
- Converts to timed MelodyNote format using tempo inference

## Future Ideas

- **MIDI keyboard integration** with YouTube practice
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
