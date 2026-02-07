/**
 * Sheet Music OCR using Claude Vision API
 *
 * Analyzes video frames containing sheet music to extract notes.
 * Uses Claude's vision capabilities via the Anthropic API.
 *
 * ## Why This Exists
 * Audio-based pitch detection (pitchy) is unreliable for extracting notes
 * from YouTube piano tutorials - getting 3-9 notes when there should be 16.
 * Many tutorial videos show sheet music, which is a much more reliable source.
 * This module uses AI vision to read the notation directly from video frames.
 *
 * ## Setup
 * Create a .env file in the project root with:
 *   VITE_ANTHROPIC_API_KEY=sk-ant-api03-...
 *
 * Get your API key at https://console.anthropic.com/
 *
 * ## How It Works
 * 1. Extracts sample frames from the video (beginning, middle, end)
 * 2. Sends each frame to Claude with a prompt asking to identify notes
 * 3. Parses the response to extract note names, beats, measures
 * 4. Converts to MIDI note numbers and timing information
 */

import Anthropic from '@anthropic-ai/sdk';

export interface ExtractedNote {
  noteName: string;  // e.g., "C4", "F#5"
  midi: number;
  beat: number;      // Position in the measure (1, 2, 3, 4 for 4/4 time)
  measure: number;   // Which measure this note is in
  duration: string;  // "quarter", "half", "whole", "eighth", etc.
}

export interface SheetMusicAnalysis {
  notes: ExtractedNote[];
  timeSignature: { numerator: number; denominator: number };
  tempo?: number;
  keySignature?: string;
  confidence: number;
  rawResponse: string;
}

export interface OCRStatus {
  available: boolean;
  error?: string;
}

// Get API key from Vite environment
function getApiKey(): string | undefined {
  return import.meta.env.VITE_ANTHROPIC_API_KEY;
}

// Initialize client with API key from .env
let anthropicClient: Anthropic | null = null;

function getClient(): Anthropic {
  if (!anthropicClient) {
    const apiKey = getApiKey();
    if (!apiKey) {
      throw new Error('VITE_ANTHROPIC_API_KEY not set in .env file');
    }
    // dangerouslyAllowBrowser is safe here - this is a local Electron app,
    // not a web app where the key would be exposed to other users
    anthropicClient = new Anthropic({ apiKey, dangerouslyAllowBrowser: true });
  }
  return anthropicClient;
}

/**
 * Check if Anthropic API is configured
 */
export async function checkOCRStatus(): Promise<OCRStatus> {
  const apiKey = getApiKey();

  if (!apiKey) {
    return {
      available: false,
      error: 'Create .env file with VITE_ANTHROPIC_API_KEY=sk-ant-...',
    };
  }

  try {
    // Quick test call to verify API key works
    const client = getClient();
    await client.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 10,
      messages: [{ role: 'user', content: 'Hi' }],
    });
    return { available: true };
  } catch (err) {
    return {
      available: false,
      error: `API error: ${err}`,
    };
  }
}

/**
 * Convert note name to MIDI number
 * @exported for testing
 */
