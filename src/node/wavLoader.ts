/**
 * WAV Loader (Node-only)
 *
 * Minimal RIFF/WAV parser for PCM16 LE mono 44.1kHz.
 * Hard-fails with actionable errors for unsupported formats.
 */

import * as fs from 'fs';

export interface WavData {
  samples: Float32Array;
  sampleRate: number;
  channels: number;
  duration: number;
}

export function loadWav(filePath: string): WavData {
  if (!fs.existsSync(filePath)) {
    throw new Error(`WAV file not found: ${filePath}`);
  }

  const buffer = fs.readFileSync(filePath);

  if (buffer.length < 44) {
    throw new Error(`File too small to be a valid WAV: ${buffer.length} bytes`);
  }

  // RIFF header
  const riff = buffer.toString('ascii', 0, 4);
  if (riff !== 'RIFF') {
    throw new Error(`Not a RIFF file (got "${riff}"). Expected a WAV file.`);
  }

  const wave = buffer.toString('ascii', 8, 12);
  if (wave !== 'WAVE') {
    throw new Error(`Not a WAVE file (got "${wave}"). Expected a WAV file.`);
  }

  // Find fmt chunk
  let offset = 12;
  let fmtFound = false;
  let audioFormat = 0;
  let channels = 0;
  let sampleRate = 0;
  let bitsPerSample = 0;

  while (offset < buffer.length - 8) {
    const chunkId = buffer.toString('ascii', offset, offset + 4);
    const chunkSize = buffer.readUInt32LE(offset + 4);

    if (chunkId === 'fmt ') {
      fmtFound = true;
      audioFormat = buffer.readUInt16LE(offset + 8);
      channels = buffer.readUInt16LE(offset + 10);
      sampleRate = buffer.readUInt32LE(offset + 12);
      bitsPerSample = buffer.readUInt16LE(offset + 22);
    }

    if (chunkId === 'data') {
      if (!fmtFound) {
        throw new Error('WAV data chunk found before fmt chunk');
      }

      // Validate format
      if (audioFormat !== 1) {
        throw new Error(
          `Unsupported WAV format: audioFormat=${audioFormat} (expected 1=PCM). ` +
          `Pre-normalize with: ffmpeg -i input.wav -acodec pcm_s16le -ar 44100 -ac 1 output.wav`
        );
      }

      if (bitsPerSample !== 16) {
        throw new Error(
          `Unsupported bit depth: ${bitsPerSample}-bit (expected 16-bit). ` +
          `Pre-normalize with: ffmpeg -i input.wav -acodec pcm_s16le -ar 44100 -ac 1 output.wav`
        );
      }

      if (channels !== 1) {
        throw new Error(
          `Unsupported channel count: ${channels} (expected mono). ` +
          `Pre-normalize with: ffmpeg -i input.wav -acodec pcm_s16le -ar 44100 -ac 1 output.wav`
        );
      }

      if (sampleRate !== 44100) {
        throw new Error(
          `Unsupported sample rate: ${sampleRate}Hz (expected 44100Hz). ` +
          `Pre-normalize with: ffmpeg -i input.wav -acodec pcm_s16le -ar 44100 -ac 1 output.wav`
        );
      }

      const dataOffset = offset + 8;
      const dataSize = Math.min(chunkSize, buffer.length - dataOffset);
      const sampleCount = Math.floor(dataSize / 2); // 16-bit = 2 bytes per sample

      const samples = new Float32Array(sampleCount);
      for (let i = 0; i < sampleCount; i++) {
        samples[i] = buffer.readInt16LE(dataOffset + i * 2) / 32768;
      }

      return {
        samples,
        sampleRate,
        channels,
        duration: sampleCount / sampleRate,
      };
    }

    offset += 8 + chunkSize;
    // Chunks are word-aligned
    if (chunkSize % 2 !== 0) offset++;
  }

  throw new Error('No data chunk found in WAV file');
}
