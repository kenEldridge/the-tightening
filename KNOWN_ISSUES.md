# Known Issues - The Tightening

Last updated: Nov 28, 2024

## RESOLVED

### 1. 8-Bit Dog-Smacking Sound Quality
**Status:** FIXED in commit (pending)
**File:** `src/components/ReferenceMelody.ts`

**Problem:** The ReferenceMelodyPlayer was using a raw Tone.js PolySynth with a triangle wave oscillator instead of professional piano samples. This made the melody guide sound like a 1970s 8-bit game.

**Solution:** Replaced PolySynth with SplendidGrandPiano (same as AudioEngine and AccompanimentPlayer).

---

### 2. Same-Octave Melody Collision
**Status:** FIXED in commit (pending)
**File:** `src/components/ReferenceMelody.ts`

**Problem:** Guide melody played the SAME notes at the SAME octave as the user, causing:
- Phase interference (frequencies cancel/amplify unpredictably)
- Masking (one voice drowns out the other)
- "Muddy" sound

**Solution:** Added configurable `octaveOffset` parameter (default: -12 semitones = 1 octave down). Playing the guide melody lower creates natural bass+melody harmony instead of collision.

**Physics explanation:**
- Same pitch = phase interference possible
- Octave apart (2:1 frequency ratio) = harmonic reinforcement
- This is how all music works - bass supports melody

---

### 3. LRC Lyrics Timing and Missing Bridge
**Status:** FIXED in commit (pending)
**File:** `public/songs/hey-jude.lrc`

**Problem:** LRC timestamps were ~27 seconds off (synced to original Beatles recording, not MIDI file). Also missing the Bridge section entirely.

**MIDI structure discovered:**
- Section 1: 5.68s - Verse 1
- Section 2: 58.99s - Verse 2
- Section 3: 99.73s - Bridge (was MISSING from LRC)
- Section 4: 127.09s - Verse 3
- Section 5: 167.84s - Outro

**Solution:** Complete rewrite of LRC with correct timestamps matching MIDI and added Bridge section. Placeholder lyrics kept for now.

---

## OPEN ISSUES

### 4. Excessive Re-renders (Medium Priority)
**Status:** Open
**Files:** `src/App.tsx`, `src/config/AppConfig.ts`

App component renders ~60x/second during playback (every 16ms tick), and `loadConfig()` reads from localStorage on EVERY render. This is unnecessary overhead.

**Potential fix:** Memoize config loading, only load on mount.

---

## Notes

When adding new issues:
1. Add to "OPEN ISSUES" section
2. Include: Status, File(s), Problem description, Potential fix
3. Move to "RESOLVED" when fixed with solution description
