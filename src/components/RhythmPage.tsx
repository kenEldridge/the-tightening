/**
 * Rhythm Page
 *
 * Full-screen view for the rhythm/chord trainer.
 * Flow: Create Project → Ingest Audio → Analyze → Edit Timeline → Practice
 */

import React, { useState, useCallback, useRef, useEffect } from 'react';
import { RhythmAnalyzer } from '../core/RhythmAnalyzer';
import { createTimeline, applyEdit } from '../core/timelineEditor';
import { buildPracticePayload, validateChordPress, createEmptyStats } from '../core/rhythmTrainer';
import type {
  PracticeProjectLite,
  ChordTimelineArtifact,
  ChordEvent,
  TimelineEditOp,
  RhythmPracticePayload,
  ChordValidationStats,
  AnalysisOptions,
  ExtractionError,
} from '../core/rhythmTypes';

// ============================================
// Sub-views
// ============================================

type RhythmView = 'projects' | 'ingest' | 'analyzing' | 'timeline' | 'practice';

interface ProjectSummary {
  id: string;
  name: string;
  sourceType: string;
  sourceTitle: string;
  hasTimeline: boolean;
  createdAt: string;
  lastOpenedAt: string;
}

interface RhythmPageProps {
  onClose: () => void;
}

export const RhythmPage: React.FC<RhythmPageProps> = ({ onClose }) => {
  const [view, setView] = useState<RhythmView>('projects');
  const [projects, setProjects] = useState<ProjectSummary[]>([]);
  const [currentProject, setCurrentProject] = useState<PracticeProjectLite | null>(null);
  const [timeline, setTimeline] = useState<ChordTimelineArtifact | null>(null);
  const [error, setError] = useState<ExtractionError | null>(null);
  const [analysisProgress, setAnalysisProgress] = useState('');
  const [practicePayload, setPracticePayload] = useState<RhythmPracticePayload | null>(null);
  const [stats, setStats] = useState<ChordValidationStats>(createEmptyStats());
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentChangeIdx, setCurrentChangeIdx] = useState(0);
  const [youtubeUrl, setYoutubeUrl] = useState('');
  const playbackRef = useRef<number | null>(null);
  const startTimeRef = useRef<number>(0);
  const pressedNotesRef = useRef<Set<number>>(new Set());

  // Load projects on mount
  useEffect(() => {
    loadProjects();
  }, []);

  const loadProjects = useCallback(async () => {
    if (!window.electronAPI?.projectList) return;
    const list = await window.electronAPI.projectList();
    setProjects(list);
  }, []);

  // ============================================
  // Project Creation
  // ============================================

  const createFromYouTube = useCallback(async () => {
    if (!youtubeUrl.trim()) return;
    setError(null);

    try {
      // Get video info
      const info = await window.electronAPI.youtubeGetInfo(youtubeUrl);
      if (!info) {
        setError({ code: 'download_failed', message: 'Could not get video info', recoverable: true, fallback: 'import_local' });
        return;
      }

      // Create project
      const result = await window.electronAPI.projectCreateLite({
        name: info.title,
        sourceType: 'youtube',
        sourceUri: youtubeUrl,
        sourceTitle: info.title,
        sourceDuration: info.duration,
      });

      if (!result.ok) {
        setError(result.error);
        return;
      }

      const project = result.project as PracticeProjectLite;
      setCurrentProject(project);

      // Extract audio
      setView('analyzing');
      setAnalysisProgress('Downloading audio...');

      const audioPath = await window.electronAPI.youtubeExtractAudio(youtubeUrl);
      if (!audioPath) {
        setError({ code: 'download_failed', message: 'Failed to download audio', recoverable: true, fallback: 'import_local' });
        setView('ingest');
        return;
      }

      // Normalize
      setAnalysisProgress('Normalizing audio...');
      const normResult = await window.electronAPI.normalizeAudioToWav(audioPath, project.id);
      if (!normResult.ok) {
        setError(normResult.error);
        setView('ingest');
        return;
      }

      project.audioPath = normResult.audioPath;
      await runAnalysis(project);
    } catch (err) {
      setError({ code: 'unknown', message: (err as Error).message, recoverable: true });
      setView('ingest');
    }
  }, [youtubeUrl]);

  const createFromLocalFile = useCallback(async () => {
    setError(null);

    try {
      const importResult = await window.electronAPI.projectImportLocalMedia();
      if (!importResult.ok) {
        if (importResult.canceled) return;
        setError(importResult.error);
        return;
      }

      const { filePath, fileName } = importResult;

      // Create project
      const result = await window.electronAPI.projectCreateLite({
        name: fileName,
        sourceType: 'local_file',
        sourceUri: filePath,
        sourceTitle: fileName,
      });

      if (!result.ok) {
        setError(result.error);
        return;
      }

      const project = result.project as PracticeProjectLite;
      setCurrentProject(project);

      // Normalize
      setView('analyzing');
      setAnalysisProgress('Normalizing audio...');

      const normResult = await window.electronAPI.normalizeAudioToWav(filePath, project.id);
      if (!normResult.ok) {
        setError(normResult.error);
        setView('ingest');
        return;
      }

      project.audioPath = normResult.audioPath;
      await runAnalysis(project);
    } catch (err) {
      setError({ code: 'unknown', message: (err as Error).message, recoverable: true });
      setView('ingest');
    }
  }, []);

  // ============================================
  // Analysis
  // ============================================

  const runAnalysis = useCallback(async (project: PracticeProjectLite, options?: AnalysisOptions) => {
    if (!project.audioPath) {
      setError({ code: 'file_not_found', message: 'No audio file available', recoverable: false });
      return;
    }

    setView('analyzing');
    setAnalysisProgress('Running rhythm analysis...');
    setError(null);

    try {
      const analyzer = new RhythmAnalyzer();
      const result = await analyzer.analyze(project.audioPath, options || {});

      const tl = createTimeline(result.beatGrid, result.chords, {
        analysisVersion: result.meta.analysisVersion,
        configHash: result.meta.configHash,
      });

      // Save to project
      await window.electronAPI.projectSaveTimeline(project.id, tl);

      setTimeline(tl);
      setCurrentProject({ ...project, timeline: tl });
      setView('timeline');
      setAnalysisProgress('');
    } catch (err) {
      setError({ code: 'analysis_failed', message: (err as Error).message, recoverable: true, fallback: 'retry' });
      setView('ingest');
    }
  }, []);

  // ============================================
  // Load existing project
  // ============================================

  const openProject = useCallback(async (projectId: string) => {
    const result = await window.electronAPI.projectLoadLite(projectId);
    if (!result.ok) {
      setError(result.error);
      return;
    }

    const project = result.project as PracticeProjectLite;
    setCurrentProject(project);

    if (project.timeline) {
      setTimeline(project.timeline);
      setView('timeline');
    } else if (project.audioPath) {
      await runAnalysis(project);
    } else {
      setView('ingest');
    }
  }, [runAnalysis]);

  // ============================================
  // Timeline Editing
  // ============================================

  const applyTimelineEdit = useCallback(async (op: TimelineEditOp) => {
    if (!timeline || !currentProject) return;

    const updated = applyEdit(timeline, op);
    setTimeline(updated);
    await window.electronAPI.projectSaveTimeline(currentProject.id, updated);
  }, [timeline, currentProject]);

  // ============================================
  // Practice Mode
  // ============================================

  const startPractice = useCallback((barRange?: { start: number; end: number }) => {
    if (!timeline || !currentProject) return;

    const payload = buildPracticePayload(currentProject.id, timeline, barRange);
    setPracticePayload(payload);
    setStats(createEmptyStats());
    setCurrentChangeIdx(0);
    setView('practice');
  }, [timeline, currentProject]);

  const stopPractice = useCallback(() => {
    if (playbackRef.current) {
      cancelAnimationFrame(playbackRef.current);
      playbackRef.current = null;
    }
    setIsPlaying(false);
  }, []);

  // ============================================
  // Render
  // ============================================

  return (
    <div style={{
      display: 'flex',
      flexDirection: 'column',
      height: '100vh',
      backgroundColor: '#1a1a1a',
      color: '#eee',
      fontFamily: 'monospace',
      overflow: 'hidden',
    }}>
      {/* Header */}
      <div style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        padding: '8px 16px',
        borderBottom: '1px solid #333',
        flexShrink: 0,
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
          <button
            onClick={view === 'projects' ? onClose : () => {
              stopPractice();
              if (view === 'practice' || view === 'timeline') {
                setView('timeline');
                if (view === 'practice') return;
              }
              setView('projects');
            }}
            style={{
              background: 'none',
              border: '1px solid #444',
              color: '#aaa',
              padding: '4px 10px',
              borderRadius: '4px',
              cursor: 'pointer',
              fontFamily: 'monospace',
              fontSize: '12px',
            }}
          >
            {view === 'projects' ? '← Home' : '← Back'}
          </button>
          <span style={{ fontSize: '14px', fontWeight: 700, color: '#e8a' }}>
            Rhythm Trainer
          </span>
          {currentProject && (
            <span style={{ fontSize: '12px', color: '#888' }}>
              — {currentProject.name}
            </span>
          )}
        </div>
        <span style={{ fontSize: '11px', color: '#555' }}>
          {view}
        </span>
      </div>

      {/* Error banner */}
      {error && (
        <div style={{
          padding: '8px 16px',
          backgroundColor: '#3a2020',
          borderBottom: '1px solid #633',
          fontSize: '12px',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
        }}>
          <span>
            <span style={{ color: '#f66' }}>[{error.code}]</span>{' '}
            {error.message}
            {error.detail && <span style={{ color: '#888' }}> — {error.detail}</span>}
          </span>
          <div style={{ display: 'flex', gap: '8px' }}>
            {error.fallback === 'import_local' && (
              <button onClick={createFromLocalFile} style={smallBtnStyle}>
                Import Local File
              </button>
            )}
            {error.fallback === 'retry' && currentProject && (
              <button onClick={() => runAnalysis(currentProject)} style={smallBtnStyle}>
                Retry
              </button>
            )}
            <button onClick={() => setError(null)} style={smallBtnStyle}>
              Dismiss
            </button>
          </div>
        </div>
      )}

      {/* Main content */}
      <div style={{ flex: 1, overflow: 'auto', padding: '16px' }}>
        {view === 'projects' && (
          <ProjectsView
            projects={projects}
            onOpen={openProject}
            onNew={() => setView('ingest')}
            onDelete={async (id) => {
              await window.electronAPI.projectDelete(id);
              loadProjects();
            }}
          />
        )}

        {view === 'ingest' && (
          <IngestView
            youtubeUrl={youtubeUrl}
            onYoutubeUrlChange={setYoutubeUrl}
            onYoutubeSubmit={createFromYouTube}
            onLocalImport={createFromLocalFile}
          />
        )}

        {view === 'analyzing' && (
          <div style={{ textAlign: 'center', paddingTop: '80px' }}>
            <div style={{ fontSize: '24px', marginBottom: '16px' }}>Analyzing...</div>
            <div style={{ fontSize: '14px', color: '#aaa' }}>{analysisProgress}</div>
          </div>
        )}

        {view === 'timeline' && timeline && (
          <TimelineView
            timeline={timeline}
            onEdit={applyTimelineEdit}
            onPractice={startPractice}
            onReanalyze={currentProject ? () => runAnalysis(currentProject) : undefined}
          />
        )}

        {view === 'practice' && practicePayload && (
          <PracticeView
            payload={practicePayload}
            stats={stats}
            onStop={() => {
              stopPractice();
              setView('timeline');
            }}
          />
        )}
      </div>
    </div>
  );
};

