/**
 * Integration tests for SheetMusicOCR using real frames
 *
 * These tests hit the actual Anthropic API with real video frames
 * to validate the OCR works end-to-end.
 *
 * Run with: npm run test:integration
 * Requires: VITE_ANTHROPIC_API_KEY in .env
 */

import { describe, it, expect, beforeAll } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import Anthropic from '@anthropic-ai/sdk';

// Skip these tests if no API key (CI environments)
const API_KEY = process.env.VITE_ANTHROPIC_API_KEY;
const describeIfApiKey = API_KEY ? describe : describe.skip;

// Path to test fixtures
const FIXTURES_DIR = path.join(__dirname, '__fixtures__');
const TEST_FRAME = path.join(FIXTURES_DIR, 'test_frame.jpg');

// The prompt we're iterating on
const SHEET_MUSIC_PROMPT = `You are analyzing a video frame from a piano tutorial. The image shows:
1. A piano keyboard (top)
2. Hands playing the piano (middle)
3. Sheet music notation (bottom)

Focus ONLY on the sheet music at the bottom of the image. Extract every note you can see on the musical staff.

IMPORTANT: Do your best to identify notes even if the image quality isn't perfect. Make reasonable guesses based on:
- Note position on the staff lines/spaces
- Key signature (count sharps/flats)
- Chord symbols above the staff (D, A, Bm, G, etc.)

For each note on the staff, provide:
- note: The note name with octave (C4 = middle C, use standard octave numbering)
- beat: Position in the measure (1, 2, 3, 4)
- measure: Which measure number (start from 1 for what's visible)
- duration: quarter, half, whole, eighth, sixteenth

Also identify:
- key_signature: e.g., "D major" or "2 sharps"
- time_signature: e.g., "4/4"
- chord_symbols: Array of chord names visible above the staff

Respond with ONLY valid JSON, no explanation:
{
  "key_signature": "...",
  "time_signature": "...",
  "chord_symbols": ["D", "A", "Bm", "G"],
  "notes": [
    {"note": "F#4", "beat": 1, "measure": 1, "duration": "quarter"},
    ...
  ]
}`;

describeIfApiKey('SheetMusicOCR Integration', () => {
  let client: Anthropic;

  beforeAll(() => {
    if (!API_KEY) {
      throw new Error('VITE_ANTHROPIC_API_KEY required for integration tests');
    }
    client = new Anthropic({ apiKey: API_KEY });
  });

  it('extracts notes from real video frame', async () => {
    // Load test frame
    expect(fs.existsSync(TEST_FRAME)).toBe(true);
    const imageBuffer = fs.readFileSync(TEST_FRAME);
    const base64Data = imageBuffer.toString('base64');

    // Call API
    const response = await client.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 4096,
      messages: [
        {
          role: 'user',
          content: [
            {
              type: 'image',
              source: {
                type: 'base64',
                media_type: 'image/jpeg',
                data: base64Data,
              },
            },
            {
              type: 'text',
              text: SHEET_MUSIC_PROMPT,
            },
          ],
        },
      ],
    });

    // Extract response text
    const rawResponse = response.content
      .filter((block): block is Anthropic.TextBlock => block.type === 'text')
      .map(block => block.text)
      .join('\n');

    console.log('Raw API response:', rawResponse);

    // Parse JSON
    const jsonMatch = rawResponse.match(/\{[\s\S]*\}/);
    expect(jsonMatch).not.toBeNull();

    const result = JSON.parse(jsonMatch![0]);
    console.log('Parsed result:', JSON.stringify(result, null, 2));

    // Validate structure
    expect(result).toHaveProperty('notes');
    expect(Array.isArray(result.notes)).toBe(true);

    // Should find SOME notes - this frame clearly has sheet music
    expect(result.notes.length).toBeGreaterThan(0);

    // Check note structure
    if (result.notes.length > 0) {
      const firstNote = result.notes[0];
      expect(firstNote).toHaveProperty('note');
      expect(firstNote.note).toMatch(/^[A-G][#b]?\d$/);
    }

    // Should detect key signature (D major = 2 sharps)
    expect(result.key_signature).toBeDefined();
    expect(
      result.key_signature.toLowerCase().includes('d major') ||
      result.key_signature.includes('2 sharp')
    ).toBe(true);

    // Should detect chord symbols
    expect(result.chord_symbols).toBeDefined();
    expect(result.chord_symbols.length).toBeGreaterThan(0);
  }, 30000); // 30s timeout for API call

  it('handles frame with no sheet music gracefully', async () => {
    // Create a simple test - use first frame which might be intro/no music
    const introFramePath = path.join(
      '/mnt/c/Users/eldri/AppData/Roaming/the-tightening/extracted-audio/frames/i1AMYsR7xHQ',
      'frame_0_15.jpg'
    );

    if (!fs.existsSync(introFramePath)) {
      console.log('Skipping - intro frame not found');
      return;
    }

    const imageBuffer = fs.readFileSync(introFramePath);
    const base64Data = imageBuffer.toString('base64');

    const response = await client.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 4096,
      messages: [
        {
          role: 'user',
          content: [
            {
              type: 'image',
              source: {
                type: 'base64',
                media_type: 'image/jpeg',
                data: base64Data,
              },
            },
            {
              type: 'text',
              text: SHEET_MUSIC_PROMPT,
            },
          ],
        },
      ],
    });

    const rawResponse = response.content
      .filter((block): block is Anthropic.TextBlock => block.type === 'text')
      .map(block => block.text)
      .join('\n');

    console.log('Intro frame response:', rawResponse);

    // Should still return valid JSON even if no notes found
    const jsonMatch = rawResponse.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      const result = JSON.parse(jsonMatch[0]);
      expect(result).toHaveProperty('notes');
      // May have 0 notes, that's ok
    }
  }, 30000);
});
