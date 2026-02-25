# The Tightening - Key Lessons

## Wait Mode Bug (Feb 17, 2026)

**Root causes of "wait mode just plays through":**

1. **stale closure in setInterval**: `isWaiting` state captured in closure was always the
   value from when the effect last ran. Fixed by adding `isWaitingRef` (a ref that's always
   current) and using `isWaitingRef.current` instead of the closure value.

2. **hitNoteIndicesRef polluted by normal play**: `handleNoteOn` adds note indices to
   `hitNoteIndicesRef` during normal (non-waiting) playback. The wait mode skipped notes
   already in this set, so playing along disabled all future waits. Fixed by removing the
   `unhitNotes` filter from `checkForWait` - wait mode now pauses for ALL new note groups.

3. **lastWaitNoteIndexRef not reset on stop/loop**: When audio stopped or looped,
   `lastWaitNoteIndexRef` retained its old value, causing early notes to be skipped on
   restart. Fixed by resetting to -1 in the stop effect and in `handleTimeUpdate` on loop
   detection (time jumped backward > 1s).

**Pattern**: For setInterval callbacks that read React state, always use a ref to mirror
the state, and set the ref immediately (synchronously) when changing the state.

## Architecture Notes

- Test mode: `npm run dev:test` loads cached OCR data from `extracted-audio/cache/{videoId}.json`
- Screenshots saved to `visuals_for_claude/captures/` via IPC `debugScreenshot('label')`
- Log file: `C:\Users\eldri\AppData\Roaming\the-tightening\logs\main.log`
- AppConfig is being loaded 4x per timeupdate (existing perf issue, not fixed here)
