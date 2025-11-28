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
import type { SongSegment } from '../utils/midiParser';

// Song name mappings
const SONG_NAMES: Record<string, string> = {
  'canon-in-d': 'Canon in D (Pachelbel)',
  'hey-jude': 'Hey Jude (The Beatles)',
};

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

  // Song selection
  availableSongs: string[];
  currentSong: string;
  onSongChange: (songId: string) => void;

  // Segment selection
  segments: SongSegment[];
  currentSegment: SongSegment | null;
  onSegmentChange: (segment: SongSegment | null) => void;
  isSegmentLoopEnabled: boolean;
  onSegmentLoopToggle: () => void;
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
  availableSongs,
  currentSong,
  onSongChange,
  segments,
  currentSegment,
  onSegmentChange,
  isSegmentLoopEnabled,
  onSegmentLoopToggle,
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

      {/* Song Selection */}
      <div style={{ marginBottom: '20px', paddingBottom: '20px', borderBottom: '1px solid #444' }}>
        <h3 style={{ margin: '0 0 10px 0' }}>Song</h3>
        <select
          value={currentSong}
          onChange={(e) => onSongChange(e.target.value)}
          style={{
            width: '100%',
            padding: '8px',
            backgroundColor: '#2a2a2a',
            color: '#eee',
            border: '1px solid #555',
            borderRadius: '4px',
            cursor: 'pointer',
            fontFamily: 'monospace',
          }}
        >
          {availableSongs.map((songId) => (
            <option key={songId} value={songId}>
              {SONG_NAMES[songId] || songId}
            </option>
          ))}
        </select>
      </div>

      {/* Segment Selection */}
      <div style={{ marginBottom: '20px', paddingBottom: '20px', borderBottom: '1px solid #444' }}>
        <h3 style={{ margin: '0 0 10px 0' }}>Practice Section</h3>

        <select
          value={currentSegment?.id || 'full'}
          onChange={(e) => {
            const segmentId = e.target.value;
            const segment = segments.find(s => s.id === segmentId) || null;
            onSegmentChange(segment);
          }}
          style={{
            width: '100%',
            padding: '8px',
            backgroundColor: '#2a2a2a',
            color: '#eee',
            border: '1px solid #555',
            borderRadius: '4px',
            cursor: 'pointer',
            fontFamily: 'monospace',
            marginBottom: '10px',
          }}
        >
          <option value="full">Full Song</option>
          {segments.map((segment) => {
            const startMin = Math.floor(segment.startTime / 60);
            const startSec = Math.floor(segment.startTime % 60);
            const endMin = Math.floor(segment.endTime / 60);
            const endSec = Math.floor(segment.endTime % 60);
            return (
              <option key={segment.id} value={segment.id}>
                {segment.name} ({startMin}:{startSec.toString().padStart(2, '0')} - {endMin}:{endSec.toString().padStart(2, '0')})
              </option>
            );
          })}
        </select>

        {currentSegment && (
          <div style={{ fontSize: '12px', color: '#aaa', marginBottom: '10px' }}>
            {currentSegment.noteCount} notes • {Math.round(currentSegment.endTime - currentSegment.startTime)}s duration
          </div>
        )}

        <button
          onClick={onSegmentLoopToggle}
          disabled={!currentSegment}
          style={{
            width: '100%',
            padding: '10px',
            backgroundColor: isSegmentLoopEnabled ? '#4a7c59' : '#3a3a3a',
            color: isSegmentLoopEnabled ? '#fff' : '#aaa',
            border: 'none',
            borderRadius: '4px',
            cursor: currentSegment ? 'pointer' : 'not-allowed',
            fontSize: '14px',
            fontWeight: 'bold',
            fontFamily: 'monospace',
          }}
        >
          {isSegmentLoopEnabled ? '🔁 Looping Section' : '🔁 Loop This Section'}
        </button>
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

      {/* Confusion Matrix */}
      <div style={{ marginBottom: '20px', paddingBottom: '20px', borderBottom: '1px solid #444' }}>
        <h3 style={{ margin: '0 0 10px 0' }}>Note Tracking</h3>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '8px' }}>
          <div style={{ padding: '10px', backgroundColor: '#1a4a1a', borderRadius: '5px', textAlign: 'center' }}>
            <div style={{ fontSize: '20px', fontWeight: 'bold', color: '#4ade80' }}>
              {stats.confusionMatrix?.hits || 0}
            </div>
            <div style={{ fontSize: '11px', color: '#86efac' }}>HITS</div>
          </div>
          <div style={{ padding: '10px', backgroundColor: '#4a1a1a', borderRadius: '5px', textAlign: 'center' }}>
            <div style={{ fontSize: '20px', fontWeight: 'bold', color: '#f87171' }}>
              {stats.confusionMatrix?.misses || 0}
            </div>
            <div style={{ fontSize: '11px', color: '#fca5a5' }}>MISSES</div>
          </div>
          <div style={{ padding: '10px', backgroundColor: '#4a4a1a', borderRadius: '5px', textAlign: 'center' }}>
            <div style={{ fontSize: '20px', fontWeight: 'bold', color: '#facc15' }}>
              {stats.confusionMatrix?.extras || 0}
            </div>
            <div style={{ fontSize: '11px', color: '#fde047' }}>EXTRAS</div>
          </div>
        </div>
        {/* Hit Rate */}
        {(stats.confusionMatrix?.hits || 0) + (stats.confusionMatrix?.misses || 0) > 0 && (
          <div style={{ marginTop: '10px', padding: '8px', backgroundColor: '#1a1a1a', borderRadius: '5px', textAlign: 'center' }}>
            <span style={{ color: '#888', fontSize: '12px' }}>Hit Rate: </span>
            <span style={{ color: '#4ade80', fontWeight: 'bold' }}>
              {(((stats.confusionMatrix?.hits || 0) /
                ((stats.confusionMatrix?.hits || 0) + (stats.confusionMatrix?.misses || 0))) * 100).toFixed(1)}%
            </span>
          </div>
        )}
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
