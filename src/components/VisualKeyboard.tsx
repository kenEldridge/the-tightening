/**
 * Visual Keyboard Component
 *
 * Displays a piano keyboard (limited range) with:
 * - Visual feedback when keys are pressed
 * - Distribution visualization (Option C - shows acceptable range)
 * - Highlights for correct/current notes
 */

import React, { memo } from 'react';
import type { AppConfig } from '../config/AppConfig';

export interface VisualKeyboardProps {
  // MIDI note range to display
  noteRange: { min: number; max: number };
  // Currently pressed keys (MIDI numbers)
  pressedKeys: Set<number>;
  // Current correct note (for highlighting)
  currentCorrectNote: number | null;
  // Upcoming notes to show with faded highlights (MIDI numbers)
  upcomingNotes?: number[];
  // Distribution width (for visualization)
  distributionWidth: number;
  // Configuration
  config: AppConfig;
  // Keyboard dimensions
  width: number;
  height: number;
}

export const VisualKeyboard: React.FC<VisualKeyboardProps> = memo(({
  noteRange,
  pressedKeys,
  currentCorrectNote,
  upcomingNotes = [],
  distributionWidth,
  config,
  width,
  height,
}) => {
  const noteCount = noteRange.max - noteRange.min + 1;
  const keyWidth = width / noteCount;

  // Calculate acceptable key range based on distribution
  const acceptableRange = currentCorrectNote !== null
    ? calculateAcceptableRange(currentCorrectNote, distributionWidth)
    : null;

  // Convert upcoming notes array to a set for O(1) lookup
  const upcomingNotesSet = new Set(upcomingNotes);

  return (
    <svg
      width={width}
      height={height}
      style={{
        display: 'block',
        backgroundColor: '#1a1a1a',
        borderRadius: '0 0 8px 8px', // Rounded bottom corners only
      }}
    >
      {/* Define glow filter for active note */}
      <defs>
        <filter id="activeGlow" x="-50%" y="-50%" width="200%" height="200%">
          <feGaussianBlur stdDeviation="4" result="blur" />
          <feMerge>
            <feMergeNode in="blur" />
            <feMergeNode in="SourceGraphic" />
          </feMerge>
        </filter>
      </defs>
      {/* Draw keys */}
      {Array.from({ length: noteCount }).map((_, index) => {
        const midiNote = noteRange.min + index;
        const x = index * keyWidth;
        const isBlackKey = isBlackKeyNote(midiNote);
        const isPressed = pressedKeys.has(midiNote);
        const isCorrect = midiNote === currentCorrectNote;
        const isUpcoming = upcomingNotesSet.has(midiNote);
        const isInRange = acceptableRange
          ? midiNote >= acceptableRange.min && midiNote <= acceptableRange.max
          : false;

        return (
          <g key={midiNote}>
            {/* Distribution visualization (Option C) */}
            {(config.visual.distributionMode === 'C' || config.visual.distributionMode === 'B') &&
              isInRange &&
              acceptableRange && (
                <DistributionGlow
                  x={x}
                  keyWidth={keyWidth}
                  height={height}
                  midiNote={midiNote}
                  correctNote={currentCorrectNote!}
                  distributionWidth={distributionWidth}
                  color={config.visual.colors.distribution}
                />
              )}

            {/* Upcoming note highlight */}
            {isUpcoming && !isCorrect && (
              <UpcomingNoteGlow
                x={x}
                keyWidth={keyWidth}
                height={height}
                isBlackKey={isBlackKey}
              />
            )}

            {/* Piano key */}
            <PianoKey
              x={x}
              width={keyWidth}
              height={height}
              isBlackKey={isBlackKey}
              isPressed={isPressed}
              isCorrect={isCorrect}
              isUpcoming={isUpcoming}
              config={config}
            />

            {/* Note label - only show for white keys to reduce clutter */}
            {!isBlackKey && keyWidth > 15 && (
              <text
                x={x + keyWidth / 2}
                y={height - 8}
                textAnchor="middle"
                fontSize={keyWidth > 25 ? '11' : '9'}
                fill="#666"
                fontFamily="monospace"
              >
                {getMidiNoteName(midiNote)}
              </text>
            )}
          </g>
        );
      })}
    </svg>
  );
});

