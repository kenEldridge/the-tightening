/**
 * Music Learning App - Main Application
 *
 * Integrates all components for the adaptive key mapping piano learning experience
 */

import { useEffect, useRef, useState, useCallback } from 'react';
import './App.css';

// Type declaration for Electron API exposed via preload
declare global {
  interface Window {
    electronAPI: {
      platform: string;
      // MIDI
      onMidiNoteOn: (callback: (data: { note: number; velocity: number; channel: number }) => void) => void;
      onMidiNoteOff: (callback: (data: { note: number }) => void) => void;
      onMidiStatus: (callback: (data: { connected: boolean; message: string }) => void) => void;
      removeMidiListeners: () => void;
      // YouTube extraction
      youtubeGetInfo: (url: string) => Promise<{ title: string; duration: number; thumbnail?: string; uploader?: string } | null>;
      youtubeExtractAudio: (url: string) => Promise<string | null>;
      onYoutubeProgress: (callback: (progress: { status: string; progress?: number; message?: string; outputPath?: string }) => void) => void;
      removeYoutubeProgressListener: () => void;
      youtubeGetOutputDir: () => Promise<string>;
      youtubeCleanup: (maxAgeHours?: number) => Promise<boolean>;
      // Analysis cache
      analysisCacheSave: (videoId: string, data: any) => Promise<boolean>;
      analysisCacheLoad: (videoId: string) => Promise<any | null>;
      analysisCacheExists: (videoId: string) => Promise<boolean>;
      // File access
      readAudioFile: (filePath: string) => Promise<string | null>;
      readImageFile: (filePath: string) => Promise<string | null>;
      // Video & Frame extraction
      youtubeDownloadVideo: (url: string) => Promise<string | null>;
      extractFrames: (videoPath: string, timestamps: number[]) => Promise<string[]>;
      getVideoPath: (url: string) => Promise<string | null>;
      // Debug screenshots
      debugScreenshot: (label?: string) => Promise<string | null>;
      debugScreenshotReset: () => Promise<boolean>;
      // Rhythm project API
      projectCreateLite: (input: { name: string; sourceType: 'youtube' | 'local_file'; sourceUri: string; sourceTitle: string; sourceDuration?: number }) => Promise<any>;
      projectLoadLite: (projectId: string) => Promise<any>;
      projectList: () => Promise<any[]>;
      projectDelete: (projectId: string) => Promise<boolean>;
      projectSaveTimeline: (projectId: string, timeline: any) => Promise<boolean>;
      projectImportLocalMedia: () => Promise<any>;
      normalizeAudioToWav: (inputPath: string, projectId: string) => Promise<any>;
      projectSetAudioPath: (projectId: string, audioPath: string) => Promise<boolean>;
    };
  }
}

// Logging
// TEMPORARILY DISABLED - Testing if this blocks rendering
// import { initializeLogger, loggers } from './utils/logger';

// Configuration
import type { AppConfig } from './config/AppConfig';
import { loadConfig, saveConfig } from './config/AppConfig';

// Core components
import type { KeyMappingResult } from './components/AdaptiveKeyMapper';
import { AdaptiveKeyMapper } from './components/AdaptiveKeyMapper';
import { AudioEngine } from './components/AudioEngine';
import { AccompanimentPlayer } from './components/AccompanimentPlayer';
import { ReferenceMelodyPlayer } from './components/ReferenceMelody';
import type { PerformanceStats } from './components/ProgressTracker';
import { ProgressTracker } from './components/ProgressTracker';

// Microphone input for pitch detection
import { MicrophoneInput, type NoteEvent, type AudioCaptureStatus } from './core/MicrophoneInput';

// Comparison engine for note matching
import { ComparisonEngine, type ComparisonStats, type NoteComparisonResult } from './core/ComparisonEngine';

// UI components
import { ScrollingSheetMusic } from './components/ScrollingSheetMusic';
import { WebMidi } from 'webmidi';
import { VisualKeyboard } from './components/VisualKeyboard';
import { PracticeControls } from './components/PracticeControls';
import { TheTighteningLogo } from './components/TheTighteningLogo';
import { LyricsDisplay } from './components/LyricsDisplay';
import { YouTubeImporter, type PassageSelection } from './components/YouTubeImporter';
import { YouTubeHomePage } from './components/YouTubeHomePage';
import { HomePage } from './components/HomePage';
import { PracticeFrameDisplay } from './components/PracticeFrameDisplay';
import { RhythmPage } from './components/RhythmPage';
import type { DetectedNoteEvent } from './core/VideoAnalyzer';
import type { MelodyNote } from './utils/midiParser';
import type { SavedSegment } from './utils/segmentStorage';
import { convertOcrNotesToMelody } from './utils/timingConverter';
import { debugCapture } from './utils/debug';

// Data
import { loadSong, getLrcData, SONG_LIBRARY, loadSongByPath, type SongIndexEntry } from './data/loadSongs';
import type { SongData, SongSegment } from './utils/midiParser';
import type { LrcLine } from './utils/lrcParser';

// Startup diagnostic
console.log('[App] Module loading - if you see this, console capture is working!');

