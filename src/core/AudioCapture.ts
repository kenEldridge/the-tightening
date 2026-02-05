/**
 * Audio Capture Module
 *
 * Handles microphone input via Web Audio API for pitch detection.
 * Provides audio data buffer to PitchDetector for analysis.
 */

export interface AudioCaptureConfig {
  // FFT size for frequency analysis (must be power of 2)
  // Larger = better frequency resolution but higher latency
  fftSize: number;
  // Minimum audio level (0-1) to consider as signal (vs silence)
  silenceThreshold: number;
  // Sample rate override (null = use device default, typically 44100 or 48000)
  sampleRate: number | null;
}

export const defaultAudioCaptureConfig: AudioCaptureConfig = {
  fftSize: 2048, // ~46ms at 44.1kHz - good balance of resolution and latency
  silenceThreshold: 0.01,
  sampleRate: null,
};

export type AudioCaptureStatus =
  | 'uninitialized'
  | 'requesting-permission'
  | 'permission-denied'
  | 'no-microphone'
  | 'ready'
  | 'listening'
  | 'error';

export interface AudioCaptureState {
  status: AudioCaptureStatus;
  errorMessage: string | null;
  sampleRate: number;
  isListening: boolean;
}

export class AudioCapture {
  private config: AudioCaptureConfig;
  private audioContext: AudioContext | null = null;
  private mediaStream: MediaStream | null = null;
  private sourceNode: MediaStreamAudioSourceNode | null = null;
  private analyserNode: AnalyserNode | null = null;
  private status: AudioCaptureStatus = 'uninitialized';
  private errorMessage: string | null = null;

  // Callback for when audio data is available
  private onAudioDataCallback: ((data: Float32Array) => void) | null = null;

  // Animation frame for continuous polling
  private animationFrameId: number | null = null;

  constructor(config: Partial<AudioCaptureConfig> = {}) {
    this.config = { ...defaultAudioCaptureConfig, ...config };
  }

  /**
   * Initialize audio capture - requests microphone permission
   */
  async initialize(): Promise<boolean> {
    if (this.status === 'listening' || this.status === 'ready') {
      console.log('[AudioCapture] Already initialized');
      return true;
    }

    this.status = 'requesting-permission';
    console.log('[AudioCapture] Requesting microphone permission...');

    try {
      // Request microphone access
      const constraints: MediaStreamConstraints = {
        audio: {
          echoCancellation: false, // We want raw piano audio
          noiseSuppression: false, // Don't filter out piano harmonics
          autoGainControl: false,  // Maintain consistent volume
        },
        video: false,
      };

      this.mediaStream = await navigator.mediaDevices.getUserMedia(constraints);
      console.log('[AudioCapture] Microphone access granted');

      // Create audio context
      const contextOptions: AudioContextOptions = {};
      if (this.config.sampleRate) {
        contextOptions.sampleRate = this.config.sampleRate;
      }
      this.audioContext = new AudioContext(contextOptions);

      // Create source from microphone stream
      this.sourceNode = this.audioContext.createMediaStreamSource(this.mediaStream);

      // Create analyser for getting audio data
      this.analyserNode = this.audioContext.createAnalyser();
      this.analyserNode.fftSize = this.config.fftSize;
      this.analyserNode.smoothingTimeConstant = 0; // No smoothing - we want raw data

      // Connect: microphone -> analyser (no output to speakers to avoid feedback)
      this.sourceNode.connect(this.analyserNode);

      this.status = 'ready';
      console.log('[AudioCapture] Initialized', {
        sampleRate: this.audioContext.sampleRate,
        fftSize: this.config.fftSize,
        bufferLength: this.analyserNode.fftSize,
      });

      return true;
    } catch (err) {
      const error = err as Error;

      if (error.name === 'NotAllowedError' || error.name === 'PermissionDeniedError') {
        this.status = 'permission-denied';
        this.errorMessage = 'Microphone permission denied';
      } else if (error.name === 'NotFoundError' || error.name === 'DevicesNotFoundError') {
        this.status = 'no-microphone';
        this.errorMessage = 'No microphone found';
      } else {
        this.status = 'error';
        this.errorMessage = error.message;
      }

      console.error('[AudioCapture] Initialization failed', {
        status: this.status,
        error: this.errorMessage,
      });

      return false;
    }
  }