interface PianoKeyProps {
  x: number;
  width: number;
  height: number;
  isBlackKey: boolean;
  isPressed: boolean;
  isCorrect: boolean;
  isUpcoming?: boolean;
  config: AppConfig;
}

const PianoKey: React.FC<PianoKeyProps> = ({
  x,
  width,
  height,
  isBlackKey,
  isPressed,
  isCorrect,
  isUpcoming = false,
  config,
}) => {
  let fill = isBlackKey ? '#333' : '#ddd';

  if (isPressed) {
    fill = config.visual.colors.neutral;
  }

  if (isUpcoming && !isCorrect) {
    // Subtle blue tint for upcoming notes
    fill = isBlackKey ? '#1a3a5c' : '#b3d4fc';
  }

  if (isCorrect) {
    fill = config.visual.colors.correctKey;
  }

  const keyHeight = isBlackKey ? height * 0.6 : height - 25;
  const radius = 4;

  return (
    <g>
      {/* Glow effect for correct/landing note */}
      {isCorrect && (
        <rect
          x={x}
          y={0}
          width={width}
          height={keyHeight + 10}
          fill={config.visual.colors.correctKey}
          opacity={0.4}
          filter="url(#activeGlow)"
          rx={radius}
        />
      )}
      {/* Main key */}
      <rect
        x={x + 1}
        y={0}
        width={width - 2}
        height={keyHeight}
        fill={fill}
        stroke={isCorrect ? config.visual.colors.correctKey : isUpcoming ? '#2196F3' : '#000'}
        strokeWidth={isCorrect ? 2 : isUpcoming ? 1.5 : 1}
        rx={radius}
      />
      {/* Key highlight (3D effect) */}
      {!isBlackKey && (
        <rect
          x={x + 3}
          y={2}
          width={width - 6}
          height={8}
          fill="rgba(255,255,255,0.3)"
          rx={2}
        />
      )}
    </g>
  );
};

interface UpcomingNoteGlowProps {
  x: number;
  keyWidth: number;
  height: number;
  isBlackKey: boolean;
}

const UpcomingNoteGlow: React.FC<UpcomingNoteGlowProps> = ({
  x,
  keyWidth,
  height,
  isBlackKey,
}) => {
  const keyHeight = isBlackKey ? height * 0.6 : height - 25;

  return (
    <rect
      x={x + 1}
      y={0}
      width={keyWidth - 2}
      height={keyHeight}
      fill="#2196F3"
      opacity={0.2}
      pointerEvents="none"
      rx={4}
    />
  );
};

interface DistributionGlowProps {
  x: number;
  keyWidth: number;
  height: number;
  midiNote: number;
  correctNote: number;
  distributionWidth: number;
  color: string;
}

const DistributionGlow: React.FC<DistributionGlowProps> = ({
  x,
  keyWidth,
  height,
  midiNote,
  correctNote,
  distributionWidth,
  color,
}) => {
  // Calculate opacity based on distance from correct note (Gaussian falloff)
  const distance = Math.abs(midiNote - correctNote);
  const sigma = distributionWidth / 2;
  const opacity = Math.exp(-(distance * distance) / (2 * sigma * sigma));
  const keyHeight = height - 25;

  return (
    <rect
      x={x + 1}
      y={0}
      width={keyWidth - 2}
      height={keyHeight}
      fill={color}
      opacity={opacity * 0.4}
      pointerEvents="none"
      rx={4}
    />
  );
};

/**
 * Helper: Check if MIDI note is a black key
 */
function isBlackKeyNote(midi: number): boolean {
  const note = midi % 12;
  return [1, 3, 6, 8, 10].includes(note); // C#, D#, F#, G#, A#
}

/**
 * Helper: Get note name from MIDI number
 */
function getMidiNoteName(midi: number): string {
  const notes = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
  const octave = Math.floor(midi / 12) - 1;
  const noteIndex = midi % 12;
  return `${notes[noteIndex]}${octave}`;
}

/**
 * Helper: Calculate acceptable MIDI key range based on distribution
 */
function calculateAcceptableRange(
  correctNote: number,
  distributionWidth: number
): { min: number; max: number } {
  if (distributionWidth >= 44) {
    return { min: 0, max: 127 };
  }

  const rangeWidth = Math.ceil(distributionWidth * 2);
  return {
    min: Math.max(0, correctNote - rangeWidth),
    max: Math.min(127, correctNote + rangeWidth),
  };
}
