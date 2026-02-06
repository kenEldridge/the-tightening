# 🎹 The Tightening

> **From any key to the right key**

A piano learning app that lets you play the melody from day one. Import YouTube tutorials, practice with video frames showing hand positions, and get real-time feedback from your microphone or MIDI keyboard.

![The Tightening Logo](https://img.shields.io/badge/status-alpha-orange) ![Electron](https://img.shields.io/badge/electron-latest-47848F?logo=electron) ![React](https://img.shields.io/badge/react-18-61DAFB?logo=react)

---

## 🎯 What It Does

### Learn From YouTube Tutorials
1. Paste a YouTube URL of a piano tutorial
2. The app extracts the audio and detects notes
3. Video frames are captured showing hand positions
4. Practice the passage with audio + visual guidance
5. Get feedback comparing your playing to the tutorial

### Adaptive Key Mapping (The Core Idea)
Traditional piano learning: **"You pressed the wrong key. Try again."**

The Tightening: **"Great! You played the melody. Now let's make it sound even better."**

- **Day 1**: Press ANY key → It plays the correct melody note
- **Week 2**: Wrong keys still work but sound slightly off
- **Month 2**: Distribution tightens → You're playing correctly

---

## ✨ Features

### YouTube Import
- 📺 **Paste any YouTube URL** - Piano tutorials, lessons, performances
- 🎵 **Automatic note detection** - Extracts notes from audio (pitchy)
- 🖼️ **Video frame extraction** - Captures hand positions at each note
- ✂️ **Passage selection** - Select specific sections to practice
- 🔁 **Loop practice** - Repeat passages until mastered

### Practice Mode
- 🎬 **Video frames** - See hand positions synced to audio playback
- 🎤 **Microphone input** - Play your piano, get real-time feedback
- 🎹 **MIDI input** - Connect a MIDI keyboard for precise input
- 📊 **Performance stats** - Accuracy, hits, misses, extras
- 🔄 **Loop toggle** - Keep practicing the same passage

### Sheet Music OCR (Experimental)
- 🤖 **AI vision** - Uses local Ollama + llava model
- 📝 **Read notation** - Extracts notes from sheet music in video frames
- 🎯 **More reliable** - Better than audio detection when notation is visible

### Core Learning System
- 🎹 **Adaptive Key Mapping** - Gaussian distribution guides you to correct keys
- 🎵 **Accompaniment Mode** - Chords play while you play melody
- 📊 **Confusion Matrix** - Tracks hits, misses, extras (not just %)
- 🎮 **Guitar Hero Style** - Notes fall onto keyboard keys

### Song Library
- **51,000+ MIDI files** indexed
- **33,000 unique songs** with smart deduplication
- Searchable by name, artist, category

---

## 🚀 Quick Start

### Prerequisites
- **Node.js** (latest LTS)
- **yt-dlp** (for YouTube extraction): `pip install yt-dlp`
- **ffmpeg** (for audio processing): Install via your package manager
- **MIDI Keyboard** (optional) or **Microphone** for input

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

### Optional: Sheet Music OCR Setup

For AI-powered sheet music reading (when videos show notation):

```bash
# Windows (recommended - needs 8GB+ RAM)
# Download from https://ollama.com/download/windows
# Then in PowerShell:
ollama pull llava

# macOS
# Download from https://ollama.com/download/mac
ollama pull llava

# Linux
curl -fsSL https://ollama.com/install.sh | sh
ollama serve &
ollama pull llava
```

---

## 🎮 Usage

### Import a YouTube Tutorial
1. Click the **YouTube** button
2. Paste a tutorial URL
3. Wait for audio extraction and note detection
4. Click **Extract Video Frames** to capture hand positions
5. Select a passage by clicking start/end points on the timeline
6. Click **Practice This Passage**

### Practice Mode
- **Play** - Start the audio and video frame playback
- **Loop ON/OFF** - Toggle looping (on by default)
- **MIC OFF/ON** - Enable microphone to detect your playing
- Watch the stats bar for accuracy feedback

### Input Modes
- **Microphone** - Play an acoustic/electric piano near your computer
- **MIDI** - Connect a MIDI keyboard (lower latency, more precise)

---

## 🛠️ Tech Stack

| Category | Technology |
|----------|-----------|
| **Desktop** | Electron |
| **Frontend** | React 18 + TypeScript + Vite |
| **Audio** | smplr (piano samples) + Tone.js + pitchy (pitch detection) |
| **Video** | yt-dlp + ffmpeg + HTML5 Canvas |
| **MIDI** | Native `midi` package + @tonejs/midi |
| **AI Vision** | Ollama + llava (optional, for sheet music OCR) |

---

## 📁 Project Structure

```
the-tightening/
├── src/
│   ├── App.tsx                      # Main application
│   ├── config/AppConfig.ts          # Central configuration
│   ├── components/
│   │   ├── YouTubeImporter.tsx      # YouTube URL input & extraction
│   │   ├── PracticeFrameDisplay.tsx # Video frame practice mode
│   │   ├── AdaptiveKeyMapper.ts     # Core algorithm
│   │   ├── AudioEngine.ts           # Piano synthesis
│   │   ├── FallingNotesCanvas.tsx   # Guitar Hero visualization
│   │   └── VisualKeyboard.tsx       # Piano display
│   ├── core/
│   │   ├── MicrophoneInput.ts       # Mic audio capture
│   │   ├── PitchDetector.ts         # Note detection from audio
│   │   ├── ComparisonEngine.ts      # Compare played vs expected
│   │   ├── VideoAnalyzer.ts         # Extract notes from video audio
│   │   └── SheetMusicOCR.ts         # AI vision for notation
│   └── data/
│       └── loadSongs.ts             # Song library
├── electron/
│   ├── main.ts                      # Electron main process
│   └── preload.ts                   # IPC bridge
├── public/
│   ├── songs/                       # Built-in MIDI files
│   └── song-index.json              # Searchable index
└── research/                        # Music theory explorations
```

---

## 🐛 Known Issues & Roadmap

### Current Limitations
- Audio pitch detection can be unreliable (3-9 notes instead of 16)
- Sheet music OCR requires 8GB+ RAM for the AI model
- Some YouTube videos may fail to extract

### Roadmap
- [x] YouTube video import
- [x] Video frame extraction
- [x] Microphone input mode
- [x] Practice mode with looping
- [x] Real-time comparison feedback
- [ ] Sheet music OCR testing & refinement
- [ ] Hand separation (left/right)
- [ ] Session history graphs
- [ ] Karaoke file support (.kar)

---

## 🤝 Contributing

Contributions welcome! See [CLAUDE.MD](./CLAUDE.MD) for detailed documentation.

```bash
npm run dev      # Start development
npm run build    # Build for production
npm run lint     # Run ESLint
```

---

## 📜 License

TBD

---

## 🙏 Credits

- **Created by**: Ken Eldridge
- **AI Pair Programming**: Claude (Anthropic)
- **Audio/Video**: yt-dlp, ffmpeg, pitchy
- **Piano Samples**: smplr (SplendidGrandPiano)

---

**Built with ❤️ and a lot of Gaussian distributions**
