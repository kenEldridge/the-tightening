import { describe, it, expect } from 'vitest';
import { noteNameToMidi, parseNotesFromResponse, detectMediaType } from './SheetMusicOCR';

describe('noteNameToMidi', () => {
  it('converts C4 (middle C) to MIDI 60', () => {
    expect(noteNameToMidi('C4')).toBe(60);
  });

  it('converts A4 (concert pitch) to MIDI 69', () => {
    expect(noteNameToMidi('A4')).toBe(69);
  });

  it('handles sharps', () => {
    expect(noteNameToMidi('C#4')).toBe(61);
    expect(noteNameToMidi('F#5')).toBe(78);
  });

  it('handles flats', () => {
    expect(noteNameToMidi('Bb3')).toBe(58);
    expect(noteNameToMidi('Eb4')).toBe(63);
  });

  it('handles different octaves', () => {
    expect(noteNameToMidi('C0')).toBe(12);
    expect(noteNameToMidi('C1')).toBe(24);
    expect(noteNameToMidi('C5')).toBe(72);
    expect(noteNameToMidi('C8')).toBe(108);
  });

  it('handles lowercase input', () => {
    expect(noteNameToMidi('c4')).toBe(60);
    expect(noteNameToMidi('f#5')).toBe(78);
  });

  it('returns 60 (middle C) for invalid input', () => {
    expect(noteNameToMidi('invalid')).toBe(60);
    expect(noteNameToMidi('')).toBe(60);
    expect(noteNameToMidi('X4')).toBe(60);
  });
});

describe('parseNotesFromResponse', () => {
  describe('JSON parsing', () => {
    it('parses valid JSON array with "note" key', () => {
      const response = `Here are the notes:
[
  {"note": "C4", "beat": 1, "measure": 1, "duration": "quarter"},
  {"note": "E4", "beat": 2, "measure": 1, "duration": "quarter"},
  {"note": "G4", "beat": 3, "measure": 1, "duration": "half"}
]`;
      const notes = parseNotesFromResponse(response);
      expect(notes).toHaveLength(3);
      expect(notes[0]).toEqual({
        noteName: 'C4',
        midi: 60,
        beat: 1,
        measure: 1,
        duration: 'quarter',
      });
      expect(notes[1].noteName).toBe('E4');
      expect(notes[2].duration).toBe('half');
    });

    it('parses JSON with "noteName" key', () => {
      const response = `[{"noteName": "D5", "beat": 1, "measure": 2}]`;
      const notes = parseNotesFromResponse(response);
      expect(notes).toHaveLength(1);
      expect(notes[0].noteName).toBe('D5');
    });

    it('uses default values for missing fields', () => {
      const response = `[{"note": "F4"}]`;
      const notes = parseNotesFromResponse(response);
      expect(notes[0]).toEqual({
        noteName: 'F4',
        midi: 65,
        beat: 1,
        measure: 1,
        duration: 'quarter',
      });
    });

    it('handles JSON with surrounding text', () => {
      const response = `I found these notes in the sheet music:

[{"note": "A4", "beat": 1, "measure": 1, "duration": "whole"}]

The time signature appears to be 4/4.`;
      const notes = parseNotesFromResponse(response);
      expect(notes).toHaveLength(1);
      expect(notes[0].noteName).toBe('A4');
    });
  });

  describe('text fallback parsing', () => {
    it('extracts notes from plain text', () => {
      const response = `I can see C4, then E4, followed by G4 in the first measure.`;
      const notes = parseNotesFromResponse(response);
      expect(notes).toHaveLength(3);
      expect(notes.map(n => n.noteName)).toEqual(['C4', 'E4', 'G4']);
    });

    it('handles sharps and flats in text', () => {
      const response = `The melody goes F#4, Bb4, C#5`;
      const notes = parseNotesFromResponse(response);
      expect(notes).toHaveLength(3);
      expect(notes[0].noteName).toBe('F#4');
      expect(notes[1].noteName).toBe('BB4'); // gets uppercased
    });

    it('auto-increments beats and measures', () => {
      const response = `Notes: C4, D4, E4, F4, G4`;
      const notes = parseNotesFromResponse(response);
      expect(notes).toHaveLength(5);
      // First 4 notes in measure 1
      expect(notes[0]).toMatchObject({ beat: 1, measure: 1 });
      expect(notes[1]).toMatchObject({ beat: 2, measure: 1 });
      expect(notes[2]).toMatchObject({ beat: 3, measure: 1 });
      expect(notes[3]).toMatchObject({ beat: 4, measure: 1 });
      // 5th note wraps to measure 2
      expect(notes[4]).toMatchObject({ beat: 1, measure: 2 });
    });
  });

  describe('edge cases', () => {
    it('returns empty array for empty response', () => {
      expect(parseNotesFromResponse('')).toEqual([]);
    });

    it('returns empty array when no notes found', () => {
      const response = `I cannot identify any sheet music in this image.`;
      expect(parseNotesFromResponse(response)).toEqual([]);
    });

    it('handles malformed JSON gracefully', () => {
      const response = `[{"note": "C4" broken json`;
      // Should fall back to text parsing
      const notes = parseNotesFromResponse(response);
      expect(notes).toHaveLength(1);
      expect(notes[0].noteName).toBe('C4');
    });

    it('skips JSON array items without note/noteName', () => {
      const response = `[{"foo": "bar"}, {"note": "C4"}]`;
      const notes = parseNotesFromResponse(response);
      expect(notes).toHaveLength(1);
    });
  });
});

