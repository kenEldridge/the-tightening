# 🎹 The Tightening

> **From any key to the right key**

A revolutionary piano learning app that lets you play the melody from day one. No frustration. No wrong notes. Just gradual, natural improvement through adaptive key mapping and audio feedback.

![The Tightening Logo](https://img.shields.io/badge/status-alpha-orange) ![MIT License](https://img.shields.io/badge/license-TBD-blue) ![Electron](https://img.shields.io/badge/electron-latest-47848F?logo=electron) ![React](https://img.shields.io/badge/react-18-61DAFB?logo=react)

---

## 🎯 The Big Idea

Traditional piano learning: **"You pressed the wrong key. Try again."**

The Tightening: **"Great! You played the melody. Now let's make it sound even better."**

### How It Works

1. **Phase 1 - Complete Freedom** (Day 1)
   - Press **ANY key** on your MIDI keyboard
   - It plays the correct melody note
   - You're playing Canon in D from minute one!

2. **Phase 2 - Gentle Guidance** (Weeks 1-4)
   - Wrong keys still play the melody
   - But they sound slightly off (detuned, different timbre, quieter)
   - Correct keys sound perfect
   - Your brain naturally gravitates toward better-sounding keys

3. **Phase 3 - Mastery** (Month 2+)
   - Distribution has tightened to correct keys only
   - You're playing the actual song correctly
   - You learned without frustration

## 🧠 The Science

**Adaptive Key Mapping** using Gaussian probability distributions:

```
accuracy = e^(-distance² / (2σ²))
```

- **Initially**: σ = 44 semitones → all 88 keys work equally
- **Progressively**: σ gradually decreases based on your performance
- **Finally**: σ = 0.5 semitones → only correct keys sound good

**Audio Feedback** with three tunable mechanisms:
- **Detuning**: ±50 cents pitch shift for wrong keys
- **Timbre**: Low-pass filter reduces brightness (10kHz → 500Hz)
- **Volume**: Up to 50% quieter for wrong keys

All parameters are **fully configurable** - we expect to iterate based on real use.

---

## ✨ Features

### Core
- 🎹 **Adaptive Key Mapping** - ANY key plays melody initially
- 🎵 **Accompaniment Mode** - Chord progressions play while you play melody
- 📊 **Confusion Matrix Tracking** - Hits, misses, extras (not just %)
- 🎮 **Notes Land on Keyboard** - Guitar Hero style, notes fall directly onto keys
- 💥 **Impact Effects** - Visual ripple/flash when notes hit
- 🎛️ **Collapsible Sidebar** - Maximize screen space for practice
- 🎤 **Lyrics Display** - Section names and lyrics for songs that have them

### Technical
- ⚡ **Low Latency** - <20ms MIDI, <50ms audio
- 🎨 **60fps Rendering** - Canvas + SVG with React.memo optimization
- 📐 **Responsive Layout** - Fills available screen space
- 💾 **Progress Persistence** - LocalStorage save/load
- 🎚️ **Fully Tunable** - Single config file controls all behavior

### Current Songs
- Canon in D (Pachelbel)
- Hey Jude (The Beatles) - with section lyrics

---

## 🚀 Quick Start

### Prerequisites
- **Node.js** (latest LTS)
- **MIDI Keyboard** (tested with Akai MPK Mini 3)
- **Git**

### Installation

```bash
# Clone the repository
git clone https://github.com/kenEldridge/the-tightening.git
cd the-tightening

# Install dependencies
npm install

# Run the app
npm run dev
```

The app will open in Electron. Click **Play** to start!

---

## 🎮 Usage

### First Time Setup
1. Connect your MIDI keyboard before opening the app
2. Click the **Play** button to initialize audio
3. Start playing any keys - you're playing Canon in D!

### Practice Controls
- **Play/Pause** - Control playback
- **Tempo Slider** - Adjust speed (40-200 BPM)
- **Distribution Width** - Manual difficulty control
- **Reference Volume** - Adjust background melody
- **Auto Progression** - Toggle automatic tightening

### Understanding the UI
- **Falling Notes** - Notes fall directly onto keyboard keys with impact effects
- **Piano Keyboard** - Keys glow when notes land, distribution shown as gradient
- **Collapsible Sidebar** - Click ◀/▶ to show/hide controls
- **Stats Dashboard** - Progress, accuracy, streaks, confusion matrix

---

## 🛠️ Tech Stack

| Category | Technology |
|----------|-----------|
| **Desktop** | Electron |
| **Frontend** | React 18 + TypeScript + Vite |
| **Audio** | smplr (SplendidGrandPiano samples) + Tone.js (timing) |
| **MIDI** | Native `midi` package (via Electron IPC) + @tonejs/midi (parsing) |
| **Visualization** | HTML5 Canvas + SVG + React.memo |
| **Build** | Vite + TypeScript |

---

## 📁 Project Structure

```
the-tightening/
├── src/
│   ├── App.tsx                      # Main application
│   ├── config/
│   │   └── AppConfig.ts            # Central configuration
│   ├── components/
│   │   ├── AdaptiveKeyMapper.ts    # Core algorithm
│   │   ├── AudioEngine.ts          # Piano synthesis (smplr)
│   │   ├── AccompanimentPlayer.ts  # Chord progressions
│   │   ├── ProgressTracker.ts      # Performance + confusion matrix
│   │   ├── FallingNotesCanvas.tsx  # Guitar Hero viz
│   │   ├── VisualKeyboard.tsx      # Piano display
│   │   ├── PracticeControls.tsx    # UI controls
│   │   ├── LyricsDisplay.tsx       # Section lyrics
│   │   └── TheTighteningLogo.tsx   # Branding
│   ├── utils/
│   │   ├── midiParser.ts           # MIDI file parsing
│   │   └── logger.ts               # Logging utility
│   └── data/
│       ├── loadSongs.ts            # Song library
│       ├── songMetadata.ts         # Manual sections/lyrics
│       └── chordProgressions.ts    # Chord data per song
├── public/
│   └── songs/                      # MIDI files (canon-in-d, hey-jude)
├── CLAUDE.MD                       # Detailed docs
└── README.md                       # You are here!
```

---

## ⚙️ Configuration

All behavior is controlled by `src/config/AppConfig.ts`:

```typescript
{
  distribution: {
    initialWidth: 44,      // All keys work
    finalWidth: 0.5,       // Only correct keys
    autoTighteningRate: 0.01
  },
  audioFeedback: {
    detuning: { enabled: true, maxCents: 50, weight: 0.4 },
    timbre: { enabled: true, filterReduction: 2000, weight: 0.3 },
    volume: { enabled: true, maxReduction: 0.5, weight: 0.3 }
  },
  progression: {
    autoMode: true,
    accuracyThreshold: 0.7  // 70% to trigger tightening
  }
}
```

See [CLAUDE.MD](./CLAUDE.MD) for complete configuration reference.

---

## 🐛 Known Issues

### Recently Fixed
- **Stale closure bug** - Same note playing every time (fixed with refs)
- **Audio degradation cliff** - Width=44 caused sudden quality drop (fixed)
- **Toy piano sound** - Replaced with smplr SplendidGrandPiano samples
- **8-bit melody guide** - Now uses SplendidGrandPiano, plays 1 octave lower
- **Confusing UI** - Responsive layout, notes land on keyboard, impact effects
- **Excessive re-renders** - Components memoized with React.memo

### Roadmap
- [x] ~~Fix Tone.js timing errors~~ (replaced with smplr)
- [x] ~~Add more songs to library~~ (Hey Jude added)
- [x] ~~Add confusion matrix tracking~~ (hits/misses/extras)
- [x] ~~Add lyrics/sections display~~
- [x] ~~UI overhaul~~ (responsive, notes land on keys, impact effects)
- [ ] Karaoke file support (.kar with embedded lyrics)
- [ ] Test adaptive key mapping with real users
- [ ] Implement hand separation (left/right)
- [ ] Add session history graphs
- [ ] Custom song import

See [Issues](https://github.com/kenEldridge/the-tightening/issues) for full list.

---

## 🤝 Contributing

This project is in **early alpha**. Contributions, ideas, and feedback are welcome!

### Ways to Contribute
- 🎵 **Add songs** - Find/create public domain MIDI files
- 🐛 **Report bugs** - Open an issue
- 💡 **Suggest features** - What would help you learn?
- 🎹 **Test with real keyboards** - Share your experience
- 📖 **Improve docs** - Clarity is key

### Development Setup
```bash
npm run dev      # Start development server
npm run build    # Build for production
npm run lint     # Run ESLint
```

---

## 📚 Learn More

- **Detailed Documentation**: [CLAUDE.MD](./CLAUDE.MD)
- **Algorithm Deep Dive**: See `src/components/AdaptiveKeyMapper.ts`
- **Configuration Guide**: See `src/config/AppConfig.ts`

---

## 🎼 The Name

**"The Tightening"** refers to the core mechanic: the gradual tightening of the probability distribution that guides learners from complete freedom to precise accuracy.

Chaos → Order. Any key → The right key.

---

## 📜 License

TBD

---

## 🙏 Credits

- **Created by**: Ken Eldridge
- **AI Pair Programming**: Claude (Anthropic)
- **Music**: Canon in D by Johann Pachelbel (public domain)
- **MIDI Source**: [MidiFind.com](https://midifind.com)

---

## 🌟 Star History

If this project helps you learn piano, consider giving it a star! ⭐

---

**Built with ❤️ and a lot of Gaussian distributions**
