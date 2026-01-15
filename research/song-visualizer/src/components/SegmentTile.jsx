import './SegmentTile.css';

function SegmentTile({ segment, onEdit, onDuplicate, onTileDragStart, onConnectionStart }) {
  const handleMouseDown = (e) => {
    if (e.target.closest('.tile-actions')) return;
    if (e.target.closest('.tile-tooltip')) return;
    if (e.target.closest('.connection-handle')) {
      onConnectionStart(segment.id, e);
    } else {
      onTileDragStart(segment.id, e);
    }
  };

  // Abbreviate notes for preview (first 4 notes)
  const getNotesPreview = () => {
    const notes = segment.notes.trim().split(/\s+/);
    if (notes.length <= 4) {
      return segment.notes;
    }
    return notes.slice(0, 4).join(' ') + '...';
  };

  return (
    <div
      className="segment-tile"
      onMouseDown={handleMouseDown}
    >
      {/* Hover tooltip */}
      <div className="tile-tooltip">
        <div className="tooltip-section">
          <div className="tooltip-label">Full Notes</div>
          <div className="tooltip-content tooltip-notes">
            {segment.notes}
          </div>
        </div>
        {segment.lyrics && segment.lyrics.length > 0 && (
          <div className="tooltip-section">
            <div className="tooltip-label">Lyrics</div>
            <div className="tooltip-content tooltip-lyrics">
              {segment.lyrics.map((line, idx) => (
                <div key={idx} className="tooltip-lyrics-line">{line}</div>
              ))}
            </div>
          </div>
        )}
      </div>

      <div className="connection-handle" title="Drag to create connection">
        <svg width="20" height="20" viewBox="0 0 24 24">
          <circle cx="12" cy="12" r="8" fill="#4a9eff" />
          <path d="M12 8 L12 16 M8 12 L16 12" stroke="white" strokeWidth="2" />
        </svg>
      </div>

      <div className="tile-header">
        <h3>{segment.name}</h3>
      </div>

      <div className="tile-notes">
        <div className="notes-preview">{getNotesPreview()}</div>
      </div>

      <div className="tile-actions">
        <button onClick={() => onEdit(segment)} className="btn-edit">Edit</button>
        <button onClick={() => onDuplicate(segment)} className="btn-duplicate">Dup</button>
      </div>
    </div>
  );
}

export default SegmentTile;
