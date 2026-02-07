/**
 * Sheet Music OCR using Ollama vision models
 *
 * Analyzes video frames containing sheet music to extract notes.
 * Uses llava or similar vision-language models via Ollama API.
 *
 * ## Why This Exists
 * Audio-based pitch detection (pitchy) is unreliable for extracting notes
 * from YouTube piano tutorials - getting 3-9 notes when there should be 16.
 * Many tutorial videos show sheet music, which is a much more reliable source.
 * This module uses AI vision to read the notation directly from video frames.
 *
 * ## Default: Azure-hosted Ollama
 * By default, this uses an Azure Container Instance running Ollama with llava.
 * Cost: ~$0.20/hour when running, $0 when stopped.
 *
 * To manage the Azure container:
 *   az container start -g ollama-ocr -n ollama-server   # Start
 *   az container stop -g ollama-ocr -n ollama-server    # Stop (saves money!)
 *
 * ## Alternative: Local Ollama
 * Set OLLAMA_API_URL environment variable to use a local instance:
 *   export OLLAMA_API_URL=http://localhost:11434
 *
 * ### Local Setup (requires 8GB+ RAM)
 * 1. Install Ollama: https://ollama.com/download
 * 2. Pull model: ollama pull llava
 * 3. Set env var: export OLLAMA_API_URL=http://localhost:11434
 *
 * ## How It Works
 * 1. Extracts sample frames from the video (beginning, middle, end)
 * 2. Sends each frame to llava with a prompt asking to identify notes
 * 3. Parses the response to extract note names, beats, measures
 * 4. Converts to MIDI note numbers and timing information
 */

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

export interface OllamaStatus {
  available: boolean;
  model: string | null;
  error?: string;
}

const DEFAULT_OLLAMA_URL = 'http://172.27.224.1:11434';

const OLLAMA_API = typeof process !== 'undefined' && process.env?.OLLAMA_API_URL
  ? process.env.OLLAMA_API_URL
  : DEFAULT_OLLAMA_URL;

/**
 * Check if Ollama is running and has a vision model available
 */
export async function checkOllamaStatus(): Promise<OllamaStatus> {
  try {
    // Check if Ollama is running
    const versionRes = await fetch(`${OLLAMA_API}/api/version`);
    if (!versionRes.ok) {
      return { available: false, model: null, error: 'Ollama not responding' };
    }

    // Check for vision models
    const modelsRes = await fetch(`${OLLAMA_API}/api/tags`);
    if (!modelsRes.ok) {
      return { available: false, model: null, error: 'Cannot list models' };
    }

    const { models } = await modelsRes.json();

    // Look for vision-capable models (llava, bakllava, etc.)
    const visionModels = ['llava', 'bakllava', 'llava-llama3', 'llava:latest'];
    const availableVisionModel = models?.find((m: { name: string }) =>
      visionModels.some(vm => m.name.toLowerCase().includes(vm))
    );

    if (availableVisionModel) {
      return { available: true, model: availableVisionModel.name };
    }

    return {
      available: false,
      model: null,
      error: 'No vision model found. Run: ollama pull llava'
    };
  } catch (err) {
    return {
      available: false,
      model: null,
      error: `Cannot connect to Ollama: ${err}`
    };
  }
}

/**
 * Convert note name to MIDI number
 */
function noteNameToMidi(noteName: string): number {
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
 * Parse the LLM response to extract structured note data
 */
function parseNotesFromResponse(response: string): ExtractedNote[] {
  const notes: ExtractedNote[] = [];

  // Try to find JSON in the response
  const jsonMatch = response.match(/\[[\s\S]*\]/);
  if (jsonMatch) {
    try {
      const parsed = JSON.parse(jsonMatch[0]);
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
        return notes;
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

  return notes;
}

/**
 * Analyze a frame image for sheet music notation
 */
export async function analyzeSheetMusic(
  imageBase64: string,
  model: string = 'llava'
): Promise<SheetMusicAnalysis> {
  const prompt = `Analyze this image of sheet music. I need you to extract all the musical notes you can see.

For each note, tell me:
1. The note name with octave (e.g., C4, F#5, Bb3)
2. The beat position (1, 2, 3, or 4 for 4/4 time)
3. The measure number
4. The duration (quarter, half, whole, eighth, sixteenth)

Also identify:
- Time signature (e.g., 4/4, 3/4)
- Key signature if visible
- Tempo marking if visible

Please respond with a JSON array of notes like:
[
  {"note": "C4", "beat": 1, "measure": 1, "duration": "quarter"},
  {"note": "E4", "beat": 2, "measure": 1, "duration": "quarter"},
  ...
]

If you cannot see clear sheet music notation, describe what you see and list any notes you can identify.`;

  try {
    const response = await fetch(`${OLLAMA_API}/api/generate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model,
        prompt,
        images: [imageBase64],
        stream: false,
      }),
    });

    if (!response.ok) {
      throw new Error(`Ollama API error: ${response.status}`);
    }

    const result = await response.json();
    const rawResponse = result.response || '';

    console.log('[SheetMusicOCR] Raw response:', rawResponse);

    const notes = parseNotesFromResponse(rawResponse);

    // Try to extract time signature
    const timeMatch = rawResponse.match(/(\d)\/(\d)/);
    const timeSignature = timeMatch
      ? { numerator: parseInt(timeMatch[1]), denominator: parseInt(timeMatch[2]) }
      : { numerator: 4, denominator: 4 };

    // Try to extract tempo
    const tempoMatch = rawResponse.match(/(\d{2,3})\s*(?:bpm|BPM)/);
    const tempo = tempoMatch ? parseInt(tempoMatch[1]) : undefined;

    return {
      notes,
      timeSignature,
      tempo,
      confidence: notes.length > 0 ? 0.7 : 0.3,
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
  frames: Map<number, string>,
  model: string = 'llava'
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

    // Extract base64 from data URL
    const base64Match = imageDataUrl.match(/base64,(.+)/);
    if (!base64Match) continue;

    const result = await analyzeSheetMusic(base64Match[1], model);

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
    confidence: uniqueNotes.length > 0 ? 0.7 : 0.3,
    rawResponse: `Analyzed ${sampleTimestamps.length} frames, found ${uniqueNotes.length} unique notes`,
  };
}
