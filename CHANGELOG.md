# Changelog

Notable changes to Chord Walk, starting from this entry.

## [3.6.0] - 2026-09-16

### Added
- 6th-chord detection (`6`/`m6`). A 6th chord is pitch-class-identical to a m7/m7b5
  a third away (e.g. Eb-G-Bb-C is both Eb6 and Cm7) — both readings now show
  side by side instead of the detector silently picking one.
- Chord-name banner on the Circle of Fifths (top-left corner), showing the
  currently — or most recently — recognized chord(s), so you don't need the
  sidebar's Held Notes panel open to see what you're playing.
- Inversion labeling: chord names carry a superscript tick per inversion
  (e.g. C′ for 1st inversion, C″ for 2nd), based on which chord tone is in
  the bass.
- Visible short-label badges on extended-chord hint arrows and Jam mode
  "where next" suggestion arrows on the circle (previously hover-only
  tooltips).
- Quality badge on Jam mode circle nodes: flags when a held chord is
  actually a 7th/sus voicing collapsed onto its triad node for pathfinding
  (dom7/maj7/min7/sus2/sus4), with a colored glyph and hover detail.

### Fixed
- The flats/sharps spelling toggle wasn't respected by held-note names, the
  sidebar's matched-chord list, or extended-chord hint-edge graph lookups —
  the latter silently broke the hint arrows in flats mode, since graph
  lookups were keyed by the display spelling instead of a canonical one.
- The chord-name banner and hint arrows now persist through momentary
  note-release gaps instead of blanking, mirroring how Jam mode's suggestion
  arrows already behaved.
- Inversion labels no longer flicker to the wrong value while releasing a
  chord: the bass note and the chord match are now captured together in the
  same debounced detection pass, instead of on two different update clocks.
