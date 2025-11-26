/**
 * Practice Controls UI
 *
 * Provides controls for:
 * - Start/Stop/Pause playback
 * - Tempo adjustment
 * - Manual distribution width control
 * - Reference melody volume
 * - Audio feedback tuning
 * - Progress reset
 */

import React from 'react';
import type { PerformanceStats } from './ProgressTracker';

export interface PracticeControlsProps {
  // Playback state
  isPlaying: boolean;
  onPlayPause: () => void;
  onStop: () => void;
  onReset: () => void;

  // Tempo control
  tempo: number;
  onTempoChange: (tempo: number) => void;

  // Distribution control
  distributionWidth: number;
  maxDistributionWidth: number;
  onDistributionChange: (width: number) => void;

  // Reference melody volume
  referenceVolume: number;
  onReferenceVolumeChange: (volume: number) => void;

  // Auto progression mode
  autoProgression: boolean;
  onAutoProgressionToggle: () => void;

  // Performance stats
  stats: PerformanceStats;
}

export const PracticeControls: React.FC<PracticeControlsProps> = ({
  isPlaying,
  onPlayPause,
  onStop,
  onReset,
  tempo,
  onTempoChange,
  distributionWidth,
  maxDistributionWidth,
  onDistributionChange,
  referenceVolume,
  onReferenceVolumeChange,
  autoProgression,
  onAutoProgressionToggle,
  stats,
}) => {
  return (
    <div
      style={{
        padding: '20px',
        backgroundColor: '#2a2a2a',
        color: '#eee',
        fontFamily: 'monospace',
        border: '2px solid #333',
      }}
    >
      {/* Playback Controls */}
      <div style={{ marginBottom: '20px' }}>
        <h3 style={{ margin: '0 0 10px 0' }}>Playback Controls</h3>
        <div style={{ display: 'flex', gap: '10px' }}>
          <button onClick={onPlayPause} style={buttonStyle}>
            {isPlaying ? '⏸ Pause' : '▶ Play'}
          </button>
          <button onClick={onStop} style={buttonStyle}>
            ⏹ Stop
          </button>
          <button onClick={onReset} style={{ ...buttonStyle, backgroundColor: '#d32f2f' }}>
            🔄 Reset Progress
          </button>
        </div>
      </div>

      {/* Performance Stats */}
      <div style={{ marginBottom: '20px' }}>
        <h3 style={{ margin: '0 0 10px 0' }}>Performance</h3>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px' }}>
          <StatDisplay label="Progress" value={`${stats.progress.toFixed(1)}%`} />
          <StatDisplay label="Total Notes" value={stats.totalNotes.toString()} />
          <StatDisplay label="Avg Accuracy" value={`${(stats.averageAccuracy * 100).toFixed(1)}%`} />
          <StatDisplay label="Recent Accuracy" value={`${(stats.recentAccuracy * 100).toFixed(1)}%`} />
          <StatDisplay label="Current Streak" value={stats.currentStreak.toString()} />
          <StatDisplay label="Best Streak" value={stats.bestStreak.toString()} />
        </div>
        <StatDisplay
          label="Practice Time"
          value={formatTime(stats.practiceTime)}
          style={{ marginTop: '10px' }}
        />
      </div>

      {/* Tempo Control */}
      <div style={{ marginBottom: '20px' }}>
        <h3 style={{ margin: '0 0 10px 0' }}>Tempo: {tempo} BPM</h3>
        <input
          type="range"
          min="40"
          max="200"
          value={tempo}
          onChange={(e) => onTempoChange(Number(e.target.value))}
          style={sliderStyle}
        />
        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '12px', marginTop: '5px' }}>
          <span>40 BPM</span>
          <span>200 BPM</span>
        </div>
      </div>

      {/* Distribution Width Control */}
      <div style={{ marginBottom: '20px' }}>
        <h3 style={{ margin: '0 0 5px 0' }}>Distribution Width: {distributionWidth.toFixed(1)} semitones</h3>
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '10px' }}>
          <label style={{ display: 'flex', alignItems: 'center', gap: '5px' }}>
            <input
              type="checkbox"
              checked={autoProgression}
              onChange={onAutoProgressionToggle}
            />
            Auto Progression
          </label>
        </div>
        <input
          type="range"
          min="0.5"
          max={maxDistributionWidth}
          step="0.1"
          value={distributionWidth}
          onChange={(e) => onDistributionChange(Number(e.target.value))}
          disabled={autoProgression}
          style={sliderStyle}
        />
        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '12px', marginTop: '5px' }}>
          <span>Exact Keys</span>
          <span>All Keys</span>
        </div>
      </div>

      {/* Reference Melody Volume */}
      <div style={{ marginBottom: '20px' }}>
        <h3 style={{ margin: '0 0 10px 0' }}>Reference Melody Volume: {(referenceVolume * 100).toFixed(0)}%</h3>
        <input
          type="range"
          min="0"
          max="1"
          step="0.01"
          value={referenceVolume}
          onChange={(e) => onReferenceVolumeChange(Number(e.target.value))}
          style={sliderStyle}
        />
        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '12px', marginTop: '5px' }}>
          <span>Silent</span>
          <span>Full</span>
        </div>
      </div>
    </div>
  );
};

interface StatDisplayProps {
  label: string;
  value: string;
  style?: React.CSSProperties;
}

const StatDisplay: React.FC<StatDisplayProps> = ({ label, value, style }) => (
  <div style={{ padding: '10px', backgroundColor: '#1a1a1a', borderRadius: '5px', ...style }}>
    <div style={{ fontSize: '12px', color: '#888' }}>{label}</div>
    <div style={{ fontSize: '18px', fontWeight: 'bold' }}>{value}</div>
  </div>
);

const buttonStyle: React.CSSProperties = {
  padding: '10px 20px',
  fontSize: '14px',
  fontFamily: 'monospace',
  backgroundColor: '#2196F3',
  color: 'white',
  border: 'none',
  borderRadius: '5px',
  cursor: 'pointer',
};

const sliderStyle: React.CSSProperties = {
  width: '100%',
  height: '8px',
  borderRadius: '5px',
  outline: 'none',
};

function formatTime(seconds: number): string {
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const secs = Math.floor(seconds % 60);

  if (hours > 0) {
    return `${hours}h ${minutes}m ${secs}s`;
  } else if (minutes > 0) {
    return `${minutes}m ${secs}s`;
  } else {
    return `${secs}s`;
  }
}
