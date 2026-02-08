/**
 * Test Practice Mode
 *
 * Loads directly into PracticeFrameDisplay with cached data.
 * Run with: npm run dev:test
 *
 * This bypasses YouTube import and loads cached frames/audio directly.
 */

import { useState, useEffect, useRef, useCallback } from 'react';
import { PracticeFrameDisplay } from '../components/PracticeFrameDisplay';
import { VisualKeyboard } from '../components/VisualKeyboard';
import { TEST_VIDEO_ID, TEST_SEGMENT, TEST_FRAME_TIMES } from './fixtures/testSegment';
import type { MelodyNote } from '../utils/midiParser';
import { loadConfig } from '../config/AppConfig';
import { analyzeMultipleFrames, checkOCRStatus, type SheetMusicAnalysis } from '../core/SheetMusicOCR';
import { convertOcrNotesToMelody, countMeasures, inferTempo } from '../utils/timingConverter';

export function TestPracticeMode() {
  // ALL HOOKS MUST BE BEFORE ANY CONDITIONAL RETURNS
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [frames, setFrames] = useState<Map<number, string>>(new Map());
  const [audioUrl, setAudioUrl] = useState<string | null>(null);
  const [notes, setNotes] = useState<MelodyNote[]>([]);
  const [status, setStatus] = useState('Initializing...');
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [width, setWidth] = useState(1200);

  const config = loadConfig();
  const containerRef = useRef<HTMLDivElement>(null);
  const lastScreenshotTime = useRef(0);
  const screenshotEnabled = useRef(true);

  // Screenshot helper - captures at key moments
  const captureScreenshot = useCallback(async (label: string) => {
    if (!screenshotEnabled.current || !window.electronAPI?.debugScreenshot) return;
    try {
      await window.electronAPI.debugScreenshot(label);
    } catch (err) {
      console.error('[TestMode] Screenshot failed:', err);
    }
  }, []);

  // Handle play state changes
  const handlePlayStateChange = useCallback((playing: boolean) => {
    setIsPlaying(playing);
    console.log('[TestMode] Play state:', playing);
    captureScreenshot(playing ? 'play_start' : 'play_stop');
  }, [captureScreenshot]);

  // Handle time updates
  const handleTimeUpdate = useCallback((time: number) => {
    setCurrentTime(time);
  }, []);

  // Track container width
  useEffect(() => {
    const updateWidth = () => {
      if (containerRef.current) {
        setWidth(containerRef.current.clientWidth - 40);
      }
    };
    updateWidth();
    window.addEventListener('resize', updateWidth);
    return () => window.removeEventListener('resize', updateWidth);
  }, []);

  // Capture screenshots during playback (every 0.5 seconds)
  useEffect(() => {
    if (isPlaying && currentTime - lastScreenshotTime.current >= 0.5) {
      lastScreenshotTime.current = currentTime;
      captureScreenshot(`t${currentTime.toFixed(1)}`);
    }
  }, [isPlaying, currentTime, captureScreenshot]);

  // Load cached data on mount
  useEffect(() => {
    const loadTestData = async () => {
      try {
        if (!window.electronAPI) {
          throw new Error('electronAPI not available - must run in Electron');
        }

        // Check OCR availability
        setStatus('Checking OCR status...');
        const ocrStatus = await checkOCRStatus();
        if (!ocrStatus.available) {
          throw new Error(`OCR not available: ${ocrStatus.error}`);
        }

        // Load frames first (needed for OCR)
        setStatus('Loading frames...');
        const outputDir = await window.electronAPI.youtubeGetOutputDir();
        const frameMap = new Map<number, string>();

        for (const time of TEST_FRAME_TIMES) {
          const seconds = Math.floor(time);
          const centiseconds = Math.round((time - seconds) * 100);
          const frameName = `frame_${seconds}_${centiseconds.toString().padStart(2, '0')}.jpg`;
          const framePath = `${outputDir}/frames/${TEST_VIDEO_ID}/${frameName}`;

          const dataUrl = await window.electronAPI.readImageFile(framePath);
          if (dataUrl) {
            const relativeTime = time - TEST_SEGMENT.startTime;
            frameMap.set(relativeTime, dataUrl);
          }
        }

        console.log(`[TestMode] Loaded ${frameMap.size} frames`);
        setFrames(frameMap);

        // Check for cached OCR results
        const ocrCacheKey = `${TEST_VIDEO_ID}_ocr_${TEST_SEGMENT.startTime}_${TEST_SEGMENT.endTime}`;
        let ocrResult: SheetMusicAnalysis | null = null;

        const cachedOcr = await window.electronAPI.analysisCacheLoad(ocrCacheKey);
        if (cachedOcr && cachedOcr.notes && cachedOcr.notes.length > 0) {
          console.log(`[TestMode] Using cached OCR results: ${cachedOcr.notes.length} notes`);
          ocrResult = cachedOcr as SheetMusicAnalysis;
        } else {
          // Run OCR on frames
          setStatus('Running sheet music OCR (Claude Vision)...');
          console.log('[TestMode] Running OCR on frames...');
          ocrResult = await analyzeMultipleFrames(frameMap);
          console.log(`[TestMode] OCR found ${ocrResult.notes.length} notes`);

          // Cache the OCR results
          if (ocrResult.notes.length > 0) {
            await window.electronAPI.analysisCacheSave(ocrCacheKey, ocrResult);
            console.log('[TestMode] OCR results cached');
          }
        }

        // Convert OCR notes to MelodyNote format
        if (ocrResult && ocrResult.notes.length > 0) {
          const segmentDuration = TEST_SEGMENT.endTime - TEST_SEGMENT.startTime;
          const measureCount = countMeasures(ocrResult.notes);
          const beatsPerMeasure = ocrResult.timeSignature.numerator;

          // Infer tempo from segment duration and measure count
          const inferredTempo = ocrResult.tempo || inferTempo(segmentDuration, measureCount, beatsPerMeasure);
          console.log(`[TestMode] Using tempo: ${inferredTempo} BPM (${measureCount} measures, ${beatsPerMeasure} beats/measure)`);

          const melodyNotes = convertOcrNotesToMelody(ocrResult.notes, {
            beatsPerMeasure,
            tempo: inferredTempo,
            segmentStartTime: 0, // Relative timing
          });

          console.log(`[TestMode] Converted to ${melodyNotes.length} melody notes`);
          setNotes(melodyNotes);
        } else {
          console.warn('[TestMode] No OCR notes found, falling back to pitch detection');
          // Fallback to pitch detection if OCR fails
          const cachedAnalysis = await window.electronAPI.analysisCacheLoad(TEST_VIDEO_ID);
          if (cachedAnalysis?.notes) {
            const segmentNotes: MelodyNote[] = cachedAnalysis.notes
              .filter((n: any) => n.startTime >= TEST_SEGMENT.startTime && n.startTime < TEST_SEGMENT.endTime)
              .map((n: any) => ({
                midi: n.midi,
                name: n.noteName,
                time: n.startTime - TEST_SEGMENT.startTime,
                duration: n.duration,
                velocity: 80,
              }));
            setNotes(segmentNotes);
          }
        }

        // Load audio
        setStatus('Loading audio...');
        const audioPath = `${outputDir}/${TEST_VIDEO_ID}.wav`;
        const audioBase64 = await window.electronAPI.readAudioFile(audioPath);
        if (audioBase64) {
          const binaryString = atob(audioBase64);
          const bytes = new Uint8Array(binaryString.length);
          for (let i = 0; i < binaryString.length; i++) {
            bytes[i] = binaryString.charCodeAt(i);
          }
          const blob = new Blob([bytes], { type: 'audio/wav' });
          setAudioUrl(URL.createObjectURL(blob));
        }

        setStatus('Ready');
        setLoading(false);
        console.log('[TestMode] All data loaded successfully');

        // Reset and capture initial screenshot
        if (window.electronAPI?.debugScreenshotReset) {
          await window.electronAPI.debugScreenshotReset();
        }
        // Short delay to let UI render
        setTimeout(async () => {
          if (window.electronAPI?.debugScreenshot) {
            await window.electronAPI.debugScreenshot('ready');
          }
        }, 500);

      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.error('[TestMode] Error:', msg);
        setError(msg);
        setLoading(false);
      }
    };

    loadTestData();
  }, []);

  // Calculate note range (always, not conditionally)
  const noteRange = notes.length > 0
    ? {
        min: Math.min(...notes.map(n => n.midi)) - 5,
        max: Math.max(...notes.map(n => n.midi)) + 5
      }
    : { min: 48, max: 72 };

  // Find current note(s) for keyboard highlighting
  const currentNotes = notes.filter(
    n => currentTime >= n.time && currentTime < n.time + n.duration
  );
  const currentNoteMidi = currentNotes.length > 0 ? currentNotes[0].midi : null;
  const pressedKeys = new Set(currentNotes.map(n => n.midi));

  // NOW we can do conditional returns (after all hooks)
  if (loading) {
    return (
      <div style={{
        padding: 40,
        backgroundColor: '#1a1a1a',
        color: '#fff',
        height: '100vh',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
      }}>
        <h1>Test Practice Mode</h1>
        <p style={{ color: '#888' }}>{status}</p>
        <p style={{ color: '#666', fontSize: 12 }}>
          Video: {TEST_VIDEO_ID}<br/>
          Segment: {TEST_SEGMENT.startTime}s - {TEST_SEGMENT.endTime}s
        </p>
      </div>
    );
  }

  if (error) {
    return (
      <div style={{
        padding: 40,
        backgroundColor: '#1a1a1a',
        color: '#fff',
        height: '100vh',
      }}>
        <h1 style={{ color: '#f44' }}>Test Mode Error</h1>
        <p>{error}</p>
        <p style={{ color: '#888', marginTop: 20 }}>
          Make sure you have cached data for video {TEST_VIDEO_ID}.<br/>
          Run the app normally first and import a YouTube video to create the cache.
        </p>
      </div>
    );
  }

  return (
    <div
      ref={containerRef}
      style={{
        backgroundColor: '#1a1a1a',
        color: '#fff',
        height: '100vh',
        display: 'flex',
        flexDirection: 'column',
        padding: 20,
        overflow: 'hidden',
      }}
    >
      {/* Header */}
      <div style={{ marginBottom: 10, flexShrink: 0, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div>
          <h2 style={{ margin: 0, color: '#4CAF50' }}>Test Practice Mode</h2>
          <p style={{ margin: '5px 0', color: '#888', fontSize: 12 }}>
            {notes.length} notes | {frames.size} frames | t={currentTime.toFixed(1)}s | {isPlaying ? 'PLAYING' : 'PAUSED'}
          </p>
        </div>
        <div style={{ display: 'flex', gap: 10 }}>
          <button
            onClick={() => captureScreenshot('manual')}
            style={{ padding: '8px 16px', backgroundColor: '#2196F3', color: '#fff', border: 'none', borderRadius: 4, cursor: 'pointer' }}
          >
            Screenshot
          </button>
          <button
            onClick={() => { screenshotEnabled.current = !screenshotEnabled.current; }}
            style={{ padding: '8px 16px', backgroundColor: screenshotEnabled.current ? '#4CAF50' : '#666', color: '#fff', border: 'none', borderRadius: 4, cursor: 'pointer' }}
          >
            {screenshotEnabled.current ? 'Auto-capture ON' : 'Auto-capture OFF'}
          </button>
        </div>
      </div>

      {/* Practice Display */}
      <div style={{ flex: 1, minHeight: 300 }}>
        <PracticeFrameDisplay
          notes={notes}
          frames={frames}
          audioBlobUrl={audioUrl}
          audioStartTime={TEST_SEGMENT.startTime}
          width={width}
          height={Math.max(300, window.innerHeight - 350)}
          onTimeUpdate={handleTimeUpdate}
          onPlayStateChange={handlePlayStateChange}
          micEnabled={false}
          onMicToggle={() => {}}
          lastDetectedNote={null}
          comparisonStats={null}
        />
      </div>

      {/* Keyboard */}
      <div style={{ flexShrink: 0, marginTop: 10 }}>
        <VisualKeyboard
          noteRange={noteRange}
          pressedKeys={pressedKeys}
          currentCorrectNote={currentNoteMidi}
          distributionWidth={12}
          config={config}
          width={width}
          height={150}
        />
      </div>
    </div>
  );
}
