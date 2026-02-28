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
import { RhythmPreviewPlayer, type PreviewMode, type HearItState } from '../core/RhythmPreviewPlayer';
import { applyLyricsToTimeline, parseArtistTitle, applyLyricCorrections, buildLineTargetKey, generateTimelineFingerprints, generateSectionFingerprint } from '../core/lyricsAlign';
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
  const previewPlayerRef = useRef<RhythmPreviewPlayer | null>(null);

  // Load projects on mount, cleanup preview player on unmount
  useEffect(() => {
    loadProjects();
    return () => {
      previewPlayerRef.current?.dispose();
    };
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
      const analyzerOptions: AnalysisOptions = {};
      if (options?.keyHint) analyzerOptions.keyHint = options.keyHint;
      if (typeof options?.tempoHint === 'number') analyzerOptions.tempoHint = options.tempoHint;
      if (options?.timeSignatureHint) analyzerOptions.timeSignatureHint = options.timeSignatureHint;

      // Persist analysis hints on the project so they survive across reanalyses
      if (options) {
        const hintsToSave: PracticeProjectLite['analysisHints'] = {};
        if (options.keyHint) hintsToSave.keyHint = options.keyHint;
        if (typeof options.tempoHint === 'number') hintsToSave.tempoHint = options.tempoHint;
        if (options.timeSignatureHint) {
          hintsToSave.timeSignatureHint = `${options.timeSignatureHint.numerator}/${options.timeSignatureHint.denominator}`;
        }
        project.analysisHints = hintsToSave;
        window.electronAPI.projectSaveHints?.(project.id, hintsToSave);
      }

      const result = await analyzer.analyze(project.audioPath, analyzerOptions);

      let tl = createTimeline(result.beatGrid, result.chords, {
        analysisVersion: result.meta.analysisVersion,
        configHash: result.meta.configHash,
        keyRoot: result.meta.keyRoot,
      });

      // Carry over lyric_correction edits from previous timeline (intent preservation)
      const prevTimeline = project.timeline;
      if (prevTimeline) {
        const lyricEdits = prevTimeline.edits.filter(e => e.op.type === 'lyric_correction');
        if (lyricEdits.length > 0) {
          tl = { ...tl, edits: [...tl.edits, ...lyricEdits] };
          console.log('[RhythmPage] Carried over lyric corrections', { count: lyricEdits.length });
        }
      }

      // Migrate legacy lyricsBarOffset to a global lyric_correction edit (one-time)
      const legacyOffset = project.lyricsBarOffset || 0;
      if (legacyOffset !== 0 && !tl.edits.some(e => e.op.type === 'lyric_correction' && (e.op as any).scope === 'global')) {
        const migrationEdit: import('../core/rhythmTypes').TimelineEdit = {
          id: `edit_migrate_offset_${Date.now()}`,
          op: { type: 'lyric_correction', scope: 'global' as const, targetKey: 'global', deltaBars: legacyOffset },
          timestamp: new Date().toISOString(),
        };
        tl = { ...tl, edits: [...tl.edits, migrationEdit] };
        console.log('[RhythmPage] Migrated lyricsBarOffset to global lyric_correction', { legacyOffset });
        // Clear legacy field
        project.lyricsBarOffset = 0;
      }

      // Try to fetch lyrics and apply to timeline
      setAnalysisProgress('Fetching lyrics...');
      let rawLyrics = project.cachedLyrics || '';
      let syncedLyrics: string | undefined = project.cachedSyncedLyrics;
      try {
        if (!rawLyrics && window.electronAPI?.fetchLyrics) {
          const { artist, title } = parseArtistTitle(project.source.title || project.name);
          console.log('[RhythmPage] Fetching lyrics for', { artist, title });
          const lyricsResult = await window.electronAPI.fetchLyrics(artist, title);
          if (lyricsResult.ok && lyricsResult.lyrics) {
            rawLyrics = lyricsResult.lyrics;
            syncedLyrics = lyricsResult.syncedLyrics;
            project.cachedLyrics = rawLyrics;
            project.cachedSyncedLyrics = syncedLyrics;
          } else {
            console.log('[RhythmPage] No lyrics found:', lyricsResult.error);
          }
        }
        if (rawLyrics) {
          // 1. Apply baseline lyrics placement
          tl = applyLyricsToTimeline(tl, rawLyrics, syncedLyrics);
          // 2. Apply ALL scoped lyric corrections from edit history (includes global shifts)
          tl = applyLyricCorrections(tl);
          console.log('[RhythmPage] Lyrics applied', {
            mode: syncedLyrics ? 'timed (LRC)' : 'structural',
            lines: rawLyrics.split('\n').filter(l => l.trim()).length,
            bars: tl.chords.filter(c => c.lyrics).length,
            corrections: tl.edits.filter(e => e.op.type === 'lyric_correction').length,
          });
        }
      } catch (lyricsErr) {
        console.warn('[RhythmPage] Lyrics fetch failed (non-fatal):', lyricsErr);
      }

      const lyricsCacheUpdate: { lyricsBarOffset: number; lyrics?: string; syncedLyrics?: string } = {
        lyricsBarOffset: 0, // Legacy field, always 0 now — corrections are in edits[]
      };
      if (rawLyrics) lyricsCacheUpdate.lyrics = rawLyrics;
      if (syncedLyrics) lyricsCacheUpdate.syncedLyrics = syncedLyrics;
      await window.electronAPI.projectSaveLyrics?.(project.id, lyricsCacheUpdate);

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

  const moveLyrics = useCallback(async (fromIdx: number, direction: -1 | 1, scope: import('../core/rhythmTypes').LyricCorrectionScope = 'line') => {
    if (!timeline || !currentProject) return;

    const updatedChords = timeline.chords.map(c => ({ ...c }));
    const lyricsText = updatedChords[fromIdx].lyrics;
    if (!lyricsText && scope === 'line') return;

    let targetKey: string;
    const totalBars = timeline.chords.length;

    if (scope === 'line') {
      // Line-level: move just this one lyric
      const toIdx = fromIdx + direction;
      if (toIdx < 0 || toIdx >= totalBars) return;

      updatedChords[fromIdx].lyrics = undefined;
      if (updatedChords[toIdx].lyrics) {
        updatedChords[toIdx].lyrics += ' / ' + lyricsText;
      } else {
        updatedChords[toIdx].lyrics = lyricsText;
      }
      targetKey = buildLineTargetKey(fromIdx, totalBars, lyricsText!);
    } else if (scope === 'section_occurrence') {
      // Section-level: shift all lyrics in this section
      const fingerprints = generateTimelineFingerprints(updatedChords);
      // Find which section this bar belongs to
      let sectionFp = '';
      for (const [barIdx, fp] of [...fingerprints.entries()].sort((a, b) => a[0] - b[0])) {
        if (barIdx <= fromIdx) sectionFp = fp;
      }
      targetKey = sectionFp || 'unknown';

      // Find section boundaries
      const fpEntries = [...fingerprints.keys()].sort((a, b) => a - b);
      const sectionStartIdx = fpEntries.findIndex(k => k <= fromIdx && (fpEntries[fpEntries.indexOf(k) + 1] ?? totalBars) > fromIdx);
      const sectionStart = sectionStartIdx >= 0 ? fpEntries[sectionStartIdx] : 0;
      const sectionEnd = fpEntries[sectionStartIdx + 1] ?? totalBars;

      // Visually shift all lyrics in this section
      const lyricData: Array<{ idx: number; lyrics: string }> = [];
      for (let i = sectionStart; i < sectionEnd; i++) {
        if (updatedChords[i].lyrics) {
          lyricData.push({ idx: i, lyrics: updatedChords[i].lyrics! });
          updatedChords[i].lyrics = undefined;
        }
      }
      for (const { idx, lyrics } of lyricData) {
        const target = idx + direction;
        if (target >= 0 && target < totalBars) {
          if (updatedChords[target].lyrics) {
            updatedChords[target].lyrics += ' / ' + lyrics;
          } else {
            updatedChords[target].lyrics = lyrics;
          }
        }
      }
    } else {
      // Global: shift all lyrics
      targetKey = 'global';
      const lyricData: Array<{ idx: number; lyrics: string; section?: string }> = [];
      for (let i = 0; i < totalBars; i++) {
        if (updatedChords[i].lyrics || updatedChords[i].section) {
          lyricData.push({ idx: i, lyrics: updatedChords[i].lyrics || '', section: updatedChords[i].section });
          updatedChords[i].lyrics = undefined;
          updatedChords[i].section = undefined;
        }
      }
      for (const { idx, lyrics, section } of lyricData) {
        const target = idx + direction;
        if (target >= 0 && target < totalBars) {
          if (lyrics) {
            if (updatedChords[target].lyrics) {
              updatedChords[target].lyrics += ' / ' + lyrics;
            } else {
              updatedChords[target].lyrics = lyrics;
            }
          }
          if (section && !updatedChords[target].section) {
            updatedChords[target].section = section;
          }
        }
      }
    }

    const correctionEdit: import('../core/rhythmTypes').TimelineEdit = {
      id: `edit_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
      op: { type: 'lyric_correction', scope, targetKey, deltaBars: direction },
      timestamp: new Date().toISOString(),
    };

    const updated: import('../core/rhythmTypes').ChordTimelineArtifact = {
      ...timeline,
      chords: updatedChords,
      edits: [...timeline.edits, correctionEdit],
      modifiedAt: new Date().toISOString(),
    };

    setTimeline(updated);
    setCurrentProject({ ...currentProject, timeline: updated });
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
              previewPlayerRef.current?.stop();
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
            audioPath={currentProject?.audioPath || null}
            savedHints={currentProject?.analysisHints}
            previewPlayerRef={previewPlayerRef}
            onEdit={applyTimelineEdit}
            onMoveLyrics={moveLyrics}
            onPractice={startPractice}
            onReanalyze={currentProject ? (opts?: AnalysisOptions) => runAnalysis(currentProject, opts) : undefined}
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

const arrowBtnStyle: React.CSSProperties = {
  background: 'none',
  border: '1px solid #444',
  color: '#aaa',
  padding: '0px 3px',
  borderRadius: '2px',
  cursor: 'pointer',
  fontFamily: 'monospace',
  fontSize: '9px',
  lineHeight: '14px',
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
  audioPath: string | null;
  savedHints?: { keyHint?: string; tempoHint?: number; timeSignatureHint?: string; lyricsBarOffset?: number };
  previewPlayerRef: React.MutableRefObject<RhythmPreviewPlayer | null>;
  onEdit: (op: TimelineEditOp) => void;
  onMoveLyrics: (fromIdx: number, direction: -1 | 1, scope?: import('../core/rhythmTypes').LyricCorrectionScope) => void;
  onPractice: (barRange?: { start: number; end: number }) => void;
  onReanalyze?: (opts?: AnalysisOptions) => void;
}> = ({ timeline, audioPath, savedHints, previewPlayerRef, onEdit, onMoveLyrics, onPractice, onReanalyze }) => {
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editSymbol, setEditSymbol] = useState('');
  const [hearItState, setHearItState] = useState<HearItState | null>(null);
  const [loading, setLoading] = useState(false);

  // Analysis hints for re-analyze (initialized from persisted project hints)
  const [hintKey, setHintKey] = useState(savedHints?.keyHint || '');
  const [hintTempo, setHintTempo] = useState(savedHints?.tempoHint ? String(savedHints.tempoHint) : '');
  const [hintTimeSig, setHintTimeSig] = useState<'auto' | '3/4' | '4/4'>(
    (savedHints?.timeSignatureHint as 'auto' | '3/4' | '4/4') || 'auto'
  );
  const [showHints, setShowHints] = useState(false);

  // Nudge scope: controls what the arrow buttons affect
  const [nudgeScope, setNudgeScope] = useState<import('../core/rhythmTypes').LyricCorrectionScope>('line');

  // Loop controls
  const [loopStartBar, setLoopStartBar] = useState('');
  const [loopEndBar, setLoopEndBar] = useState('');

  // Initialize preview player and load timeline when it changes
  useEffect(() => {
    let cancelled = false;

    const init = async () => {
      setLoading(true);
      try {
        if (!previewPlayerRef.current) {
          previewPlayerRef.current = new RhythmPreviewPlayer();
        }
        const player = previewPlayerRef.current;

        player.onTimeUpdate((state) => {
          if (!cancelled) setHearItState(state);
        });

        await player.loadTimeline(timeline);

        if (audioPath) {
          await player.loadSourceAudio(audioPath);
        }
      } catch (err) {
        console.error('[TimelineView] Failed to init preview player', err);
      }
      if (!cancelled) setLoading(false);
    };

    init();

    return () => {
      cancelled = true;
      previewPlayerRef.current?.removeTimeUpdateCallback();
    };
  }, [timeline, audioPath, previewPlayerRef]);

  // Reload timeline into player when edits change
  useEffect(() => {
    if (previewPlayerRef.current && timeline) {
      previewPlayerRef.current.loadTimeline(timeline);
    }
  }, [timeline.edits.length]);

  const player = previewPlayerRef.current;
  const activeChordId = hearItState?.activeChordId || null;
  const activeRowRef = useRef<HTMLDivElement | null>(null);
  const [autoScrollEnabled, setAutoScrollEnabled] = useState(true);
  const programmaticScrollRef = useRef(false);

  // Disable auto-scroll on user scroll, re-enable when playback stops
  useEffect(() => {
    const handleWheel = () => {
      if (!programmaticScrollRef.current) {
        setAutoScrollEnabled(false);
      }
    };
    window.addEventListener('wheel', handleWheel, { passive: true });
    return () => window.removeEventListener('wheel', handleWheel);
  }, []);

  // Re-enable auto-scroll when playback starts
  useEffect(() => {
    if (hearItState?.playing) {
      setAutoScrollEnabled(true);
    }
  }, [hearItState?.playing]);

  // Auto-scroll to keep active chord centered
  useEffect(() => {
    if (autoScrollEnabled && activeRowRef.current) {
      programmaticScrollRef.current = true;
      activeRowRef.current.scrollIntoView({ behavior: 'smooth', block: 'center' });
      setTimeout(() => { programmaticScrollRef.current = false; }, 500);
    }
  }, [activeChordId, autoScrollEnabled]);

  const handleSetChord = (eventId: string) => {
    if (!editSymbol.trim()) return;
    onEdit({ type: 'set_chord', eventId, symbol: editSymbol.trim() });
    setEditingId(null);
    setEditSymbol('');
  };

  const formatTime = (s: number) => {
    const min = Math.floor(s / 60);
    const sec = Math.floor(s % 60);
    return `${min}:${sec.toString().padStart(2, '0')}`;
  };

  return (
    <div>
      {/* Header row */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px' }}>
        <div>
          <h2 style={{ margin: 0, fontSize: '18px' }}>Chord Timeline</h2>
          <div style={{ fontSize: '11px', color: '#888', marginTop: '4px' }}>
            {timeline.beatGrid.tempo} BPM — {timeline.beatGrid.timeSignature.numerator}/{timeline.beatGrid.timeSignature.denominator} — {timeline.beatGrid.barCount} bars — {timeline.chords.length} chords — {timeline.edits.length} edits
          </div>
        </div>
        <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
          {/* Key transposition selector */}
          {timeline.keyRoot != null ? (
            <select
              value={timeline.keyRoot}
              onChange={(e) => {
                const newKeyRoot = parseInt(e.target.value, 10);
                if (newKeyRoot !== timeline.keyRoot) {
                  onEdit({ type: 'transpose_key', fromKeyRoot: timeline.keyRoot!, toKeyRoot: newKeyRoot });
                }
              }}
              style={{
                backgroundColor: '#333',
                color: '#eee',
                border: '1px solid #555',
                borderRadius: '4px',
                padding: '4px 8px',
                fontSize: '12px',
              }}
              title="Transpose to a different key"
            >
              {['C', 'C#/Db', 'D', 'D#/Eb', 'E', 'F', 'F#/Gb', 'G', 'G#/Ab', 'A', 'A#/Bb', 'B'].map((name, i) => (
                <option key={i} value={i}>Key: {name}</option>
              ))}
            </select>
          ) : (
            <span style={{ color: '#666', fontSize: '11px' }} title="Re-analyze to enable key transposition">
              No key data
            </span>
          )}
          {onReanalyze && (
            <button onClick={() => setShowHints(!showHints)} style={smallBtnStyle}>
              {showHints ? 'Hide Hints' : 'Re-analyze...'}
            </button>
          )}
          <button onClick={() => onPractice()} style={primaryBtnStyle}>
            Practice All
          </button>
        </div>
      </div>

      {/* ---- Analysis Hints Panel ---- */}
      {showHints && onReanalyze && (
        <div style={{
          display: 'flex',
          alignItems: 'center',
          gap: '12px',
          padding: '8px 12px',
          backgroundColor: '#2a2520',
          border: '1px solid #553',
          borderRadius: '6px',
          marginBottom: '8px',
          fontSize: '12px',
          flexWrap: 'wrap',
        }}>
          <label style={{ color: '#aa8', whiteSpace: 'nowrap' }}>Key:</label>
          <input
            value={hintKey}
            onChange={(e) => setHintKey(e.target.value)}
            placeholder="e.g. D, Am, Bb"
            style={{
              width: '70px',
              padding: '3px 6px',
              backgroundColor: '#333',
              border: '1px solid #555',
              borderRadius: '3px',
              color: '#eee',
              fontFamily: 'monospace',
              fontSize: '12px',
            }}
          />
          <label style={{ color: '#aa8', whiteSpace: 'nowrap' }}>Tempo:</label>
          <input
            value={hintTempo}
            onChange={(e) => setHintTempo(e.target.value)}
            placeholder="BPM"
            style={{
              width: '50px',
              padding: '3px 6px',
              backgroundColor: '#333',
              border: '1px solid #555',
              borderRadius: '3px',
              color: '#eee',
              fontFamily: 'monospace',
              fontSize: '12px',
            }}
          />
          <label style={{ color: '#aa8', whiteSpace: 'nowrap' }}>Time Sig:</label>
          <select
            value={hintTimeSig}
            onChange={(e) => setHintTimeSig(e.target.value as 'auto' | '3/4' | '4/4')}
            style={{
              padding: '3px 6px',
              backgroundColor: '#333',
              border: '1px solid #555',
              borderRadius: '3px',
              color: '#eee',
              fontFamily: 'monospace',
              fontSize: '12px',
            }}
          >
            <option value="auto">Auto</option>
            <option value="3/4">3/4 (Waltz)</option>
            <option value="4/4">4/4</option>
          </select>
          <button
            onClick={() => {
              const opts: AnalysisOptions = {};
              if (hintKey.trim()) opts.keyHint = hintKey.trim();
              if (hintTempo.trim()) {
                const t = parseFloat(hintTempo.trim());
                if (!isNaN(t) && t > 0) opts.tempoHint = t;
              }
              if (hintTimeSig !== 'auto') {
                const num = hintTimeSig === '3/4' ? 3 : 4;
                opts.timeSignatureHint = { numerator: num, denominator: 4 };
              }
              onReanalyze(opts);
              setShowHints(false);
            }}
            style={{ ...primaryBtnStyle, padding: '3px 12px', fontSize: '12px' }}
          >
            Re-analyze
          </button>
          <button
            onClick={() => { onReanalyze(); setShowHints(false); }}
            style={{ ...smallBtnStyle }}
          >
            No hints
          </button>
        </div>
      )}

      {/* ---- Nudge Scope Chooser ---- */}
      <div style={{
        display: 'flex',
        alignItems: 'center',
        gap: '8px',
        padding: '6px 12px',
        backgroundColor: '#252530',
        border: '1px solid #336',
        borderRadius: '6px',
        marginBottom: '8px',
        fontSize: '12px',
      }}>
        <span style={{ color: '#88a' }}>Arrow nudge scope:</span>
        {(['line', 'section_occurrence', 'global'] as const).map(s => {
          const labels: Record<string, string> = { line: 'This line', section_occurrence: 'This section', global: 'Global' };
          const isActive = nudgeScope === s;
          return (
            <button
              key={s}
              onClick={() => setNudgeScope(s)}
              style={{
                ...smallBtnStyle,
                backgroundColor: isActive ? '#2a2a3a' : 'transparent',
                borderColor: isActive ? '#88f' : '#444',
                color: isActive ? '#aaf' : '#666',
                fontWeight: isActive ? 700 : 400,
              }}
            >
              {labels[s]}
            </button>
          );
        })}
        <span style={{ color: '#555', fontSize: '11px', marginLeft: '4px' }}>
          {nudgeScope === 'line' ? 'Moves one lyric line' :
           nudgeScope === 'section_occurrence' ? 'Moves all lyrics in this section' :
           'Moves all lyrics in the song'}
        </span>
      </div>

      {/* ---- Hear It Transport Bar ---- */}
      <div style={{
        display: 'flex',
        alignItems: 'center',
        gap: '8px',
        padding: '8px 12px',
        backgroundColor: '#252525',
        border: '1px solid #333',
        borderRadius: '6px',
        marginBottom: '12px',
        fontSize: '12px',
      }}>
        {/* Play / Pause / Stop */}
        <button
          onClick={async () => {
            if (!player) return;
            if (hearItState?.playing) {
              player.pause();
            } else {
              await player.play();
            }
          }}
          disabled={loading || !player}
          style={{ ...smallBtnStyle, fontSize: '14px', padding: '2px 10px' }}
          title={hearItState?.playing ? 'Pause' : 'Play'}
        >
          {hearItState?.playing ? '⏸' : '▶'}
        </button>
        <button
          onClick={() => player?.stop()}
          disabled={!player}
          style={{ ...smallBtnStyle, fontSize: '14px', padding: '2px 10px' }}
          title="Stop"
        >
          ⏹
        </button>

        {/* Time display */}
        <span style={{ color: '#aaa', minWidth: '80px' }}>
          {hearItState ? `${formatTime(hearItState.currentTime)} / ${formatTime(hearItState.duration)}` : '--:-- / --:--'}
        </span>

        {/* Seek bar */}
        <input
          type="range"
          min={0}
          max={hearItState?.duration || 1}
          step={0.1}
          value={hearItState?.currentTime || 0}
          onChange={(e) => player?.seekTo(parseFloat(e.target.value))}
          style={{ flex: 1, accentColor: '#4a9', cursor: 'pointer' }}
        />

        {/* A/B mode toggle */}
        <div style={{
          display: 'flex',
          border: '1px solid #444',
          borderRadius: '4px',
          overflow: 'hidden',
        }}>
          <button
            onClick={() => player?.setMode('generated')}
            style={{
              ...smallBtnStyle,
              border: 'none',
              borderRadius: 0,
              backgroundColor: hearItState?.mode === 'generated' ? '#2a3a2a' : 'transparent',
              color: hearItState?.mode === 'generated' ? '#4a9' : '#666',
              fontWeight: hearItState?.mode === 'generated' ? 700 : 400,
            }}
          >
            Generated
          </button>
          <button
            onClick={() => player?.setMode('source')}
            disabled={!audioPath}
            style={{
              ...smallBtnStyle,
              border: 'none',
              borderRadius: 0,
              borderLeft: '1px solid #444',
              backgroundColor: hearItState?.mode === 'source' ? '#3a2a20' : 'transparent',
              color: hearItState?.mode === 'source' ? '#e8a' : '#666',
              fontWeight: hearItState?.mode === 'source' ? 700 : 400,
            }}
          >
            Source
          </button>
        </div>

        {/* Active chord display */}
        {hearItState?.activeChordId && (
          <span style={{
            padding: '2px 8px',
            backgroundColor: '#2a3a2a',
            border: '1px solid #4a9',
            borderRadius: '3px',
            color: '#4a9',
            fontWeight: 700,
            minWidth: '40px',
            textAlign: 'center',
          }}>
            {timeline.chords.find(c => c.id === hearItState.activeChordId)?.symbol || ''}
          </span>
        )}

        {/* Auto-scroll toggle */}
        {hearItState?.playing && !autoScrollEnabled && (
          <button
            onClick={() => setAutoScrollEnabled(true)}
            style={{
              ...smallBtnStyle,
              backgroundColor: '#3a3020',
              border: '1px solid #a84',
              color: '#e8a',
              fontSize: '11px',
              padding: '2px 8px',
            }}
            title="Resume auto-scrolling to current bar"
          >
            Auto-scroll
          </button>
        )}

        {/* Skipped chords indicator */}
        {hearItState && hearItState.skippedChords > 0 && (
          <span
            style={{ color: '#e84', fontSize: '11px' }}
            title={`${hearItState.skippedChords} chord(s) have no voicing and are silent in generated playback`}
          >
            {hearItState.skippedChords} skipped
          </span>
        )}
      </div>

      {/* ---- Loop Controls ---- */}
      <div style={{
        display: 'flex',
        alignItems: 'center',
        gap: '8px',
        padding: '6px 12px',
        backgroundColor: '#252525',
        border: '1px solid #333',
        borderRadius: '6px',
        marginBottom: '12px',
        fontSize: '12px',
      }}>
        <span style={{ color: '#888' }}>Loop:</span>
        <label style={{ color: '#aaa' }}>Start bar</label>
        <input
          type="number"
          min={1}
          max={timeline.beatGrid.barCount}
          value={loopStartBar}
          onChange={(e) => setLoopStartBar(e.target.value)}
          placeholder="1"
          style={{
            width: '50px',
            padding: '2px 6px',
            backgroundColor: '#333',
            border: '1px solid #555',
            borderRadius: '3px',
            color: '#eee',
            fontFamily: 'monospace',
            fontSize: '12px',
          }}
        />
        <label style={{ color: '#aaa' }}>End bar</label>
        <input
          type="number"
          min={1}
          max={timeline.beatGrid.barCount}
          value={loopEndBar}
          onChange={(e) => setLoopEndBar(e.target.value)}
          placeholder={String(timeline.beatGrid.barCount)}
          style={{
            width: '50px',
            padding: '2px 6px',
            backgroundColor: '#333',
            border: '1px solid #555',
            borderRadius: '3px',
            color: '#eee',
            fontFamily: 'monospace',
            fontSize: '12px',
          }}
        />
        <button
          onClick={() => {
            const start = parseInt(loopStartBar) || 1;
            const end = parseInt(loopEndBar) || timeline.beatGrid.barCount;
            if (start >= 1 && end >= start && end <= timeline.beatGrid.barCount) {
              player?.setLoopBars(start, end);
            }
          }}
          disabled={!player}
          style={{ ...primaryBtnStyle, padding: '2px 10px', fontSize: '12px' }}
        >
          Set Loop
        </button>
        <button
          onClick={() => {
            player?.setLoop(null);
            setLoopStartBar('');
            setLoopEndBar('');
          }}
          disabled={!player || !hearItState?.loopRange}
          style={{ ...smallBtnStyle }}
        >
          Clear Loop
        </button>
        {hearItState?.loopRange && (
          <span style={{ color: '#4a9', fontSize: '11px' }}>
            Looping {formatTime(hearItState.loopRange.startTime)}–{formatTime(hearItState.loopRange.endTime)}
          </span>
        )}
      </div>

      {/* Chord events table */}
      <div style={{
        display: 'grid',
        gridTemplateColumns: '40px 55px 60px 90px 1fr 36px 30px',
        gap: '1px',
        backgroundColor: '#333',
        border: '1px solid #333',
        borderRadius: '4px',
        overflow: 'hidden',
        fontSize: '12px',
      }}>
        {/* Header */}
        {['Bar', 'Time', 'Chord', 'Section', 'Lyrics', '', ''].map((h, i) => (
          <div key={i} style={{ padding: '6px 8px', backgroundColor: '#2a2a2a', color: '#888', fontWeight: 600 }}>
            {h}
          </div>
        ))}

        {/* Rows */}
        {timeline.chords.map((chord, idx) => {
          const isActive = chord.id === activeChordId;
          const rowBg = isActive ? '#1a2e1a' : '#222';
          const prevSection = idx > 0 ? timeline.chords[idx - 1].section : undefined;
          const showSection = chord.section && chord.section !== prevSection;

          return (
            <React.Fragment key={chord.id}>
              <div ref={isActive ? activeRowRef : undefined} style={{ ...cellStyle, backgroundColor: rowBg, color: '#888' }}>{chord.barStart}</div>
              <div style={{ ...cellStyle, backgroundColor: rowBg, color: '#888' }}>{chord.startTime.toFixed(1)}s</div>
              <div style={{
                ...cellStyle,
                backgroundColor: rowBg,
                fontWeight: 700,
                color: isActive ? '#5fb' : chord.source === 'manual' ? '#e8a' : '#4a9',
              }}>
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
                      width: '50px',
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
              <div style={{
                ...cellStyle,
                backgroundColor: showSection ? '#2a2a30' : rowBg,
                color: '#8af',
                fontWeight: showSection ? 600 : 400,
                fontSize: '11px',
              }}>
                {showSection ? chord.section : ''}
              </div>
              <div style={{
                ...cellStyle,
                backgroundColor: rowBg,
                color: isActive ? '#eee' : '#aaa',
                fontStyle: chord.lyrics ? 'italic' : 'normal',
              }}>
                {chord.lyrics || ''}
              </div>
              <div style={{ ...cellStyle, backgroundColor: rowBg, display: 'flex', gap: '2px', padding: '4px 2px' }}>
                {(chord.lyrics || nudgeScope !== 'line') && (
                  <>
                    <button
                      onClick={() => onMoveLyrics(idx, -1, nudgeScope)}
                      disabled={idx === 0}
                      style={{ ...arrowBtnStyle, opacity: idx === 0 ? 0.3 : 1 }}
                      title={nudgeScope === 'line' ? 'Move lyrics up one bar' :
                             nudgeScope === 'section_occurrence' ? 'Shift section up one bar' :
                             'Shift all lyrics up one bar'}
                    >
                      ▲
                    </button>
                    <button
                      onClick={() => onMoveLyrics(idx, 1, nudgeScope)}
                      disabled={idx >= timeline.chords.length - 1}
                      style={{ ...arrowBtnStyle, opacity: idx >= timeline.chords.length - 1 ? 0.3 : 1 }}
                      title={nudgeScope === 'line' ? 'Move lyrics down one bar' :
                             nudgeScope === 'section_occurrence' ? 'Shift section down one bar' :
                             'Shift all lyrics down one bar'}
                    >
                      ▼
                    </button>
                  </>
                )}
              </div>
              <div style={{ ...cellStyle, backgroundColor: rowBg }}>
                <button
                  onClick={() => {
                    player?.seekTo(chord.startTime);
                    if (!hearItState?.playing) player?.play();
                  }}
                  style={{ ...smallBtnStyle, fontSize: '10px', padding: '1px 4px' }}
                  title="Play from here"
                >
                  ▶
                </button>
              </div>
            </React.Fragment>
          );
        })}
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
