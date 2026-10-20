# Changelog

Notable changes to Chord Walk, starting from this entry.

## [3.7.0] - 2026-10-20

### Added
- **Home key** (Jam mode): pick a major key in the sidebar (remembered across
  sessions). The key's seven chords are outlined in gold with Roman-numeral
  tags, the tonic gets an extra ring, out-of-key chords fade back, and the
  chord banner shows the played chord's numeral (gold in key, orange
  outside — e.g. "Ab · IV", "Db · bVII"). With Zoom on, the camera frames
  the key. A set home key also takes over the Jam tab's circle even when a
  Walk path exists.
- **Triad & inversion tracker**: a "Track triads & inversions" checkbox
  under the home key. Each diatonic chord gets a three-arc ring (root
  position, 1st, 2nd inversion) that turns green once that exact voicing is
  played, plus sidebar dots, an N/21 count and Reset. Session-only.
- **Scales panel** under the progression input: lists the scales that fit
  a progression — live while typing, or for any saved progression —
  preferring the first chord as tonic, with near misses when nothing fits.
- 7sus4 chord detection, with a V→I hint arrow like a dominant 7th.
- Diatonic moves into vii°: ii → vii°, IV → vii°, V → vii° and vii° → V.
  Previously the only ways onto a diminished chord were from I, vi or
  another diminished chord.

### Changed
- Diatonic is now on by default in Jam's "Suggest next" arrows.
- Edges between nearby nodes arc outward instead of running straight, so
  short moves (neighbouring dim chords, relative major ↔ minor) show a
  visible line and arrowhead. Neighbouring dim chords previously got no
  edge at all.
- Chord tones are always shown on the inner (diminished) ring, at a
  readable size, instead of only while the chord was active.

### Fixed
- Sus chords weren't recognised in practice: since they contain no triad,
  the chord banner, Jam node glow and suggestion arrows ignored them. They
  now count as the chord they suspend (Csus4 → C).
- Ambiguous sus voicings take the bass note as the root (A-B-E with A in
  the bass is Asus2, not Esus4), and a 3-note reading inside a 4-note chord
  is no longer listed separately (G7sus4 no longer also shows Csus4).

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
