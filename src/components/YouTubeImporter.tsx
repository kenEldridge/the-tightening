/**
 * YouTube Importer Component
 *
 * UI for importing piano tutorial videos from YouTube.
 * Handles URL input, extraction progress, and displays the video with detected notes.
 */

import React, { useState, useRef, useCallback, useEffect } from 'react';
import { getVideoAnalyzer, type DetectedNoteEvent, type AnalysisProgress } from '../core/VideoAnalyzer';
import { checkOllamaStatus, analyzeMultipleFrames, type OllamaStatus, type SheetMusicAnalysis } from '../core/SheetMusicOCR';

interface VideoInfo {
  title: string;
  duration: number;
  thumbnail?: string;
  uploader?: string;
}

interface ExtractionStatus {
  status: 'idle' | 'extracting' | 'analyzing' | 'complete' | 'error';
  progress: number;
  message: string;
}

export interface PassageSelection {
  startTime: number;
  endTime: number;
  notes: DetectedNoteEvent[];
  frames?: Map<number, string>; // timestamp -> dataUrl for video frames
  audioBlobUrl?: string; // URL to the extracted audio
}

export interface YouTubeImporterProps {
  onNotesExtracted?: (notes: DetectedNoteEvent[], videoInfo: VideoInfo) => void;
  onPassageSelected?: (passage: PassageSelection, videoInfo: VideoInfo) => void;
  onClose?: () => void;
}

