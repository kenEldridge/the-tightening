import React from 'react';
import { TheTighteningLogo } from './TheTighteningLogo';

interface HomePageProps {
  onSongPractice: () => void;
  onYoutubePractice: () => void;
  loadingStatus?: string;
}

export const HomePage: React.FC<HomePageProps> = ({
  onSongPractice,
  onYoutubePractice,
  loadingStatus,
}) => {
  return (
    <div style={{
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      justifyContent: 'center',
      height: '100vh',
      backgroundColor: '#1a1a1a',
      color: '#eee',
      fontFamily: 'monospace',
      gap: '48px',
    }}>
      <TheTighteningLogo width={320} />

      <div style={{
        display: 'flex',
        gap: '24px',
      }}>
        {/* Song Practice card */}
        <button
          onClick={onSongPractice}
          style={{
            width: '220px',
            padding: '32px 24px',
            backgroundColor: '#2a2a2a',
            border: '1px solid #333',
            borderRadius: '8px',
            color: '#eee',
            fontFamily: 'monospace',
            cursor: 'pointer',
            textAlign: 'left',
            display: 'flex',
            flexDirection: 'column',
            gap: '12px',
            transition: 'border-color 0.15s, background-color 0.15s',
          }}
          onMouseEnter={e => {
            (e.currentTarget as HTMLButtonElement).style.borderColor = '#4a9';
            (e.currentTarget as HTMLButtonElement).style.backgroundColor = '#2e3a32';
          }}
          onMouseLeave={e => {
            (e.currentTarget as HTMLButtonElement).style.borderColor = '#333';
            (e.currentTarget as HTMLButtonElement).style.backgroundColor = '#2a2a2a';
          }}
        >
          <div style={{ fontSize: '32px' }}>🎵</div>
          <div style={{ fontSize: '18px', fontWeight: 700, color: '#4a9' }}>
            Song Practice
          </div>
          <div style={{ fontSize: '12px', color: '#888', lineHeight: '1.6' }}>
            33,000+ songs<br />
            Adaptive key mapping<br />
            Guitar Hero notes
          </div>
          <div style={{
            marginTop: '8px',
            fontSize: '13px',
            color: '#4a9',
          }}>
            Start →
          </div>
        </button>

        {/* YouTube Practice card */}
        <button
          onClick={onYoutubePractice}
          style={{
            width: '220px',
            padding: '32px 24px',
            backgroundColor: '#2a2a2a',
            border: '1px solid #333',
            borderRadius: '8px',
            color: '#eee',
            fontFamily: 'monospace',
            cursor: 'pointer',
            textAlign: 'left',
            display: 'flex',
            flexDirection: 'column',
            gap: '12px',
            transition: 'border-color 0.15s, background-color 0.15s',
          }}
          onMouseEnter={e => {
            (e.currentTarget as HTMLButtonElement).style.borderColor = '#FF0000';
            (e.currentTarget as HTMLButtonElement).style.backgroundColor = '#3a2020';
          }}
          onMouseLeave={e => {
            (e.currentTarget as HTMLButtonElement).style.borderColor = '#333';
            (e.currentTarget as HTMLButtonElement).style.backgroundColor = '#2a2a2a';
          }}
        >
          <div style={{ fontSize: '32px' }}>📹</div>
          <div style={{ fontSize: '18px', fontWeight: 700, color: '#FF0000' }}>
            YouTube Practice
          </div>
          <div style={{ fontSize: '12px', color: '#888', lineHeight: '1.6' }}>
            Import piano tutorials<br />
            OCR sheet music<br />
            Sync video + audio
          </div>
          <div style={{
            marginTop: '8px',
            fontSize: '13px',
            color: '#FF0000',
          }}>
            Open →
          </div>
        </button>
      </div>

      {loadingStatus && (
        <div style={{ fontSize: '11px', color: '#555' }}>
          {loadingStatus}
        </div>
      )}
    </div>
  );
};