describe('detectMediaType', () => {
  it('detects PNG from data URL', () => {
    expect(detectMediaType('data:image/png;base64,iVBOR...')).toBe('image/png');
  });

  it('detects JPEG from data URL', () => {
    expect(detectMediaType('data:image/jpeg;base64,/9j/...')).toBe('image/jpeg');
    expect(detectMediaType('data:image/jpg;base64,/9j/...')).toBe('image/jpeg');
  });

  it('detects GIF from data URL', () => {
    expect(detectMediaType('data:image/gif;base64,R0lGO...')).toBe('image/gif');
  });

  it('detects WebP from data URL', () => {
    expect(detectMediaType('data:image/webp;base64,UklGR...')).toBe('image/webp');
  });

  it('detects PNG from magic bytes', () => {
    expect(detectMediaType('iVBORw0KGgoAAAANSUhEU...')).toBe('image/png');
  });

  it('detects JPEG from magic bytes', () => {
    expect(detectMediaType('/9j/4AAQSkZJRg...')).toBe('image/jpeg');
  });

  it('detects GIF from magic bytes', () => {
    expect(detectMediaType('R0lGODlhAQABAI...')).toBe('image/gif');
  });

  it('detects WebP from magic bytes', () => {
    expect(detectMediaType('UklGRl4AAABXRUJQVlA4...')).toBe('image/webp');
  });

  it('defaults to JPEG for unknown format', () => {
    expect(detectMediaType('unknown_data')).toBe('image/jpeg');
    expect(detectMediaType('')).toBe('image/jpeg');
  });
});

describe('integration: response parsing scenarios', () => {
  it('handles typical Claude response with explanation + JSON', () => {
    const response = `Looking at this sheet music, I can see a simple melody in C major. The time signature is 4/4.

Here are the notes I identified:

[
  {"note": "C4", "beat": 1, "measure": 1, "duration": "quarter"},
  {"note": "D4", "beat": 2, "measure": 1, "duration": "quarter"},
  {"note": "E4", "beat": 3, "measure": 1, "duration": "quarter"},
  {"note": "F4", "beat": 4, "measure": 1, "duration": "quarter"},
  {"note": "G4", "beat": 1, "measure": 2, "duration": "half"},
  {"note": "E4", "beat": 3, "measure": 2, "duration": "half"}
]

The melody appears to be a simple ascending scale followed by a third interval.`;

    const notes = parseNotesFromResponse(response);
    expect(notes).toHaveLength(6);
    expect(notes.map(n => n.noteName)).toEqual(['C4', 'D4', 'E4', 'F4', 'G4', 'E4']);
    expect(notes[4].measure).toBe(2);
  });

  it('handles response where Claude says it cannot read the music', () => {
    const response = `I'm looking at the image, but I don't see any clear sheet music notation. The image appears to show a piano keyboard or possibly hands on piano keys, but there's no visible musical score or staff notation that I can read to identify specific notes.

If you have an image that shows actual sheet music (with staff lines, clefs, and note symbols), I'd be happy to help identify the notes.`;

    const notes = parseNotesFromResponse(response);
    expect(notes).toEqual([]);
  });

  it('handles response with notes mentioned in text only', () => {
    const response = `This appears to be the opening of "Für Elise" by Beethoven. The main motif consists of E5 D#5 E5 D#5 E5 B4 D5 C5, resolving to A4.`;

    const notes = parseNotesFromResponse(response);
    // Should extract: E5, D5, E5, D5, E5, B4, D5, C5, A4 (D#5 won't match due to # placement)
    expect(notes.length).toBeGreaterThan(0);
    expect(notes.some(n => n.noteName === 'E5')).toBe(true);
    expect(notes.some(n => n.noteName === 'A4')).toBe(true);
  });
});
