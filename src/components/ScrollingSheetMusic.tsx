/**
 * Scrolling Sheet Music Component
 *
 * Displays a horizontal scrolling notation view:
 * - Past notes (faded, on the left)
 * - Current note (highlighted in green, center)
 * - Upcoming notes (visible ahead, on the right)
 *
 * Notes scroll left as time progresses, synced to video playback.
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
}

export const ScrollingSheetMusic: React.FC<ScrollingSheetMusicProps> = ({
  notes,
  currentTime,
  width,
  height = 80,
  visibleWindow = 6, // 3 seconds past + 3 seconds ahead
}) => {
  const containerRef = useRef<HTMLDivElement>(null);

  // Calculate pixels per second for scrolling
  const pixelsPerSecond = width / visibleWindow;
  const centerX = width / 2;

  // Find current note index
  const currentNoteIndex = useMemo(() => {
    for (let i = 0; i < notes.length; i++) {
      const note = notes[i];
      if (currentTime >= note.time && currentTime < note.time + note.duration) {
        return i;
      }
    }
    // If not on a note, find the next upcoming note
    for (let i = 0; i < notes.length; i++) {
      if (notes[i].time > currentTime) {
        return i - 1; // Previous note (or -1 if before first)
      }
    }
    return notes.length - 1;
  }, [notes, currentTime]);

  // Render notes with position and style
  const renderedNotes = useMemo(() => {
    return notes.map((note, index) => {
      // Calculate X position relative to current time
      const timeDiff = note.time - currentTime;
      const x = centerX + timeDiff * pixelsPerSecond;

      // Determine note state
      const isCurrentNote = index === currentNoteIndex &&
        currentTime >= note.time &&
        currentTime < note.time + note.duration;
      const isPast = note.time + note.duration <= currentTime;
      const isUpcoming = note.time > currentTime;

      // Skip notes too far outside the visible area
      if (x < -100 || x > width + 100) {
        return null;
      }

      // Calculate note width based on duration
      const noteWidth = Math.max(30, note.duration * pixelsPerSecond * 0.8);

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
  }, [notes, currentTime, currentNoteIndex, centerX, pixelsPerSecond, visibleWindow, width]);

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
        {Math.max(0, currentTime - visibleWindow / 2).toFixed(1)}s
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
        {(currentTime + visibleWindow / 2).toFixed(1)}s
      </div>

      {/* Render note groups */}
      {noteGroups.map((group, groupIndex) => {
        if (group.length === 0) return null;

        // Use first note in group for positioning
        const firstItem = group[0]!;
        const { x, noteWidth, isCurrentNote, isPast, opacity } = firstItem;

        // Stack notes vertically for chords
        const isChord = group.length > 1;

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
              gap: '2px',
              opacity,
              transition: 'opacity 0.1s',
            }}
          >
            {group.map((item) => {
              if (!item) return null;
              const { note, index, isCurrentNote: isThisCurrent } = item;

              return (
                <div
                  key={index}
                  style={{
                    padding: '4px 12px',
                    backgroundColor: isThisCurrent
                      ? '#4CAF50'
                      : isPast
                      ? '#333'
                      : '#2196F3',
                    borderRadius: '4px',
                    fontSize: isThisCurrent ? '18px' : '14px',
                    fontWeight: isThisCurrent ? 'bold' : 'normal',
                    fontFamily: 'monospace',
                    color: '#fff',
                    whiteSpace: 'nowrap',
                    boxShadow: isThisCurrent
                      ? '0 0 10px rgba(76, 175, 80, 0.5)'
                      : 'none',
                    minWidth: isChord ? '50px' : noteWidth,
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
