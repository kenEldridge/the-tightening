import SongSection from './SongSection';
import './SongViewer.css';

function SongViewer({ song }) {
  if (!song) {
    return (
      <div className="song-viewer empty">
        <p>No song loaded. Please select a song or upload a JSON file.</p>
      </div>
    );
  }

  return (
    <div className="song-viewer">
      <div className="song-header">
        <h1>{song.title}</h1>
        {song.artist && <h2 className="artist">{song.artist}</h2>}
      </div>

      <div className="sections-container">
        {song.sections.map((section, index) => (
          <SongSection
            key={index}
            section={section}
            index={index}
          />
        ))}
      </div>

      <div className="song-footer">
        <p>Total sections: {song.sections.length}</p>
      </div>
    </div>
  );
}

export default SongViewer;
