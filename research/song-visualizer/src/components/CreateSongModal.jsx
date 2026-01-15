import { useState } from 'react';
import Modal from './Modal';

function CreateSongModal({ isOpen, onClose, onSave }) {
  const [title, setTitle] = useState('');
  const [artist, setArtist] = useState('');

  const handleSubmit = (e) => {
    e.preventDefault();
    if (!title.trim()) return;

    onSave({
      title: title.trim(),
      artist: artist.trim(),
      segments: [],
      connections: []
    });

    setTitle('');
    setArtist('');
    onClose();
  };

  return (
    <Modal isOpen={isOpen} onClose={onClose} title="Create New Song">
      <form onSubmit={handleSubmit}>
        <div className="form-group">
          <label htmlFor="song-title">Song Title *</label>
          <input
            id="song-title"
            type="text"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="Enter song title"
            required
          />
        </div>

        <div className="form-group">
          <label htmlFor="song-artist">Artist / Credits</label>
          <input
            id="song-artist"
            type="text"
            value={artist}
            onChange={(e) => setArtist(e.target.value)}
            placeholder="Enter artist name or credits"
          />
        </div>

        <div className="form-actions">
          <button type="button" className="btn-secondary" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" className="btn-primary">
            Create Song
          </button>
        </div>
      </form>
    </Modal>
  );
}

export default CreateSongModal;