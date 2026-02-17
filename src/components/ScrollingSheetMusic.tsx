/**
 * Scrolling Sheet Music Component
 *
 * Horizontal scrolling notation view — time flows left to right, NOW marker
 * is fixed at center. Past notes fade left, upcoming notes approach from right.
 *
 * Pill sizing is automatic:
 *   height < 120px  → compact (song mode sidebar)
 *   height ≥ 120px  → large  (YouTube practice full-area view)
 *
 * Wait mode: pass `waitingForNotes` (Set<midi>) to highlight target notes
 * orange and show a "▶ C4" banner at the top.
 */

import React, { useMemo, useRef, useEffect } from 'react';
import type { MelodyNote } from '../utils/midiParser';

export interface ScrollingSheetMusicProps {
  /** All notes in the segment */
  notes: MelodyNote[];
  /** Current playback time (relative to segment start) */
  currentTime: number;
  /** Width of the component */
  width: number;
  /** Height of the component */
  height?: number;
  /** Seconds of music visible at once */
  visibleWindow?: number;
  /** Sync offset - adjusts note timing relative to video */
  syncOffset?: number;
  /** MIDI notes we're waiting for in wait mode (highlighted orange) */
  waitingForNotes?: Set<number>;
}

export const ScrollingSheetMusic: React.FC<ScrollingSheetMusicProps> = ({
  notes,
  currentTime,
  width,
  height = 80,
  visibleWindow = 6, // 3 seconds past + 3 seconds ahead
  syncOffset = 0,
  waitingForNotes,
}) => {
  const containerRef = useRef<HTMLDivElement>(null);

  // Apply sync offset to get adjusted time for note comparisons
  const adjustedTime = currentTime - syncOffset;

  // Calculate pixels per second for scrolling
  const pixelsPerSecond = width / visibleWindow;
  const centerX = width / 2;

  // Derive note names for the waiting banner
  const waitingNoteNames = useMemo(() => {
    if (!waitingForNotes || waitingForNotes.size === 0) return [];
    const seen = new Map<number, string>();
    for (const note of notes) {
      if (waitingForNotes.has(note.midi) && !seen.has(note.midi)) {
        seen.set(note.midi, note.name);
      }
    }
    return Array.from(seen.values());
  }, [notes, waitingForNotes]);

  // Find current note index
  const currentNoteIndex = useMemo(() => {
    for (let i = 0; i < notes.length; i++) {
      const note = notes[i];
      if (adjustedTime >= note.time && adjustedTime < note.time + note.duration) {
        return i;
      }
    }
    // If not on a note, find the next upcoming note
    for (let i = 0; i < notes.length; i++) {
      if (notes[i].time > adjustedTime) {
        return i - 1; // Previous note (or -1 if before first)
      }
    }
    return notes.length - 1;
  }, [notes, adjustedTime]);

  // Render notes with position and style
  const renderedNotes = useMemo(() => {
    return notes.map((note, index) => {
      // Calculate X position relative to current time
      const timeDiff = note.time - adjustedTime;
      const x = centerX + timeDiff * pixelsPerSecond;

      // Determine note state
      const isCurrentNote = index === currentNoteIndex &&
        adjustedTime >= note.time &&
        adjustedTime < note.time + note.duration;
      const isPast = note.time + note.duration <= adjustedTime;
      const isUpcoming = note.time > adjustedTime;

      // Skip notes too far outside the visible area
      if (x < -100 || x > width + 100) {
        return null;
      }

      // Calculate note width based on duration; scale with height
      const minPillWidth = height >= 120 ? 58 : 20;
      const noteWidth = Math.max(minPillWidth, note.duration * pixelsPerSecond * 0.6);

      // Opacity based on distance from center
      let opacity = 1;
      if (isPast) {
        const pastDistance = Math.abs(timeDiff);
        opacity = Math.max(0.2, 1 - pastDistance / (visibleWindow / 2));
      } else if (isUpcoming && !isCurrentNote) {
        opacity = 0.8;
      }

      return {
        note,
        index,
        x,
        noteWidth,
        isCurrentNote,
        isPast,
        isUpcoming,
        opacity,
      };
    }).filter(Boolean);
  }, [notes, adjustedTime, currentNoteIndex, centerX, pixelsPerSecond, visibleWindow, width]);

  // Group notes by approximate time for chord display
  const noteGroups = useMemo(() => {
    const groups: typeof renderedNotes[] = [];
    let currentGroup: typeof renderedNotes = [];
    let lastTime = -Infinity;

    for (const item of renderedNotes) {
      if (!item) continue;

      // If notes are within 0.1 seconds, group them as a chord
      if (item.note.time - lastTime < 0.1) {
        currentGroup.push(item);
      } else {
        if (currentGroup.length > 0) {
          groups.push(currentGroup);
        }
        currentGroup = [item];
      }
      lastTime = item.note.time;
    }

    if (currentGroup.length > 0) {
      groups.push(currentGroup);
    }

    return groups;
  }, [renderedNotes]);

  if (notes.length === 0) {
    return (
      <div
        style={{
          width,
          height,
          backgroundColor: '#1a1a1a',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          color: '#666',
          borderRadius: '4px',
        }}
      >
        <span>No notes to display</span>
      </div>
    );
  }

  return (
    <div
      ref={containerRef}
      style={{
        width,
        height,
        backgroundColor: '#1a1a1a',
        borderRadius: '4px',
        position: 'relative',
        overflow: 'hidden',
      }}
    >
      {/* Center line / playhead */}
      <div
        style={{
          position: 'absolute',
          left: centerX,
          top: 0,
          bottom: 0,
          width: 2,
          backgroundColor: '#4CAF50',
          zIndex: 10,
          opacity: 0.5,
        }}
      />

      {/* "NOW" label */}
      <div
        style={{
          position: 'absolute',
          left: centerX - 20,
          top: 2,
          width: 40,
          textAlign: 'center',
          fontSize: '10px',
          color: '#4CAF50',
          fontWeight: 'bold',
          zIndex: 11,
        }}
      >
        NOW
      </div>

      {/* Waiting banner — shown prominently when wait mode pauses */}
      {waitingNoteNames.length > 0 && (
        <div
          style={{
            position: 'absolute',
            top: 6,
            left: '50%',
            transform: 'translateX(-50%)',
            backgroundColor: '#FF9800',
            color: '#fff',
            padding: '5px 14px',
            borderRadius: '5px',
            fontSize: '18px',
            fontWeight: 'bold',
            fontFamily: 'monospace',
            zIndex: 20,
            whiteSpace: 'nowrap',
            boxShadow: '0 0 16px rgba(255, 152, 0, 0.7)',
            letterSpacing: '0.05em',
          }}
        >
          ▶ {waitingNoteNames.join(' + ')}
        </div>
      )}

      {/* Time labels */}
      <div
        style={{
          position: 'absolute',
          left: 8,
          bottom: 4,
          fontSize: '10px',
          color: '#666',
        }}
      >
        {Math.max(0, adjustedTime - visibleWindow / 2).toFixed(1)}s
      </div>
      <div
        style={{
          position: 'absolute',
          right: 8,
          bottom: 4,
          fontSize: '10px',
          color: '#666',
        }}
      >
        {(adjustedTime + visibleWindow / 2).toFixed(1)}s
      </div>

      {/* Render note groups */}
      {noteGroups.map((group, groupIndex) => {
        if (group.length === 0) return null;

        // Use first note in group for positioning
        const firstItem = group[0]!;
        const { x, noteWidth, isCurrentNote, isPast, opacity } = firstItem;

        // Stack notes vertically for chords
        const isChord = group.length > 1;

        // Scale pill size based on available height
        const large = height >= 120;
        const pillPadding = large
          ? (isChord ? '5px 10px' : '8px 16px')
          : (isChord ? '2px 6px' : '4px 10px');
        const pillFont = large
          ? (isChord ? '15px' : '17px')
          : (isChord ? '11px' : '12px');
        const pillFontCurrent = large ? '20px' : '14px';
        const pillMinWidth = large ? (isChord ? '48px' : '58px') : (isChord ? '36px' : '44px');

        return (
          <div
            key={groupIndex}
            style={{
              position: 'absolute',
              left: x - noteWidth / 2,
              top: '50%',
              transform: 'translateY(-50%)',
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              gap: large ? '4px' : '2px',
              opacity,
              transition: 'opacity 0.1s',
            }}
          >
            {group.map((item) => {
              if (!item) return null;
              const { note, index, isCurrentNote: isThisCurrent } = item;
              const isWaitingNote = !!(waitingForNotes && waitingForNotes.size > 0 && waitingForNotes.has(note.midi));

              return (
                <div
                  key={index}
                  style={{
                    padding: pillPadding,
                    backgroundColor: isWaitingNote
                      ? '#FF9800'
                      : isThisCurrent
                      ? '#4CAF50'
                      : isPast
                      ? '#333'
                      : '#2196F3',
                    borderRadius: '4px',
                    fontSize: isThisCurrent || isWaitingNote ? pillFontCurrent : pillFont,
                    fontWeight: isThisCurrent || isWaitingNote ? 'bold' : 'normal',
                    fontFamily: 'monospace',
                    color: '#fff',
                    whiteSpace: 'nowrap',
                    boxShadow: isWaitingNote
                      ? '0 0 10px rgba(255, 152, 0, 0.8)'
                      : isThisCurrent
                      ? '0 0 8px rgba(76, 175, 80, 0.5)'
                      : 'none',
                    minWidth: pillMinWidth,
                    textAlign: 'center',
                  }}
                >
                  {note.name}
                </div>
              );
            })}
          </div>
        );
      })}

      {/* Direction indicators */}
      <div
        style={{
          position: 'absolute',
          left: 8,
          top: '50%',
          transform: 'translateY(-50%)',
          color: '#444',
          fontSize: '20px',
        }}
      >
        {'<'}
      </div>
      <div
        style={{
          position: 'absolute',
          right: 8,
          top: '50%',
          transform: 'translateY(-50%)',
          color: '#888',
          fontSize: '20px',
        }}
      >
        {'>'}
      </div>
    </div>
  );
};

export default ScrollingSheetMusic;
