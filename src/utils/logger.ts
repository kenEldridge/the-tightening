/**
 * Centralized Logging System
 *
 * Uses electron-log for persistent file-based logging across both
 * Electron main and renderer processes.
 *
 * Log files location:
 * - Windows: %APPDATA%\the-tightening\logs\
 * - macOS: ~/Library/Logs/the-tightening/
 * - Linux: ~/.config/the-tightening/logs/
 */

import log from 'electron-log';

/**
 * Initialize the logging system
 * Should be called once in main process and once in renderer
 */
export function initializeLogger() {
  const isProduction = process.env.NODE_ENV === 'production';

  // ===== FILE TRANSPORT (Persistent logs) =====
  log.transports.file.level = isProduction ? 'info' : 'debug';
  log.transports.file.maxSize = 5 * 1024 * 1024; // 5 MB
  log.transports.file.format = '[{y}-{m}-{d} {h}:{i}:{s}.{ms}] [{level}] [{scope}] {text}';
  log.transports.file.sync = false; // Async for performance

  // ===== CONSOLE TRANSPORT (Dev tools / terminal) =====
  log.transports.console.level = isProduction ? 'warn' : 'debug';
  log.transports.console.format = '[{h}:{i}:{s}] [{level}] [{scope}] {text}';
  log.transports.console.useStyles = true; // Colorized output

  // Log initialization
  log.info('Logger initialized', {
    logPath: log.transports.file.getFile().path,
    mode: isProduction ? 'production' : 'development',
    fileLevel: log.transports.file.level,
    consoleLevel: log.transports.console.level
  });

  return log;
}

/**
 * Scoped loggers for different components
 * Use these throughout the app for automatic source tagging
 */
export const loggers = {
  app: log.scope('App'),
  audio: log.scope('AudioEngine'),
  midi: log.scope('MIDI'),
  reference: log.scope('ReferenceMelody'),
  progress: log.scope('ProgressTracker'),
  keyMapper: log.scope('KeyMapper'),
  config: log.scope('Config'),
  song: log.scope('SongLoader'),
  main: log.scope('Main'),
  ui: log.scope('UI')
};

/**
 * Log with metadata (helper for structured logging)
 */
export function logWithMetadata(
  logger: typeof log,
  level: 'info' | 'debug' | 'warn' | 'error',
  message: string,
  metadata?: Record<string, any>
) {
  if (metadata) {
    logger[level](message, metadata);
  } else {
    logger[level](message);
  }
}

/**
 * Log performance metrics (helper for timing operations)
 */
export function logPerformance(
  logger: typeof log,
  operation: string,
  startTime: number,
  metadata?: Record<string, any>
) {
  const duration = Date.now() - startTime;
  logger.debug(`${operation} completed in ${duration}ms`, metadata);
}

/**
 * Log Tone.js Transport state (helper for debugging timing issues)
 */
export function logTransportState(Transport: any) {
  loggers.reference.debug('Transport state', {
    state: Transport.state,
    seconds: Transport.seconds,
    bpm: Transport.bpm.value,
    timeSignature: Transport.timeSignature
  });
}

// Export the base log object for direct use if needed
export default log;
