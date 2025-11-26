/**
 * Progress Tracker
 *
 * Tracks user performance and controls automatic progression
 * Monitors accuracy over time and tightens distribution when appropriate
 */

import type { AppConfig } from '../config/AppConfig';
import { saveConfig } from '../config/AppConfig';
import { AdaptiveKeyMapper } from './AdaptiveKeyMapper';
import { ReferenceMelodyPlayer } from './ReferenceMelody';

export interface PerformanceStats {
  // Total notes played
  totalNotes: number;
  // Average accuracy (0-1)
  averageAccuracy: number;
  // Recent accuracy (last N notes)
  recentAccuracy: number;
  // Current streak of good notes
  currentStreak: number;
  // Best streak achieved
  bestStreak: number;
  // Time spent practicing (seconds)
  practiceTime: number;
  // Progress percentage (0-100)
  progress: number;
}

interface NotePerformance {
  accuracy: number;
  timestamp: number;
}

export class ProgressTracker {
  private config: AppConfig;
  private keyMapper: AdaptiveKeyMapper;
  private referenceMelody: ReferenceMelodyPlayer | null = null;

  // Performance tracking
  private noteHistory: NotePerformance[] = [];
  private currentStreak = 0;
  private bestStreak = 0;
  private startTime: number = Date.now();
  private totalPracticeTime = 0;
  private lastUpdateTime: number = Date.now();

  constructor(
    config: AppConfig,
    keyMapper: AdaptiveKeyMapper,
    referenceMelody?: ReferenceMelodyPlayer
  ) {
    this.config = config;
    this.keyMapper = keyMapper;
    this.referenceMelody = referenceMelody || null;
  }

  /**
   * Record a note performance
   *
   * @param accuracy - Accuracy score (0-1)
   */
  recordNote(accuracy: number): void {
    const now = Date.now();

    // Add to history
    this.noteHistory.push({
      accuracy,
      timestamp: now,
    });

    // Update streak
    if (accuracy > 0.8) {
      // Good note
      this.currentStreak++;
      this.bestStreak = Math.max(this.bestStreak, this.currentStreak);
    } else {
      this.currentStreak = 0;
    }

    // Trigger automatic progression check
    if (this.config.progression.autoMode) {
      this.checkAndUpdateProgression();
    }

    // Update reference melody volume
    if (this.referenceMelody) {
      const avgAccuracy = this.getAverageAccuracy();
      this.referenceMelody.fadeBasedOnAccuracy(avgAccuracy);
    }
  }

  /**
   * Check if progression should occur and update distribution
   */
  private checkAndUpdateProgression(): void {
    const recentAccuracy = this.getRecentAccuracy();

    // If recent accuracy is above threshold, tighten distribution
    if (
      recentAccuracy > this.config.progression.accuracyThreshold &&
      this.noteHistory.length >= this.config.progression.consistencyWindow
    ) {
      this.keyMapper.tightenDistribution();
    }
  }

  /**
   * Get average accuracy across all notes
   */
  private getAverageAccuracy(): number {
    if (this.noteHistory.length === 0) return 0;

    const sum = this.noteHistory.reduce((acc, note) => acc + note.accuracy, 0);
    return sum / this.noteHistory.length;
  }

  /**
   * Get recent accuracy (last N notes based on consistency window)
   */
  private getRecentAccuracy(): number {
    const window = this.config.progression.consistencyWindow;
    if (this.noteHistory.length === 0) return 0;

    const recentNotes = this.noteHistory.slice(-window);
    const sum = recentNotes.reduce((acc, note) => acc + note.accuracy, 0);
    return sum / recentNotes.length;
  }

  /**
   * Get current performance statistics
   */
  getStats(): PerformanceStats {
    const now = Date.now();
    const sessionTime = (now - this.lastUpdateTime) / 1000;
    this.totalPracticeTime += sessionTime;
    this.lastUpdateTime = now;

    return {
      totalNotes: this.noteHistory.length,
      averageAccuracy: this.getAverageAccuracy(),
      recentAccuracy: this.getRecentAccuracy(),
      currentStreak: this.currentStreak,
      bestStreak: this.bestStreak,
      practiceTime: this.totalPracticeTime,
      progress: this.keyMapper.getProgress() * 100,
    };
  }

  /**
   * Reset all progress
   */
  reset(): void {
    this.noteHistory = [];
    this.currentStreak = 0;
    this.bestStreak = 0;
    this.startTime = Date.now();
    this.totalPracticeTime = 0;
    this.lastUpdateTime = Date.now();
    this.keyMapper.reset();
  }

  /**
   * Save progress to localStorage
   */
  saveProgress(): void {
    if (!this.config.progression.persistProgress) return;

    const progressData = {
      noteHistory: this.noteHistory,
      currentStreak: this.currentStreak,
      bestStreak: this.bestStreak,
      totalPracticeTime: this.totalPracticeTime,
      keyMapperState: this.keyMapper.serialize(),
      lastSaved: Date.now(),
    };

    localStorage.setItem('musicLearningAppProgress', JSON.stringify(progressData));
    saveConfig(this.config);
  }

  /**
   * Load progress from localStorage
   */
  loadProgress(): boolean {
    if (!this.config.progression.persistProgress) return false;

    try {
      const saved = localStorage.getItem('musicLearningAppProgress');
      if (!saved) return false;

      const progressData = JSON.parse(saved);

      this.noteHistory = progressData.noteHistory || [];
      this.currentStreak = progressData.currentStreak || 0;
      this.bestStreak = progressData.bestStreak || 0;
      this.totalPracticeTime = progressData.totalPracticeTime || 0;
      this.lastUpdateTime = Date.now();

      if (progressData.keyMapperState) {
        this.keyMapper.deserialize(progressData.keyMapperState);
      }

      return true;
    } catch (err) {
      console.error('Failed to load progress:', err);
      return false;
    }
  }

  /**
   * Update configuration
   */
  updateConfig(config: AppConfig): void {
    this.config = config;
  }

  /**
   * Set reference melody player (for volume fading)
   */
  setReferenceMelody(referenceMelody: ReferenceMelodyPlayer): void {
    this.referenceMelody = referenceMelody;
  }

  /**
   * Get note history for visualization/analysis
   */
  getNoteHistory(): NotePerformance[] {
    return this.noteHistory;
  }

  /**
   * Manually trigger progression (for manual mode)
   *
   * @param amount - Amount to tighten (optional)
   */
  manualProgressionStep(amount?: number): void {
    this.keyMapper.tightenDistribution(amount);
  }
}
