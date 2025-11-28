/**
 * Lyrics Display Component
 *
 * Shows the current section name and lyrics based on playback time.
 * Positioned between falling notes and piano keyboard.
 */

import React, { useMemo } from 'react';
import type { SongSegment } from '../utils/midiParser';

export interface LyricsDisplayProps {
  segments: SongSegment[];
  currentTime: number;
  width?: number;
}

export const LyricsDisplay: React.FC<LyricsDisplayProps> = ({
  segments,
  currentTime,
  width = 800,
}) => {
  // Find current segment based on time
  const currentSegment = useMemo(() => {
    return segments.find(
      (seg) => currentTime >= seg.startTime && currentTime < seg.endTime
    );
  }, [segments, currentTime]);

  // Calculate progress through current segment
  const segmentProgress = useMemo(() => {
    if (!currentSegment) return 0;
    const elapsed = currentTime - currentSegment.startTime;
    const duration = currentSegment.endTime - currentSegment.startTime;
    return Math.min(1, elapsed / duration);
  }, [currentSegment, currentTime]);

  if (!currentSegment) {
    return (
      <div
        style={{
          width,
          padding: '15px 20px',
          backgroundColor: '#252525',
          borderRadius: '8px',
          textAlign: 'center',
          color: '#666',
          fontFamily: 'monospace',
          fontSize: '14px',
        }}
      >
        Press Play to start...
      </div>
    );
  }

  return (
    <div
      style={{
        width,
        backgroundColor: '#252525',
        borderRadius: '8px',
        overflow: 'hidden',
      }}
    >
      {/* Progress bar */}
      <div
        style={{
          height: '3px',
          backgroundColor: '#333',
        }}
      >
        <div
          style={{
            width: `${segmentProgress * 100}%`,
            height: '100%',
            backgroundColor: '#4a9eff',
            transition: 'width 0.1s linear',
          }}
        />
      </div>

      {/* Section header */}
      <div
        style={{
          padding: '10px 20px 5px',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
        }}
      >
        <span
          style={{
            color: '#4a9eff',
            fontFamily: 'monospace',
            fontSize: '12px',
            fontWeight: 'bold',
            textTransform: 'uppercase',
            letterSpacing: '1px',
          }}
        >
          {currentSegment.name}
        </span>
        <span
          style={{
            color: '#666',
            fontFamily: 'monospace',
            fontSize: '11px',
          }}
        >
          {Math.floor(currentTime - currentSegment.startTime)}s / {Math.floor(currentSegment.endTime - currentSegment.startTime)}s
        </span>
      </div>

      {/* Lyrics */}
      {currentSegment.lyrics && (
        <div
          style={{
            padding: '5px 20px 15px',
            color: '#ccc',
            fontFamily: 'Georgia, serif',
            fontSize: '16px',
            lineHeight: '1.6',
            whiteSpace: 'pre-line',
            maxHeight: '100px',
            overflow: 'auto',
          }}
        >
          {currentSegment.lyrics}
        </div>
      )}
    </div>
  );
};
