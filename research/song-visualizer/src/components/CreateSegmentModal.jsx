import { useState, useEffect } from 'react';
import Modal from './Modal';

function CreateSegmentModal({ isOpen, onClose, onSave, editingSegment }) {
  const [name, setName] = useState('');
  const [notes, setNotes] = useState('');
  const [lyrics, setLyrics] = useState('');

  useEffect(() => {
    if (editingSegment) {
      setName(editingSegment.name);
      setNotes(editingSegment.notes);
      setLyrics(editingSegment.lyrics ? editingSegment.lyrics.join('\n') : '');
    } else {
      setName('');
      setNotes('');
      setLyrics('');
    }
  }, [editingSegment, isOpen]);

  const handleSubmit = (e) => {
    e.preventDefault();
    if (!name.trim() || !notes.trim()) return;

    const lyricsArray = lyrics
      .split('\n')
      .filter(line => line.trim().length > 0);

    const segment = {
      id: editingSegment?.id || `seg-${Date.now()}`,
      name: name.trim(),
      notes: notes.trim(),
      lyrics: lyricsArray
    };

    onSave(segment);
    setName('');
    setNotes('');
    setLyrics('');
    onClose();
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={editingSegment ? 'Edit Segment' : 'Create New Segment'}
    >
      <form onSubmit={handleSubmit}>
        <div className="form-group">
          <label htmlFor="segment-name">Segment Name *</label>
          <input
            id="segment-name"
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g., Verse 1, Chorus, Bridge"
            required
          />
        </div>

        <div className="form-group">
          <label htmlFor="segment-notes">Notes / Keys *</label>
          <input
            id="segment-notes"
            type="text"
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="e.g., A B Db D E F E D D"
            required
          />
        </div>

        <div className="form-group">
          <label htmlFor="segment-lyrics">Lyrics (one line per line)</label>
          <textarea
            id="segment-lyrics"
            value={lyrics}
            onChange={(e) => setLyrics(e.target.value)}
            placeholder="Enter lyrics, one line per line..."
          />
        </div>

        <div className="form-actions">
          <button type="button" className="btn-secondary" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" className="btn-primary">
            {editingSegment ? 'Save Changes' : 'Create Segment'}
          </button>
        </div>
      </form>
    </Modal>
  );
}

export default CreateSegmentModal;