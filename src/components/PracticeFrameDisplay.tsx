/**
 * Practice Frame Display
 *
 * Self-contained YouTube practice component with its own audio playback.
 * Shows video frames synced to the actual YouTube audio.
 */

import React, { useState, useRef, useEffect, useCallback, useMemo, useLayoutEffect } from 'react';
import type { MelodyNote } from '../utils/midiParser';
import { ScrollingSheetMusic } from './ScrollingSheetMusic';

// Simple stats for MIDI tracking (keyboard makes its own sound)
export interface SimpleStats {
  hits: number;
  misses: number;
  extras: number;
}

interface PracticeFrameDisplayProps {
  notes: MelodyNote[];
  frames: Map<number, string> | null;  // relative timestamp -> dataUrl
  audioBlobUrl: string | null;  // URL to the full extracted audio
  audioStartTime: number;  // Where in the full audio this segment starts
  width: number;
  height: number;
  onTimeUpdate?: (time: number) => void;  // Called during playback with relative time
  onPlayStateChange?: (isPlaying: boolean) => void;  // Called when play/pause state changes
  // Mic feedback props
  micEnabled?: boolean;
  onMicToggle?: () => void;
  lastDetectedNote?: { midi: number; noteName: string; clarity: number } | null;
  comparisonStats?: { accuracy: number; hits: number; misses: number; extras: number } | null;
  // MIDI feedback props - keyboard makes its own sound, we just track performance
  midiPressedKeys?: Set<number>;  // Keys currently pressed on MIDI keyboard
  midiStats?: SimpleStats | null;  // Simple hits/misses/extras
  // Wait mode - parent can control pause/resume
  waitMode?: boolean;
  onWaitModeChange?: (enabled: boolean) => void;
  isWaiting?: boolean;
  waitingForNotes?: Set<number>;  // MIDI notes we're waiting for (chord support)
  playedNotes?: Set<number>;  // Notes already played in this chord
  pauseRef?: React.MutableRefObject<(() => void) | null>;  // Parent sets this to get pause function
  resumeRef?: React.MutableRefObject<(() => void) | null>;  // Parent sets this to get resume function
}