// ============================================
// Sub-components
// ============================================

const smallBtnStyle: React.CSSProperties = {
  background: 'none',
  border: '1px solid #555',
  color: '#ccc',
  padding: '2px 8px',
  borderRadius: '3px',
  cursor: 'pointer',
  fontFamily: 'monospace',
  fontSize: '11px',
};

const btnStyle: React.CSSProperties = {
  background: 'none',
  border: '1px solid #555',
  color: '#eee',
  padding: '8px 16px',
  borderRadius: '4px',
  cursor: 'pointer',
  fontFamily: 'monospace',
  fontSize: '13px',
};

const primaryBtnStyle: React.CSSProperties = {
  ...btnStyle,
  backgroundColor: '#2a3a2a',
  borderColor: '#4a9',
  color: '#4a9',
};

// ---- Projects List ----

const ProjectsView: React.FC<{
  projects: ProjectSummary[];
  onOpen: (id: string) => void;
  onNew: () => void;
  onDelete: (id: string) => void;
}> = ({ projects, onOpen, onNew, onDelete }) => (
  <div>
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
      <h2 style={{ margin: 0, fontSize: '18px' }}>Projects</h2>
      <button onClick={onNew} style={primaryBtnStyle}>+ New Project</button>
    </div>

    {projects.length === 0 ? (
      <div style={{ color: '#666', padding: '40px', textAlign: 'center' }}>
        No projects yet. Create one to get started.
      </div>
    ) : (
      <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
        {projects.map(p => (
          <div
            key={p.id}
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              padding: '12px 16px',
              backgroundColor: '#2a2a2a',
              border: '1px solid #333',
              borderRadius: '6px',
              cursor: 'pointer',
            }}
            onClick={() => onOpen(p.id)}
          >
            <div>
              <div style={{ fontSize: '14px', fontWeight: 600 }}>{p.name}</div>
              <div style={{ fontSize: '11px', color: '#888', marginTop: '4px' }}>
                {p.sourceType === 'youtube' ? 'YouTube' : 'Local'} — {p.hasTimeline ? 'Analyzed' : 'Pending'}
              </div>
            </div>
            <button
              onClick={(e) => { e.stopPropagation(); onDelete(p.id); }}
              style={{ ...smallBtnStyle, color: '#f66', borderColor: '#633' }}
            >
              Delete
            </button>
          </div>
        ))}
      </div>
    )}
  </div>
);

