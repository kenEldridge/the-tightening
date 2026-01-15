import { useState, useEffect, useRef } from 'react';
import SongBoard from './components/SongBoard';
import CreateSongModal from './components/CreateSongModal';
import CreateSegmentModal from './components/CreateSegmentModal';
import './App.css';

function App() {
  const [song, setSong] = useState(null);
  const [availableSongs, setAvailableSongs] = useState(['example-song']);
  const [selectedSong, setSelectedSong] = useState('example-song');
  const [error, setError] = useState(null);

  const [showCreateSongModal, setShowCreateSongModal] = useState(false);
  const [showCreateSegmentModal, setShowCreateSegmentModal] = useState(false);
  const [editingSegment, setEditingSegment] = useState(null);
  const [zoom, setZoom] = useState(100);

  const autoArrangeRef = useRef(null);

  useEffect(() => {
    if (selectedSong && selectedSong !== 'new') {
      loadSong(selectedSong);
    }
  }, [selectedSong]);

  const loadSong = async (songName) => {
    try {
      setError(null);
      const response = await fetch(`/songs/${songName}.json`);
      if (!response.ok) {
        throw new Error(`Failed to load song: ${response.statusText}`);
      }
      const songData = await response.json();
      setSong(songData);
      // Auto-arrange after a short delay to ensure positions are initialized
      setTimeout(() => {
        if (autoArrangeRef.current) {
          autoArrangeRef.current();
        }
      }, 100);
    } catch (err) {
      setError(`Error loading song: ${err.message}`);
      console.error(err);
    }
  };

  const handleFileUpload = async (event) => {
    const file = event.target.files[0];
    if (!file) return;

    try {
      setError(null);
      const text = await file.text();
      const songData = JSON.parse(text);
      setSong(songData);
      setSelectedSong('custom');
      // Auto-arrange after loading file
      setTimeout(() => {
        if (autoArrangeRef.current) {
          autoArrangeRef.current();
        }
      }, 100);
    } catch (err) {
      setError(`Error parsing JSON file: ${err.message}`);
      console.error(err);
    }
  };

  const handleCreateSong = (newSong) => {
    setSong(newSong);
    setSelectedSong('new');
    // Auto-arrange after creating song
    setTimeout(() => {
      if (autoArrangeRef.current) {
        autoArrangeRef.current();
      }
    }, 100);
  };

  const handleSaveSegment = (segment) => {
    if (!song) return;

    const existingIndex = song.segments.findIndex(s => s.id === segment.id);
    let updatedSegments;

    if (existingIndex >= 0) {
      updatedSegments = [...song.segments];
      updatedSegments[existingIndex] = segment;
    } else {
      updatedSegments = [...song.segments, segment];
    }

    setSong({
      ...song,
      segments: updatedSegments
    });

    setEditingSegment(null);
  };

  const handleEditSegment = (segment) => {
    setEditingSegment(segment);
    setShowCreateSegmentModal(true);
  };

  const handleDuplicateSegment = (segment) => {
    const newSegment = {
      ...segment,
      id: `seg-${Date.now()}`,
      name: `${segment.name} (Copy)`
    };

    setSong({
      ...song,
      segments: [...song.segments, newSegment]
    });
  };

  const handleUpdateConnections = (connections) => {
    setSong({
      ...song,
      connections
    });
  };

  const handleUpdatePositions = (positions) => {
    setSong({
      ...song,
      positions
    });
  };

  const handleAutoArrange = () => {
    if (autoArrangeRef.current) {
      autoArrangeRef.current();
    }
  };

  const handleZoomIn = () => {
    setZoom(prev => Math.min(prev + 25, 200));
  };

  const handleZoomOut = () => {
    setZoom(prev => Math.max(prev - 25, 25));
  };

  const handleZoomReset = () => {
    setZoom(100);
  };

  const handleDownloadJSON = () => {
    if (!song) return;

    const dataStr = JSON.stringify(song, null, 2);
    const dataBlob = new Blob([dataStr], { type: 'application/json' });
    const url = URL.createObjectURL(dataBlob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `${song.title.replace(/\s+/g, '-').toLowerCase()}.json`;
    link.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="app">
      <header className="app-header">
        <h1>Music Structure Visualizer</h1>
        <p className="subtitle">Build and visualize your song structure</p>
      </header>

      <div className="controls">
        <div className="control-group">
          <button
            className="btn-create-song"
            onClick={() => setShowCreateSongModal(true)}
          >
            + Create Song
          </button>
          <button
            className="btn-create-segment"
            onClick={() => {
              setEditingSegment(null);
              setShowCreateSegmentModal(true);
            }}
            disabled={!song}
          >
            + Create Segment
          </button>
        </div>

        <div className="control-group">
          <label htmlFor="song-select">Load Song:</label>
          <select
            id="song-select"
            value={selectedSong}
            onChange={(e) => setSelectedSong(e.target.value)}
          >
            <option value="">Select a song...</option>
            {availableSongs.map((songName) => (
              <option key={songName} value={songName}>
                {songName}
              </option>
            ))}
            {selectedSong === 'custom' && (
              <option value="custom">Custom Upload</option>
            )}
            {selectedSong === 'new' && (
              <option value="new">New Song</option>
            )}
          </select>
        </div>

        <div className="control-group">
          <label htmlFor="file-upload" className="file-upload-label">
            Upload JSON:
          </label>
          <input
            id="file-upload"
            type="file"
            accept=".json"
            onChange={handleFileUpload}
            className="file-input"
          />
        </div>

        {song && (
          <>
            <div className="control-group">
              <button className="btn-auto-arrange" onClick={handleAutoArrange}>
                Auto-Arrange
              </button>
            </div>
            <div className="control-group zoom-controls">
              <button className="btn-zoom" onClick={handleZoomOut} disabled={zoom <= 25}>
                -
              </button>
              <span className="zoom-display">{zoom}%</span>
              <button className="btn-zoom" onClick={handleZoomIn} disabled={zoom >= 200}>
                +
              </button>
              <button className="btn-zoom-reset" onClick={handleZoomReset}>
                Reset
              </button>
            </div>
            <div className="control-group">
              <button className="btn-download" onClick={handleDownloadJSON}>
                Download JSON
              </button>
            </div>
          </>
        )}
      </div>

      {song && (
        <div className="song-info">
          <h2>{song.title}</h2>
          {song.artist && <p className="artist">{song.artist}</p>}
          <p className="segment-count">
            {song.segments?.length || 0} segment(s) | {song.connections?.length || 0} connection(s)
          </p>
        </div>
      )}

      {error && (
        <div className="error-message">
          {error}
        </div>
      )}

      <SongBoard
        song={song}
        onEditSegment={handleEditSegment}
        onDuplicateSegment={handleDuplicateSegment}
        onUpdateConnections={handleUpdateConnections}
        onUpdatePositions={handleUpdatePositions}
        onAutoArrange={autoArrangeRef}
        zoom={zoom}
      />

      <CreateSongModal
        isOpen={showCreateSongModal}
        onClose={() => setShowCreateSongModal(false)}
        onSave={handleCreateSong}
      />

      <CreateSegmentModal
        isOpen={showCreateSegmentModal}
        onClose={() => {
          setShowCreateSegmentModal(false);
          setEditingSegment(null);
        }}
        onSave={handleSaveSegment}
        editingSegment={editingSegment}
      />
    </div>
  );
}

export default App;
