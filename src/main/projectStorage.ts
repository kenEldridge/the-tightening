/**
 * Project Storage
 *
 * Persists PracticeProjectLite artifacts to disk (Electron userData).
 * Runs in the main process, accessed via IPC from renderer.
 */

import path from 'path';
import fs from 'fs';
import { app } from 'electron';
import type { PracticeProjectLite, ChordTimelineArtifact } from '../core/rhythmTypes';
import { loggers } from '../utils/logger';

const PROJECTS_DIR_NAME = 'rhythm-projects';

function getProjectsDir(): string {
  const dir = path.join(app.getPath('userData'), PROJECTS_DIR_NAME);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  return dir;
}

function getProjectPath(projectId: string): string {
  return path.join(getProjectsDir(), `${projectId}.json`);
}

function generateId(): string {
  return `proj_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

/**
 * Create a new project
 */
export function createProject(input: {
  name: string;
  sourceType: 'youtube' | 'local_file';
  sourceUri: string;
  sourceTitle: string;
  sourceDuration?: number;
}): PracticeProjectLite {
  const now = new Date().toISOString();
  const project: PracticeProjectLite = {
    id: generateId(),
    name: input.name,
    source: {
      type: input.sourceType,
      uri: input.sourceUri,
      title: input.sourceTitle,
      duration: input.sourceDuration,
    },
    audioPath: null,
    timeline: null,
    createdAt: now,
    lastOpenedAt: now,
  };

  const filePath = getProjectPath(project.id);
  fs.writeFileSync(filePath, JSON.stringify(project, null, 2));
  loggers.main.info('[ProjectStorage] Created project', { id: project.id, name: project.name });
  return project;
}

/**
 * Load a project by ID
 */
export function loadProject(projectId: string): PracticeProjectLite | null {
  const filePath = getProjectPath(projectId);
  if (!fs.existsSync(filePath)) {
    loggers.main.warn('[ProjectStorage] Project not found', { projectId });
    return null;
  }

  try {
    const data = JSON.parse(fs.readFileSync(filePath, 'utf-8')) as PracticeProjectLite;
    // Update last opened
    data.lastOpenedAt = new Date().toISOString();
    fs.writeFileSync(filePath, JSON.stringify(data, null, 2));
    return data;
  } catch (err) {
    loggers.main.error('[ProjectStorage] Failed to load project', {
      projectId,
      error: (err as Error).message,
    });
    return null;
  }
}

/**
 * List all projects (summary only)
 */
export function listProjects(): Array<{
  id: string;
  name: string;
  sourceType: string;
  sourceTitle: string;
  hasTimeline: boolean;
  createdAt: string;
  lastOpenedAt: string;
}> {
  const dir = getProjectsDir();
  const files = fs.readdirSync(dir).filter(f => f.endsWith('.json'));

  return files
    .map(file => {
      try {
        const data = JSON.parse(
          fs.readFileSync(path.join(dir, file), 'utf-8')
        ) as PracticeProjectLite;
        return {
          id: data.id,
          name: data.name,
          sourceType: data.source.type,
          sourceTitle: data.source.title,
          hasTimeline: data.timeline !== null,
          createdAt: data.createdAt,
          lastOpenedAt: data.lastOpenedAt,
        };
      } catch {
        return null;
      }
    })
    .filter((p): p is NonNullable<typeof p> => p !== null)
    .sort((a, b) => new Date(b.lastOpenedAt).getTime() - new Date(a.lastOpenedAt).getTime());
}

/**
 * Update a project's audio path
 */
export function setProjectAudioPath(projectId: string, audioPath: string): boolean {
  const project = loadProject(projectId);
  if (!project) return false;

  project.audioPath = audioPath;
  project.lastOpenedAt = new Date().toISOString();
  fs.writeFileSync(getProjectPath(projectId), JSON.stringify(project, null, 2));
  loggers.main.info('[ProjectStorage] Set audio path', { projectId, audioPath });
  return true;
}

/**
 * Save a timeline artifact to a project
 */
export function saveProjectTimeline(
  projectId: string,
  timeline: ChordTimelineArtifact
): boolean {
  const project = loadProject(projectId);
  if (!project) return false;

  project.timeline = timeline;
  project.lastOpenedAt = new Date().toISOString();
  timeline.modifiedAt = new Date().toISOString();
  fs.writeFileSync(getProjectPath(projectId), JSON.stringify(project, null, 2));
  loggers.main.info('[ProjectStorage] Saved timeline', {
    projectId,
    chordCount: timeline.chords.length,
    barCount: timeline.beatGrid.barCount,
  });
  return true;
}

/**
 * Save cached lyrics to a project
 */
export function saveProjectLyrics(
  projectId: string,
  lyricsData: string | { lyrics?: string; syncedLyrics?: string; lyricsBarOffset?: number },
): boolean {
  const project = loadProject(projectId);
  if (!project) return false;

  const payload = typeof lyricsData === 'string' ? { lyrics: lyricsData } : lyricsData;
  if (payload.lyrics !== undefined) {
    project.cachedLyrics = payload.lyrics;
  }
  if (payload.syncedLyrics !== undefined) {
    project.cachedSyncedLyrics = payload.syncedLyrics;
  }
  if (payload.lyricsBarOffset !== undefined && Number.isFinite(payload.lyricsBarOffset)) {
    project.lyricsBarOffset = Math.trunc(payload.lyricsBarOffset);
  }
  project.lastOpenedAt = new Date().toISOString();

  fs.writeFileSync(getProjectPath(projectId), JSON.stringify(project, null, 2));
  loggers.main.info('[ProjectStorage] Saved cached lyrics', {
    projectId,
    hasLyrics: typeof payload.lyrics === 'string',
    hasSyncedLyrics: typeof payload.syncedLyrics === 'string',
    lyricsBarOffset: project.lyricsBarOffset ?? 0,
  });
  return true;
}

/**
 * Delete a project
 */
export function deleteProject(projectId: string): boolean {
  const filePath = getProjectPath(projectId);
  if (!fs.existsSync(filePath)) return false;

  fs.unlinkSync(filePath);
  loggers.main.info('[ProjectStorage] Deleted project', { projectId });
  return true;
}
