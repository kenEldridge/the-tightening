/**
 * YouTube Extractor
 *
 * Extracts audio from YouTube videos using yt-dlp.
 * Runs in the Electron main process.
 */

import { app } from 'electron';
import path from 'path';
import fs from 'fs';
import { createRequire } from 'module';
import { loggers } from '../utils/logger';
import { classifyError } from './extractionErrors';
import type { ExtractionError } from '../core/rhythmTypes';

// yt-dlp-wrap is CommonJS
const require = createRequire(import.meta.url);
const YTDlpWrap = require('yt-dlp-wrap').default;

export interface ExtractionProgress {
  status: 'downloading' | 'extracting' | 'complete' | 'error';
  progress?: number; // 0-100
  message?: string;
  outputPath?: string;
  videoInfo?: VideoInfo;
  /** Typed error info when status === 'error' */
  typedError?: ExtractionError;
}

export interface VideoInfo {
  title: string;
  duration: number; // seconds
  thumbnail?: string;
  uploader?: string;
}

export class YouTubeExtractor {
  private ytDlp: any;
  private outputDir: string;
  private binaryPath: string;

  constructor() {
    // Store extracted audio in app's user data directory
    this.outputDir = path.join(app.getPath('userData'), 'extracted-audio');
    this.binaryPath = path.join(app.getPath('userData'), 'yt-dlp', process.platform === 'win32' ? 'yt-dlp.exe' : 'yt-dlp');

    // Ensure output directory exists
    if (!fs.existsSync(this.outputDir)) {
      fs.mkdirSync(this.outputDir, { recursive: true });
    }
  }

  /**
   * Initialize yt-dlp (download binary if needed)
   */
  async initialize(): Promise<boolean> {
    try {
      // Check if binary exists
      if (!fs.existsSync(this.binaryPath)) {
        loggers.main.info('[YouTubeExtractor] Downloading yt-dlp binary...');

        // Ensure directory exists
        const binDir = path.dirname(this.binaryPath);
        if (!fs.existsSync(binDir)) {
          fs.mkdirSync(binDir, { recursive: true });
        }

        // Download the binary
        await YTDlpWrap.downloadFromGithub(this.binaryPath);
        loggers.main.info('[YouTubeExtractor] yt-dlp binary downloaded', { path: this.binaryPath });
      }

      this.ytDlp = new YTDlpWrap(this.binaryPath);
      loggers.main.info('[YouTubeExtractor] Initialized', { binaryPath: this.binaryPath });
      return true;
    } catch (err) {
      const error = err as Error;
      loggers.main.error('[YouTubeExtractor] Initialization failed', { error: error.message });
      return false;
    }
  }

  /**
   * Get video information without downloading
   */
  async getVideoInfo(url: string): Promise<VideoInfo | null> {
    try {
      if (!this.ytDlp) {
        await this.initialize();
      }

      const info = await this.ytDlp.getVideoInfo(url);

      return {
        title: info.title || 'Unknown',
        duration: info.duration || 0,
        thumbnail: info.thumbnail,
        uploader: info.uploader,
      };
    } catch (err) {
      const error = err as Error;
      loggers.main.error('[YouTubeExtractor] Failed to get video info', { url, error: error.message });
      return null;
    }
  }