export function noteNameToMidi(noteName: string): number {
  const noteMap: Record<string, number> = {
    'C': 0, 'C#': 1, 'Db': 1,
    'D': 2, 'D#': 3, 'Eb': 3,
    'E': 4, 'Fb': 4, 'E#': 5,
    'F': 5, 'F#': 6, 'Gb': 6,
    'G': 7, 'G#': 8, 'Ab': 8,
    'A': 9, 'A#': 10, 'Bb': 10,
    'B': 11, 'Cb': 11, 'B#': 0,
  };

  // Parse note name like "C4", "F#5", "Bb3"
  const match = noteName.match(/^([A-Ga-g][#b]?)(\d+)$/);
  if (!match) return 60; // Default to middle C

  const [, note, octaveStr] = match;
  const octave = parseInt(octaveStr, 10);
  const semitone = noteMap[note.charAt(0).toUpperCase() + note.slice(1)] ?? 0;

  return (octave + 1) * 12 + semitone;
}

/**
 * Parse result from structured JSON response
 */
export interface ParsedOCRResult {
  notes: ExtractedNote[];
  keySignature?: string;
  timeSignature: { numerator: number; denominator: number };
  chordSymbols?: string[];
}

/**
 * Parse the LLM response to extract structured note data
 * @exported for testing
 */
export function parseNotesFromResponse(response: string): ExtractedNote[] {
  const result = parseFullResponse(response);
  return result.notes;
}

/**
 * Parse the full response including metadata
 * @exported for testing
 */
export function parseFullResponse(response: string): ParsedOCRResult {
  const notes: ExtractedNote[] = [];
  let keySignature: string | undefined;
  let timeSignature = { numerator: 4, denominator: 4 };
  let chordSymbols: string[] | undefined;

  // Try to find JSON object in the response (new format)
  const objectMatch = response.match(/\{[\s\S]*\}/);
  if (objectMatch) {
    try {
      const parsed = JSON.parse(objectMatch[0]);

      // Extract metadata
      if (parsed.key_signature) {
        keySignature = parsed.key_signature;
      }
      if (parsed.time_signature) {
        const tsMatch = parsed.time_signature.match(/(\d+)\/(\d+)/);
        if (tsMatch) {
          timeSignature = {
            numerator: parseInt(tsMatch[1]),
            denominator: parseInt(tsMatch[2]),
          };
        }
      }
      if (parsed.chord_symbols && Array.isArray(parsed.chord_symbols)) {
        chordSymbols = parsed.chord_symbols;
      }

      // Extract notes from nested array
      const notesArray = parsed.notes || parsed;
      if (Array.isArray(notesArray)) {
        for (const item of notesArray) {
          if (item.note || item.noteName) {
            const noteName = item.note || item.noteName;
            notes.push({
              noteName,
              midi: noteNameToMidi(noteName),
              beat: item.beat || 1,
              measure: item.measure || 1,
              duration: item.duration || 'quarter',
            });
          }
        }
        return { notes, keySignature, timeSignature, chordSymbols };
      }
    } catch {
      // JSON parsing failed, try array format
    }
  }

  // Try to find JSON array in the response (old format)
  const arrayMatch = response.match(/\[[\s\S]*\]/);
  if (arrayMatch) {
    try {
      const parsed = JSON.parse(arrayMatch[0]);
      if (Array.isArray(parsed)) {
        for (const item of parsed) {
          if (item.note || item.noteName) {
            const noteName = item.note || item.noteName;
            notes.push({
              noteName,
              midi: noteNameToMidi(noteName),
              beat: item.beat || 1,
              measure: item.measure || 1,
              duration: item.duration || 'quarter',
            });
          }
        }
        return { notes, keySignature, timeSignature, chordSymbols };
      }
    } catch {
      // JSON parsing failed, try text parsing
    }
  }

  // Fallback: parse note names from text
  // Look for patterns like "C4", "F#5", "Bb3"
  const notePattern = /\b([A-Ga-g][#b]?\d)\b/g;
  let match;
  let beat = 1;
  let measure = 1;

  while ((match = notePattern.exec(response)) !== null) {
    const noteName = match[1].toUpperCase();
    notes.push({
      noteName,
      midi: noteNameToMidi(noteName),
      beat,
      measure,
      duration: 'quarter',
    });

    beat++;
    if (beat > 4) {
      beat = 1;
      measure++;
    }
  }

  return { notes, keySignature, timeSignature, chordSymbols };
}

/**
 * Detect media type from base64 data or data URL
 * @exported for testing
 */
export function detectMediaType(imageData: string): 'image/jpeg' | 'image/png' | 'image/gif' | 'image/webp' {
  // Check for data URL prefix
  if (imageData.startsWith('data:image/png')) return 'image/png';
  if (imageData.startsWith('data:image/jpeg') || imageData.startsWith('data:image/jpg')) return 'image/jpeg';
  if (imageData.startsWith('data:image/gif')) return 'image/gif';
  if (imageData.startsWith('data:image/webp')) return 'image/webp';

  // Check magic bytes in base64
  if (imageData.startsWith('/9j/')) return 'image/jpeg';
  if (imageData.startsWith('iVBOR')) return 'image/png';
  if (imageData.startsWith('R0lGO')) return 'image/gif';
  if (imageData.startsWith('UklGR')) return 'image/webp';

  // Default to JPEG
  return 'image/jpeg';
}

/**
 * Analyze a frame image for sheet music notation
 */
export async function analyzeSheetMusic(imageBase64: string): Promise<SheetMusicAnalysis> {
  const prompt = `You are analyzing a video frame from a piano tutorial. The image shows:
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

  try {
    const client = getClient();
    const mediaType = detectMediaType(imageBase64);

    // Strip data URL prefix if present
    const base64Data = imageBase64.replace(/^data:image\/\w+;base64,/, '');

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
                media_type: mediaType,
                data: base64Data,
              },
            },
            {
              type: 'text',
              text: prompt,
            },
          ],
        },
      ],
    });

    // Extract text from response
    const rawResponse = response.content
      .filter((block): block is Anthropic.TextBlock => block.type === 'text')
      .map(block => block.text)
      .join('\n');

    console.log('[SheetMusicOCR] Raw response:', rawResponse);

    const parsed = parseFullResponse(rawResponse);

    // Try to extract tempo from raw response
    const tempoMatch = rawResponse.match(/(\d{2,3})\s*(?:bpm|BPM)/);
    const tempo = tempoMatch ? parseInt(tempoMatch[1]) : undefined;

    return {
      notes: parsed.notes,
      timeSignature: parsed.timeSignature,
      keySignature: parsed.keySignature,
      tempo,
      confidence: parsed.notes.length > 0 ? 0.8 : 0.3,
      rawResponse,
    };
  } catch (err) {
    console.error('[SheetMusicOCR] Analysis failed:', err);
    return {
      notes: [],
      timeSignature: { numerator: 4, denominator: 4 },
      confidence: 0,
      rawResponse: `Error: ${err}`,
    };
  }
}

/**
 * Analyze multiple frames and combine results
 */
export async function analyzeMultipleFrames(
  frames: Map<number, string>
): Promise<SheetMusicAnalysis> {
  // Take a sample of frames (beginning, middle, end)
  const timestamps = Array.from(frames.keys()).sort((a, b) => a - b);

  if (timestamps.length === 0) {
    return {
      notes: [],
      timeSignature: { numerator: 4, denominator: 4 },
      confidence: 0,
      rawResponse: 'No frames to analyze',
    };
  }

  // Select up to 3 representative frames
  const sampleIndices = [
    0,
    Math.floor(timestamps.length / 2),
    timestamps.length - 1,
  ].filter((v, i, a) => a.indexOf(v) === i); // Remove duplicates

  const sampleTimestamps = sampleIndices.map(i => timestamps[i]);

  console.log('[SheetMusicOCR] Analyzing', sampleTimestamps.length, 'frames');

  const allNotes: ExtractedNote[] = [];
  let bestTimeSignature = { numerator: 4, denominator: 4 };
  let bestTempo: number | undefined;

  for (const ts of sampleTimestamps) {
    const imageDataUrl = frames.get(ts);
    if (!imageDataUrl) continue;

    const result = await analyzeSheetMusic(imageDataUrl);

    if (result.notes.length > 0) {
      allNotes.push(...result.notes);
      bestTimeSignature = result.timeSignature;
      if (result.tempo) bestTempo = result.tempo;
    }
  }

  // Deduplicate notes (same note in same measure/beat)
  const uniqueNotes = allNotes.filter((note, index, self) =>
    index === self.findIndex(n =>
      n.noteName === note.noteName &&
      n.measure === note.measure &&
      n.beat === note.beat
    )
  );

  return {
    notes: uniqueNotes,
    timeSignature: bestTimeSignature,
    tempo: bestTempo,
    confidence: uniqueNotes.length > 0 ? 0.8 : 0.3,
    rawResponse: `Analyzed ${sampleTimestamps.length} frames, found ${uniqueNotes.length} unique notes`,
  };
}
