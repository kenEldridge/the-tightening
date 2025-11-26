/**
 * Visual Keyboard Component
 *
 * Displays a piano keyboard (limited range) with:
 * - Visual feedback when keys are pressed
 * - Distribution visualization (Option C - shows acceptable range)
 * - Highlights for correct/current notes
 */

import React from 'react';
import type { AppConfig } from '../config/AppConfig';

export interface VisualKeyboardProps {
  // MIDI note range to display
  noteRange: { min: number; max: number };
  // Currently pressed keys (MIDI numbers)
  pressedKeys: Set<number>;
  // Current correct note (for highlighting)
  currentCorrectNote: number | null;
  // Distribution width (for visualization)
  distributionWidth: number;
  // Configuration
  config: AppConfig;
  // Keyboard dimensions
  width: number;
  height: number;
}

export const VisualKeyboard: React.FC<VisualKeyboardProps> = ({
  noteRange,
  pressedKeys,
  currentCorrectNote,
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

  return (
    <svg
      width={width}
      height={height}
      style={{
        display: 'block',
        backgroundColor: '#2a2a2a',
        border: '2px solid #333',
      }}
    >
      {/* Draw keys */}
      {Array.from({ length: noteCount }).map((_, index) => {
        const midiNote = noteRange.min + index;
        const x = index * keyWidth;
        const isBlackKey = isBlackKeyNote(midiNote);
        const isPressed = pressedKeys.has(midiNote);
        const isCorrect = midiNote === currentCorrectNote;
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

            {/* Piano key */}
            <PianoKey
              x={x}
              width={keyWidth}
              height={height}
              isBlackKey={isBlackKey}
              isPressed={isPressed}
              isCorrect={isCorrect}
              config={config}
            />

            {/* Note label */}
            <text
              x={x + keyWidth / 2}
              y={height - 5}
              textAnchor="middle"
              fontSize="10"
              fill="#888"
              fontFamily="monospace"
            >
              {getMidiNoteName(midiNote)}
            </text>
          </g>
        );
      })}
    </svg>
  );
};

interface PianoKeyProps {
  x: number;
  width: number;
  height: number;
  isBlackKey: boolean;
  isPressed: boolean;
  isCorrect: boolean;
  config: AppConfig;
}

const PianoKey: React.FC<PianoKeyProps> = ({
  x,
  width,
  height,
  isBlackKey,
  isPressed,
  isCorrect,
  config,
}) => {
  let fill = isBlackKey ? '#333' : '#eee';

  if (isPressed) {
    fill = config.visual.colors.neutral;
  }

  if (isCorrect) {
    fill = config.visual.colors.correctKey;
  }

  const keyHeight = isBlackKey ? height * 0.6 : height - 20;

  return (
    <rect
      x={x + 1}
      y={0}
      width={width - 2}
      height={keyHeight}
      fill={fill}
      stroke="#000"
      strokeWidth="1"
      rx="3"
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
  // Calculate opacity based on distance from correct note
  const distance = Math.abs(midiNote - correctNote);
  const sigma = distributionWidth / 2;
  const opacity = Math.exp(-(distance * distance) / (2 * sigma * sigma));

  return (
    <rect
      x={x + 1}
      y={0}
      width={keyWidth - 2}
      height={height - 20}
      fill={color}
      opacity={opacity * 0.5}
      pointerEvents="none"
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
