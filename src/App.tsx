/**
 * Music Learning App - Main Application
 *
 * Integrates all components for the adaptive key mapping piano learning experience
 */

import { useEffect, useRef, useState, useCallback } from 'react';
import { WebMidi, Input } from 'webmidi';
import './App.css';

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
import { ReferenceMelodyPlayer } from './components/ReferenceMelody';
import type { PerformanceStats } from './components/ProgressTracker';
import { ProgressTracker } from './components/ProgressTracker';

// UI components
import { FallingNotesCanvas } from './components/FallingNotesCanvas';
import { VisualKeyboard } from './components/VisualKeyboard';
import { PracticeControls } from './components/PracticeControls';
import { TheTighteningLogo } from './components/TheTighteningLogo';

// Data
import { loadSong, SONG_LIBRARY } from './data/loadSongs';
import type { SongData, SongSegment } from './utils/midiParser';

function App() {
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
  });

  // Visual state
  const [pressedKeys, setPressedKeys] = useState<Set<number>>(new Set());
  const [currentCorrectNote, setCurrentCorrectNote] = useState<number | null>(null);

  // Song and segment state
  const [currentSongId, setCurrentSongId] = useState<string>(config.gameplay.currentSong);
  const [currentSegment, setCurrentSegment] = useState<SongSegment | null>(null);
  const [isSegmentLoopEnabled, setIsSegmentLoopEnabled] = useState<boolean>(false);

  // Component instances (refs to maintain state)
  const keyMapperRef = useRef<AdaptiveKeyMapper | null>(null);
  const audioEngineRef = useRef<AudioEngine | null>(null);
  const referenceMelodyRef = useRef<ReferenceMelodyPlayer | null>(null);
  const progressTrackerRef = useRef<ProgressTracker | null>(null);
  const midiInputRef = useRef<Input | null>(null);
  const timeUpdateIntervalRef = useRef<number | null>(null);

  // Initialize logger first
  useEffect(() => {
    // initializeLogger(); // TEMP DISABLED
    console.log('[App] Initializing application...');
  }, []);

  // Initialize core components
  useEffect(() => {
    const init = async () => {
      try {
        console.info('Creating core components...');
        // Create core components
        keyMapperRef.current = new AdaptiveKeyMapper(config);
        audioEngineRef.current = new AudioEngine(config);
        referenceMelodyRef.current = new ReferenceMelodyPlayer(config);
        progressTrackerRef.current = new ProgressTracker(
          config,
          keyMapperRef.current,
          referenceMelodyRef.current
        );

        // Load song
        console.info('Loading initial song', { songId: config.gameplay.currentSong });
        const song = await loadSong(config.gameplay.currentSong);
        setSongData(song);
        console.info('Song loaded successfully', {
          name: song.name,
          noteCount: song.notes.length,
          duration: song.duration
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
      if (referenceMelodyRef.current) referenceMelodyRef.current.dispose();
    };
  }, []);

  // Initialize MIDI
  useEffect(() => {
    const initMidi = async () => {
      try {
        console.info('Initializing WebMIDI...');
        await WebMidi.enable();

        if (WebMidi.inputs.length === 0) {
          console.warn('No MIDI devices found');
          setMidiStatus('No MIDI devices found. Connect keyboard and refresh.');
          return;
        }

        const input = WebMidi.inputs[0];
        midiInputRef.current = input;
        console.info('MIDI device connected', {
          name: input.name,
          manufacturer: input.manufacturer,
          id: input.id,
          state: input.state
        });
        setMidiStatus(`Connected: ${input.name}`);

        // Listen for note events
        input.addListener('noteon', handleNoteOn);
        input.addListener('noteoff', handleNoteOff);
        console.debug('MIDI event listeners registered');
      } catch (err) {
        const error = err as Error;
        console.error('MIDI initialization failed', {
          error: error.message,
          stack: error.stack
        });
        setMidiStatus(`MIDI Error: ${error.message}`);
      }
    };

    initMidi();

    return () => {
      if (midiInputRef.current) {
        midiInputRef.current.removeListener('noteon');
        midiInputRef.current.removeListener('noteoff');
      }
    };
  }, []);

  // Handle MIDI note on
  const handleNoteOn = useCallback((e: any) => {
    const pressedMidiKey = e.note.number;

    console.debug('Note ON', {
      midi: pressedMidiKey,
      noteName: e.note.name,
      velocity: e.note.attack
    });

    // Add to pressed keys
    setPressedKeys((prev) => new Set(prev).add(pressedMidiKey));

    // Get current correct note from song
    if (!songData || !keyMapperRef.current || !audioEngineRef.current) return;

    const currentNote = getCurrentNote();
    if (!currentNote) return;

    // Map pressed key to melody note
    const mapping: KeyMappingResult = keyMapperRef.current.mapKeyToMelody(
      pressedMidiKey,
      currentNote.midi
    );

    console.debug('Key mapped', {
      pressed: mapping.pressedKey,
      correct: currentNote.midi,
      distance: mapping.distance,
      accuracy: mapping.accuracy.toFixed(2)
    });

    // Play audio with feedback
    audioEngineRef.current.playNote({
      note: mapping.melodyNote,
      accuracy: mapping.accuracy,
      duration: currentNote.duration,
      velocity: e.note.attack,
    });

    // Record performance
    if (progressTrackerRef.current) {
      progressTrackerRef.current.recordNote(mapping.accuracy);
      setStats(progressTrackerRef.current.getStats());
    }
  }, [songData]);

  // Handle MIDI note off
  const handleNoteOff = useCallback((e: any) => {
    console.debug('Note OFF', { midi: e.note.number });
    setPressedKeys((prev) => {
      const next = new Set(prev);
      next.delete(e.note.number);
      return next;
    });
  }, []);

  // Get current note based on playback time
  const getCurrentNote = useCallback(() => {
    if (!songData) return null;

    // Find the note that should be playing now
    const note = songData.notes.find((n, i) => {
      const noteStart = n.time;
      const noteEnd = n.time + n.duration;
      return currentTime >= noteStart && currentTime < noteEnd;
    });

    return note || null;
  }, [songData, currentTime]);

  // Update current correct note for visualization
  useEffect(() => {
    const note = getCurrentNote();
    setCurrentCorrectNote(note ? note.midi : null);
  }, [getCurrentNote]);

  // Playback time update loop
  // NOTE: Using setInterval polling (16ms lag) for simplicity
  // FUTURE: Consider migrating to Transport.scheduleRepeat for tighter sync
  useEffect(() => {
    if (!isPlaying || !referenceMelodyRef.current) return;

    const interval = setInterval(() => {
      const time = referenceMelodyRef.current!.getCurrentTime();
      setCurrentTime(time);
    }, 16); // ~60fps updates

    timeUpdateIntervalRef.current = interval as unknown as number;

    return () => {
      if (timeUpdateIntervalRef.current) {
        clearInterval(timeUpdateIntervalRef.current);
      }
    };
  }, [isPlaying]);

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
    if (!audioEngineRef.current || !referenceMelodyRef.current || !songData) return;

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
        await referenceMelodyRef.current.initialize();

        const loadTime = Date.now() - startTime;
        console.info('Piano samples loaded', { loadTimeMs: loadTime });

        setSamplesLoaded(true);

        // Set tempo BEFORE loading song (so Part is scheduled with correct timing)
        const tempo = songData.tempo * config.gameplay.tempoMultiplier;
        referenceMelodyRef.current.setTempo(tempo);
        console.debug('Tempo set', { tempo, multiplier: config.gameplay.tempoMultiplier });

        // Load song into reference melody player (uses current Transport.bpm)
        referenceMelodyRef.current.loadSong(songData);

        // Start playback
        referenceMelodyRef.current.start();
        setIsPlaying(true);
        setAudioStatus('Playing');
        console.info('Playback started');
      } else {
        // Pause
        console.info('Pausing playback');
        referenceMelodyRef.current.pause();
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
    if (referenceMelodyRef.current) {
      referenceMelodyRef.current.stop();
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

    if (referenceMelodyRef.current) {
      referenceMelodyRef.current.setTempo(tempo);
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
    if (referenceMelodyRef.current) {
      referenceMelodyRef.current.setVolume(volume);
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

    // Load new song
    setLoading(true);
    try {
      const song = await loadSong(songId);
      setSongData(song);
      console.info('New song loaded', {
        name: song.name,
        noteCount: song.notes.length,
        duration: song.duration,
        segmentCount: song.segments.length
      });

      // Reset segment selection
      setCurrentSegment(null);
      setIsSegmentLoopEnabled(false);

      // Reset progress
      if (progressTrackerRef.current) {
        progressTrackerRef.current.reset();
        setStats(progressTrackerRef.current.getStats());
        console.info('Progress reset for new song');
      }

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

    if (referenceMelodyRef.current) {
      referenceMelodyRef.current.setLoopSegment(segment);
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

    if (referenceMelodyRef.current) {
      if (newState && currentSegment) {
        referenceMelodyRef.current.setLoopSegment(currentSegment);
      } else {
        referenceMelodyRef.current.setLoopSegment(null);
      }
    }
  };

  // Save config when it changes
  useEffect(() => {
    saveConfig(config);

    // Update component configs
    if (keyMapperRef.current) keyMapperRef.current.updateConfig(config);
    if (audioEngineRef.current) audioEngineRef.current.updateConfig(config);
    if (referenceMelodyRef.current) referenceMelodyRef.current.updateConfig(config);
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
  const currentReferenceVolume = referenceMelodyRef.current?.getVolume() || config.referenceMelody.initialVolume;

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
