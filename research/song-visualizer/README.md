# Song Structure Visualizer

A React webapp for visualizing song structure as flowchart-style tiles. Break down songs into component pieces (Intro, Verse, Chorus, etc.) with notes and lyrics.

## What It Is

This tool helps learn song structure by creating a visual flowchart of segments. Each tile shows:
- Segment name (Verse 1, Chorus, etc.)
- Note sequence (abbreviated on tile, full in hover tooltip)
- Lyrics (shown on hover)
- Connections between segments (how the song flows)

**Use case**: "I know the melody, this is to teach me the structure of the song"

## Quick Start

```bash
# From this directory
npm install
npm run dev
# Opens http://localhost:5173
```

## Features

- Visual tiles showing segment names and abbreviated notes
- Hover tooltip displays full notes and lyrics
- Drag tiles to reposition
- Click blue + icon on tile to create connections
- Auto-arrange button (horizontal flow, left-to-right)
- Zoom controls (+/-, 25%-200%)
- Download/upload JSON files
- Dark mode UI

## Creating Songs

Songs are JSON files. You can either:
1. Use the UI to create songs and segments via modals
2. Create JSON files manually in `public/songs/`

### JSON Format

```json
{
  "title": "Song Name",
  "artist": "Artist Name (optional)",
  "segments": [
    {
      "id": "seg-intro",
      "name": "Intro",
      "notes": "C G Am F",
      "lyrics": ["Line 1", "Line 2"]
    },
    {
      "id": "seg-verse",
      "name": "Verse 1",
      "notes": "A B Db D E F E D D",
      "lyrics": ["Verse line 1", "Verse line 2"]
    }
  ],
  "connections": [
    {
      "from": "seg-intro",
      "to": "seg-verse",
      "label": "Intro to Verse"
    }
  ],
  "positions": {
    "seg-intro": { "x": 50, "y": 200 },
    "seg-verse": { "x": 300, "y": 200 }
  }
}
```

## Tech Stack

- React 18
- Vite
- Pure CSS (no UI libraries)

## Known Issues

Current problems (documented but not yet fixed):
- Tiles stuck at bottom of viewport (vertical centering issue)
- Connection labels sometimes overlap tiles
- Overall cramped appearance

See main project notes for details on fixing these if you want to tackle them.

## Difference from The Tightening

- **The Tightening**: Interactive MIDI practice tool with adaptive learning
- **Song Visualizer**: Static analysis tool for understanding song structure

This is a complementary tool for a different aspect of music learning.

---

_Part of The Tightening research explorations_