// ---- Ingest View ----

const IngestView: React.FC<{
  youtubeUrl: string;
  onYoutubeUrlChange: (url: string) => void;
  onYoutubeSubmit: () => void;
  onLocalImport: () => void;
}> = ({ youtubeUrl, onYoutubeUrlChange, onYoutubeSubmit, onLocalImport }) => (
  <div style={{ maxWidth: '500px', margin: '0 auto', paddingTop: '40px' }}>
    <h2 style={{ margin: '0 0 24px 0', fontSize: '18px' }}>New Project</h2>

    {/* YouTube input */}
    <div style={{ marginBottom: '32px' }}>
      <label style={{ fontSize: '13px', color: '#aaa', marginBottom: '8px', display: 'block' }}>
        YouTube URL
      </label>
      <div style={{ display: 'flex', gap: '8px' }}>
        <input
          type="text"
          value={youtubeUrl}
          onChange={(e) => onYoutubeUrlChange(e.target.value)}
          placeholder="https://www.youtube.com/watch?v=..."
          style={{
            flex: 1,
            padding: '8px 12px',
            backgroundColor: '#222',
            border: '1px solid #444',
            borderRadius: '4px',
            color: '#eee',
            fontFamily: 'monospace',
            fontSize: '13px',
          }}
          onKeyDown={(e) => e.key === 'Enter' && onYoutubeSubmit()}
        />
        <button onClick={onYoutubeSubmit} style={primaryBtnStyle}>
          Analyze
        </button>
      </div>
    </div>

    {/* Divider */}
    <div style={{
      display: 'flex',
      alignItems: 'center',
      gap: '12px',
      marginBottom: '32px',
      color: '#555',
      fontSize: '12px',
    }}>
      <div style={{ flex: 1, height: '1px', backgroundColor: '#333' }} />
      or
      <div style={{ flex: 1, height: '1px', backgroundColor: '#333' }} />
    </div>

    {/* Local file */}
    <button onClick={onLocalImport} style={{ ...btnStyle, width: '100%', padding: '16px' }}>
      Import Local Audio/Video File
    </button>
  </div>
);

