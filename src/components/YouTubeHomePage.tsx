/**
 * YouTube Home Page
 *
 * Lists all saved practice sessions grouped by video.
 * Entry point for YouTube practice mode.
 */

import React, { useState, useEffect, useCallback } from 'react';
import { getAllSavedVideos, deleteSegmentBySavedAt, type SavedSegment } from '../utils/segmentStorage';

export interface YouTubeHomePageProps {
  onClose: () => void;
  onNewVideo: () => void;
  onResume: (segment: SavedSegment) => void;
  resumeLoading: boolean;
}

function formatTime(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${s.toString().padStart(2, '0')}`;
}

export const YouTubeHomePage: React.FC<YouTubeHomePageProps> = ({
  onClose,
  onNewVideo,
  onResume,
  resumeLoading,
}) => {
  const [videos, setVideos] = useState<ReturnType<typeof getAllSavedVideos>>([]);

  const reload = useCallback(() => {
    setVideos(getAllSavedVideos());
  }, []);

  useEffect(() => {
    reload();
  }, [reload]);

  const handleDelete = useCallback((videoId: string, savedAt: string) => {
    deleteSegmentBySavedAt(videoId, savedAt);
    reload();
  }, [reload]);

  return (
    <div style={{
      position: 'fixed',
      inset: 0,
      backgroundColor: '#1a1a1a',
      zIndex: 1000,
      display: 'flex',
      flexDirection: 'column',
      fontFamily: 'monospace',
      color: '#eee',
    }}>
      {/* Header */}
      <div style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        padding: '16px 24px',
        borderBottom: '1px solid #333',
        flexShrink: 0,
      }}>
        <button
          onClick={onClose}
          style={{
            background: 'transparent',
            border: 'none',
            color: '#aaa',
            cursor: 'pointer',
            fontSize: '14px',
            padding: '6px 12px',
          }}
        >
          ✕ Close
        </button>

        <h2 style={{ margin: 0, fontSize: '18px', color: '#fff' }}>
          YouTube Practice
        </h2>

        <button
          onClick={onNewVideo}
          style={{
            padding: '8px 16px',
            backgroundColor: '#FF0000',
            color: '#fff',
            border: 'none',
            borderRadius: '4px',
            cursor: 'pointer',
            fontSize: '13px',
          }}
        >
          + New Video
        </button>
      </div>

      {/* Content */}
      <div style={{
        flex: 1,
        overflowY: 'auto',
        padding: '24px',
      }}>
        {videos.length === 0 ? (
          <div style={{
            textAlign: 'center',
            color: '#666',
            marginTop: '80px',
            fontSize: '15px',
            lineHeight: '2',
          }}>
            <div style={{ fontSize: '40px', marginBottom: '16px' }}>📹</div>
            <div>No sessions yet.</div>
            <div>Import a YouTube video to get started.</div>
            <button
              onClick={onNewVideo}
              style={{
                marginTop: '24px',
                padding: '10px 24px',
                backgroundColor: '#FF0000',
                color: '#fff',
                border: 'none',
                borderRadius: '4px',
                cursor: 'pointer',
                fontSize: '14px',
              }}
            >
              Import YouTube Video
            </button>
          </div>
        ) : (
          videos.map(video => (
            <div key={video.videoId} style={{ marginBottom: '32px' }}>
              {/* Video title */}
              <div style={{
                display: 'flex',
                alignItems: 'center',
                gap: '8px',
                marginBottom: '8px',
              }}>
                <span style={{ fontSize: '18px' }}>📹</span>
                <span style={{ fontSize: '15px', fontWeight: 'bold', color: '#fff' }}>
                  {video.videoTitle || video.videoId}
                </span>
              </div>

              {/* Segments */}
              <div style={{
                borderRadius: '6px',
                border: '1px solid #333',
                overflow: 'hidden',
              }}>
                {video.segments.map((segment, idx) => {
                  const duration = segment.endTime - segment.startTime;
                  const noteCount = segment.ocrNotes.length;
                  return (
                    <div
                      key={segment.savedAt}
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'space-between',
                        padding: '12px 16px',
                        backgroundColor: idx % 2 === 0 ? '#222' : '#1e1e1e',
                        borderBottom: idx < video.segments.length - 1 ? '1px solid #333' : 'none',
                      }}
                    >
                      {/* Segment info */}
                      <div>
                        <div style={{ fontSize: '14px', color: '#ddd', marginBottom: '4px' }}>
                          {segment.name || `Segment ${idx + 1}`}
                        </div>
                        <div style={{ fontSize: '12px', color: '#888' }}>
                          {formatTime(segment.startTime)} – {formatTime(segment.endTime)}
                          {' • '}
                          {Math.round(duration)}s
                          {' • '}
                          {noteCount} notes
                          {segment.tempo !== 120 && ` • ${Math.round(segment.tempo)} BPM`}
                        </div>
                      </div>

                      {/* Actions */}
                      <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                        <button
                          onClick={() => onResume(segment)}
                          disabled={resumeLoading}
                          style={{
                            padding: '6px 14px',
                            backgroundColor: resumeLoading ? '#444' : '#2a6',
                            color: '#fff',
                            border: 'none',
                            borderRadius: '4px',
                            cursor: resumeLoading ? 'not-allowed' : 'pointer',
                            fontSize: '13px',
                          }}
                        >
                          {resumeLoading ? '...' : '▶ Resume'}
                        </button>
                        <button
                          onClick={() => handleDelete(video.videoId, segment.savedAt)}
                          disabled={resumeLoading}
                          style={{
                            padding: '6px 10px',
                            backgroundColor: 'transparent',
                            color: '#666',
                            border: '1px solid #444',
                            borderRadius: '4px',
                            cursor: resumeLoading ? 'not-allowed' : 'pointer',
                            fontSize: '13px',
                          }}
                        >
                          Delete
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
};
