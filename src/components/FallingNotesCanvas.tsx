/**
 * Falling Notes Canvas (Guitar Hero Style)
 *
 * Displays notes falling from top to bottom
 * Shows distribution width visually (Option C implementation)
 */

import React, { useEffect, useRef } from 'react';
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

export const FallingNotesCanvas: React.FC<FallingNotesCanvasProps> = ({
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
    const hitZoneY = height - 80; // Hit zone at bottom

    const animate = () => {
      // Clear canvas
      ctx.fillStyle = '#1a1a1a';
      ctx.fillRect(0, 0, width, height);

      // Draw hit zone line
      ctx.strokeStyle = config.visual.colors.neutral;
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.moveTo(0, hitZoneY);
      ctx.lineTo(width, hitZoneY);
      ctx.stroke();

      // Draw segment boundaries and highlight current segment
      if (segments.length > 0) {
        segments.forEach((segment) => {
          // Calculate Y positions for segment start and end
          const startTimeDiff = segment.startTime - currentTime;
          const endTimeDiff = segment.endTime - currentTime;

          // Only draw if segment is in visible range
          if (endTimeDiff >= 0 && startTimeDiff <= lookAhead) {
            // Highlight current segment with green tint
            if (currentSegment && segment.id === currentSegment.id) {
              const segmentStartY = Math.max(50, hitZoneY - (startTimeDiff / lookAhead) * (hitZoneY - 50));
              const segmentEndY = Math.min(hitZoneY, hitZoneY - (endTimeDiff / lookAhead) * (hitZoneY - 50));

              ctx.fillStyle = 'rgba(74, 124, 89, 0.15)'; // Green tint
              ctx.fillRect(0, segmentEndY, width, segmentStartY - segmentEndY);
            }

            // Draw segment boundary line at end of segment
            const boundaryY = hitZoneY - (endTimeDiff / lookAhead) * (hitZoneY - 50);

            if (boundaryY >= 50 && boundaryY <= hitZoneY) {
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

      // Filter notes that should be visible
      const visibleNotes = notes.filter((note) => {
        const timeDiff = note.time - currentTime;
        return timeDiff >= 0 && timeDiff <= lookAhead;
      });

      // Draw falling notes
      visibleNotes.forEach((note) => {
        const timeDiff = note.time - currentTime;
        const y = hitZoneY - (timeDiff / lookAhead) * (hitZoneY - 50);

        // Calculate X position based on MIDI note
        const noteIndex = note.midi - noteRange.min;
        const x = noteIndex * noteWidth;

        // Draw note with distribution width visualization
        drawNote(ctx, x, y, noteWidth, note, distributionWidth, config);
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
        border: '2px solid #333',
      }}
    />
  );
};

/**
 * Draw a single falling note with distribution visualization
 */
function drawNote(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  noteWidth: number,
  note: MelodyNote,
  distributionWidth: number,
  config: AppConfig
): void {
  const noteHeight = 12; // Reduced from 20 to prevent overlap of rapid notes

  // Option C: Show distribution as glow/width around the note
  if (config.visual.distributionMode === 'C' || config.visual.distributionMode === 'A') {
    // Draw distribution glow
    const glowWidth = Math.min(distributionWidth * noteWidth * 0.5, noteWidth * 3);

    const gradient = ctx.createRadialGradient(
      x + noteWidth / 2,
      y + noteHeight / 2,
      noteWidth / 2,
      x + noteWidth / 2,
      y + noteHeight / 2,
      glowWidth
    );

    gradient.addColorStop(0, config.visual.colors.distribution + '80');
    gradient.addColorStop(0.5, config.visual.colors.distribution + '40');
    gradient.addColorStop(1, config.visual.colors.distribution + '00');

    ctx.fillStyle = gradient;
    ctx.fillRect(
      x + noteWidth / 2 - glowWidth,
      y + noteHeight / 2 - glowWidth,
      glowWidth * 2,
      glowWidth * 2
    );
  }

  // Draw main note rectangle
  ctx.fillStyle = config.visual.colors.neutral;
  ctx.fillRect(x + 2, y, noteWidth - 4, noteHeight);

  // Draw border to distinguish overlapping notes
  ctx.strokeStyle = '#ffffff';
  ctx.lineWidth = 1;
  ctx.strokeRect(x + 2, y, noteWidth - 4, noteHeight);

  // Draw note name (only if note is tall enough)
  if (noteHeight >= 12) {
    ctx.fillStyle = '#000';
    ctx.font = '9px monospace';
    ctx.textAlign = 'center';
    ctx.fillText(note.name, x + noteWidth / 2, y + 9);
  }
}