// ---- Timeline View ----

const TimelineView: React.FC<{
  timeline: ChordTimelineArtifact;
  onEdit: (op: TimelineEditOp) => void;
  onPractice: (barRange?: { start: number; end: number }) => void;
  onReanalyze?: () => void;
}> = ({ timeline, onEdit, onPractice, onReanalyze }) => {
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editSymbol, setEditSymbol] = useState('');

  const handleSetChord = (eventId: string) => {
    if (!editSymbol.trim()) return;
    onEdit({ type: 'set_chord', eventId, symbol: editSymbol.trim() });
    setEditingId(null);
    setEditSymbol('');
  };

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
        <div>
          <h2 style={{ margin: 0, fontSize: '18px' }}>Chord Timeline</h2>
          <div style={{ fontSize: '11px', color: '#888', marginTop: '4px' }}>
            {timeline.beatGrid.tempo} BPM — {timeline.beatGrid.timeSignature.numerator}/{timeline.beatGrid.timeSignature.denominator} — {timeline.beatGrid.barCount} bars — {timeline.chords.length} chords — {timeline.edits.length} edits
          </div>
        </div>
        <div style={{ display: 'flex', gap: '8px' }}>
          {onReanalyze && (
            <button onClick={onReanalyze} style={smallBtnStyle}>Re-analyze</button>
          )}
          <button onClick={() => onPractice()} style={primaryBtnStyle}>
            Practice All
          </button>
        </div>
      </div>

      {/* Chord events table */}
      <div style={{
        display: 'grid',
        gridTemplateColumns: '60px 80px 80px 80px 1fr 60px 40px',
        gap: '1px',
        backgroundColor: '#333',
        border: '1px solid #333',
        borderRadius: '4px',
        overflow: 'hidden',
        fontSize: '12px',
      }}>
        {/* Header */}
        {['Bars', 'Start', 'End', 'Chord', 'Confidence', 'Source', ''].map((h, i) => (
          <div key={i} style={{ padding: '6px 8px', backgroundColor: '#2a2a2a', color: '#888', fontWeight: 600 }}>
            {h}
          </div>
        ))}

        {/* Rows */}
        {timeline.chords.map((chord) => (
          <React.Fragment key={chord.id}>
            <div style={cellStyle}>{chord.barStart}–{chord.barEnd}</div>
            <div style={cellStyle}>{chord.startTime.toFixed(1)}s</div>
            <div style={cellStyle}>{chord.endTime.toFixed(1)}s</div>
            <div style={{ ...cellStyle, fontWeight: 700, color: chord.source === 'manual' ? '#e8a' : '#4a9' }}>
              {editingId === chord.id ? (
                <input
                  autoFocus
                  value={editSymbol}
                  onChange={(e) => setEditSymbol(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') handleSetChord(chord.id);
                    if (e.key === 'Escape') { setEditingId(null); setEditSymbol(''); }
                  }}
                  onBlur={() => { setEditingId(null); setEditSymbol(''); }}
                  style={{
                    width: '60px',
                    backgroundColor: '#333',
                    border: '1px solid #555',
                    color: '#eee',
                    fontFamily: 'monospace',
                    fontSize: '12px',
                    padding: '1px 4px',
                    borderRadius: '2px',
                  }}
                />
              ) : (
                <span
                  style={{ cursor: 'pointer' }}
                  onClick={() => { setEditingId(chord.id); setEditSymbol(chord.symbol); }}
                  title="Click to edit"
                >
                  {chord.symbol}
                </span>
              )}
            </div>
            <div style={cellStyle}>
              <div style={{
                width: `${Math.round(chord.confidence * 100)}%`,
                height: '4px',
                backgroundColor: chord.confidence > 0.7 ? '#4a9' : chord.confidence > 0.4 ? '#ea4' : '#f66',
                borderRadius: '2px',
              }} />
            </div>
            <div style={{ ...cellStyle, color: '#888' }}>{chord.source}</div>
            <div style={cellStyle}>
              <button
                onClick={() => onPractice({ start: chord.barStart, end: chord.barEnd })}
                style={{ ...smallBtnStyle, fontSize: '10px', padding: '1px 4px' }}
                title="Practice this section"
              >
                ▶
              </button>
            </div>
          </React.Fragment>
        ))}
      </div>
    </div>
  );
};

