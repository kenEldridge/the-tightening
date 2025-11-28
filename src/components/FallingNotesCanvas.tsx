/**
 * Falling Notes Canvas (Guitar Hero Style)
 *
 * Displays notes falling from top to bottom
 * Shows distribution width visually (Option C implementation)
 */

import React, { useEffect, useRef, memo } from 'react';
import type { MelodyNote, SongSegment } from '../utils/midiParser';
import type { AppConfig } from '../config/AppConfig';

export interface FallingNote {
  note: MelodyNote;
  y: number; // Current Y position
  hit: boolean; // Whether note has been hit
  accuracy?: number; // Accuracy when hit (0-1)
}

export interface FallingNotesCanvasProps {
  // Song notes
  notes: MelodyNote[];
  // Current playback time (seconds)
  currentTime: number;
  // Current distribution width (semitones)
  distributionWidth: number;
  // MIDI note range to display
  noteRange: { min: number; max: number };
  // Configuration
  config: AppConfig;
  // Canvas size
  width: number;
  height: number;
  // Look-ahead time (how many seconds ahead to show notes)
  lookAhead?: number;
  // Song segments (for visual markers)
  segments?: SongSegment[];
  // Currently selected segment
  currentSegment?: SongSegment | null;
}

// Track note impacts for visual effects
interface NoteImpact {
  x: number;
  time: number; // When the impact started
  color: string;
}

