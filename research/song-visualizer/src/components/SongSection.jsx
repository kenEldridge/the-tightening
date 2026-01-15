import { useState } from 'react';
import './SongSection.css';

function SongSection({ section, index }) {
  const [showLyrics, setShowLyrics] = useState(true);

  const colors = [
    '#1e3a5f', // dark blue
    '#3d2c5d', // dark purple
    '#2d4a2e', // dark green
    '#5a3e2a', // dark orange
    '#4a2e3d', // dark pink
    '#2d4a4a', // dark teal
  ];

  const borderColors = [
    '#4a9eff', // bright blue
    '#b967ff', // bright purple
    '#67dd6a', // bright green
    '#ffaa44', // bright orange
    '#ff4d8f', // bright pink
    '#44ccbb', // bright teal
  ];

  const bgColor = colors[index % colors.length];
  const borderColor = borderColors[index % borderColors.length];

  return (
    <div
      className="song-section"
      style={{
        backgroundColor: bgColor,
        borderLeft: `4px solid ${borderColor}`
      }}
    >
      <div className="section-header">
        <h3>{section.name}</h3>
        {section.lyrics && section.lyrics.length > 0 && (
          <button
            className="toggle-lyrics"
            onClick={() => setShowLyrics(!showLyrics)}
          >
            {showLyrics ? 'Hide Lyrics' : 'Show Lyrics'}
          </button>
        )}
      </div>

      <div className="section-notes">
        <strong>Notes:</strong> <span className="notes-display">{section.notes}</span>
      </div>

      {showLyrics && section.lyrics && section.lyrics.length > 0 && (
        <div className="section-lyrics">
          <strong>Lyrics:</strong>
          <div className="lyrics-content">
            {section.lyrics.map((line, idx) => (
              <p key={idx}>{line}</p>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

export default SongSection;
