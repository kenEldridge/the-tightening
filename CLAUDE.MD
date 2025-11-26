# Music Learning App

## Project Overview

This is an **Electron-based desktop application** designed to help users learn music through real-time MIDI input and interactive feedback. The project is currently in **Phase 0 (Technical Validation)** - proving that the core technical requirements can be met before building the full feature set.

## Current Phase: Phase 0 - Validation

### Goals
Validate that the application can achieve the performance characteristics required for a responsive music learning experience:

1. **MIDI Latency**: < 20ms (input lag from MIDI device to application)
2. **Audio Latency**: < 50ms (time from trigger to sound output)
3. **Rendering Performance**: 60fps (smooth visual feedback)

### Success Criteria
All three metrics must be consistently achieved on target hardware:
- ✅ MIDI latency < 20ms
- ✅ Audio latency < 50ms
- ✅ Rendering at 60fps

## Tech Stack

### Frontend
- **React 18** - UI framework
- **TypeScript** - Type safety
- **Vite** - Build tool and dev server

### Desktop
- **Electron** - Cross-platform desktop app wrapper
- Dev server runs on `localhost:5173`
- Window size: 1200x800px

### Audio & MIDI
- **Tone.js** - Web Audio API wrapper for synthesis and timing
  - Configured with `latencyHint: 'interactive'`
  - Look-ahead set to 50ms for balance between latency and stability
- **WebMidi** - MIDI device communication
  - Primary target: Akai Mini keyboard controller
  - Captures note on/off events with velocity

### Rendering
- **HTML5 Canvas** - Visual feedback system
  - Configured with `desynchronized: true` for lower latency
  - `alpha: false` for better performance

## Project Structure

```
music-learning-app/
├── src/
│   ├── App.tsx              # Main validation UI and logic
│   ├── App.css              # Application styles
│   ├── main.tsx             # React entry point
│   ├── index.css            # Global styles
│   ├── main/
│   │   └── index.ts         # Electron main process
│   ├── renderer/            # Future renderer process code
│   └── assets/              # Static assets
├── dist-electron/
│   └── index.js             # Compiled Electron main
├── public/                  # Static public files
├── index.html               # HTML entry point
└── tsconfig.*.json          # TypeScript configurations
```

## Key Files

### `src/App.tsx`
The main validation interface containing:
- MIDI device initialization and event handling
- Audio context setup with Tone.js
- Canvas animation loop for FPS testing
- Real-time metrics display and logging
- Success criteria dashboard

### `dist-electron/index.js` / `src/main/index.ts`
Electron main process:
- Creates 1200x800 BrowserWindow
- Loads Vite dev server (localhost:5173)
- DevTools enabled by default
- Context isolation enabled for security

## Current Features

### 1. MIDI Testing
- Auto-detects and connects to first available MIDI device
- Displays device name and connection status
- Logs last 10 MIDI events (note on/off)
- Shows note name, octave, MIDI number, and velocity
- Calculates and displays per-event latency
- Computes average MIDI latency across all events

### 2. Audio Testing
- Manual initialization (click "Initialize Audio & Play Test Note")
- Plays synthesized notes when MIDI keys are pressed
- Measures and displays audio context latency
- Plays test note (C4) on initialization
- Real-time synthesis responds to MIDI input

### 3. Rendering Testing
- Animated falling rectangle on canvas
- Real-time FPS counter
- Updates every second
- Visual confirmation of 60fps capability

## Performance Targets Explained

### Why < 20ms MIDI Latency?
Human perception of timing in music is extremely sensitive. Latencies above 20ms become noticeable and can disrupt the playing experience, especially for rhythm-based learning.

### Why < 50ms Audio Latency?
Combined with MIDI latency, this keeps total input-to-output delay under 70ms, which is the threshold where most musicians start to perceive lag as problematic.

### Why 60fps?
Smooth visual feedback is critical for timing-based exercises. Lower frame rates create jitter that can confuse learners trying to match visual cues to audio.

## Development Setup

### Prerequisites
- Node.js (version unknown - check package.json when it exists)
- MIDI device (Akai Mini or compatible)
- Modern browser with Web MIDI API support

### Running the App
```bash
# Install dependencies
npm install

# Start dev server
npm run dev

# Start Electron app (in another terminal)
npm run electron:dev
```

## Known Technical Decisions

1. **No package.json in root** - This appears to be missing or the project structure needs investigation
2. **DevTools always open** - Configured for development phase
3. **Single MIDI device** - Currently uses first detected device only
4. **Monospace font** - Used throughout for technical/debugging aesthetic

## Next Steps (Post Phase 0)

Once validation is complete, likely next phases:
1. **Phase 1**: Core learning features
   - Note recognition exercises
   - Timing/rhythm training
   - Visual note display (staff or piano roll)

2. **Phase 2**: Progress tracking
   - Session history
   - Performance metrics
   - Difficulty progression

3. **Phase 3**: Advanced features
   - Multiple exercise types
   - Custom song import
   - Recording and playback

## Common Issues & Solutions

### MIDI Device Not Detected
- Ensure device is connected before opening app
- Refresh the page after connecting device
- Check browser MIDI permissions

### High Latency
- Close other audio applications
- Check audio driver settings (ASIO on Windows recommended)
- Reduce browser extensions

### Low FPS
- Check GPU acceleration is enabled
- Close other GPU-intensive applications
- Monitor CPU usage

## Development Notes

- The app requires user interaction to start audio (browser security requirement)
- MIDI events are logged with timestamps for debugging
- Canvas uses `desynchronized` rendering for lower latency
- Electron enables Web MIDI API by default

## File Naming Conventions

- React components: PascalCase (.tsx)
- Styles: Same name as component (.css)
- Config files: lowercase with dots (tsconfig.json)

## Questions for Development

1. Should we support multiple MIDI devices simultaneously?
2. What's the target minimum system requirements?
3. Should there be an option to test without MIDI device (keyboard input)?
4. What platforms are we targeting? (Windows/Mac/Linux)