export const PracticeFrameDisplay: React.FC<PracticeFrameDisplayProps> = ({
  notes,
  frames,
  audioBlobUrl,
  audioStartTime,
  width,
  height,
  onTimeUpdate,
  onPlayStateChange,
  micEnabled = false,
  onMicToggle,
  lastDetectedNote,
  comparisonStats,
  midiPressedKeys,
  midiStats,
  waitMode = false,
  onWaitModeChange,
  isWaiting = false,
  waitingForNotes,
  playedNotes,
  pauseRef,
  resumeRef,
}) => {
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0); // Time relative to segment start
  const [duration, setDuration] = useState(0);
  const [loopEnabled, setLoopEnabled] = useState(true); // Loop by default for practice
  const loopEnabledRef = useRef(loopEnabled); // Ref for event handlers
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const notesListRef = useRef<HTMLDivElement | null>(null);
  const currentNoteRef = useRef<HTMLDivElement | null>(null);

  // Keep ref in sync with state
  useEffect(() => {
    loopEnabledRef.current = loopEnabled;
  }, [loopEnabled]);

  // Calculate segment duration from notes
  const segmentDuration = useMemo(() => {
    if (notes.length === 0) return 5;
    const lastNote = notes[notes.length - 1];
    return lastNote.time + lastNote.duration + 0.5; // Add a little padding
  }, [notes]);

  // Set up audio element
  useEffect(() => {
    if (!audioBlobUrl) return;

    const audio = new Audio(audioBlobUrl);
    audioRef.current = audio;

    audio.addEventListener('loadedmetadata', () => {
      setDuration(audio.duration);
      // Seek to segment start
      audio.currentTime = audioStartTime;
    });

    audio.addEventListener('timeupdate', () => {
      const relativeTime = audio.currentTime - audioStartTime;
      setCurrentTime(Math.max(0, relativeTime));
      onTimeUpdate?.(Math.max(0, relativeTime));

      // Handle segment end
      if (relativeTime >= segmentDuration) {
        // Always seek back to start
        audio.currentTime = audioStartTime;
        setCurrentTime(0);
        onTimeUpdate?.(0);

        // If not looping, pause
        if (!loopEnabledRef.current) {
          audio.pause();
          setIsPlaying(false);
          onPlayStateChange?.(false);
        }
        // If looping, audio continues playing from start
      }
    });

    audio.addEventListener('ended', () => {
      setIsPlaying(false);
      onPlayStateChange?.(false);
      setCurrentTime(0);
    });

    return () => {
      audio.pause();
      audio.src = '';
    };
  }, [audioBlobUrl, audioStartTime, segmentDuration]);

  // Play/Pause toggle
  const togglePlayback = useCallback(() => {
    if (!audioRef.current) return;

    if (isPlaying) {
      audioRef.current.pause();
      setIsPlaying(false);
      onPlayStateChange?.(false);
    } else {
      // Ensure we're at the right position
      if (audioRef.current.currentTime < audioStartTime ||
          audioRef.current.currentTime >= audioStartTime + segmentDuration) {
        audioRef.current.currentTime = audioStartTime;
      }
      audioRef.current.play().catch(err => console.error('Play failed:', err));
      setIsPlaying(true);
      onPlayStateChange?.(true);
    }
  }, [isPlaying, audioStartTime, segmentDuration, onPlayStateChange]);

  // Restart from beginning
  const restart = useCallback(() => {
    if (!audioRef.current) return;
    audioRef.current.currentTime = audioStartTime;
    setCurrentTime(0);
    onTimeUpdate?.(0);
    if (!isPlaying) {
      audioRef.current.play().catch(err => console.error('Play failed:', err));
      setIsPlaying(true);
      onPlayStateChange?.(true);
    }
  }, [audioStartTime, isPlaying, onTimeUpdate, onPlayStateChange]);

  // Pause playback (for wait mode)
  const pause = useCallback(() => {
    if (!audioRef.current) return;
    audioRef.current.pause();
    setIsPlaying(false);
    onPlayStateChange?.(false);
  }, [onPlayStateChange]);

  // Resume playback (for wait mode)
  const resume = useCallback(() => {
    if (!audioRef.current) return;
    audioRef.current.play().catch(err => console.error('Resume failed:', err));
    setIsPlaying(true);
    onPlayStateChange?.(true);
  }, [onPlayStateChange]);

  // Expose pause/resume to parent via refs
  useEffect(() => {
    if (pauseRef) pauseRef.current = pause;
    if (resumeRef) resumeRef.current = resume;
  }, [pause, resume, pauseRef, resumeRef]);

  // Find current frame
  const currentFrame = useMemo(() => {
    if (!frames || frames.size === 0) return null;

    let closestTime = -1;
    let closestDiff = Infinity;

    for (const frameTime of frames.keys()) {
      const diff = Math.abs(frameTime - currentTime);
      if (diff < closestDiff) {
        closestDiff = diff;
        closestTime = frameTime;
      }
    }

    return closestTime >= 0 ? frames.get(closestTime) || null : null;
  }, [frames, currentTime]);

  // Auto-scroll notes list to keep current note visible
  useLayoutEffect(() => {
    if (currentNoteRef.current && notesListRef.current) {
      currentNoteRef.current.scrollIntoView({
        behavior: 'smooth',
        block: 'center',
      });
    }
  }, [currentTime]);

  // Find current and upcoming notes
  const { currentNote, upcomingNotes } = useMemo(() => {
    const current = notes.find(
      n => currentTime >= n.time && currentTime < n.time + n.duration
    );

    const upcoming = notes.filter(
      n => n.time > currentTime && n.time <= currentTime + 3
    ).slice(0, 5);

    return { currentNote: current, upcomingNotes: upcoming };
  }, [notes, currentTime]);

  if (!frames || frames.size === 0) {
    return (
      <div style={{
        width,
        height,
        backgroundColor: '#1a1a1a',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        color: '#666',
        borderRadius: '8px',
      }}>
        <p style={{ fontSize: '18px', margin: '0 0 10px 0' }}>No video frames available</p>
        <p style={{ fontSize: '14px', margin: 0 }}>
          Extract frames in YouTube Importer to see hand positions
        </p>
      </div>
    );
  }

  return (
    <div style={{
      width,
      height,
      backgroundColor: '#1a1a1a',
      borderRadius: '8px',
      overflow: 'hidden',
      display: 'flex',
      flexDirection: 'column',
    }}>
      {/* Playback Controls */}
      <div style={{
        display: 'flex',
        alignItems: 'center',
        gap: '15px',
        padding: '10px 15px',
        backgroundColor: '#222',
        borderBottom: '1px solid #333',
      }}>
        <button
          onClick={togglePlayback}
          style={{
            padding: '10px 24px',
            borderRadius: '4px',
            border: 'none',
            backgroundColor: isPlaying ? '#F44336' : '#4CAF50',
            color: '#fff',
            cursor: 'pointer',
            fontSize: '16px',
            fontWeight: 'bold',
          }}
        >
          {isPlaying ? 'Pause' : 'Play'}
        </button>
        <button
          onClick={restart}
          style={{
            padding: '10px 16px',
            borderRadius: '4px',
            border: 'none',
            backgroundColor: '#555',
            color: '#fff',
            cursor: 'pointer',
            fontSize: '14px',
          }}
        >
          Restart
        </button>

        {/* Loop toggle */}
        <button
          onClick={() => setLoopEnabled(!loopEnabled)}
          style={{
            padding: '10px 16px',
            borderRadius: '4px',
            border: 'none',
            backgroundColor: loopEnabled ? '#9C27B0' : '#555',
            color: '#fff',
            cursor: 'pointer',
            fontSize: '14px',
          }}
          title={loopEnabled ? 'Loop is ON - click to disable' : 'Loop is OFF - click to enable'}
        >
          {loopEnabled ? 'Loop ON' : 'Loop OFF'}
        </button>

        {/* Wait mode toggle */}
        {onWaitModeChange && (
          <button
            onClick={() => onWaitModeChange(!waitMode)}
            style={{
              padding: '10px 16px',
              borderRadius: '4px',
              border: 'none',
              backgroundColor: waitMode ? '#FF9800' : '#555',
              color: '#fff',
              cursor: 'pointer',
              fontSize: '14px',
            }}
            title={waitMode ? 'Wait mode ON - video pauses until you play correct note' : 'Wait mode OFF - video plays continuously'}
          >
            {waitMode ? 'WAIT ON' : 'WAIT OFF'}
          </button>
        )}

        {/* Waiting indicator */}
        {isWaiting && waitingForNotes && waitingForNotes.size > 0 && (
          <div style={{
            padding: '8px 16px',
            backgroundColor: '#FF9800',
            borderRadius: '4px',
            color: '#fff',
            fontWeight: 'bold',
            fontSize: '14px',
          }}>
            {waitingForNotes.size === 1
              ? 'Play note...'
              : `Chord: ${playedNotes?.size || 0}/${waitingForNotes.size}`}
          </div>
        )}

        {/* Mic toggle */}
        {onMicToggle && (
          <button
            onClick={onMicToggle}
            style={{
              padding: '10px 16px',
              borderRadius: '4px',
              border: 'none',
              backgroundColor: micEnabled ? '#4CAF50' : '#555',
              color: '#fff',
              cursor: 'pointer',
              fontSize: '14px',
            }}
            title={micEnabled ? 'Microphone is listening' : 'Click to enable microphone'}
          >
            {micEnabled ? 'MIC ON' : 'MIC OFF'}
          </button>
        )}

        {/* Detected note display */}
        {micEnabled && lastDetectedNote && (
          <div style={{
            padding: '8px 16px',
            backgroundColor: '#2196F3',
            borderRadius: '4px',
            color: '#fff',
            fontWeight: 'bold',
            fontSize: '16px',
            fontFamily: 'monospace',
          }}>
            {lastDetectedNote.noteName} ({lastDetectedNote.clarity.toFixed(2)})
          </div>
        )}

        {/* Progress bar */}
        <div style={{ flex: 1, display: 'flex', alignItems: 'center', gap: '10px' }}>
          <span style={{ color: '#888', fontSize: '14px', fontFamily: 'monospace' }}>
            {currentTime.toFixed(1)}s
          </span>
          <div style={{
            flex: 1,
            height: '8px',
            backgroundColor: '#333',
            borderRadius: '4px',
            overflow: 'hidden',
          }}>
            <div style={{
              width: `${(currentTime / segmentDuration) * 100}%`,
              height: '100%',
              backgroundColor: '#4CAF50',
              transition: 'width 0.1s linear',
            }} />
          </div>
          <span style={{ color: '#888', fontSize: '14px', fontFamily: 'monospace' }}>
            {segmentDuration.toFixed(1)}s
          </span>
        </div>

        {/* Current note display */}
        {currentNote && (
          <div style={{
            padding: '8px 16px',
            backgroundColor: '#4CAF50',
            borderRadius: '4px',
            color: '#fff',
            fontWeight: 'bold',
            fontSize: '20px',
            fontFamily: 'monospace',
          }}>
            {currentNote.name}
          </div>
        )}
      </div>

      {/* Main content */}
      <div style={{
        flex: 1,
        display: 'flex',
        flexDirection: 'column',
        gap: '10px',
        padding: '15px',
        overflow: 'hidden',
      }}>
        {/* Top row: Video frame + notes timeline */}
        <div style={{
          flex: 1,
          display: 'flex',
          gap: '15px',
          overflow: 'hidden',
        }}>
          {/* Large frame display */}
          <div style={{
            flex: 2,
            backgroundColor: '#000',
            borderRadius: '8px',
            overflow: 'hidden',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
          }}>
            {currentFrame ? (
              <img
                src={currentFrame}
                alt="Piano hand position"
                style={{
                  maxWidth: '100%',
                  maxHeight: '100%',
                  objectFit: 'contain',
                }}
              />
            ) : (
              <div style={{ color: '#666', textAlign: 'center' }}>
                <p style={{ margin: 0, fontSize: '18px' }}>Press Play to start</p>
              </div>
            )}
          </div>

          {/* Notes timeline */}
          <div style={{
            width: '250px',
            display: 'flex',
            flexDirection: 'column',
            gap: '10px',
            overflow: 'hidden',
          }}>
            <h3 style={{ margin: 0, color: '#888', fontSize: '14px' }}>
              Notes ({notes.length} total)
            </h3>

            <div
              ref={notesListRef}
              style={{
                flex: 1,
                overflowY: 'auto',
                display: 'flex',
                flexDirection: 'column',
                gap: '4px',
              }}
            >
              {notes.map((note, i) => {
                const isCurrent = currentTime >= note.time && currentTime < note.time + note.duration;
                const isPast = currentTime >= note.time + note.duration;
                const isUpcoming = note.time > currentTime && note.time <= currentTime + 2;

                return (
                  <div
                    key={i}
                    ref={isCurrent ? currentNoteRef : null}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: '10px',
                      padding: '8px 10px',
                      backgroundColor: isCurrent ? '#4CAF50' : isPast ? '#1a1a1a' : isUpcoming ? '#333' : '#222',
                      borderRadius: '4px',
                      opacity: isPast ? 0.5 : 1,
                    }}
                  >
                    <span style={{
                      fontFamily: 'monospace',
                      fontSize: '16px',
                      fontWeight: 'bold',
                      color: isCurrent ? '#fff' : '#ccc',
                      width: '40px',
                    }}>
                      {note.name}
                    </span>
                    <span style={{
                      fontSize: '12px',
                      color: isCurrent ? 'rgba(255,255,255,0.8)' : '#666',
                    }}>
                      {note.time.toFixed(1)}s
                    </span>
                    {isCurrent && (
                      <span style={{
                        marginLeft: 'auto',
                        fontSize: '11px',
                        color: '#fff',
                        fontWeight: 'bold',
                      }}>
                        NOW
                      </span>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        </div>

        {/* Scrolling sheet music */}
        <ScrollingSheetMusic
          notes={notes}
          currentTime={currentTime}
          width={width - 30} // Account for padding
          height={120}
          visibleWindow={8}
        />
      </div>

      {/* Comparison stats bar (microphone mode) */}
      {micEnabled && comparisonStats && (
        <div style={{
          display: 'flex',
          alignItems: 'center',
          gap: '20px',
          padding: '10px 15px',
          backgroundColor: '#222',
          borderTop: '1px solid #333',
          fontSize: '14px',
        }}>
          <span style={{ color: '#888' }}>Performance:</span>
          <span style={{
            color: comparisonStats.accuracy >= 0.8 ? '#4CAF50' :
                   comparisonStats.accuracy >= 0.5 ? '#FFC107' : '#F44336',
            fontWeight: 'bold',
            fontSize: '18px',
          }}>
            {(comparisonStats.accuracy * 100).toFixed(0)}%
          </span>
          <span style={{ color: '#4CAF50' }}>Hits: {comparisonStats.hits}</span>
          <span style={{ color: '#F44336' }}>Misses: {comparisonStats.misses}</span>
          <span style={{ color: '#FF9800' }}>Extras: {comparisonStats.extras}</span>
        </div>
      )}

      {/* MIDI stats bar - keyboard makes its own sound, we just track performance */}
      {midiStats && (midiStats.hits > 0 || midiStats.misses > 0 || midiStats.extras > 0) && (
        <div style={{
          display: 'flex',
          alignItems: 'center',
          gap: '20px',
          padding: '10px 15px',
          backgroundColor: '#222',
          borderTop: '1px solid #333',
          fontSize: '14px',
        }}>
          <span style={{ color: '#888' }}>MIDI:</span>
          <span style={{ color: '#4CAF50' }}>Hits: {midiStats.hits}</span>
          <span style={{ color: '#F44336' }}>Misses: {midiStats.misses}</span>
          <span style={{ color: '#FF9800' }}>Extras: {midiStats.extras}</span>
          {(midiStats.hits + midiStats.misses) > 0 && (
            <span style={{
              color: midiStats.hits / (midiStats.hits + midiStats.misses) >= 0.8 ? '#4CAF50' :
                     midiStats.hits / (midiStats.hits + midiStats.misses) >= 0.5 ? '#FFC107' : '#F44336',
              fontWeight: 'bold',
              fontSize: '18px',
            }}>
              {((midiStats.hits / (midiStats.hits + midiStats.misses)) * 100).toFixed(0)}%
            </span>
          )}
        </div>
      )}
    </div>
  );
};
