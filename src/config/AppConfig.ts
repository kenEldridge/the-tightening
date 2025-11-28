/**
 * Central Configuration System
 *
 * This file contains ALL tunable parameters for the music learning app.
 * Adjust these values to control behavior, audio feedback, visual effects, and progression.
 */

// import { loggers } from '../utils/logger'; // REMOVED - causes renderer blocking

export interface AppConfig {
  // ============================================
  // DISTRIBUTION SYSTEM
  // ============================================
  distribution: {
    // Initial distribution width (standard deviation in semitones)
    // Higher = more keys accept input, Lower = tighter constraint
    initialWidth: number; // Default: 44 (covers all 88 keys)

    // Final/target distribution width (standard deviation in semitones)
    // This is where the distribution converges to after hours of practice
    finalWidth: number; // Default: 0.5 (essentially only correct keys)

    // Manual override (0-100 scale, null = use auto)
    // Allows user to manually control distribution width
    manualWidthOverride: number | null;

    // Tightening rate for automatic progression
    // Lower = slower convergence, Higher = faster convergence
    autoTighteningRate: number; // Default: 0.01 (very gradual)
  };

  // ============================================
  // AUDIO FEEDBACK PARAMETERS
  // ============================================
  audioFeedback: {
    // Detuning effect (pitch shift for wrong keys)
    detuning: {
      enabled: boolean;
      // Maximum detuning in cents (100 cents = 1 semitone)
      maxCents: number; // Default: 50 (half semitone)
      // Weight of this effect (0-1)
      weight: number; // Default: 0.4
    };

    // Timbre shift (filter/harmonic changes for wrong keys)
    timbre: {
      enabled: boolean;
      // Filter cutoff frequency reduction (Hz)
      filterReduction: number; // Default: 2000
      // Harmonics reduction (0-1, reduces upper harmonics)
      harmonicsReduction: number; // Default: 0.5
      // Weight of this effect (0-1)
      weight: number; // Default: 0.3
    };

    // Volume reduction for wrong keys
    volume: {
      enabled: boolean;
      // Maximum volume reduction (0-1, where 1 = silent)
      maxReduction: number; // Default: 0.5 (50% quieter)
      // Weight of this effect (0-1)
      weight: number; // Default: 0.3
    };

    // How distance from correct key affects degradation
    // 'linear' or 'exponential'
    degradationCurve: 'linear' | 'exponential';
  };

  // ============================================
  // REFERENCE MELODY TRACK
  // ============================================
  referenceMelody: {
    // Is reference melody enabled?
    enabled: boolean;

    // Initial volume (0-1)
    initialVolume: number; // Default: 0.4 (moderate)

    // Fade rate (volume reduction per accuracy improvement)
    fadeRate: number; // Default: 0.01 (very gradual)

    // Minimum volume (won't fade below this)
    minVolume: number; // Default: 0.05

    // Manual volume override (0-1, null = use auto fade)
    manualVolumeOverride: number | null;

    // Instrument timbre (different from user's piano)
    instrument: 'music-box' | 'soft-piano' | 'synth-pad';
  };

  // ============================================
  // PROGRESSION TRACKING
  // ============================================
  progression: {
    // Auto progression mode enabled?
    autoMode: boolean; // Default: true

    // Accuracy threshold to trigger tightening (0-1)
    // If user's accuracy > this threshold, distribution tightens
    accuracyThreshold: number; // Default: 0.7 (70% accurate)

    // Consistency window (number of notes to average over)
    consistencyWindow: number; // Default: 20

    // Save progress to localStorage?
    persistProgress: boolean; // Default: true
  };

  // ============================================
  // VISUAL SETTINGS
  // ============================================
  visual: {
    // Distribution visualization mode
    distributionMode: 'A' | 'B' | 'C';
    // A = falling notes show width
    // B = keyboard shows gradient
    // C = both

    // Color scheme
    colors: {
      correctKey: string; // Default: '#4CAF50' (green)
      wrongKey: string; // Default: '#F44336' (red)
      neutral: string; // Default: '#2196F3' (blue)
      distribution: string; // Default: '#FFC107' (amber)
    };

    // Animation settings
    fallingNoteSpeed: number; // pixels per frame, Default: 2

    // Visual keyboard settings
    keyboard: {
      // Show only song range + padding
      rangePadding: number; // semitones, Default: 3
    };
  };