function App() {
  // Configuration - use lazy initializer to only load config once on mount
  const [config, setConfig] = useState<AppConfig>(() => loadConfig());

  // System state
  const [midiStatus, setMidiStatus] = useState<string>('Initializing MIDI...');
  const [audioStatus, setAudioStatus] = useState<string>('Not initialized');
  const [songData, setSongData] = useState<SongData | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [samplesLoaded, setSamplesLoaded] = useState<boolean>(false);

  // Input mode state (MIDI vs Microphone)
  const [inputMode, setInputMode] = useState<'midi' | 'microphone'>('midi');
  const [micStatus, setMicStatus] = useState<AudioCaptureStatus>('uninitialized');
  const [lastDetectedNote, setLastDetectedNote] = useState<{ midi: number; noteName: string; clarity: number } | null>(null);

  // Comparison engine state (for microphone mode)
  const [comparisonStats, setComparisonStats] = useState<ComparisonStats | null>(null);
  const [lastComparisonResult, setLastComparisonResult] = useState<NoteComparisonResult | null>(null);

  // Playback state
  const [isPlaying, setIsPlaying] = useState<boolean>(false);
  const [currentTime, setCurrentTime] = useState<number>(0);
  const [currentNoteIndex, setCurrentNoteIndex] = useState<number>(0);

  // Performance state
  const [stats, setStats] = useState<PerformanceStats>({
    totalNotes: 0,
    averageAccuracy: 0,
    recentAccuracy: 0,
    currentStreak: 0,
    bestStreak: 0,
    practiceTime: 0,
    progress: 0,
    confusionMatrix: { hits: 0, misses: 0, extras: 0 },
  });

  // Visual state
  const [pressedKeys, setPressedKeys] = useState<Set<number>>(new Set());
  const [currentCorrectNote, setCurrentCorrectNote] = useState<number | null>(null);

  // Song and segment state
  const [currentSongId, setCurrentSongId] = useState<string>(config.gameplay.currentSong);
  const [currentSongName, setCurrentSongName] = useState<string>('');
  const [currentSegment, setCurrentSegment] = useState<SongSegment | null>(null);
  const [isSegmentLoopEnabled, setIsSegmentLoopEnabled] = useState<boolean>(false);
  const [lrcLines, setLrcLines] = useState<LrcLine[]>([]);

  // UI state
  const [sidebarCollapsed, setSidebarCollapsed] = useState<boolean>(false);
  const mainAreaRef = useRef<HTMLDivElement>(null);
  const [mainAreaWidth, setMainAreaWidth] = useState<number>(800);
  const vizContainerRef = useRef<HTMLDivElement>(null);
  const [vizHeight, setVizHeight] = useState<number>(500);

  // App-level view state
  type AppView = 'home' | 'song' | 'youtube' | 'rhythm';
  const [appView, setAppView] = useState<AppView>('home');

  // YouTube importer state
  type YoutubeView = null | 'home' | 'import';
  const [youtubeView, setYoutubeView] = useState<YoutubeView>(null);
  const [youtubeResumeLoading, setYoutubeResumeLoading] = useState<boolean>(false);
  const [youtubeExtractedNotes, setYoutubeExtractedNotes] = useState<DetectedNoteEvent[]>([]);
  const [practiceFrames, setPracticeFrames] = useState<Map<number, string> | null>(null);
  const [practiceAudioUrl, setPracticeAudioUrl] = useState<string | null>(null);
  const [practiceStartTime, setPracticeStartTime] = useState<number>(0); // Segment start in full audio

  // YouTube practice mode: wait mode + sync offset + MIDI stats
  const [waitMode, setWaitModeInternal] = useState(false);
  const [isWaiting, setIsWaiting] = useState(false);
  const [syncOffset, setSyncOffset] = useState(0);
  const [practiceStats, setPracticeStats] = useState({ hits: 0, misses: 0, extras: 0 });
  const [isPracticeFramePlaying, setIsPracticeFramePlaying] = useState(false);
  const isWaitingRef = useRef(false);
  const waitingForNotesRef = useRef<Set<number>>(new Set());
  const waitingNoteIndicesRef = useRef<Set<number>>(new Set());
  const playedWhileWaitingRef = useRef<Set<number>>(new Set());
  const lastWaitNoteIndexRef = useRef<number>(-1);
  const pausePlaybackRef = useRef<(() => void) | null>(null);
  const resumePlaybackRef = useRef<(() => void) | null>(null);
  // Refs so MIDI handler can read these without stale closure
  const isPracticeFrameActiveRef = useRef(false);
  const syncOffsetRef = useRef(0);

  // Component instances (refs to maintain state)
  const keyMapperRef = useRef<AdaptiveKeyMapper | null>(null);
  const audioEngineRef = useRef<AudioEngine | null>(null);
  const accompanimentRef = useRef<AccompanimentPlayer | null>(null);
  const melodyRef = useRef<ReferenceMelodyPlayer | null>(null);  // Bell synth melody guide
  const progressTrackerRef = useRef<ProgressTracker | null>(null);
  const timeUpdateIntervalRef = useRef<number | null>(null);
  const currentTimeRef = useRef<number>(0); // Ref for currentTime to avoid stale closures
  const practiceTimeRef = useRef<number>(0); // Time from PracticeFrameDisplay for mic comparison

  // Confusion matrix tracking
  const hitNoteIndicesRef = useRef<Set<number>>(new Set()); // Track which notes have been hit
  const lastCheckedNoteIndexRef = useRef<number>(-1); // Track last note we checked for misses

  // Refs to always point to latest handlers (avoids stale closure in IPC MIDI listeners)
  const handleNoteOnRef = useRef<((data: { note: number; velocity: number }) => void) | null>(null);
  const handleNoteOffRef = useRef<((data: { note: number }) => void) | null>(null);

  // Microphone input ref
  const microphoneInputRef = useRef<MicrophoneInput | null>(null);

  // Comparison engine ref (for matching detected vs expected notes)
  const comparisonEngineRef = useRef<ComparisonEngine | null>(null);

  // Initialize logger first
  useEffect(() => {
    // initializeLogger(); // TEMP DISABLED
    console.log('[App] Initializing application...');
  }, []);

  // Initialize core components
  useEffect(() => {
    const init = async () => {
      try {
        // DEV: Clear saved progress to ensure fresh start with full distribution width
        // This resets any tightening that occurred in previous sessions
        localStorage.removeItem('musicLearningAppProgress');
        console.info('[App] Cleared saved progress for fresh start');

        console.info('Creating core components...');
        // Create core components
        keyMapperRef.current = new AdaptiveKeyMapper(config);
        audioEngineRef.current = new AudioEngine(config);
        accompanimentRef.current = new AccompanimentPlayer(config);
        melodyRef.current = new ReferenceMelodyPlayer(config);  // Bell synth melody guide
        progressTrackerRef.current = new ProgressTracker(
          config,
          keyMapperRef.current,
          accompanimentRef.current
        );
        // Create comparison engine for mic mode
        comparisonEngineRef.current = new ComparisonEngine();

        // Load song and LRC data in parallel
        console.info('Loading initial song', { songId: config.gameplay.currentSong });
        const [song, lrcData] = await Promise.all([
          loadSong(config.gameplay.currentSong),
          getLrcData(config.gameplay.currentSong),
        ]);
        setSongData(song);
        if (lrcData) {
          setLrcLines(lrcData.lines);
        }
        console.info('Song loaded successfully', {
          name: song.name,
          noteCount: song.notes.length,
          duration: song.duration,
          hasLrc: !!lrcData,
        });

        // Initialize audio systems (requires user interaction, will do on play)
        setAudioStatus('Ready (click Play to load piano - may take 1-2 seconds)');

        // Try to load saved progress
        if (progressTrackerRef.current.loadProgress()) {
          console.info('Loaded saved progress');
        }

        setLoading(false);
        console.info('Application initialization complete');
        setTimeout(() => debugCapture('startup'), 500);
      } catch (err) {
        const error = err as Error;
        console.error('Initialization error', {
          error: error.message,
          stack: error.stack
        });
        setAudioStatus(`Error: ${err}`);
        setLoading(false);
      }
    };

    init();

    return () => {
      // Cleanup on unmount
      if (audioEngineRef.current) audioEngineRef.current.dispose();
      if (accompanimentRef.current) accompanimentRef.current.dispose();
      if (melodyRef.current) melodyRef.current.dispose();
      if (microphoneInputRef.current) microphoneInputRef.current.dispose();
    };
  }, []);

  // Handle microphone note events
  const handleMicrophoneNote = useCallback((event: NoteEvent) => {
    console.log('[Mic] Note event:', event.type, event.noteName, 'MIDI:', event.midi, 'clarity:', event.clarity.toFixed(2));

    if (event.type === 'on') {
      // Update last detected note for display
      setLastDetectedNote({
        midi: event.midi,
        noteName: event.noteName,
        clarity: event.clarity,
      });

      // Record to comparison engine if active
      // Use practiceTimeRef when in practice frame mode, otherwise use currentTimeRef
      const isPracticeMode = practiceFrames && practiceFrames.size > 0;
      const time = isPracticeMode ? practiceTimeRef.current : currentTimeRef.current;

      if (comparisonEngineRef.current && (isPlaying || isPracticeMode)) {
        const result = comparisonEngineRef.current.recordDetectedNote({
          midi: event.midi,
          noteName: event.noteName,
          time: time,
          clarity: event.clarity,
          velocity: event.velocity,
        });

        if (result) {
          setLastComparisonResult(result);
          // Update stats periodically
          const stats = comparisonEngineRef.current.getCurrentStats();
          setComparisonStats(stats);
        }
      }

      // Convert velocity from 0-1 to 0-127 for consistency with MIDI
      const velocity = Math.round(event.velocity * 127);

      // Route through the same handleNoteOn logic as MIDI
      if (handleNoteOnRef.current) {
        handleNoteOnRef.current({ note: event.midi, velocity });
      }
    } else {
      // Note off
      setLastDetectedNote(null);
      if (handleNoteOffRef.current) {
        handleNoteOffRef.current({ note: event.midi });
      }
    }
  }, [isPlaying, practiceFrames]);

  // Toggle between MIDI and Microphone input
  const toggleInputMode = useCallback(async () => {
    if (inputMode === 'midi') {
      // Switch to microphone
      console.log('[App] Switching to microphone input...');

      // Create microphone input if not exists
      if (!microphoneInputRef.current) {
        microphoneInputRef.current = new MicrophoneInput({
          pitchDetector: {
            clarityThreshold: 0.85, // Slightly lower threshold for piano
          },
        });
      }

      // Initialize (request permission)
      const success = await microphoneInputRef.current.initialize();
      if (success) {
        setInputMode('microphone');
        // Start listening immediately for testing (even without playing)
        microphoneInputRef.current.start(handleMicrophoneNote);
        setMicStatus('listening');
        console.log('[App] Microphone initialized and listening!');
      } else {
        const status = microphoneInputRef.current.getStatus();
        setMicStatus(status);
        console.error('[App] Microphone initialization failed:', status);
      }
    } else {
      // Switch back to MIDI
      console.log('[App] Switching to MIDI input...');
      if (microphoneInputRef.current) {
        microphoneInputRef.current.stop();
      }
      setInputMode('midi');
      setLastDetectedNote(null);
    }
  }, [inputMode, handleMicrophoneNote]);

  // Start/stop microphone listening when playing state changes
  // In practice frame mode, keep mic running since PracticeFrameDisplay has its own play state
  useEffect(() => {
    if (inputMode !== 'microphone' || !microphoneInputRef.current) {
      return;
    }

    const isPracticeMode = practiceFrames && practiceFrames.size > 0;

    if (isPlaying || isPracticeMode) {
      // Keep mic running in practice mode or when main playback is active
      microphoneInputRef.current.start(handleMicrophoneNote);
      setMicStatus('listening');
    } else {
      microphoneInputRef.current.stop();
      setMicStatus('ready');
    }
  }, [isPlaying, inputMode, handleMicrophoneNote, practiceFrames]);

  // Initialize MIDI via WebMidi (browser API - works without native addon)
  useEffect(() => {
    console.info('[App] Initializing WebMIDI...');

    WebMidi.enable()
      .then(() => {
        console.info('[App] WebMIDI enabled, inputs:', WebMidi.inputs.map(i => i.name));

        if (WebMidi.inputs.length === 0) {
          setMidiStatus('No MIDI devices found');
          return;
        }

        const input = WebMidi.inputs[0];
        setMidiStatus(`Connected: ${input.name}`);
        console.info('[App] Listening to MIDI input:', input.name);

        input.addListener('noteon', (e) => {
          if (handleNoteOnRef.current) {
            handleNoteOnRef.current({
              note: e.note.number,
              velocity: Math.round(e.note.attack * 127),
            });
          }
        });

        input.addListener('noteoff', (e) => {
          if (handleNoteOffRef.current) {
            handleNoteOffRef.current({ note: e.note.number });
          }
        });
      })
      .catch((err) => {
        console.error('[App] WebMIDI failed:', err);
        setMidiStatus(`MIDI Error: ${err.message}`);
      });

    return () => {
      WebMidi.inputs.forEach(input => input.removeListener());
    };
  }, []);

  // Handle MIDI note on (receives data from IPC: { note, velocity, channel })
  const handleNoteOn = useCallback((data: { note: number; velocity: number }) => {
    const pressedMidiKey = data.note;

    console.debug('Note ON', {
      midi: pressedMidiKey,
      velocity: data.velocity
    });

    // Add to pressed keys
    setPressedKeys((prev) => new Set(prev).add(pressedMidiKey));

    // YouTube practice mode — wait mode + stats, no tightening/audio
    if (isPracticeFrameActiveRef.current) {
      if (!songData) return;

      // Handle wait mode (chord support)
      if (isWaitingRef.current && waitingForNotesRef.current.size > 0) {
        if (waitingForNotesRef.current.has(pressedMidiKey)) {
          playedWhileWaitingRef.current.add(pressedMidiKey);
          const allPlayed = Array.from(waitingForNotesRef.current).every(
            note => playedWhileWaitingRef.current.has(note)
          );
          if (allPlayed) {
            const hitCount = waitingNoteIndicesRef.current.size;
            isWaitingRef.current = false;
            setIsWaiting(false);
            waitingForNotesRef.current.clear();
            waitingNoteIndicesRef.current.clear();
            playedWhileWaitingRef.current.clear();
            resumePlaybackRef.current?.();
            setPracticeStats(prev => ({ ...prev, hits: prev.hits + hitCount }));
          }
        }
        // Wrong note while waiting — ignore
        return;
      }

      const time = practiceTimeRef.current - syncOffsetRef.current;
      const activeNoteIndex = songData.notes.findIndex(
        n => time >= n.time && time < n.time + n.duration
      );
      if (activeNoteIndex === -1) {
        setPracticeStats(prev => ({ ...prev, extras: prev.extras + 1 }));
      } else {
        hitNoteIndicesRef.current.add(activeNoteIndex);
        setPracticeStats(prev => ({ ...prev, hits: prev.hits + 1 }));
      }
      return;
    }

    // Duck the melody guide when user plays (so their piano is the lead voice)
    if (melodyRef.current) {
      melodyRef.current.duck();
    }

    // Get current correct note from song
    if (!songData || !keyMapperRef.current || !audioEngineRef.current) {
      console.warn('[MIDI] Early return - missing:', {
        hasSongData: !!songData,
        hasKeyMapper: !!keyMapperRef.current,
        hasAudioEngine: !!audioEngineRef.current
      });
      return;
    }

    const time = currentTimeRef.current;

    // Find currently ACTIVE note (not just recent note in gap)
    const activeNoteIndex = songData.notes.findIndex((n) => {
      const noteStart = n.time;
      const noteEnd = n.time + n.duration;
      return time >= noteStart && time < noteEnd;
    });

    const isInGap = activeNoteIndex === -1;
    const currentNote = activeNoteIndex >= 0 ? songData.notes[activeNoteIndex] : null;

    // Diagnostic logging
    console.log('[MIDI] Note mapping', {
      currentTime: time.toFixed(2),
      hasActiveNote: !isInGap,
      activeNoteIndex,
      noteInfo: currentNote ? {
        midi: currentNote.midi,
        name: currentNote.name,
        time: currentNote.time.toFixed(2),
      } : 'In gap - EXTRA'
    });

    // If in a gap, this is an EXTRA press
    if (isInGap) {
      if (progressTrackerRef.current) {
        progressTrackerRef.current.recordExtra();
        setStats(progressTrackerRef.current.getStats());
      }
      // Still play something (fallback to most recent note for sound)
      const fallbackNote = songData.notes.reduce((prev, current) => {
        if (current.time + current.duration <= time) {
          return (!prev || current.time > prev.time) ? current : prev;
        }
        return prev;
      }, null as typeof songData.notes[0] | null) || songData.notes[0];

      if (fallbackNote && audioEngineRef.current) {
        const mapping = keyMapperRef.current.mapKeyToMelody(pressedMidiKey, fallbackNote.midi);
        audioEngineRef.current.playNote({
          note: mapping.melodyNote,
          accuracy: mapping.accuracy * 0.5, // Reduce accuracy for extras (degraded sound)
          duration: fallbackNote.duration,
          velocity: data.velocity,
        });
      }
      return;
    }

    // HIT: Active note being played
    // Mark this note as hit
    hitNoteIndicesRef.current.add(activeNoteIndex);

    // Map pressed key to melody note
    const mapping: KeyMappingResult = keyMapperRef.current.mapKeyToMelody(
      pressedMidiKey,
      currentNote!.midi
    );

    console.debug('Key mapped (HIT)', {
      pressed: mapping.pressedKey,
      correct: currentNote!.midi,
      distance: mapping.distance,
      accuracy: mapping.accuracy.toFixed(2),
      noteIndex: activeNoteIndex
    });

    // Play audio with feedback
    audioEngineRef.current.playNote({
      note: mapping.melodyNote,
      accuracy: mapping.accuracy,
      duration: currentNote!.duration,
      velocity: data.velocity,
    });

    // Record performance (this is a HIT)
    if (progressTrackerRef.current) {
      progressTrackerRef.current.recordNote(mapping.accuracy);
      setStats(progressTrackerRef.current.getStats());
    }
  }, [songData]);

  // Handle MIDI note off (receives data from IPC: { note })
  const handleNoteOff = useCallback((data: { note: number }) => {
    console.debug('Note OFF', { midi: data.note });
    setPressedKeys((prev) => {
      const next = new Set(prev);
      next.delete(data.note);

      // If no more keys pressed, unduck the melody guide (fade it back in)
      if (next.size === 0 && melodyRef.current) {
        melodyRef.current.unduck();
      }

      return next;
    });
  }, []);

  // Keep refs updated with latest handlers (fixes stale closure in MIDI listeners)
  useEffect(() => {
    handleNoteOnRef.current = handleNoteOn;
    handleNoteOffRef.current = handleNoteOff;
  }, [handleNoteOn, handleNoteOff]);

  // Keep practice mode refs in sync with state (used inside MIDI handler)
  useEffect(() => {
    isPracticeFrameActiveRef.current = !!(practiceFrames && practiceFrames.size > 0);
  }, [practiceFrames]);

  useEffect(() => {
    syncOffsetRef.current = syncOffset;
  }, [syncOffset]);

  // setWaitMode wrapper — resets tracking when enabling
  const setWaitMode = useCallback((enabled: boolean) => {
    if (enabled) {
      lastWaitNoteIndexRef.current = -1;
    }
    setWaitModeInternal(enabled);
  }, []);

  // Wait mode interval — pauses playback when a new note arrives
  useEffect(() => {
    if (!waitMode || !isPracticeFramePlaying || !songData) return;

    const checkForWait = () => {
      if (isWaitingRef.current) return;
      const time = practiceTimeRef.current - syncOffsetRef.current;
      const activeNotes: { index: number; note: typeof songData.notes[0] }[] = [];
      songData.notes.forEach((n, i) => {
        if (time >= n.time && time < n.time + n.duration) {
          activeNotes.push({ index: i, note: n });
        }
      });
      if (activeNotes.length === 0) return;
      const firstNoteIndex = activeNotes[0].index;
      if (firstNoteIndex === lastWaitNoteIndexRef.current) return;
      lastWaitNoteIndexRef.current = firstNoteIndex;
      waitingForNotesRef.current = new Set(activeNotes.map(({ note }) => note.midi));
      waitingNoteIndicesRef.current = new Set(activeNotes.map(({ index }) => index));
      playedWhileWaitingRef.current.clear();
      isWaitingRef.current = true;
      setIsWaiting(true);
      pausePlaybackRef.current?.();
    };

    checkForWait();
    const interval = setInterval(checkForWait, 50);
    return () => clearInterval(interval);
  }, [waitMode, isPracticeFramePlaying, songData, syncOffset]);

  // Miss detection for YouTube practice mode
  useEffect(() => {
    if (!isPracticeFramePlaying || !songData || isWaiting) return;
    if (!isPracticeFrameActiveRef.current) return;

    const interval = setInterval(() => {
      if (isWaiting) return;
      const time = practiceTimeRef.current - syncOffsetRef.current;
      const lastChecked = lastCheckedNoteIndexRef.current;
      const hitNotes = hitNoteIndicesRef.current;
      let missCount = 0;
      for (let i = lastChecked + 1; i < songData.notes.length; i++) {
        const note = songData.notes[i];
        const noteEnd = note.time + note.duration;
        if (noteEnd < time) {
          if (!hitNotes.has(i)) {
            missCount++;
          }
          lastCheckedNoteIndexRef.current = i;
        } else {
          break;
        }
      }
      if (missCount > 0) {
        setPracticeStats(prev => ({ ...prev, misses: prev.misses + missCount }));
      }
    }, 100);
    return () => clearInterval(interval);
  }, [isPracticeFramePlaying, songData, isWaiting]);

  // Get current note based on playback time
  // IMPORTANT: Uses ref to avoid stale closure - always reads latest time
  const getCurrentNote = useCallback(() => {
    if (!songData) return null;

    // Read from ref to get LATEST time (avoids stale closure in MIDI callback)
    const time = currentTimeRef.current;

    // Find currently active note
    let note = songData.notes.find((n) => {
      const noteStart = n.time;
      const noteEnd = n.time + n.duration;
      return time >= noteStart && time < noteEnd;
    });

    // If in a gap between notes, use the most recent note
    // This allows practice during rests
    if (!note) {
      // Find the note that ended most recently
      note = songData.notes.reduce((prev, current) => {
        if (current.time + current.duration <= time) {
          return (!prev || current.time + current.duration > prev.time + prev.duration)
            ? current
            : prev;
        }
        return prev;
      }, null as typeof songData.notes[0] | null);
    }

    return note;
  }, [songData]); // Note: removed currentTime dependency - using ref instead

  // Update current correct note for visualization (song practice only)
  useEffect(() => {
    if (isPracticeFrameActiveRef.current) return; // YouTube mode manages its own
    const note = getCurrentNote();
    setCurrentCorrectNote(note ? note.midi : null);
  }, [getCurrentNote]);

  // YouTube mode: update keyboard highlight based on playback time
  // (only active notes glow green; waiting notes glow via isWaiting effect)
  const lastDebugCaptureTime = useRef(-999);
  const onYoutubeTimeUpdate = useCallback((time: number) => {
    practiceTimeRef.current = time;
    if (!isWaitingRef.current && songData) {
      const adj = time - syncOffsetRef.current;
      const active = songData.notes.find(n => adj >= n.time && adj < n.time + n.duration);
      setCurrentCorrectNote(active ? active.midi : null);
    }
    // Periodic capture every 3s during practice
    if (time - lastDebugCaptureTime.current >= 3) {
      lastDebugCaptureTime.current = time;
      debugCapture(`t${Math.floor(time)}s`);
    }
  }, [songData]);

  // YouTube mode: update keyboard highlight when wait mode activates
  useEffect(() => {
    if (!isPracticeFrameActiveRef.current) return;
    if (isWaiting && waitingForNotesRef.current.size > 0) {
      setCurrentCorrectNote(Array.from(waitingForNotesRef.current)[0]);
    }
  }, [isWaiting]);

  // Playback time update loop
  // NOTE: Using setInterval polling (16ms lag) for simplicity
  // FUTURE: Consider migrating to Transport.scheduleRepeat for tighter sync
  useEffect(() => {
    if (!isPlaying || !accompanimentRef.current || !songData) return;

    const interval = setInterval(() => {
      const time = accompanimentRef.current!.getCurrentTime();
      currentTimeRef.current = time; // Update ref FIRST (for MIDI callbacks)
      setCurrentTime(time); // Then update state (for UI)

      // Check for MISSED notes (notes whose window has passed without being hit)
      const lastChecked = lastCheckedNoteIndexRef.current;
      const hitNotes = hitNoteIndicesRef.current;
      let missOccurred = false;

      // Find notes that have ended and weren't hit
      for (let i = lastChecked + 1; i < songData.notes.length; i++) {
        const note = songData.notes[i];
        const noteEnd = note.time + note.duration;

        if (noteEnd < time) {
          // Note window has passed
          if (!hitNotes.has(i)) {
            // This note was MISSED
            if (progressTrackerRef.current) {
              progressTrackerRef.current.recordMiss();
              missOccurred = true;
            }
            console.log('[MISS] Note missed', {
              noteIndex: i,
              midi: note.midi,
              name: note.name,
              noteEnd: noteEnd.toFixed(2),
              currentTime: time.toFixed(2)
            });
          }
          lastCheckedNoteIndexRef.current = i;
        } else {
          // Haven't reached this note's end yet, stop checking
          break;
        }
      }

      // Only update stats when a miss occurred (avoid excessive re-renders)
      if (missOccurred && progressTrackerRef.current) {
        setStats(progressTrackerRef.current.getStats());
      }
    }, 16); // ~60fps updates

    timeUpdateIntervalRef.current = interval as unknown as number;

    return () => {
      if (timeUpdateIntervalRef.current) {
        clearInterval(timeUpdateIntervalRef.current);
      }
    };
  }, [isPlaying, songData]);

  // Auto-save progress periodically
  useEffect(() => {
    const interval = setInterval(() => {
      if (progressTrackerRef.current) {
        progressTrackerRef.current.saveProgress();
      }
    }, 30000); // Save every 30 seconds

    return () => clearInterval(interval);
  }, []);

  // Track main area width for responsive sizing
  useEffect(() => {
    const update = () => {
      if (mainAreaRef.current) {
        setMainAreaWidth(mainAreaRef.current.clientWidth);
      }
    };
    update();
    window.addEventListener('resize', update);
    return () => window.removeEventListener('resize', update);
  }, [sidebarCollapsed]);

  // Track visualization container height for proper sizing
  useEffect(() => {
    const el = vizContainerRef.current;
    if (!el) return;
    const ro = new ResizeObserver(entries => {
      setVizHeight(entries[0].contentRect.height);
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [appView]);

  // Capture screenshot on page changes
  useEffect(() => {
    setTimeout(() => debugCapture(`view_${appView}`), 300);
  }, [appView]);


  // Play/Pause handler
  const handlePlayPause = async () => {
    if (!audioEngineRef.current || !accompanimentRef.current || !melodyRef.current || !songData) return;

    try {
      if (!isPlaying) {
        console.info('Starting playback...');

        // Show loading state if samples not loaded yet
        if (!samplesLoaded) {
          setAudioStatus('Loading piano samples...');
          console.info('Loading piano samples for first time...');
        }

        const startTime = Date.now();

        // Initialize audio (loads samples) - now properly waits for completion
        await audioEngineRef.current.initialize();
        await accompanimentRef.current.initialize();
        await melodyRef.current.initialize();  // Bell synth (instant, no samples)

        const loadTime = Date.now() - startTime;
        console.info('Piano samples loaded', { loadTimeMs: loadTime });

        setSamplesLoaded(true);

        // Set tempo BEFORE loading song (so Part is scheduled with correct timing)
        const tempo = songData.tempo * config.gameplay.tempoMultiplier;
        accompanimentRef.current.setTempo(tempo);
        melodyRef.current.setTempo(tempo);
        console.debug('Tempo set', { tempo, multiplier: config.gameplay.tempoMultiplier });

        // Load song into both players
        accompanimentRef.current.loadSong(songData);
        melodyRef.current.loadSong(songData);

        // Start both players (melody = bell guide, accompaniment = piano chords)
        // Note: They share the same Tone.Transport so they stay in sync
        accompanimentRef.current.start();
        melodyRef.current.start();

        // Start comparison session if in microphone mode
        if (inputMode === 'microphone' && comparisonEngineRef.current) {
          comparisonEngineRef.current.startSession(songData.notes);
          setComparisonStats(null);
          setLastComparisonResult(null);
          console.info('[Comparison] Session started with', songData.notes.length, 'expected notes');
        }

        setIsPlaying(true);
        setAudioStatus('Playing (melody guide + accompaniment)');
        console.info('Playback started');
      } else {
        // Pause both
        console.info('Pausing playback');
        accompanimentRef.current.pause();
        melodyRef.current.pause();
        setIsPlaying(false);
        setAudioStatus('Paused');
      }
    } catch (err) {
      const error = err as Error;
      console.error('Playback error', {
        error: error.message,
        stack: error.stack
      });
      setAudioStatus(`Error loading samples: ${err}`);
      setSamplesLoaded(false); // Reset on error
    }
  };

  // Stop handler
  const handleStop = () => {
    // End comparison session if active
    if (comparisonEngineRef.current && inputMode === 'microphone') {
      const finalStats = comparisonEngineRef.current.endSession();
      setComparisonStats(finalStats);
      console.info('[Comparison] Session ended', {
        accuracy: (finalStats.accuracy * 100).toFixed(1) + '%',
        hits: finalStats.hits,
        misses: finalStats.misses,
        extras: finalStats.extras,
      });
    }

    if (accompanimentRef.current) {
      accompanimentRef.current.stop();
    }
    if (melodyRef.current) {
      melodyRef.current.stop();
    }
    currentTimeRef.current = 0; // Reset ref
    setCurrentTime(0);
    if (audioEngineRef.current) {
      audioEngineRef.current.stopAll();
    }
    setIsPlaying(false);
    setAudioStatus('Stopped');
  };

  // Reset handler
  const handleReset = () => {
    if (progressTrackerRef.current) {
      progressTrackerRef.current.reset();
      setStats(progressTrackerRef.current.getStats());
    }
    // Reset confusion matrix tracking refs
    hitNoteIndicesRef.current.clear();
    lastCheckedNoteIndexRef.current = -1;
    handleStop();
  };

  // Tempo change handler
  const handleTempoChange = (tempo: number) => {
    if (!songData) return;

    const multiplier = tempo / songData.tempo;
    setConfig((prev) => ({
      ...prev,
      gameplay: { ...prev.gameplay, tempoMultiplier: multiplier },
    }));

    if (accompanimentRef.current) {
      accompanimentRef.current.setTempo(tempo);
    }
    if (melodyRef.current) {
      melodyRef.current.setTempo(tempo);
    }
  };

  // Distribution width change handler
  const handleDistributionChange = (width: number) => {
    if (keyMapperRef.current) {
      keyMapperRef.current.setDistributionWidth(width);
    }

    setConfig((prev) => ({
      ...prev,
      distribution: { ...prev.distribution, manualWidthOverride: width },
    }));
  };

  // Reference volume change handler
  const handleReferenceVolumeChange = (volume: number) => {
    if (accompanimentRef.current) {
      accompanimentRef.current.setVolume(volume);
    }

    setConfig((prev) => ({
      ...prev,
      referenceMelody: { ...prev.referenceMelody, manualVolumeOverride: volume },
    }));
  };

  // Octave offset change handler
  const handleOctaveOffsetChange = (offset: number) => {
    setConfig((prev) => ({
      ...prev,
      referenceMelody: { ...prev.referenceMelody, octaveOffset: offset },
    }));

    // Note: Song needs to be reloaded to apply new offset
    // This will happen automatically when config changes trigger re-render
    // For immediate effect during playback, user should stop and restart
    console.info('[App] Octave offset changed', { newOffset: offset });
  };

  // Auto progression toggle handler
  const handleAutoProgressionToggle = () => {
    setConfig((prev) => ({
      ...prev,
      progression: { ...prev.progression, autoMode: !prev.progression.autoMode },
    }));
  };

  // Song change handler
  const handleSongChange = async (songId: string) => {
    console.info('Changing song', { newSongId: songId });

    // Stop current playback
    handleStop();

    // Update config
    setConfig((prev) => ({
      ...prev,
      gameplay: { ...prev.gameplay, currentSong: songId },
    }));

    // Load new song and LRC data
    setLoading(true);
    try {
      const [song, lrcData] = await Promise.all([
        loadSong(songId),
        getLrcData(songId),
      ]);
      setSongData(song);
      setLrcLines(lrcData?.lines || []);
      console.info('New song loaded', {
        name: song.name,
        noteCount: song.notes.length,
        duration: song.duration,
        segmentCount: song.segments.length,
        hasLrc: !!lrcData,
      });

      // Reset segment selection
      setCurrentSegment(null);
      setIsSegmentLoopEnabled(false);

      // Reset progress and confusion matrix tracking
      if (progressTrackerRef.current) {
        progressTrackerRef.current.reset();
        setStats(progressTrackerRef.current.getStats());
        console.info('Progress reset for new song');
      }
      hitNoteIndicesRef.current.clear();
      lastCheckedNoteIndexRef.current = -1;

      setCurrentSongId(songId);
      setCurrentSongName(song.name);
      setPracticeFrames(null); // Clear frames when switching songs
      setPracticeAudioUrl(null);
      setAudioStatus('Ready (click Play to load piano - may take 1-2 seconds)');
      setLoading(false);
    } catch (err) {
      const error = err as Error;
      console.error('Failed to load song', {
        songId,
        error: error.message,
        stack: error.stack
      });
      setAudioStatus(`Error loading song: ${err}`);
      setLoading(false);
    }
  };

  // Song selection from search handler
  const handleSongSelect = async (entry: SongIndexEntry) => {
    console.info('Selecting song from search', { name: entry.name, path: entry.path });

    // Stop current playback
    handleStop();

    // Load new song by path
    setLoading(true);
    try {
      const song = await loadSongByPath(entry.path, entry.name);
      setSongData(song);
      setLrcLines([]); // Index songs don't have LRC files
      console.info('Song loaded from index', {
        name: song.name,
        noteCount: song.notes.length,
        duration: song.duration,
      });

      // Reset segment selection
      setCurrentSegment(null);
      setIsSegmentLoopEnabled(false);

      // Reset progress and confusion matrix tracking
      if (progressTrackerRef.current) {
        progressTrackerRef.current.reset();
        setStats(progressTrackerRef.current.getStats());
      }
      hitNoteIndicesRef.current.clear();
      lastCheckedNoteIndexRef.current = -1;

      setCurrentSongId(`path:${entry.path}`);
      setCurrentSongName(entry.name);
      setPracticeFrames(null);
      setPracticeAudioUrl(null);
      setAudioStatus('Ready (click Play to load piano)');
      setLoading(false);
    } catch (err) {
      const error = err as Error;
      console.error('Failed to load song from path', {
        path: entry.path,
        error: error.message,
      });
      setAudioStatus(`Error loading song: ${err}`);
      setLoading(false);
    }
  };

  // Segment change handler
  const handleSegmentChange = (segment: SongSegment | null) => {
    setCurrentSegment(segment);

    if (accompanimentRef.current) {
      accompanimentRef.current.setLoopSegment(segment);
    }
    if (melodyRef.current) {
      melodyRef.current.setLoopSegment(segment);
    }

    // If segment selected, enable loop by default
    if (segment) {
      setIsSegmentLoopEnabled(true);
    } else {
      setIsSegmentLoopEnabled(false);
    }
  };

  // Segment loop toggle handler
  const handleSegmentLoopToggle = () => {
    const newState = !isSegmentLoopEnabled;
    setIsSegmentLoopEnabled(newState);

    if (accompanimentRef.current) {
      if (newState && currentSegment) {
        accompanimentRef.current.setLoopSegment(currentSegment);
      } else {
        accompanimentRef.current.setLoopSegment(null);
      }
    }
    if (melodyRef.current) {
      if (newState && currentSegment) {
        melodyRef.current.setLoopSegment(currentSegment);
      } else {
        melodyRef.current.setLoopSegment(null);
      }
    }
  };

  // Save config when it changes
  useEffect(() => {
    saveConfig(config);

    // Update component configs
    if (keyMapperRef.current) keyMapperRef.current.updateConfig(config);
    if (audioEngineRef.current) audioEngineRef.current.updateConfig(config);
    if (accompanimentRef.current) accompanimentRef.current.updateConfig(config);
    if (melodyRef.current) melodyRef.current.updateConfig(config);
    if (progressTrackerRef.current) progressTrackerRef.current.updateConfig(config);
  }, [config]);

  // Helper: convert base64 to Blob URL (same pattern as TestPracticeMode)
  const base64ToBlob = useCallback((base64: string, mimeType: string): Blob => {
    const binaryString = atob(base64);
    const bytes = new Uint8Array(binaryString.length);
    for (let i = 0; i < binaryString.length; i++) {
      bytes[i] = binaryString.charCodeAt(i);
    }
    return new Blob([bytes], { type: mimeType });
  }, []);

  // Resume a saved YouTube segment without re-extracting
  const handleResumeSession = useCallback(async (segment: SavedSegment) => {
    setYoutubeResumeLoading(true);
    try {
      // 1. Audio (cached on disk - fast)
      const audioPath = await window.electronAPI.youtubeExtractAudio(segment.videoUrl);
      if (audioPath) {
        const audioBase64 = await window.electronAPI.readAudioFile(audioPath);
        if (audioBase64) {
          const audioBlob = base64ToBlob(audioBase64, 'audio/wav');
          setPracticeAudioUrl(URL.createObjectURL(audioBlob));
        }
      }
      setPracticeStartTime(segment.startTime);

      // 2. Frames from disk (best-effort, skip missing gracefully)
      const outputDir = await window.electronAPI.youtubeGetOutputDir();
      const frameMap = new Map<number, string>();
      const fps = 2;
      for (let t = segment.startTime; t <= segment.endTime; t += 1 / fps) {
        const seconds = Math.floor(t);
        const cs = Math.round((t - seconds) * 100);
        const name = `frame_${seconds}_${cs.toString().padStart(2, '0')}.jpg`;
        const dataUrl = await window.electronAPI.readImageFile(`${outputDir}/frames/${segment.videoId}/${name}`);
        if (dataUrl) {
          frameMap.set(t - segment.startTime, dataUrl);
        }
      }
      if (frameMap.size > 0) {
        setPracticeFrames(frameMap);
      }

      // 3. Convert OCR notes to MelodyNote[]
      const melodyNotes: MelodyNote[] = segment.ocrNotes.length > 0
        ? convertOcrNotesToMelody(segment.ocrNotes, {
            beatsPerMeasure: segment.timeSignature.numerator,
            tempo: segment.tempo,
            segmentStartTime: 0,
          })
        : [];

      // 4. Build SongData from saved segment
      const duration = segment.endTime - segment.startTime;
      const midiValues = melodyNotes.map(n => n.midi);
      const customSongData: SongData = {
        name: segment.videoTitle ?? segment.name ?? 'YouTube',
        tempo: segment.tempo,
        timeSignature: segment.timeSignature,
        duration,
        notes: melodyNotes,
        segments: [],
        range: midiValues.length > 0
          ? { min: Math.min(...midiValues), max: Math.max(...midiValues) }
          : { min: 48, max: 84 },
      };

      setSongData(customSongData);
      setCurrentSongName(customSongData.name);
      // Reset YouTube practice mode state
      setSyncOffset(0);
      setPracticeStats({ hits: 0, misses: 0, extras: 0 });
      setWaitModeInternal(false);
      setIsWaiting(false);
      isWaitingRef.current = false;
      lastWaitNoteIndexRef.current = -1;
      waitingForNotesRef.current.clear();
      waitingNoteIndicesRef.current.clear();
      playedWhileWaitingRef.current.clear();
      hitNoteIndicesRef.current.clear();
      lastCheckedNoteIndexRef.current = -1;
      setYoutubeView(null);
      setAppView('song'); // Enter practice UI
    } catch (err) {
      console.error('[App] Failed to resume session:', err);
    } finally {
      setYoutubeResumeLoading(false);
    }
  }, [base64ToBlob]);

  // Home page view
  if (appView === 'home') {
    return (
      <HomePage
        onSongPractice={() => {
          setPracticeFrames(null);
          setPracticeAudioUrl(null);
          setAppView('song');
        }}
        onYoutubePractice={() => { setYoutubeView('home'); setAppView('youtube'); }}
        onRhythmPractice={() => setAppView('rhythm')}
        loadingStatus={loading ? audioStatus : undefined}
      />
    );
  }

  // Rhythm trainer view
  if (appView === 'rhythm') {
    return <RhythmPage onClose={() => setAppView('home')} />;
  }

  // YouTube views (full screen overlays)
  if (appView === 'youtube') {
    return (
      <div style={{
        display: 'flex',
        fontFamily: 'monospace',
        backgroundColor: '#1a1a1a',
        color: '#eee',
        height: '100vh',
        overflow: 'hidden',
      }}>
        {youtubeView === 'home' && (
          <YouTubeHomePage
            onClose={() => { setYoutubeView(null); setAppView('home'); }}
            onNewVideo={() => setYoutubeView('import')}
            onResume={handleResumeSession}
            resumeLoading={youtubeResumeLoading}
          />
        )}
        {youtubeView === 'import' && (
          <YouTubeImporter
            onNotesExtracted={(notes, videoInfo) => {
              console.log('[App] YouTube notes extracted', { count: notes.length, videoTitle: videoInfo.title });
              setYoutubeExtractedNotes(notes);
            }}
            onPassageSelected={(passage, videoInfo) => {
              console.log('[App] YouTube passage selected', {
                start: passage.startTime,
                end: passage.endTime,
                noteCount: passage.notes.length,
                frameCount: passage.frames?.size || 0,
                hasFrames: !!passage.frames,
                frameType: passage.frames ? typeof passage.frames : 'undefined',
                isMap: passage.frames instanceof Map,
                videoTitle: videoInfo.title,
              });

              // Convert DetectedNoteEvent[] to MelodyNote[] for use as practice target
              const melodyNotes: MelodyNote[] = passage.notes.map((note) => ({
                midi: note.midi,
                name: note.noteName,
                time: note.startTime - passage.startTime,
                duration: note.duration,
                velocity: 80,
              }));

              if (melodyNotes.length === 0) {
                console.error('[App] No notes in passage!');
                return;
              }

              if (passage.frames && passage.frames.size > 0) {
                setPracticeFrames(passage.frames);
                console.log('[App] Stored', passage.frames.size, 'frames for practice');
              } else {
                setPracticeFrames(null);
              }

              if (passage.audioBlobUrl) {
                setPracticeAudioUrl(passage.audioBlobUrl);
                setPracticeStartTime(passage.startTime);
                console.log('[App] Stored audio for practice', { startTime: passage.startTime });
              } else {
                setPracticeAudioUrl(null);
              }

              const customSongData: SongData = {
                name: `${videoInfo.title} (Passage)`,
                tempo: 120,
                timeSignature: { numerator: 4, denominator: 4 },
                duration: passage.endTime - passage.startTime,
                notes: melodyNotes,
                segments: [],
                range: {
                  min: Math.min(...melodyNotes.map(n => n.midi)),
                  max: Math.max(...melodyNotes.map(n => n.midi)),
                },
              };

              setSongData(customSongData);
              setCurrentSongName(customSongData.name);
              setYoutubeView(null);
              setAppView('song');

              console.log('[App] Custom song loaded from YouTube passage', customSongData);
            }}
            onClose={() => setYoutubeView('home')}
          />
        )}
      </div>
    );
  }

  // Song practice view
  if (loading || !songData) {
    return (
      <div style={{ padding: '20px', fontFamily: 'monospace', textAlign: 'center' }}>
        <h1>Loading Music Learning App...</h1>
        <p>{audioStatus}</p>
      </div>
    );
  }

  // Calculate visual keyboard range (song range + padding)
  const noteRange = {
    min: Math.max(0, songData.range.min - config.visual.keyboard.rangePadding),
    max: Math.min(127, songData.range.max + config.visual.keyboard.rangePadding),
  };

  const currentTempo = Math.round(songData.tempo * config.gameplay.tempoMultiplier);
  const currentDistribution = keyMapperRef.current?.getDistributionWidth() || config.distribution.initialWidth;
  const currentReferenceVolume = accompanimentRef.current?.getVolume() || config.referenceMelody.initialVolume;

  return (
    <div style={{
      display: 'flex',
      fontFamily: 'monospace',
      backgroundColor: '#1a1a1a',
      color: '#eee',
      height: '100vh',
      overflow: 'hidden',
    }}>
      {/* Main content area */}
      <div
        ref={mainAreaRef}
        style={{
          flex: 1,
          display: 'flex',
          flexDirection: 'column',
          padding: '8px',
          overflow: 'hidden',
        }}
      >
        {/* Compact header */}
        <div style={{
          display: 'flex',
          alignItems: 'center',
          gap: '20px',
          marginBottom: '6px',
          flexShrink: 0,
        }}>
          <TheTighteningLogo width={100} />
          <span style={{ color: '#888', fontSize: '12px' }}>
            {songData.name} | {inputMode === 'midi' ? midiStatus : `Mic: ${micStatus}`} | {audioStatus}
          </span>

          {/* Home button */}
          <button
            onClick={() => { handleStop(); setAppView('home'); }}
            style={{
              padding: '6px 12px',
              backgroundColor: '#333',
              color: '#aaa',
              border: '1px solid #555',
              borderRadius: '4px',
              cursor: 'pointer',
              fontSize: '12px',
            }}
            title="Back to home"
          >
            ← Home
          </button>

          {/* YouTube Practice button */}
          <button
            onClick={() => { setYoutubeView('home'); setAppView('youtube'); }}
            style={{
              padding: '6px 12px',
              backgroundColor: '#FF0000',
              color: '#fff',
              border: 'none',
              borderRadius: '4px',
              cursor: 'pointer',
              fontSize: '12px',
            }}
            title="YouTube practice sessions"
          >
            YouTube
          </button>

        </div>

        {/* Practice visualization - frames if YouTube session, otherwise scrolling notes */}
        <div ref={vizContainerRef} style={{ flex: 1, minHeight: '150px', overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
          {practiceFrames && practiceFrames.size > 0 ? (
            <>
              {/* Sync offset + stats controls for YouTube practice */}
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 6, flexShrink: 0 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 5, backgroundColor: '#333', padding: '4px 8px', borderRadius: 4 }}>
                  <span style={{ color: '#888', fontSize: 12 }}>Sync:</span>
                  <button onClick={() => setSyncOffset(v => v - 0.1)} style={{ width: 26, height: 26, backgroundColor: '#555', color: '#fff', border: 'none', borderRadius: 4, cursor: 'pointer' }}>-</button>
                  <span style={{ color: '#fff', fontSize: 13, fontFamily: 'monospace', minWidth: 48, textAlign: 'center' }}>
                    {syncOffset >= 0 ? '+' : ''}{syncOffset.toFixed(1)}s
                  </span>
                  <button onClick={() => setSyncOffset(v => v + 0.1)} style={{ width: 26, height: 26, backgroundColor: '#555', color: '#fff', border: 'none', borderRadius: 4, cursor: 'pointer' }}>+</button>
                  <button onClick={() => setSyncOffset(0)} style={{ padding: '2px 6px', backgroundColor: '#555', color: '#888', border: 'none', borderRadius: 4, cursor: 'pointer', fontSize: 11 }}>Reset</button>
                </div>
                <span style={{ color: '#4a4', fontSize: 12 }}>H:{practiceStats.hits}</span>
                <span style={{ color: '#a44', fontSize: 12 }}>M:{practiceStats.misses}</span>
                <span style={{ color: '#88a', fontSize: 12 }}>E:{practiceStats.extras}</span>
                <button
                  onClick={() => {
                    setPracticeStats({ hits: 0, misses: 0, extras: 0 });
                    hitNoteIndicesRef.current.clear();
                    lastCheckedNoteIndexRef.current = -1;
                    lastWaitNoteIndexRef.current = -1;
                    waitingForNotesRef.current.clear();
                    waitingNoteIndicesRef.current.clear();
                    playedWhileWaitingRef.current.clear();
                    isWaitingRef.current = false;
                    setIsWaiting(false);
                  }}
                  style={{ padding: '2px 8px', backgroundColor: '#444', color: '#888', border: 'none', borderRadius: 4, cursor: 'pointer', fontSize: 11 }}
                >
                  Reset stats
                </button>
              </div>
            <PracticeFrameDisplay
              notes={songData.notes}
              frames={practiceFrames}
              audioBlobUrl={practiceAudioUrl}
              audioStartTime={practiceStartTime}
              width={mainAreaWidth - 30}
              height={Math.max(200, vizHeight - 46)}
              onTimeUpdate={onYoutubeTimeUpdate}
              onPlayStateChange={(playing) => {
                setIsPracticeFramePlaying(playing);
                debugCapture(playing ? 'practice_play' : 'practice_stop');
                if (!playing && !isWaitingRef.current) {
                  // Only reset on user-initiated stop, not wait-mode pause
                  isWaitingRef.current = false;
                  setIsWaiting(false);
                  waitingForNotesRef.current.clear();
                  waitingNoteIndicesRef.current.clear();
                  playedWhileWaitingRef.current.clear();
                  lastWaitNoteIndexRef.current = -1;
                  hitNoteIndicesRef.current.clear();
                  lastCheckedNoteIndexRef.current = -1;
                }
                if (playing) {
                  // Start comparison session for practice mode
                  if (comparisonEngineRef.current && inputMode === 'microphone') {
                    comparisonEngineRef.current.startSession(songData.notes);
                    setComparisonStats(null);
                    setLastComparisonResult(null);
                    console.info('[Comparison] Practice session started with', songData.notes.length, 'expected notes');
                  }
                } else {
                  // End comparison session
                  if (comparisonEngineRef.current && inputMode === 'microphone') {
                    const finalStats = comparisonEngineRef.current.endSession();
                    setComparisonStats(finalStats);
                    console.info('[Comparison] Practice session ended', {
                      accuracy: (finalStats.accuracy * 100).toFixed(1) + '%',
                      hits: finalStats.hits,
                      misses: finalStats.misses,
                      extras: finalStats.extras,
                    });
                  }
                }
              }}
              micEnabled={inputMode === 'microphone'}
              onMicToggle={toggleInputMode}
              lastDetectedNote={lastDetectedNote}
              comparisonStats={comparisonStats}
              midiPressedKeys={pressedKeys}
              midiStats={practiceStats}
              waitMode={waitMode}
              onWaitModeChange={setWaitMode}
              isWaiting={isWaiting}
              waitingForNotes={waitingForNotesRef.current}
              playedNotes={playedWhileWaitingRef.current}
              pauseRef={pausePlaybackRef}
              resumeRef={resumePlaybackRef}
              syncOffset={syncOffset}
            />
            </>
          ) : (
            <ScrollingSheetMusic
              notes={songData.notes}
              currentTime={currentTime}
              width={mainAreaWidth - 30}
              height={Math.max(80, vizHeight)}
              visibleWindow={8}
            />
          )}
        </div>

        {/* Visual keyboard */}
        <div style={{ flexShrink: 0 }}>
          <VisualKeyboard
            noteRange={noteRange}
            pressedKeys={pressedKeys}
            currentCorrectNote={currentCorrectNote}
            distributionWidth={currentDistribution}
            config={config}
            width={mainAreaWidth - 30}
            height={practiceFrames && practiceFrames.size > 0 ? 100 : 180}
          />
        </div>

        {/* Lyrics — only in song practice mode */}
        {!(practiceFrames && practiceFrames.size > 0) && (
          <div style={{ flexShrink: 0, marginTop: '10px' }}>
            <LyricsDisplay
              segments={songData.segments}
              currentTime={currentTime}
              width={mainAreaWidth - 30}
              lrcLines={lrcLines}
            />
          </div>
        )}
      </div>

      {/* Collapsible sidebar */}
      <div style={{
        width: sidebarCollapsed ? '50px' : '350px',
        backgroundColor: '#2a2a2a',
        borderLeft: '2px solid #333',
        transition: 'width 0.2s ease',
        overflow: 'hidden',
        display: 'flex',
        flexDirection: 'column',
      }}>
        {/* Sidebar toggle */}
        <button
          onClick={() => setSidebarCollapsed(!sidebarCollapsed)}
          style={{
            padding: '15px',
            backgroundColor: 'transparent',
            border: 'none',
            color: '#888',
            cursor: 'pointer',
            fontSize: '20px',
            textAlign: 'center',
          }}
          title={sidebarCollapsed ? 'Expand controls' : 'Collapse controls'}
        >
          {sidebarCollapsed ? '◀' : '▶'}
        </button>

        {/* Controls content */}
        {!sidebarCollapsed && (
          <div style={{ overflow: 'auto', flex: 1 }}>
            <PracticeControls
              isPlaying={isPlaying}
              onPlayPause={handlePlayPause}
              onStop={handleStop}
              onReset={handleReset}
              tempo={currentTempo}
              onTempoChange={handleTempoChange}
              distributionWidth={currentDistribution}
              maxDistributionWidth={config.distribution.initialWidth}
              onDistributionChange={handleDistributionChange}
              referenceVolume={currentReferenceVolume}
              onReferenceVolumeChange={handleReferenceVolumeChange}
              octaveOffset={config.referenceMelody.octaveOffset}
              onOctaveOffsetChange={handleOctaveOffsetChange}
              autoProgression={config.progression.autoMode}
              onAutoProgressionToggle={handleAutoProgressionToggle}
              stats={stats}
              availableSongs={Object.keys(SONG_LIBRARY)}
              currentSong={currentSongId}
              currentSongName={currentSongName || songData?.name || 'Unknown'}
              onSongChange={handleSongChange}
              onSongSelect={handleSongSelect}
              segments={songData?.segments || []}
              currentSegment={currentSegment}
              onSegmentChange={handleSegmentChange}
              isSegmentLoopEnabled={isSegmentLoopEnabled}
              onSegmentLoopToggle={handleSegmentLoopToggle}
            />
          </div>
        )}
      </div>

    </div>
  );
}

export default App;
