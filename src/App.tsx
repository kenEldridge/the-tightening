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
      onMidiNoteOn: (callback: (data: { note: number; velocity: number; channel: number }) => void) => void;
      onMidiNoteOff: (callback: (data: { note: number }) => void) => void;
      onMidiStatus: (callback: (data: { connected: boolean; message: string }) => void) => void;
      removeMidiListeners: () => void;
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
import type { PerformanceStats } from './components/ProgressTracker';
import { ProgressTracker } from './components/ProgressTracker';

// UI components
import { FallingNotesCanvas } from './components/FallingNotesCanvas';
import { VisualKeyboard } from './components/VisualKeyboard';
import { PracticeControls } from './components/PracticeControls';
import { TheTighteningLogo } from './components/TheTighteningLogo';
import { LyricsDisplay } from './components/LyricsDisplay';

// Data
import { loadSong, getLrcData, SONG_LIBRARY } from './data/loadSongs';
import type { SongData, SongSegment } from './utils/midiParser';
import type { LrcLine } from './utils/lrcParser';

// Startup diagnostic
console.log('[App] Module loading - if you see this, console capture is working!');

function App() {
  console.log('[App] Component rendering');
  // Configuration
  const [config, setConfig] = useState<AppConfig>(loadConfig());

  // System state
  const [midiStatus, setMidiStatus] = useState<string>('Initializing MIDI...');
  const [audioStatus, setAudioStatus] = useState<string>('Not initialized');
  const [songData, setSongData] = useState<SongData | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [samplesLoaded, setSamplesLoaded] = useState<boolean>(false);

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
  const [currentSegment, setCurrentSegment] = useState<SongSegment | null>(null);
  const [isSegmentLoopEnabled, setIsSegmentLoopEnabled] = useState<boolean>(false);
  const [lrcLines, setLrcLines] = useState<LrcLine[]>([]);

  // Component instances (refs to maintain state)
  const keyMapperRef = useRef<AdaptiveKeyMapper | null>(null);
  const audioEngineRef = useRef<AudioEngine | null>(null);
  const accompanimentRef = useRef<AccompanimentPlayer | null>(null);
  const progressTrackerRef = useRef<ProgressTracker | null>(null);
  const timeUpdateIntervalRef = useRef<number | null>(null);
  const currentTimeRef = useRef<number>(0); // Ref for currentTime to avoid stale closures

  // Confusion matrix tracking
  const hitNoteIndicesRef = useRef<Set<number>>(new Set()); // Track which notes have been hit
  const lastCheckedNoteIndexRef = useRef<number>(-1); // Track last note we checked for misses

  // Refs to always point to latest handlers (avoids stale closure in IPC MIDI listeners)
  const handleNoteOnRef = useRef<((data: { note: number; velocity: number }) => void) | null>(null);
  const handleNoteOffRef = useRef<((data: { note: number }) => void) | null>(null);

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
        progressTrackerRef.current = new ProgressTracker(
          config,
          keyMapperRef.current,
          accompanimentRef.current
        );

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
    };
  }, []);

  // Initialize MIDI via IPC (MIDI is handled in main process using native midi package)
  useEffect(() => {
    console.info('Setting up MIDI IPC listeners...');

    // Check if electronAPI is available (running in Electron)
    if (!window.electronAPI) {
      console.warn('electronAPI not available - not running in Electron');
      setMidiStatus('MIDI only available in Electron app');
      return;
    }

    // Listen for MIDI status from main process
    window.electronAPI.onMidiStatus((data) => {
      console.info('MIDI status update', data);
      setMidiStatus(data.message);
    });

    // Listen for note on events - call through ref to get latest handler
    window.electronAPI.onMidiNoteOn((data) => {
      if (handleNoteOnRef.current) {
        handleNoteOnRef.current(data);
      }
    });

    // Listen for note off events - call through ref to get latest handler
    window.electronAPI.onMidiNoteOff((data) => {
      if (handleNoteOffRef.current) {
        handleNoteOffRef.current(data);
      }
    });

    console.debug('MIDI IPC listeners registered');

    return () => {
      // Cleanup IPC listeners on unmount
      window.electronAPI?.removeMidiListeners();
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
      return next;
    });
  }, []);

  // Keep refs updated with latest handlers (fixes stale closure in MIDI listeners)
  useEffect(() => {
    handleNoteOnRef.current = handleNoteOn;
    handleNoteOffRef.current = handleNoteOff;
  }, [handleNoteOn, handleNoteOff]);

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

  // Update current correct note for visualization
  useEffect(() => {
    const note = getCurrentNote();
    setCurrentCorrectNote(note ? note.midi : null);
  }, [getCurrentNote]);

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

  // Play/Pause handler
  const handlePlayPause = async () => {
    if (!audioEngineRef.current || !accompanimentRef.current || !songData) return;

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

        const loadTime = Date.now() - startTime;
        console.info('Piano samples loaded', { loadTimeMs: loadTime });

        setSamplesLoaded(true);

        // Set tempo BEFORE loading song (so Part is scheduled with correct timing)
        const tempo = songData.tempo * config.gameplay.tempoMultiplier;
        accompanimentRef.current.setTempo(tempo);
        console.debug('Tempo set', { tempo, multiplier: config.gameplay.tempoMultiplier });

        // Load song into reference melody player (uses current Transport.bpm)
        accompanimentRef.current.loadSong(songData);

        // Start playback
        accompanimentRef.current.start();
        setIsPlaying(true);
        setAudioStatus('Playing');
        console.info('Playback started');
      } else {
        // Pause
        console.info('Pausing playback');
        accompanimentRef.current.pause();
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
    if (accompanimentRef.current) {
      accompanimentRef.current.stop();
      currentTimeRef.current = 0; // Reset ref
      setCurrentTime(0);
    }
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

  // Segment change handler
  const handleSegmentChange = (segment: SongSegment | null) => {
    setCurrentSegment(segment);

    if (accompanimentRef.current) {
      accompanimentRef.current.setLoopSegment(segment);
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
  };

  // Save config when it changes
  useEffect(() => {
    saveConfig(config);

    // Update component configs
    if (keyMapperRef.current) keyMapperRef.current.updateConfig(config);
    if (audioEngineRef.current) audioEngineRef.current.updateConfig(config);
    if (accompanimentRef.current) accompanimentRef.current.updateConfig(config);
    if (progressTrackerRef.current) progressTrackerRef.current.updateConfig(config);
  }, [config]);

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
    <div style={{ padding: '20px', fontFamily: 'monospace', backgroundColor: '#1a1a1a', color: '#eee', minHeight: '100vh' }}>
      <div style={{ marginBottom: '20px' }}>
        <TheTighteningLogo width={300} />
      </div>
      <p style={{ color: '#888', marginBottom: '20px' }}>
        Song: {songData.name} | MIDI: {midiStatus} | Audio: {audioStatus}
      </p>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 400px', gap: '20px' }}>
        {/* Main visualization area */}
        <div>
          {/* Falling notes (Guitar Hero style) */}
          <div style={{ marginBottom: '20px' }}>
            <h3 style={{ marginBottom: '10px' }}>Falling Notes</h3>
            <FallingNotesCanvas
              notes={songData.notes}
              currentTime={currentTime}
              distributionWidth={currentDistribution}
              noteRange={noteRange}
              config={config}
              width={800}
              height={400}
              lookAhead={3}
              segments={songData.segments}
              currentSegment={currentSegment}
            />
          </div>

          {/* Lyrics display */}
          <div style={{ marginBottom: '20px' }}>
            <LyricsDisplay
              segments={songData.segments}
              currentTime={currentTime}
              width={800}
              lrcLines={lrcLines}
            />
          </div>

          {/* Visual keyboard */}
          <div>
            <h3 style={{ marginBottom: '10px' }}>Piano Keyboard</h3>
            <VisualKeyboard
              noteRange={noteRange}
              pressedKeys={pressedKeys}
              currentCorrectNote={currentCorrectNote}
              distributionWidth={currentDistribution}
              config={config}
              width={800}
              height={150}
            />
          </div>
        </div>

        {/* Practice controls sidebar */}
        <div>
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
            autoProgression={config.progression.autoMode}
            onAutoProgressionToggle={handleAutoProgressionToggle}
            stats={stats}
            availableSongs={Object.keys(SONG_LIBRARY)}
            currentSong={currentSongId}
            onSongChange={handleSongChange}
            segments={songData?.segments || []}
            currentSegment={currentSegment}
            onSegmentChange={handleSegmentChange}
            isSegmentLoopEnabled={isSegmentLoopEnabled}
            onSegmentLoopToggle={handleSegmentLoopToggle}
          />
        </div>
      </div>
    </div>
  );
}

export default App;
