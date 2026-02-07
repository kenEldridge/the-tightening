/**
 * Test OCR prompt with real frames
 *
 * Usage: node scripts/test-ocr-prompt.mjs
 * Requires: VITE_ANTHROPIC_API_KEY in .env
 */

import Anthropic from '@anthropic-ai/sdk';
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Load .env manually
const envPath = path.join(__dirname, '..', '.env');
const envContent = fs.readFileSync(envPath, 'utf-8');
const envMatch = envContent.match(/VITE_ANTHROPIC_API_KEY=(.+)/);
const API_KEY = envMatch ? envMatch[1].trim() : process.env.VITE_ANTHROPIC_API_KEY;

if (!API_KEY) {
  console.error('ERROR: VITE_ANTHROPIC_API_KEY not found in .env');
  process.exit(1);
}

const PROMPT = `You are analyzing a video frame from a piano tutorial. The image shows:
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

async function testFrame(framePath) {
  console.log(`\n${'='.repeat(60)}`);
  console.log(`Testing: ${path.basename(framePath)}`);
  console.log('='.repeat(60));

  if (!fs.existsSync(framePath)) {
    console.log('Frame not found, skipping');
    return null;
  }

  const imageBuffer = fs.readFileSync(framePath);
  const base64Data = imageBuffer.toString('base64');

  const client = new Anthropic({ apiKey: API_KEY });

  console.log('Calling Claude API...');
  const startTime = Date.now();

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
            text: PROMPT,
          },
        ],
      },
    ],
  });

  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
  console.log(`API response in ${elapsed}s`);

  // Extract text
  const rawResponse = response.content
    .filter(block => block.type === 'text')
    .map(block => block.text)
    .join('\n');

  console.log('\n--- Raw Response ---');
  console.log(rawResponse);

  // Try to parse JSON
  const jsonMatch = rawResponse.match(/\{[\s\S]*\}/);
  if (jsonMatch) {
    try {
      const result = JSON.parse(jsonMatch[0]);
      console.log('\n--- Parsed Result ---');
      console.log(JSON.stringify(result, null, 2));
      console.log(`\nFound ${result.notes?.length || 0} notes`);
      console.log(`Key signature: ${result.key_signature}`);
      console.log(`Chords: ${result.chord_symbols?.join(', ')}`);
      return result;
    } catch (e) {
      console.error('JSON parse error:', e.message);
    }
  } else {
    console.log('\nNo JSON found in response');
  }

  return null;
}

async function main() {
  const framesDir = path.join(
    process.env.APPDATA || '',
    'the-tightening',
    'extracted-audio',
    'frames',
    'i1AMYsR7xHQ'
  );

  // Test frames from the selection (~151s)
  const testFrames = [
    path.join(framesDir, 'frame_151_01.jpg'),
    path.join(framesDir, 'frame_151_51.jpg'),
    path.join(framesDir, 'frame_152_01.jpg'),
  ];

  // Also test the fixture frame
  const fixtureFrame = path.join(__dirname, '..', 'src', 'core', '__fixtures__', 'test_frame.jpg');
  if (fs.existsSync(fixtureFrame)) {
    testFrames.unshift(fixtureFrame);
  }

  console.log('Testing OCR prompt with real frames');
  console.log(`API Key: ${API_KEY.slice(0, 15)}...`);
  console.log(`Frames dir: ${framesDir}`);

  let totalNotes = 0;
  for (const framePath of testFrames) {
    try {
      const result = await testFrame(framePath);
      if (result?.notes?.length) {
        totalNotes += result.notes.length;
      }
    } catch (err) {
      console.error(`Error testing ${framePath}:`, err.message);
    }
  }

  console.log(`\n${'='.repeat(60)}`);
  console.log(`TOTAL: Found ${totalNotes} notes across ${testFrames.length} frames`);
  console.log('='.repeat(60));
}

main().catch(console.error);