  /**
   * Start listening for audio input
   * @param callback - Called with audio data buffer on each frame
   */
  start(callback: (data: Float32Array) => void): void {
    if (this.status !== 'ready' && this.status !== 'listening') {
      console.warn('[AudioCapture] Cannot start - not initialized');
      return;
    }

    if (!this.analyserNode || !this.audioContext) {
      console.warn('[AudioCapture] Cannot start - missing audio nodes');
      return;
    }

    // Resume audio context if suspended (browser autoplay policy)
    if (this.audioContext.state === 'suspended') {
      this.audioContext.resume();
    }

    this.onAudioDataCallback = callback;
    this.status = 'listening';

    // Start the audio processing loop
    this.processAudio();
    console.log('[AudioCapture] Started listening');
  }

  /**
   * Stop listening for audio input
   */
  stop(): void {
    if (this.animationFrameId) {
      cancelAnimationFrame(this.animationFrameId);
      this.animationFrameId = null;
    }

    this.onAudioDataCallback = null;

    if (this.status === 'listening') {
      this.status = 'ready';
      console.log('[AudioCapture] Stopped listening');
    }
  }

  /**
   * Process audio data continuously
   */
  private processAudio = (): void => {
    if (!this.analyserNode || !this.onAudioDataCallback) {
      return;
    }

    // Get time-domain data (waveform)
    const bufferLength = this.analyserNode.fftSize;
    const dataArray = new Float32Array(bufferLength);
    this.analyserNode.getFloatTimeDomainData(dataArray);

    // Check if signal is above silence threshold
    const rms = this.calculateRMS(dataArray);
    if (rms > this.config.silenceThreshold) {
      this.onAudioDataCallback(dataArray);
    }

    // Continue processing loop
    this.animationFrameId = requestAnimationFrame(this.processAudio);
  };

  /**
   * Calculate RMS (root mean square) of audio buffer
   * Used to detect silence
   */
  private calculateRMS(data: Float32Array): number {
    let sum = 0;
    for (let i = 0; i < data.length; i++) {
      sum += data[i] * data[i];
    }
    return Math.sqrt(sum / data.length);
  }

  /**
   * Get current state
   */
  getState(): AudioCaptureState {
    return {
      status: this.status,
      errorMessage: this.errorMessage,
      sampleRate: this.audioContext?.sampleRate ?? 0,
      isListening: this.status === 'listening',
    };
  }

  /**
   * Get the sample rate of the audio context
   */
  getSampleRate(): number {
    return this.audioContext?.sampleRate ?? 44100;
  }

  /**
   * Get the buffer size (fftSize)
   */
  getBufferSize(): number {
    return this.config.fftSize;
  }

  /**
   * Update configuration
   */
  updateConfig(config: Partial<AudioCaptureConfig>): void {
    this.config = { ...this.config, ...config };

    // Update analyser if it exists
    if (this.analyserNode && config.fftSize) {
      this.analyserNode.fftSize = config.fftSize;
    }
  }

  /**
   * Clean up resources
   */
  dispose(): void {
    this.stop();

    // Stop all tracks on the media stream
    if (this.mediaStream) {
      this.mediaStream.getTracks().forEach(track => track.stop());
      this.mediaStream = null;
    }

    // Disconnect and clean up audio nodes
    if (this.sourceNode) {
      this.sourceNode.disconnect();
      this.sourceNode = null;
    }

    if (this.analyserNode) {
      this.analyserNode.disconnect();
      this.analyserNode = null;
    }

    // Close audio context
    if (this.audioContext) {
      this.audioContext.close();
      this.audioContext = null;
    }

    this.status = 'uninitialized';
    this.errorMessage = null;
    console.log('[AudioCapture] Disposed');
  }
}
