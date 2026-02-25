/**
 * Extraction Error Classification
 *
 * Classifies raw errors from yt-dlp, ffmpeg, and analysis into
 * typed ExtractionError objects with actionable recovery paths.
 */

import type { ExtractionError } from '../core/rhythmTypes';

/**
 * Classify a raw error message into a typed ExtractionError
 */
export function classifyError(err: Error | string): ExtractionError {
  const message = typeof err === 'string' ? err : err.message;
  const lower = message.toLowerCase();

  // DNS / network errors
  if (
    lower.includes('getaddrinfo') ||
    lower.includes('dns') ||
    lower.includes('enotfound') ||
    lower.includes('network is unreachable') ||
    lower.includes('no internet')
  ) {
    return {
      code: 'network_dns',
      message: 'Network error — cannot reach server',
      detail: message,
      recoverable: true,
      fallback: 'import_local',
    };
  }

  // Download failures (yt-dlp specific)
  if (
    lower.includes('unable to download') ||
    lower.includes('video unavailable') ||
    lower.includes('private video') ||
    lower.includes('403') ||
    lower.includes('404') ||
    lower.includes('sign in') ||
    lower.includes('http error') ||
    lower.includes('urlopen error')
  ) {
    return {
      code: 'download_failed',
      message: 'Download failed — video may be unavailable or restricted',
      detail: message,
      recoverable: true,
      fallback: 'import_local',
    };
  }

  // ffmpeg missing
  if (
    lower.includes('ffmpeg') && (lower.includes('not found') || lower.includes('enoent')) ||
    lower.includes('ffprobe') && lower.includes('not found')
  ) {
    return {
      code: 'ffmpeg_missing',
      message: 'ffmpeg not found — install ffmpeg and ensure it is on your PATH',
      detail: message,
      recoverable: false,
    };
  }

  // File not found
  if (
    lower.includes('enoent') ||
    lower.includes('no such file') ||
    lower.includes('file not found')
  ) {
    return {
      code: 'file_not_found',
      message: 'File not found',
      detail: message,
      recoverable: true,
      fallback: 'import_local',
    };
  }

  // Invalid format
  if (
    lower.includes('invalid data') ||
    lower.includes('unsupported') ||
    lower.includes('codec') ||
    lower.includes('corrupt')
  ) {
    return {
      code: 'invalid_format',
      message: 'Audio file format not supported or file is corrupted',
      detail: message,
      recoverable: true,
      fallback: 'import_local',
    };
  }

  // Analysis failure
  if (
    lower.includes('analysis') ||
    lower.includes('analyzer') ||
    lower.includes('detection failed')
  ) {
    return {
      code: 'analysis_failed',
      message: 'Audio analysis failed',
      detail: message,
      recoverable: true,
      fallback: 'retry',
    };
  }

  // Fallthrough
  return {
    code: 'unknown',
    message: 'An unexpected error occurred',
    detail: message,
    recoverable: false,
  };
}

/**
 * Get a user-friendly description of a fallback action
 */
export function getFallbackDescription(fallback: ExtractionError['fallback']): string {
  switch (fallback) {
    case 'import_local':
      return 'Try importing a local audio or video file instead';
    case 'retry':
      return 'Try again — the error may be temporary';
    case 'manual_entry':
      return 'Enter chord data manually';
    default:
      return '';
  }
}