  /**
   * Extract audio from a YouTube URL
   * @param url YouTube video URL
   * @param onProgress Progress callback
   * @returns Path to extracted audio file
   */
  async extractAudio(
    url: string,
    onProgress?: (progress: ExtractionProgress) => void
  ): Promise<string | null> {
    try {
      if (!this.ytDlp) {
        const initialized = await this.initialize();
        if (!initialized) {
          onProgress?.({ status: 'error', message: 'Failed to initialize yt-dlp' });
          return null;
        }
      }

      // Get video info first
      onProgress?.({ status: 'downloading', progress: 0, message: 'Getting video info...' });
      const videoInfo = await this.getVideoInfo(url);

      if (!videoInfo) {
        const typedError = classifyError(new Error('Failed to get video info - video may be unavailable'));
        onProgress?.({ status: 'error', message: typedError.message, typedError });
        return null;
      }

      loggers.main.info('[YouTubeExtractor] Starting extraction', { url, title: videoInfo.title });
      onProgress?.({ status: 'downloading', progress: 5, message: `Downloading: ${videoInfo.title}`, videoInfo });

      // Generate output filename from video ID
      const videoId = this.extractVideoId(url) || Date.now().toString();
      const outputPath = path.join(this.outputDir, `${videoId}.wav`);

      // Check if already extracted
      if (fs.existsSync(outputPath)) {
        loggers.main.info('[YouTubeExtractor] Using cached audio', { path: outputPath });
        onProgress?.({ status: 'complete', progress: 100, outputPath, videoInfo });
        return outputPath;
      }

      // Download and extract audio
      // Using WAV format for best compatibility with Web Audio API
      const args = [
        url,
        '-x', // Extract audio
        '--audio-format', 'wav',
        '--audio-quality', '0', // Best quality
        '-o', outputPath,
        '--no-playlist', // Don't download playlists
        '--no-warnings',
      ];

      return new Promise((resolve, reject) => {
        let lastProgress = 0;

        const process = this.ytDlp.exec(args)
          .on('progress', (progress: any) => {
            // yt-dlp reports download progress
            const percent = progress.percent || 0;
            if (percent > lastProgress) {
              lastProgress = percent;
              onProgress?.({
                status: 'downloading',
                progress: Math.min(95, 5 + percent * 0.9), // Reserve last 5% for extraction
                message: `Downloading: ${percent.toFixed(0)}%`,
                videoInfo,
              });
            }
          })
          .on('error', (err: Error) => {
            loggers.main.error('[YouTubeExtractor] Extraction failed', { error: err.message });
            const typedError = classifyError(err);
            onProgress?.({ status: 'error', message: typedError.message, typedError });
            reject(err);
          })
          .on('close', () => {
            if (fs.existsSync(outputPath)) {
              loggers.main.info('[YouTubeExtractor] Extraction complete', { path: outputPath });
              onProgress?.({ status: 'complete', progress: 100, outputPath, videoInfo });
              resolve(outputPath);
            } else {
              const error = new Error('Output file not created');
              const typedError = classifyError(error);
              loggers.main.error('[YouTubeExtractor] Extraction failed', { error: error.message });
              onProgress?.({ status: 'error', message: typedError.message, typedError });
              reject(error);
            }
          });
      });
    } catch (err) {
      const error = err as Error;
      loggers.main.error('[YouTubeExtractor] Extraction error', { error: error.message });
      const typedError = classifyError(error);
      onProgress?.({ status: 'error', message: typedError.message, typedError });
      return null;
    }
  }