const cellStyle: React.CSSProperties = {
  padding: '6px 8px',
  backgroundColor: '#222',
};

// ---- Practice View ----

const PracticeView: React.FC<{
  payload: RhythmPracticePayload;
  stats: ChordValidationStats;
  onStop: () => void;
}> = ({ payload, stats, onStop }) => {
  const [currentIdx, setCurrentIdx] = useState(0);
  const currentChange = payload.changes[currentIdx] || null;

  return (
    <div style={{ textAlign: 'center', paddingTop: '40px' }}>
      <div style={{ fontSize: '14px', color: '#888', marginBottom: '24px' }}>
        {payload.tempo} BPM — Bars {payload.barRange.start}–{payload.barRange.end} — {payload.changes.length} changes
      </div>

      {/* Current chord */}
      {currentChange && (
        <div style={{ marginBottom: '32px' }}>
          <div style={{ fontSize: '64px', fontWeight: 700, color: '#4a9', marginBottom: '8px' }}>
            {currentChange.symbol}
          </div>
          <div style={{ fontSize: '14px', color: '#888' }}>
            Bar {currentChange.bar} — {currentChange.duration.toFixed(1)}s
          </div>
        </div>
      )}

      {/* Upcoming */}
      <div style={{ display: 'flex', justifyContent: 'center', gap: '16px', marginBottom: '32px' }}>
        {payload.changes.slice(currentIdx + 1, currentIdx + 5).map((change, i) => (
          <div key={i} style={{
            padding: '8px 16px',
            backgroundColor: '#2a2a2a',
            border: '1px solid #333',
            borderRadius: '4px',
            fontSize: '18px',
            color: '#666',
          }}>
            {change.symbol}
          </div>
        ))}
      </div>

      {/* Stats */}
      <div style={{ display: 'flex', justifyContent: 'center', gap: '24px', marginBottom: '32px', fontSize: '13px' }}>
        <span style={{ color: '#4a9' }}>Correct: {stats.correct}</span>
        <span style={{ color: '#ea4' }}>Late: {stats.late}</span>
        <span style={{ color: '#f66' }}>Wrong: {stats.wrong}</span>
        <span style={{ color: '#888' }}>Missed: {stats.missed}</span>
      </div>

      {/* Navigation */}
      <div style={{ display: 'flex', justifyContent: 'center', gap: '12px' }}>
        <button
          onClick={() => setCurrentIdx(Math.max(0, currentIdx - 1))}
          style={btnStyle}
          disabled={currentIdx === 0}
        >
          ← Prev
        </button>
        <button onClick={onStop} style={{ ...btnStyle, color: '#f66', borderColor: '#633' }}>
          Stop
        </button>
        <button
          onClick={() => setCurrentIdx(Math.min(payload.changes.length - 1, currentIdx + 1))}
          style={btnStyle}
          disabled={currentIdx >= payload.changes.length - 1}
        >
          Next →
        </button>
      </div>
    </div>
  );
};