export const YouTubeImporter: React.FC<YouTubeImporterProps> = ({
  onNotesExtracted,
  onPassageSelected,
  onClose,
}) => {
  const [url, setUrl] = useState('');
  const [videoInfo, setVideoInfo] = useState<VideoInfo | null>(null);
  const [status, setStatus] = useState<ExtractionStatus>({
    status: 'idle',
    progress: 0,
    message: 'Paste a YouTube URL to get started',
  });
  const [extractedNotes, setExtractedNotes] = useState<DetectedNoteEvent[]>([]);
  const [audioPath, setAudioPath] = useState<string | null>(null);
  const [audioBlobUrl, setAudioBlobUrl] = useState<string | null>(null);
  const [currentTime, setCurrentTime] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);

  // Video & frame extraction state
  const [videoPath, setVideoPath] = useState<string | null>(null);
  const [extractedFrames, setExtractedFrames] = useState<Map<number, string>>(new Map()); // timestamp -> dataUrl
  const [isExtractingFrames, setIsExtractingFrames] = useState(false);
  const [frameExtractionProgress, setFrameExtractionProgress] = useState<string>('');

  // Sheet music OCR state
  const [ollamaStatus, setOllamaStatus] = useState<OllamaStatus | null>(null);
  const [isAnalyzingSheetMusic, setIsAnalyzingSheetMusic] = useState(false);
  const [ocrProgress, setOcrProgress] = useState<string>('');

  // Passage selection state
  const [selectionStart, setSelectionStart] = useState<number | null>(null);
  const [selectionEnd, setSelectionEnd] = useState<number | null>(null);
  const [isLooping, setIsLooping] = useState(false);
  const [youtubeTime, setYoutubeTime] = useState(0);

  const audioRef = useRef<HTMLAudioElement | null>(null);
  const analyzerRef = useRef(getVideoAnalyzer());
  const youtubePlayerRef = useRef<any>(null);
  const youtubeIntervalRef = useRef<number | null>(null);

  // Listen for extraction progress from main process
  useEffect(() => {
    if (window.electronAPI) {
      window.electronAPI.onYoutubeProgress((progress) => {
        if (progress.status === 'downloading' || progress.status === 'extracting') {
          setStatus({
            status: 'extracting',
            progress: progress.progress || 0,
            message: progress.message || 'Extracting audio...',
          });
          if (progress.videoInfo) {
            setVideoInfo(progress.videoInfo as VideoInfo);
          }
        } else if (progress.status === 'complete') {
          setAudioPath(progress.outputPath || null);
        } else if (progress.status === 'error') {
          setStatus({
            status: 'error',
            progress: 0,
            message: progress.message || 'Extraction failed',
          });
        }
      });

      return () => {
        window.electronAPI.removeYoutubeProgressListener();
      };
    }
  }, []);

  // Check Ollama status on mount
  useEffect(() => {
    checkOllamaStatus().then(status => {
      console.log('[YouTubeImporter] Ollama status:', status);
      setOllamaStatus(status);
    });
  }, []);

  // Analyze sheet music from frames using Ollama
  const analyzeSheetMusicFromFrames = useCallback(async () => {
    if (!ollamaStatus?.available || extractedFrames.size === 0) {
      console.log('[YouTubeImporter] Cannot analyze - Ollama not available or no frames');
      return;
    }

    setIsAnalyzingSheetMusic(true);
    setOcrProgress('Analyzing sheet music with AI vision...');

    try {
      const result = await analyzeMultipleFrames(extractedFrames, ollamaStatus.model || 'llava');

      console.log('[YouTubeImporter] Sheet music analysis result:', result);
      setOcrProgress(`Found ${result.notes.length} notes (${(result.confidence * 100).toFixed(0)}% confidence)`);

      if (result.notes.length > 0) {
        // Convert OCR notes to DetectedNoteEvent format
        // We need to estimate timing based on tempo and beat positions
        const tempo = result.tempo || 120;
        const beatsPerSecond = tempo / 60;
        const secondsPerBeat = 1 / beatsPerSecond;

        const ocrNotes: DetectedNoteEvent[] = result.notes.map((note, index) => {
          // Calculate time based on measure and beat
          const measureOffset = (note.measure - 1) * result.timeSignature.numerator * secondsPerBeat;
          const beatOffset = (note.beat - 1) * secondsPerBeat;
          const startTime = measureOffset + beatOffset;

          // Duration based on note type
          const durationMap: Record<string, number> = {
            'whole': 4,
            'half': 2,
            'quarter': 1,
            'eighth': 0.5,
            'sixteenth': 0.25,
          };
          const durationBeats = durationMap[note.duration] || 1;
          const durationSeconds = durationBeats * secondsPerBeat;

          return {
            midi: note.midi,
            noteName: note.noteName,
            startTime: (selectionStart || 0) + startTime,
            endTime: (selectionStart || 0) + startTime + durationSeconds,
            duration: durationSeconds,
            clarity: result.confidence,
            velocity: 0.8,
          };
        });

        // Replace or merge with existing notes
        setExtractedNotes(ocrNotes);
        setOcrProgress(`Loaded ${ocrNotes.length} notes from sheet music`);
      }
    } catch (err) {
      console.error('[YouTubeImporter] Sheet music analysis failed:', err);
      setOcrProgress(`Analysis failed: ${err}`);
    } finally {
      setIsAnalyzingSheetMusic(false);
    }
  }, [ollamaStatus, extractedFrames, selectionStart]);

  // Extract video ID from URL for embedding
  const getVideoId = useCallback((youtubeUrl: string): string | null => {
    const patterns = [
      /(?:youtube\.com\/watch\?v=|youtu\.be\/|youtube\.com\/embed\/)([^&\n?#]+)/,
      /youtube\.com\/shorts\/([^&\n?#]+)/,
    ];

    for (const pattern of patterns) {
      const match = youtubeUrl.match(pattern);
      if (match) return match[1];
    }
    return null;
  }, []);

  // Load YouTube IFrame API and create player
  useEffect(() => {
    const videoId = url ? getVideoId(url) : null;
    if (!videoId) return;

    // Load YouTube API if not already loaded
    if (!(window as any).YT) {
      const tag = document.createElement('script');
      tag.src = 'https://www.youtube.com/iframe_api';
      const firstScript = document.getElementsByTagName('script')[0];
      firstScript.parentNode?.insertBefore(tag, firstScript);
    }

    const initPlayer = () => {
      if (youtubePlayerRef.current) {
        youtubePlayerRef.current.destroy();
      }

      youtubePlayerRef.current = new (window as any).YT.Player('youtube-player', {
        videoId,
        events: {
          onReady: () => {
            console.log('[YouTubeImporter] YouTube player ready');
            // Poll for current time
            youtubeIntervalRef.current = window.setInterval(() => {
              if (youtubePlayerRef.current?.getCurrentTime) {
                setYoutubeTime(youtubePlayerRef.current.getCurrentTime());
              }
            }, 250);
          },
        },
      });
    };

    if ((window as any).YT?.Player) {
      initPlayer();
    } else {
      (window as any).onYouTubeIframeAPIReady = initPlayer;
    }

    return () => {
      if (youtubeIntervalRef.current) {
        clearInterval(youtubeIntervalRef.current);
      }
      if (youtubePlayerRef.current) {
        youtubePlayerRef.current.destroy();
        youtubePlayerRef.current = null;
      }
    };
  }, [url, getVideoId]);

  // Handle URL submission
  const handleSubmit = useCallback(async () => {
    if (!url.trim()) return;

    const videoId = getVideoId(url);
    if (!videoId) {
      setStatus({
        status: 'error',
        progress: 0,
        message: 'Invalid YouTube URL',
      });
      return;
    }

    if (!window.electronAPI) {
      setStatus({
        status: 'error',
        progress: 0,
        message: 'YouTube extraction only available in Electron app',
      });
      return;
    }

    setStatus({
      status: 'extracting',
      progress: 0,
      message: 'Starting extraction...',
    });

    try {
      // Extract audio using main process
      const outputPath = await window.electronAPI.youtubeExtractAudio(url);

      if (!outputPath) {
        setStatus({
          status: 'error',
          progress: 0,
          message: 'Failed to extract audio',
        });
        return;
      }

      setAudioPath(outputPath);

      // Check for cached analysis results
      setStatus({
        status: 'analyzing',
        progress: 0,
        message: 'Checking for cached analysis...',
      });

      const cachedResult = await window.electronAPI.analysisCacheLoad(videoId);

      if (cachedResult && cachedResult.notes && cachedResult.notes.length > 0) {
        // Use cached results
        console.log('[YouTubeImporter] Using cached analysis', { noteCount: cachedResult.notes.length });
        setExtractedNotes(cachedResult.notes);
        setStatus({
          status: 'complete',
          progress: 100,
          message: `Loaded ${cachedResult.notes.length} notes from cache (${cachedResult.duration?.toFixed(1) || '?'}s)`,
        });

        if (videoInfo && onNotesExtracted) {
          onNotesExtracted(cachedResult.notes, videoInfo);
        }
      } else {
        // No cache - analyze the audio
        setStatus({
          status: 'analyzing',
          progress: 0,
          message: 'Analyzing audio for notes...',
        });

        const result = await analyzerRef.current.analyzeFile(outputPath, (progress: AnalysisProgress) => {
          setStatus({
            status: 'analyzing',
            progress: progress.progress,
            message: progress.message || 'Analyzing...',
          });
        });

        if (result) {
          setExtractedNotes(result.notes);
          setStatus({
            status: 'complete',
            progress: 100,
            message: `Found ${result.notes.length} notes in ${result.duration.toFixed(1)}s`,
          });

          // Save to cache for future use
          const cacheData = {
            notes: result.notes,
            duration: result.duration,
            sampleRate: result.sampleRate,
            analysisTime: result.analysisTime,
            cachedAt: new Date().toISOString(),
            version: 1, // Cache version for future invalidation
          };
          await window.electronAPI.analysisCacheSave(videoId, cacheData);
          console.log('[YouTubeImporter] Analysis cached', { videoId, noteCount: result.notes.length });

          if (videoInfo && onNotesExtracted) {
            onNotesExtracted(result.notes, videoInfo);
          }
        } else {
          setStatus({
            status: 'error',
            progress: 0,
            message: 'Failed to analyze audio',
          });
        }
      }
    } catch (err) {
      const error = err as Error;
      setStatus({
        status: 'error',
        progress: 0,
        message: error.message,
      });
    }
  }, [url, getVideoId, videoInfo, onNotesExtracted]);

  // Handle audio playback
  const togglePlayback = useCallback(() => {
    console.log('[YouTubeImporter] togglePlayback', {
      hasAudioRef: !!audioRef.current,
      isPlaying,
      audioBlobUrl,
      selectionStart,
      selectionEnd
    });
    if (!audioRef.current) {
      console.error('[YouTubeImporter] No audio ref!');
      return;
    }

    if (isPlaying) {
      audioRef.current.pause();
    } else {
      // If looping and we're past the end, restart at selection start
      if (isLooping && selectionStart !== null && selectionEnd !== null) {
        if (audioRef.current.currentTime >= selectionEnd || audioRef.current.currentTime < selectionStart) {
          audioRef.current.currentTime = selectionStart;
        }
      }
      audioRef.current.play().catch(err => console.error('[YouTubeImporter] Play failed:', err));
    }
    setIsPlaying(!isPlaying);
  }, [isPlaying, isLooping, selectionStart, selectionEnd, audioBlobUrl]);

  // Set selection start to current YouTube time
  const markSelectionStart = useCallback(() => {
    console.log('[YouTubeImporter] Mark Start clicked', { youtubeTime });
    setSelectionStart(youtubeTime);
    if (selectionEnd !== null && youtubeTime >= selectionEnd) {
      setSelectionEnd(null);
    }
  }, [youtubeTime, selectionEnd]);

  // Set selection end to current YouTube time
  const markSelectionEnd = useCallback(() => {
    console.log('[YouTubeImporter] Mark End clicked', { youtubeTime, selectionStart });
    if (selectionStart !== null && youtubeTime > selectionStart) {
      setSelectionEnd(youtubeTime);
    }
  }, [youtubeTime, selectionStart]);

  // Clear selection
  const clearSelection = useCallback(() => {
    setSelectionStart(null);
    setSelectionEnd(null);
  }, []);

  // Get notes within selection
  const getSelectedNotes = useCallback((): DetectedNoteEvent[] => {
    if (selectionStart === null || selectionEnd === null) return [];
    return extractedNotes.filter(
      note => note.startTime >= selectionStart && note.endTime <= selectionEnd
    );
  }, [extractedNotes, selectionStart, selectionEnd]);

  // Download video and extract frames at note timestamps
  const extractVideoFrames = useCallback(async () => {
    console.log('[YouTubeImporter] extractVideoFrames called!', {
      hasUrl: !!url,
      noteCount: extractedNotes.length,
      hasElectronAPI: !!window.electronAPI,
      hasGetVideoPath: !!window.electronAPI?.getVideoPath,
      hasDownloadVideo: !!window.electronAPI?.youtubeDownloadVideo,
      hasExtractFrames: !!window.electronAPI?.extractFrames,
      hasReadImageFile: !!window.electronAPI?.readImageFile,
    });

    if (!url || extractedNotes.length === 0 || !window.electronAPI) {
      console.error('[YouTubeImporter] Cannot extract frames - missing requirements');
      setFrameExtractionProgress('Error: Missing URL or notes');
      return;
    }

    // Check if the IPC methods exist
    if (!window.electronAPI.youtubeDownloadVideo) {
      console.error('[YouTubeImporter] youtubeDownloadVideo not available - rebuild required');
      setFrameExtractionProgress('Error: Rebuild app to enable frame extraction');
      return;
    }

    setIsExtractingFrames(true);
    setFrameExtractionProgress('Downloading video...');
    console.log('[YouTubeImporter] Starting video download...');

    try {
      // First check if video already downloaded
      let videoFilePath = null;
      if (window.electronAPI.getVideoPath) {
        videoFilePath = await window.electronAPI.getVideoPath(url);
        console.log('[YouTubeImporter] Cached video path:', videoFilePath);
      }

      if (!videoFilePath) {
        console.log('[YouTubeImporter] Video not cached, downloading...');
        videoFilePath = await window.electronAPI.youtubeDownloadVideo(url);
        console.log('[YouTubeImporter] Video downloaded:', videoFilePath);
      }

      if (!videoFilePath) {
        console.error('[YouTubeImporter] Failed to download video');
        setFrameExtractionProgress('Failed to download video');
        setIsExtractingFrames(false);
        return;
      }

      setVideoPath(videoFilePath);
      setFrameExtractionProgress('Extracting frames...');

      // Get unique timestamps (one frame per note, at the start of each note)
      // Limit to reasonable number to avoid overwhelming ffmpeg
      const maxFrames = 50;
      const timestamps = [...new Set(
        extractedNotes
          .slice(0, maxFrames)
          .map(note => Math.round(note.startTime * 100) / 100) // Round to 2 decimal places
      )];

      console.log('[YouTubeImporter] Extracting frames', { count: timestamps.length, videoPath: videoFilePath, timestamps: timestamps.slice(0, 5) });

      if (!window.electronAPI.extractFrames) {
        console.error('[YouTubeImporter] extractFrames not available');
        setFrameExtractionProgress('Error: extractFrames not available');
        setIsExtractingFrames(false);
        return;
      }

      // Extract frames
      console.log('[YouTubeImporter] Calling extractFrames...');
      const framePaths = await window.electronAPI.extractFrames(videoFilePath, timestamps);
      console.log('[YouTubeImporter] Frame paths received:', framePaths?.length || 0);

      // Load frames as data URLs
      const frameMap = new Map<number, string>();
      for (let i = 0; i < timestamps.length && i < framePaths.length; i++) {
        const framePath = framePaths[i];
        if (framePath) {
          const dataUrl = await window.electronAPI.readImageFile(framePath);
          if (dataUrl) {
            frameMap.set(timestamps[i], dataUrl);
          }
        }
        setFrameExtractionProgress(`Loading frames... ${i + 1}/${timestamps.length}`);
      }

      setExtractedFrames(frameMap);
      setFrameExtractionProgress(`Extracted ${frameMap.size} frames`);
      console.log('[YouTubeImporter] Frame extraction complete', { frameCount: frameMap.size });

    } catch (err) {
      const error = err as Error;
      console.error('[YouTubeImporter] Frame extraction failed', error);
      setFrameExtractionProgress(`Error: ${error.message}`);
    }

    setIsExtractingFrames(false);
  }, [url, extractedNotes]);

  // Find frame for a given timestamp (finds closest frame)
  const getFrameForTimestamp = useCallback((timestamp: number): string | null => {
    if (extractedFrames.size === 0) {
      console.log('[YouTubeImporter] getFrameForTimestamp: no frames available');
      return null;
    }

    // Find the closest frame timestamp
    let closestTime = -1;
    let closestDiff = Infinity;

    for (const frameTime of extractedFrames.keys()) {
      const diff = Math.abs(frameTime - timestamp);
      if (diff < closestDiff) {
        closestDiff = diff;
        closestTime = frameTime;
      }
    }

    // Use frame if within 2 seconds (loosened from 0.5)
    if (closestTime >= 0 && closestDiff <= 2.0) {
      console.log('[YouTubeImporter] getFrameForTimestamp:', timestamp, '-> closest:', closestTime, 'diff:', closestDiff.toFixed(2));
      return extractedFrames.get(closestTime) || null;
    }

    console.log('[YouTubeImporter] getFrameForTimestamp:', timestamp, '-> no match, closest was', closestTime, 'diff:', closestDiff.toFixed(2));
    return null;
  }, [extractedFrames]);

  // Use selected passage
  const useSelectedPassage = useCallback(async () => {
    console.log('[YouTubeImporter] useSelectedPassage called', {
      selectionStart,
      selectionEnd,
      hasVideoInfo: !!videoInfo,
      hasVideoPath: !!videoPath,
    });

    if (selectionStart === null || selectionEnd === null || !videoInfo) return;

    const selectedNotes = getSelectedNotes();
    console.log('[YouTubeImporter] Selected notes:', selectedNotes.length);

    if (selectedNotes.length === 0) {
      alert('No notes found in selected passage');
      return;
    }

    // Extract frames specifically for this segment
    const passageFrames = new Map<number, string>();

    // First ensure we have the video downloaded
    let currentVideoPath = videoPath;
    if (!currentVideoPath && window.electronAPI?.youtubeDownloadVideo) {
      setIsExtractingFrames(true);
      setFrameExtractionProgress('Downloading video...');
      try {
        currentVideoPath = await window.electronAPI.youtubeDownloadVideo(url);
        if (currentVideoPath) {
          setVideoPath(currentVideoPath);
        }
      } catch (err) {
        console.error('[YouTubeImporter] Video download failed:', err);
        setFrameExtractionProgress('Video download failed');
        setIsExtractingFrames(false);
      }
    }

    // Now extract frames for the segment
    if (currentVideoPath && window.electronAPI?.extractFrames) {
      setIsExtractingFrames(true);
      setFrameExtractionProgress('Extracting frames for segment...');

      // Generate timestamps: ~2 frames per second for the segment
      const frameInterval = 0.5; // Every 0.5 seconds
      const segmentTimestamps: number[] = [];
      for (let t = selectionStart; t <= selectionEnd; t += frameInterval) {
        segmentTimestamps.push(Math.round(t * 100) / 100);
      }

      console.log('[YouTubeImporter] Extracting segment frames', {
        count: segmentTimestamps.length,
        start: selectionStart,
        end: selectionEnd,
        videoPath: currentVideoPath,
      });

      try {
        const framePaths = await window.electronAPI.extractFrames(currentVideoPath, segmentTimestamps);
        console.log('[YouTubeImporter] Got frame paths:', framePaths?.length);

        // Load frames as data URLs with relative timestamps
        for (let i = 0; i < segmentTimestamps.length && i < framePaths.length; i++) {
          const framePath = framePaths[i];
          if (framePath && window.electronAPI.readImageFile) {
            const dataUrl = await window.electronAPI.readImageFile(framePath);
            if (dataUrl) {
              const relativeTime = segmentTimestamps[i] - selectionStart;
              passageFrames.set(relativeTime, dataUrl);
            }
          }
          setFrameExtractionProgress(`Loading frames... ${i + 1}/${segmentTimestamps.length}`);
        }

        console.log('[YouTubeImporter] Segment frames loaded:', passageFrames.size);
        setFrameExtractionProgress(`${passageFrames.size} frames ready`);
      } catch (err) {
        console.error('[YouTubeImporter] Segment frame extraction failed:', err);
        setFrameExtractionProgress('Frame extraction failed');
      }

      setIsExtractingFrames(false);
    }

    const passage: PassageSelection = {
      startTime: selectionStart,
      endTime: selectionEnd,
      notes: selectedNotes,
      frames: passageFrames.size > 0 ? passageFrames : undefined,
      audioBlobUrl: audioBlobUrl || undefined, // Include the audio for playback
    };

    console.log('[YouTubeImporter] Passage ready', {
      start: selectionStart.toFixed(2),
      end: selectionEnd.toFixed(2),
      noteCount: selectedNotes.length,
      frameCount: passageFrames.size,
    });

    if (onPassageSelected) {
      onPassageSelected(passage, videoInfo);
    }
  }, [selectionStart, selectionEnd, videoInfo, url, videoPath, audioBlobUrl, getSelectedNotes, onPassageSelected]);

  // Load audio file as blob URL (file:// is blocked by Electron security)
  useEffect(() => {
    if (!audioPath || !window.electronAPI?.readAudioFile) return;

    let cancelled = false;

    const loadAudio = async () => {
      console.log('[YouTubeImporter] Loading audio file as blob...', { audioPath });
      const base64Data = await window.electronAPI.readAudioFile(audioPath);

      if (cancelled || !base64Data) {
        console.error('[YouTubeImporter] Failed to load audio file');
        return;
      }

      // Convert base64 to blob
      const binaryString = atob(base64Data);
      const bytes = new Uint8Array(binaryString.length);
      for (let i = 0; i < binaryString.length; i++) {
        bytes[i] = binaryString.charCodeAt(i);
      }
      const blob = new Blob([bytes], { type: 'audio/wav' });
      const blobUrl = URL.createObjectURL(blob);

      console.log('[YouTubeImporter] Audio blob URL created', { blobUrl });
      setAudioBlobUrl(blobUrl);
    };

    loadAudio();

    return () => {
      cancelled = true;
      // Clean up old blob URL
      if (audioBlobUrl) {
        URL.revokeObjectURL(audioBlobUrl);
      }
    };
  }, [audioPath]);

  // Update current time during playback
  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;

    const handleTimeUpdate = () => {
      const time = audio.currentTime;
      setCurrentTime(time);

      // Handle looping within selection
      if (isLooping && selectionStart !== null && selectionEnd !== null) {
        if (time >= selectionEnd) {
          audio.currentTime = selectionStart;
        }
      }
    };
    const handleEnded = () => setIsPlaying(false);

    audio.addEventListener('timeupdate', handleTimeUpdate);
    audio.addEventListener('ended', handleEnded);

    return () => {
      audio.removeEventListener('timeupdate', handleTimeUpdate);
      audio.removeEventListener('ended', handleEnded);
    };
  }, [audioPath]);

  // Get notes that are currently playing
  const currentNotes = extractedNotes.filter(
    note => currentTime >= note.startTime && currentTime <= note.endTime
  );

  // Get upcoming notes (next 2 seconds)
  const upcomingNotes = extractedNotes.filter(
    note => note.startTime > currentTime && note.startTime <= currentTime + 2
  );

  const videoId = getVideoId(url);

  return (
    <div style={{
      position: 'fixed',
      top: 0,
      left: 0,
      right: 0,
      bottom: 0,
      backgroundColor: 'rgba(0, 0, 0, 0.9)',
      display: 'flex',
      flexDirection: 'column',
      padding: '20px',
      zIndex: 1000,
    }}>
      {/* Header */}
      <div style={{
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        marginBottom: '20px',
      }}>
        <h2 style={{ margin: 0, color: '#fff' }}>Import from YouTube</h2>
        {onClose && (
          <button
            onClick={onClose}
            style={{
              background: 'transparent',
              border: '1px solid #666',
              color: '#fff',
              padding: '8px 16px',
              borderRadius: '4px',
              cursor: 'pointer',
            }}
          >
            Close
          </button>
        )}
      </div>

      {/* URL Input */}
      <div style={{
        display: 'flex',
        gap: '10px',
        marginBottom: '20px',
      }}>
        <input
          type="text"
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          placeholder="Paste YouTube URL here..."
          style={{
            flex: 1,
            padding: '12px',
            fontSize: '16px',
            borderRadius: '4px',
            border: '1px solid #444',
            backgroundColor: '#222',
            color: '#fff',
          }}
          onKeyDown={(e) => e.key === 'Enter' && handleSubmit()}
        />
        <button
          onClick={handleSubmit}
          disabled={!url.trim() || status.status === 'extracting' || status.status === 'analyzing'}
          style={{
            padding: '12px 24px',
            fontSize: '16px',
            borderRadius: '4px',
            border: 'none',
            backgroundColor: status.status === 'extracting' || status.status === 'analyzing' ? '#444' : '#4CAF50',
            color: '#fff',
            cursor: status.status === 'extracting' || status.status === 'analyzing' ? 'not-allowed' : 'pointer',
          }}
        >
          {status.status === 'extracting' || status.status === 'analyzing' ? 'Processing...' : 'Extract Notes'}
        </button>
      </div>

      {/* Progress Bar */}
      {(status.status === 'extracting' || status.status === 'analyzing') && (
        <div style={{ marginBottom: '20px' }}>
          <div style={{
            height: '4px',
            backgroundColor: '#333',
            borderRadius: '2px',
            overflow: 'hidden',
          }}>
            <div
              style={{
                height: '100%',
                width: `${status.progress}%`,
                backgroundColor: status.status === 'extracting' ? '#2196F3' : '#4CAF50',
                transition: 'width 0.3s',
              }}
            />
          </div>
          <p style={{ color: '#888', marginTop: '8px' }}>{status.message}</p>
        </div>
      )}

      {/* Error Message */}
      {status.status === 'error' && (
        <div style={{
          padding: '12px',
          backgroundColor: '#f44336',
          borderRadius: '4px',
          marginBottom: '20px',
        }}>
          <p style={{ color: '#fff', margin: 0 }}>{status.message}</p>
        </div>
      )}

      {/* Main Content */}
      <div style={{
        flex: 1,
        display: 'flex',
        gap: '20px',
        overflow: 'hidden',
      }}>
        {/* Video Preview */}
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column' }}>
          {videoId ? (
            <div
              id="youtube-player"
              style={{
                width: '100%',
                flex: 1,
                minHeight: '300px',
                borderRadius: '8px',
                backgroundColor: '#000',
              }}
            />
          ) : (
            <div style={{
              flex: 1,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              backgroundColor: '#1a1a1a',
              borderRadius: '8px',
              color: '#666',
            }}>
              <p>Video preview will appear here</p>
            </div>
          )}

          {/* Video Info */}
          {videoInfo && (
            <div style={{
              marginTop: '10px',
              padding: '10px',
              backgroundColor: '#222',
              borderRadius: '4px',
            }}>
              <h3 style={{ margin: '0 0 5px 0', color: '#fff' }}>{videoInfo.title}</h3>
              <p style={{ margin: 0, color: '#888' }}>
                {videoInfo.uploader} &bull; {Math.floor(videoInfo.duration / 60)}:{String(Math.floor(videoInfo.duration % 60)).padStart(2, '0')}
              </p>
            </div>
          )}
        </div>

        {/* Notes Panel */}
        <div style={{
          width: '350px',
          display: 'flex',
          flexDirection: 'column',
          backgroundColor: '#1a1a1a',
          borderRadius: '8px',
          padding: '15px',
        }}>
          <h3 style={{ margin: '0 0 15px 0', color: '#fff' }}>Detected Notes</h3>

          {status.status === 'complete' && extractedNotes.length > 0 ? (
            <>
              {/* Frame Extraction Controls - Show prominently at top */}
              <div style={{
                padding: '12px',
                backgroundColor: '#9C27B0',
                borderRadius: '8px',
                marginBottom: '15px',
              }}>
                <div style={{ display: 'flex', gap: '10px', alignItems: 'center', flexWrap: 'wrap' }}>
                  <button
                    onClick={extractVideoFrames}
                    disabled={isExtractingFrames || extractedNotes.length === 0}
                    style={{
                      padding: '10px 20px',
                      borderRadius: '4px',
                      border: 'none',
                      backgroundColor: isExtractingFrames ? '#666' : '#fff',
                      color: isExtractingFrames ? '#aaa' : '#9C27B0',
                      cursor: isExtractingFrames ? 'not-allowed' : 'pointer',
                      fontSize: '14px',
                      fontWeight: 'bold',
                    }}
                  >
                    {isExtractingFrames ? 'Extracting...' : extractedFrames.size > 0 ? 'Re-extract Frames' : 'Extract Video Frames'}
                  </button>
                  <span style={{ color: '#fff', fontSize: '12px' }}>
                    {frameExtractionProgress || 'Get hand position screenshots'}
                  </span>
                </div>
                {extractedFrames.size > 0 && (
                  <p style={{ color: '#E1BEE7', margin: '8px 0 0 0', fontSize: '12px' }}>
                    {extractedFrames.size} frames ready - see thumbnails below
                  </p>
                )}
              </div>

              {/* Audio Controls */}
              {audioBlobUrl && (
                <div style={{ marginBottom: '15px' }}>
                  <audio
                    ref={audioRef}
                    src={audioBlobUrl}
                    style={{ display: 'none' }}
                  />
                  <div style={{ display: 'flex', gap: '10px', alignItems: 'center', flexWrap: 'wrap' }}>
                    <button
                      onClick={togglePlayback}
                      style={{
                        padding: '8px 16px',
                        borderRadius: '4px',
                        border: 'none',
                        backgroundColor: '#4CAF50',
                        color: '#fff',
                        cursor: 'pointer',
                      }}
                    >
                      {isPlaying ? 'Pause' : 'Play'}
                    </button>
                    <span style={{ color: '#888' }}>
                      {currentTime.toFixed(1)}s
                    </span>
                    <button
                      onClick={() => setIsLooping(!isLooping)}
                      style={{
                        padding: '6px 12px',
                        borderRadius: '4px',
                        border: 'none',
                        backgroundColor: isLooping ? '#FF9800' : '#555',
                        color: '#fff',
                        cursor: 'pointer',
                        fontSize: '12px',
                      }}
                      title="Loop within selection"
                    >
                      Loop {isLooping ? 'ON' : 'OFF'}
                    </button>
                  </div>

                  {/* Passage Selection Controls */}
                  <div style={{
                    marginTop: '10px',
                    padding: '10px',
                    backgroundColor: '#222',
                    borderRadius: '4px',
                  }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
                      <span style={{ color: '#888', fontSize: '12px' }}>
                        Select a passage to practice:
                      </span>
                      <span style={{
                        color: '#4CAF50',
                        fontSize: '16px',
                        fontFamily: 'monospace',
                        fontWeight: 'bold'
                      }}>
                        Video: {youtubeTime.toFixed(1)}s
                      </span>
                    </div>
                    <div style={{ display: 'flex', gap: '8px', alignItems: 'center', flexWrap: 'wrap' }}>
                      <button
                        onClick={markSelectionStart}
                        style={{
                          padding: '6px 12px',
                          borderRadius: '4px',
                          border: 'none',
                          backgroundColor: '#2196F3',
                          color: '#fff',
                          cursor: 'pointer',
                          fontSize: '12px',
                        }}
                      >
                        Mark Start
                      </button>
                      <button
                        onClick={markSelectionEnd}
                        disabled={selectionStart === null}
                        style={{
                          padding: '6px 12px',
                          borderRadius: '4px',
                          border: 'none',
                          backgroundColor: selectionStart !== null ? '#2196F3' : '#444',
                          color: '#fff',
                          cursor: selectionStart !== null ? 'pointer' : 'not-allowed',
                          fontSize: '12px',
                        }}
                      >
                        Mark End
                      </button>
                      {selectionStart !== null && (
                        <button
                          onClick={clearSelection}
                          style={{
                            padding: '6px 12px',
                            borderRadius: '4px',
                            border: 'none',
                            backgroundColor: '#666',
                            color: '#fff',
                            cursor: 'pointer',
                            fontSize: '12px',
                          }}
                        >
                          Clear
                        </button>
                      )}
                    </div>

                    {/* Selection Info */}
                    {selectionStart !== null && (
                      <div style={{ marginTop: '8px', color: '#ccc', fontSize: '12px' }}>
                        Selection: {selectionStart.toFixed(1)}s
                        {selectionEnd !== null && ` - ${selectionEnd.toFixed(1)}s (${(selectionEnd - selectionStart).toFixed(1)}s)`}
                        {selectionEnd !== null && (
                          <span style={{ color: '#4CAF50', marginLeft: '10px' }}>
                            {getSelectedNotes().length} notes
                          </span>
                        )}
                      </div>
                    )}

                    {/* Use Passage Button */}
                    {selectionStart !== null && selectionEnd !== null && getSelectedNotes().length > 0 && (
                      <div>
                        {/* Show frame status before practicing */}
                        <div style={{
                          marginTop: '10px',
                          padding: '8px',
                          backgroundColor: extractedFrames.size > 0 ? '#4A148C' : '#B71C1C',
                          borderRadius: '4px',
                          fontSize: '12px',
                          color: '#fff',
                          textAlign: 'center',
                        }}>
                          {extractedFrames.size > 0
                            ? `${extractedFrames.size} frames available for practice`
                            : 'No frames extracted - click "Extract Video Frames" first!'}
                        </div>
                        <button
                          onClick={useSelectedPassage}
                          style={{
                            marginTop: '10px',
                            padding: '10px 20px',
                            borderRadius: '4px',
                            border: 'none',
                            backgroundColor: '#4CAF50',
                            color: '#fff',
                            cursor: 'pointer',
                            fontSize: '14px',
                            fontWeight: 'bold',
                            width: '100%',
                          }}
                        >
                          Practice This Passage ({getSelectedNotes().length} notes)
                        </button>

                        {/* Sheet Music OCR Button */}
                        {extractedFrames.size > 0 && (
                          <div style={{ marginTop: '10px' }}>
                            {ollamaStatus === null ? (
                              <div style={{ color: '#888', fontSize: '12px' }}>
                                Checking AI vision availability...
                              </div>
                            ) : ollamaStatus.available ? (
                              <>
                                <button
                                  onClick={analyzeSheetMusicFromFrames}
                                  disabled={isAnalyzingSheetMusic}
                                  style={{
                                    padding: '10px 20px',
                                    borderRadius: '4px',
                                    border: 'none',
                                    backgroundColor: isAnalyzingSheetMusic ? '#555' : '#9C27B0',
                                    color: '#fff',
                                    cursor: isAnalyzingSheetMusic ? 'wait' : 'pointer',
                                    fontSize: '14px',
                                    fontWeight: 'bold',
                                    width: '100%',
                                  }}
                                >
                                  {isAnalyzingSheetMusic ? 'Analyzing...' : 'Read Sheet Music (AI Vision)'}
                                </button>
                                {ocrProgress && (
                                  <div style={{ color: '#9C27B0', fontSize: '12px', marginTop: '5px' }}>
                                    {ocrProgress}
                                  </div>
                                )}
                              </>
                            ) : (
                              <div style={{ color: '#FF9800', fontSize: '12px' }}>
                                AI Vision: {ollamaStatus.error}
                              </div>
                            )}
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                </div>
              )}

              {/* Current Notes */}
              {currentNotes.length > 0 && (
                <div style={{
                  padding: '10px',
                  backgroundColor: '#4CAF50',
                  borderRadius: '4px',
                  marginBottom: '10px',
                }}>
                  <strong style={{ color: '#fff' }}>Now Playing:</strong>
                  <div style={{ color: '#fff', fontSize: '24px', marginTop: '5px' }}>
                    {currentNotes.map(n => n.noteName).join(', ')}
                  </div>
                </div>
              )}

              {/* Upcoming Notes */}
              {upcomingNotes.length > 0 && (
                <div style={{
                  padding: '10px',
                  backgroundColor: '#333',
                  borderRadius: '4px',
                  marginBottom: '10px',
                }}>
                  <strong style={{ color: '#888' }}>Coming up:</strong>
                  <div style={{ color: '#ccc', marginTop: '5px' }}>
                    {upcomingNotes.slice(0, 5).map((n, i) => (
                      <span key={i} style={{ marginRight: '10px' }}>
                        {n.noteName}
                        <span style={{ color: '#666', fontSize: '12px' }}>
                          {' '}({(n.startTime - currentTime).toFixed(1)}s)
                        </span>
                      </span>
                    ))}
                  </div>
                </div>
              )}

              {/* Notes Timeline with Frames (Sheet-style view) */}
              <div style={{
                flex: 1,
                overflowY: 'auto',
                backgroundColor: '#111',
                borderRadius: '4px',
                padding: '10px',
              }}>
                <p style={{ color: '#888', margin: '0 0 10px 0', fontSize: '12px' }}>
                  Total: {extractedNotes.length} notes {extractedFrames.size > 0 && `(${extractedFrames.size} with frames)`}
                </p>
                {extractedNotes.slice(0, 100).map((note, index) => {
                  const isCurrent = currentTime >= note.startTime && currentTime <= note.endTime;
                  const isInSelection = selectionStart !== null && selectionEnd !== null &&
                    note.startTime >= selectionStart && note.endTime <= selectionEnd;
                  const frameDataUrl = getFrameForTimestamp(note.startTime);

                  return (
                    <div
                      key={index}
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: '10px',
                        padding: '8px',
                        marginBottom: '4px',
                        backgroundColor: isCurrent
                          ? '#4CAF50'
                          : isInSelection
                            ? '#2196F3'
                            : '#1a1a1a',
                        borderRadius: '4px',
                        color: isCurrent || isInSelection ? '#fff' : '#ccc',
                        borderLeft: isInSelection ? '3px solid #64B5F6' : '3px solid transparent',
                      }}
                    >
                      {/* Frame thumbnail */}
                      {frameDataUrl ? (
                        <img
                          src={frameDataUrl}
                          alt={`Frame at ${note.startTime.toFixed(2)}s`}
                          style={{
                            width: '80px',
                            height: '45px',
                            objectFit: 'cover',
                            borderRadius: '4px',
                            flexShrink: 0,
                          }}
                        />
                      ) : (
                        <div style={{
                          width: '80px',
                          height: '45px',
                          backgroundColor: '#333',
                          borderRadius: '4px',
                          flexShrink: 0,
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          fontSize: '10px',
                          color: '#666',
                        }}>
                          No frame
                        </div>
                      )}

                      {/* Note info */}
                      <div style={{ flex: 1 }}>
                        <div style={{
                          fontFamily: 'monospace',
                          fontSize: '18px',
                          fontWeight: 'bold',
                        }}>
                          {note.noteName}
                        </div>
                        <div style={{ fontSize: '11px', color: isCurrent || isInSelection ? 'rgba(255,255,255,0.7)' : '#666' }}>
                          {note.startTime.toFixed(2)}s - {note.endTime.toFixed(2)}s
                          <span style={{ marginLeft: '10px' }}>
                            ({note.duration.toFixed(2)}s)
                          </span>
                        </div>
                      </div>

                      {/* MIDI number badge */}
                      <div style={{
                        padding: '4px 8px',
                        backgroundColor: isCurrent || isInSelection ? 'rgba(255,255,255,0.2)' : '#333',
                        borderRadius: '4px',
                        fontSize: '11px',
                        fontFamily: 'monospace',
                      }}>
                        MIDI {note.midi}
                      </div>
                    </div>
                  );
                })}
                {extractedNotes.length > 100 && (
                  <p style={{ color: '#666', textAlign: 'center', marginTop: '10px' }}>
                    ...and {extractedNotes.length - 100} more
                  </p>
                )}
              </div>
            </>
          ) : status.status === 'complete' ? (
            <p style={{ color: '#888' }}>No notes detected in the audio.</p>
          ) : (
            <p style={{ color: '#666' }}>
              Notes will appear here after extraction and analysis.
            </p>
          )}
        </div>
      </div>
    </div>
  );
};