export const FallingNotesCanvas: React.FC<FallingNotesCanvasProps> = memo(({
  notes,
  currentTime,
  distributionWidth,
  noteRange,
  config,
  width,
  height,
  lookAhead = 3, // Show 3 seconds ahead by default
  segments = [],
  currentSegment = null,
}) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const animationFrameRef = useRef<number>();
  const impactsRef = useRef<NoteImpact[]>([]);
  const lastNoteTimesRef = useRef<Map<number, number>>(new Map()); // Track which notes have impacted

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext('2d', {
      desynchronized: true,
      alpha: false,
    });
    if (!ctx) return;

    // Calculate dimensions
    const noteCount = noteRange.max - noteRange.min + 1;
    const noteWidth = width / noteCount;
    const hitZoneY = height; // Notes fall to very bottom (lands on keyboard below)

    const animate = () => {
      // Clear canvas
      ctx.fillStyle = '#1a1a1a';
      ctx.fillRect(0, 0, width, height);

      // No hit zone line - notes fall directly to bottom (onto keyboard)

      // Draw segment boundaries and highlight current segment
      const topMargin = 20; // Small margin at top
      if (segments.length > 0) {
        segments.forEach((segment) => {
          // Calculate Y positions for segment start and end
          const startTimeDiff = segment.startTime - currentTime;
          const endTimeDiff = segment.endTime - currentTime;

          // Only draw if segment is in visible range
          if (endTimeDiff >= 0 && startTimeDiff <= lookAhead) {
            // Highlight current segment with green tint
            if (currentSegment && segment.id === currentSegment.id) {
              const segmentStartY = Math.max(topMargin, height - (startTimeDiff / lookAhead) * (height - topMargin));
              const segmentEndY = Math.min(height, height - (endTimeDiff / lookAhead) * (height - topMargin));

              ctx.fillStyle = 'rgba(74, 124, 89, 0.15)'; // Green tint
              ctx.fillRect(0, segmentEndY, width, segmentStartY - segmentEndY);
            }

            // Draw segment boundary line at end of segment
            const boundaryY = height - (endTimeDiff / lookAhead) * (height - topMargin);

            if (boundaryY >= topMargin && boundaryY <= height) {
              ctx.setLineDash([5, 5]); // Dashed line
              ctx.strokeStyle = currentSegment && segment.id === currentSegment.id
                ? '#4a7c59' // Green for current segment
                : '#666'; // Gray for other segments
              ctx.lineWidth = 2;
              ctx.beginPath();
              ctx.moveTo(0, boundaryY);
              ctx.lineTo(width, boundaryY);
              ctx.stroke();
              ctx.setLineDash([]); // Reset to solid line

              // Draw segment label
              ctx.fillStyle = currentSegment && segment.id === currentSegment.id
                ? '#4a7c59'
                : '#888';
              ctx.font = '12px monospace';
              ctx.textAlign = 'left';
              ctx.fillText(segment.name, 10, boundaryY - 5);
            }
          }
        });
      }

      // Filter notes that should be visible (include notes slightly past bottom for visual continuity)
      const visibleNotes = notes.filter((note) => {
        const timeDiff = note.time - currentTime;
        return timeDiff >= -0.2 && timeDiff <= lookAhead; // Show notes 0.2s past for smooth exit
      });

      // Check for new impacts (notes hitting the bottom)
      const now = performance.now();
      visibleNotes.forEach((note) => {
        const timeDiff = note.time - currentTime;
        const noteIndex = note.midi - noteRange.min;
        const x = noteIndex * noteWidth;

        // Note is hitting the bottom (within small threshold)
        if (timeDiff <= 0.05 && timeDiff >= -0.05) {
          const noteKey = note.midi * 10000 + Math.floor(note.time * 100);
          if (!lastNoteTimesRef.current.has(noteKey)) {
            lastNoteTimesRef.current.set(noteKey, now);
            impactsRef.current.push({
              x: x + noteWidth / 2,
              time: now,
              color: config.visual.colors.correctKey,
            });
          }
        }
      });

      // Clean up old impacts (older than 500ms)
      impactsRef.current = impactsRef.current.filter(impact => now - impact.time < 500);

      // Clean up old note tracking (older than 2 seconds)
      lastNoteTimesRef.current.forEach((time, key) => {
        if (now - time > 2000) lastNoteTimesRef.current.delete(key);
      });

      // Draw impact effects at the bottom
      impactsRef.current.forEach((impact) => {
        const age = now - impact.time;
        const progress = age / 500; // 0 to 1 over 500ms

        // Expanding ring
        const ringRadius = 10 + progress * 40;
        const ringOpacity = 1 - progress;

        ctx.beginPath();
        ctx.arc(impact.x, height - 5, ringRadius, 0, Math.PI * 2);
        ctx.strokeStyle = impact.color;
        ctx.lineWidth = 3 * (1 - progress);
        ctx.globalAlpha = ringOpacity * 0.8;
        ctx.stroke();

        // Inner flash
        if (progress < 0.3) {
          const flashOpacity = 1 - (progress / 0.3);
          ctx.beginPath();
          ctx.arc(impact.x, height - 5, 15, 0, Math.PI * 2);
          ctx.fillStyle = '#ffffff';
          ctx.globalAlpha = flashOpacity * 0.6;
          ctx.fill();
        }

        ctx.globalAlpha = 1;
      });

      // Draw falling notes
      visibleNotes.forEach((note) => {
        const timeDiff = note.time - currentTime;
        // Notes fall from top (topMargin) to bottom (height)
        const y = height - (timeDiff / lookAhead) * (height - topMargin);

        // Calculate X position based on MIDI note
        const noteIndex = note.midi - noteRange.min;
        const x = noteIndex * noteWidth;

        // Draw note (no distribution glow - that's on the keyboard now)
        drawNoteSimple(ctx, x, y, noteWidth, note, config);
      });

      animationFrameRef.current = requestAnimationFrame(animate);
    };

    animate();

    return () => {
      if (animationFrameRef.current) {
        cancelAnimationFrame(animationFrameRef.current);
      }
    };
  }, [notes, currentTime, distributionWidth, noteRange, config, width, height, lookAhead, segments, currentSegment]);

  return (
    <canvas
      ref={canvasRef}
      width={width}
      height={height}
      style={{
        display: 'block',
        backgroundColor: '#1a1a1a',
        borderRadius: '8px 8px 0 0', // Rounded top corners only
      }}
    />
  );
});

/**
 * Draw a single falling note (simple, no distribution glow)
 * Distribution is shown on the keyboard instead
 */
function drawNoteSimple(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  noteWidth: number,
  note: MelodyNote,
  config: AppConfig
): void {
  const noteHeight = 16; // Slightly taller for better visibility

  // Draw main note rectangle with rounded corners
  const radius = 4;
  ctx.fillStyle = config.visual.colors.neutral;
  ctx.beginPath();
  ctx.roundRect(x + 2, y, noteWidth - 4, noteHeight, radius);
  ctx.fill();

  // Draw subtle border
  ctx.strokeStyle = '#ffffff40';
  ctx.lineWidth = 1;
  ctx.stroke();

  // Draw note name if wide enough
  if (noteWidth > 20) {
    ctx.fillStyle = '#000';
    ctx.font = '10px monospace';
    ctx.textAlign = 'center';
    ctx.fillText(note.name, x + noteWidth / 2, y + 12);
  }
}