  // ============================================
  // GAMEPLAY SETTINGS
  // ============================================
  gameplay: {
    // Current song selection
    currentSong: string; // Default: 'canon-in-d'

    // Tempo multiplier (1.0 = original tempo)
    tempoMultiplier: number; // Default: 1.0

    // Allow tempo adjustment during play?
    allowTempoChange: boolean; // Default: true
  };
}

/**
 * Default configuration - optimized starting values
 */
export const defaultConfig: AppConfig = {
  distribution: {
    initialWidth: 44, // All 88 keys initially
    finalWidth: 0.5, // Essentially exact keys
    manualWidthOverride: null,
    autoTighteningRate: 0.01,
  },

  audioFeedback: {
    detuning: {
      enabled: true,
      maxCents: 50,
      weight: 0.4,
    },
    timbre: {
      enabled: true,
      filterReduction: 2000,
      harmonicsReduction: 0.5,
      weight: 0.3,
    },
    volume: {
      enabled: true,
      maxReduction: 0.5,
      weight: 0.3,
    },
    degradationCurve: 'exponential',
  },

  referenceMelody: {
    enabled: true,
    initialVolume: 0.4,
    fadeRate: 0.01,
    minVolume: 0.05,
    manualVolumeOverride: null,
    instrument: 'music-box',
  },

  progression: {
    autoMode: true,
    accuracyThreshold: 0.7,
    consistencyWindow: 20,
    persistProgress: true,
  },

  visual: {
    distributionMode: 'C', // Both falling notes and keyboard
    colors: {
      correctKey: '#4CAF50',
      wrongKey: '#F44336',
      neutral: '#2196F3',
      distribution: '#FFC107',
    },
    fallingNoteSpeed: 2,
    keyboard: {
      rangePadding: 3,
    },
  },

  gameplay: {
    currentSong: 'hey-jude',
    tempoMultiplier: 1.0,
    allowTempoChange: true,
  },
};

/**
 * Load configuration from localStorage (with defaults as fallback)
 */
export function loadConfig(): AppConfig {
  if (typeof window === 'undefined') {
    console.log('[AppConfig] Config load skipped (no window object)');
    return defaultConfig;
  }

  try {
    const saved = localStorage.getItem('musicLearningAppConfig');
    if (saved) {
      const parsed = JSON.parse(saved);
      // Deep merge to preserve nested object defaults
      const config: AppConfig = {
        ...defaultConfig,
        distribution: { ...defaultConfig.distribution, ...parsed.distribution },
        audioFeedback: { ...defaultConfig.audioFeedback, ...parsed.audioFeedback },
        referenceMelody: { ...defaultConfig.referenceMelody, ...parsed.referenceMelody },
        progression: { ...defaultConfig.progression, ...parsed.progression },
        visual: { ...defaultConfig.visual, ...parsed.visual },
        gameplay: { ...defaultConfig.gameplay, ...parsed.gameplay },
      };

      // CRITICAL: Always start with full distribution width (manualWidthOverride = null)
      // This ensures Phase 1 behavior: ANY key sounds PERFECT
      // The Tightening only happens as user improves
      config.distribution.manualWidthOverride = null;

      console.info('[AppConfig] Config loaded from localStorage', {
        distributionWidth: config.distribution.initialWidth,
        manualWidthOverride: config.distribution.manualWidthOverride,
        autoMode: config.progression.autoMode,
        currentSong: config.gameplay.currentSong
      });
      return config;
    }
    console.info('[AppConfig] No saved config found, using defaults');
  } catch (err) {
    console.warn('[AppConfig] Failed to load config from localStorage', {
      error: err instanceof Error ? err.message : String(err)
    });
  }

  return defaultConfig;
}

/**
 * Save configuration to localStorage
 */
export function saveConfig(config: AppConfig): void {
  if (typeof window === 'undefined') {
    console.log('[AppConfig] Config save skipped (no window object)');
    return;
  }

  try {
    localStorage.setItem('musicLearningAppConfig', JSON.stringify(config));
    console.info('[AppConfig] Config saved to localStorage', {
      distributionWidth: config.distribution.initialWidth,
      autoMode: config.progression.autoMode,
      currentSong: config.gameplay.currentSong
    });
  } catch (err) {
    console.error('[AppConfig] Failed to save config to localStorage', {
      error: err instanceof Error ? err.message : String(err)
    });
  }
}

/**
 * Reset configuration to defaults
 */
export function resetConfig(): AppConfig {
  if (typeof window !== 'undefined') {
    localStorage.removeItem('musicLearningAppConfig');
    console.info('[AppConfig] Config reset to defaults');
  } else {
    console.log('[AppConfig] Config reset skipped (no window object)');
  }
  return defaultConfig;
}