  /**
   * Extract video ID from YouTube URL
   */
  private extractVideoId(url: string): string | null {
    const patterns = [
      /(?:youtube\.com\/watch\?v=|youtu\.be\/|youtube\.com\/embed\/)([^&\n?#]+)/,
      /youtube\.com\/shorts\/([^&\n?#]+)/,
    ];

    for (const pattern of patterns) {
      const match = url.match(pattern);
      if (match) return match[1];
    }

    return null;
  }

  /**
   * Clean up extracted audio files
   */
  cleanupOldFiles(maxAgeHours: number = 24): void {
    try {
      const files = fs.readdirSync(this.outputDir);
      const now = Date.now();
      const maxAgeMs = maxAgeHours * 60 * 60 * 1000;

      for (const file of files) {
        const filePath = path.join(this.outputDir, file);
        const stats = fs.statSync(filePath);
        if (now - stats.mtimeMs > maxAgeMs) {
          fs.unlinkSync(filePath);
          loggers.main.info('[YouTubeExtractor] Cleaned up old file', { file });
        }
      }
    } catch (err) {
      // Ignore cleanup errors
    }
  }

  /**
   * Get the output directory path
   */
  getOutputDir(): string {
    return this.outputDir;
  }

  /**
   * Download video file (for frame extraction)
   */
  async downloadVideo(
    url: string,
    onProgress?: (progress: ExtractionProgress) => void
  ): Promise<string | null> {
    try {
      if (!this.ytDlp) {
        const initialized = await this.initialize();
        if (!initialized) {
          onProgress?.({ status: 'error', message: 'Failed to initialize yt-dlp' });
          return null;
        }
      }

      const videoId = this.extractVideoId(url) || Date.now().toString();
      const videoPath = path.join(this.outputDir, `${videoId}.mp4`);

      // Check if already downloaded
      if (fs.existsSync(videoPath)) {
        loggers.main.info('[YouTubeExtractor] Using cached video', { path: videoPath });
        return videoPath;
      }

      onProgress?.({ status: 'downloading', progress: 0, message: 'Downloading video...' });

      const args = [
        url,
        '-f', 'mp4[height<=720]/best[height<=720]', // 720p max to save space
        '-o', videoPath,
        '--no-playlist',
        '--no-warnings',
      ];

      return new Promise((resolve, reject) => {
        this.ytDlp.exec(args)
          .on('progress', (progress: any) => {
            onProgress?.({
              status: 'downloading',
              progress: progress.percent || 0,
              message: `Downloading video: ${(progress.percent || 0).toFixed(0)}%`,
            });
          })
          .on('error', (err: Error) => {
            loggers.main.error('[YouTubeExtractor] Video download failed', { error: err.message });
            reject(err);
          })
          .on('close', () => {
            if (fs.existsSync(videoPath)) {
              loggers.main.info('[YouTubeExtractor] Video downloaded', { path: videoPath });
              resolve(videoPath);
            } else {
              reject(new Error('Video file not created'));
            }
          });
      });
    } catch (err) {
      const error = err as Error;
      loggers.main.error('[YouTubeExtractor] Video download error', { error: error.message });
      return null;
    }
  }

  /**
   * Extract frames from video at specific timestamps using ffmpeg
   */
  async extractFrames(
    videoPath: string,
    timestamps: number[], // Array of timestamps in seconds
    onProgress?: (progress: { current: number; total: number }) => void
  ): Promise<string[]> {
    const { execSync } = require('child_process');
    const frames: string[] = [];
    const videoId = path.basename(videoPath, '.mp4');
    const framesDir = path.join(this.outputDir, 'frames', videoId);

    // Ensure frames directory exists
    if (!fs.existsSync(framesDir)) {
      fs.mkdirSync(framesDir, { recursive: true });
    }

    for (let i = 0; i < timestamps.length; i++) {
      const timestamp = timestamps[i];
      const framePath = path.join(framesDir, `frame_${timestamp.toFixed(2).replace('.', '_')}.jpg`);

      // Skip if already extracted
      if (fs.existsSync(framePath)) {
        frames.push(framePath);
        continue;
      }

      try {
        // Use ffmpeg to extract single frame
        const cmd = `ffmpeg -ss ${timestamp} -i "${videoPath}" -vframes 1 -q:v 2 "${framePath}" -y`;
        execSync(cmd, { stdio: 'pipe' });
        frames.push(framePath);

        onProgress?.({ current: i + 1, total: timestamps.length });
      } catch (err) {
        loggers.main.warn('[YouTubeExtractor] Frame extraction failed', { timestamp, error: (err as Error).message });
        // Continue with other frames
      }
    }

    loggers.main.info('[YouTubeExtractor] Frames extracted', { count: frames.length, total: timestamps.length });
    return frames;
  }

  /**
   * Get video path for a given URL (if already downloaded)
   */
  getVideoPath(url: string): string | null {
    const videoId = this.extractVideoId(url);
    if (!videoId) return null;

    const videoPath = path.join(this.outputDir, `${videoId}.mp4`);
    return fs.existsSync(videoPath) ? videoPath : null;
  }
}

// Singleton instance
let extractorInstance: YouTubeExtractor | null = null;

export function getYouTubeExtractor(): YouTubeExtractor {
  if (!extractorInstance) {
    extractorInstance = new YouTubeExtractor();
  }
  return extractorInstance;
}
