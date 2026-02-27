import { describe, it, expect } from 'vitest';
import { loadWav } from './wavLoader';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

/**
 * Build a minimal valid PCM16 LE mono 44100Hz WAV buffer.
 */
function buildWav(opts: {
  audioFormat?: number;
  channels?: number;
  sampleRate?: number;
  bitsPerSample?: number;
  samples?: number[];
} = {}): Buffer {
  const {
    audioFormat = 1,
    channels = 1,
    sampleRate = 44100,
    bitsPerSample = 16,
    samples = [0, 16384, 32767, -32768, -16384, 0],
  } = opts;

  const bytesPerSample = bitsPerSample / 8;
  const dataSize = samples.length * bytesPerSample;
  const fmtChunkSize = 16;
  const fileSize = 4 + (8 + fmtChunkSize) + (8 + dataSize);

  const buf = Buffer.alloc(8 + fileSize);
  let off = 0;

  // RIFF header
  buf.write('RIFF', off); off += 4;
  buf.writeUInt32LE(fileSize, off); off += 4;
  buf.write('WAVE', off); off += 4;

  // fmt chunk
  buf.write('fmt ', off); off += 4;
  buf.writeUInt32LE(fmtChunkSize, off); off += 4;
  buf.writeUInt16LE(audioFormat, off); off += 2;
  buf.writeUInt16LE(channels, off); off += 2;
  buf.writeUInt32LE(sampleRate, off); off += 4;
  buf.writeUInt32LE(sampleRate * channels * bytesPerSample, off); off += 4; // byteRate
  buf.writeUInt16LE(channels * bytesPerSample, off); off += 2; // blockAlign
  buf.writeUInt16LE(bitsPerSample, off); off += 2;

  // data chunk
  buf.write('data', off); off += 4;
  buf.writeUInt32LE(dataSize, off); off += 4;
  for (const s of samples) {
    buf.writeInt16LE(s, off); off += 2;
  }

  return buf;
}

function writeTempWav(buf: Buffer): string {
  const tmpDir = os.tmpdir();
  const tmpPath = path.join(tmpDir, `test_${Date.now()}_${Math.random().toString(36).slice(2)}.wav`);
  fs.writeFileSync(tmpPath, buf);
  return tmpPath;
}

describe('wavLoader', () => {
  it('parses a valid PCM16 mono 44100Hz WAV', () => {
    const samples = [0, 16384, 32767, -32768, -16384, 0];
    const tmpPath = writeTempWav(buildWav({ samples }));

    try {
      const wav = loadWav(tmpPath);
      expect(wav.sampleRate).toBe(44100);
      expect(wav.channels).toBe(1);
      expect(wav.samples.length).toBe(6);
      expect(wav.duration).toBeCloseTo(6 / 44100);

      // Check PCM conversion: Int16 / 32768 → Float32
      expect(wav.samples[0]).toBeCloseTo(0);
      expect(wav.samples[1]).toBeCloseTo(16384 / 32768);
      expect(wav.samples[2]).toBeCloseTo(32767 / 32768);
      expect(wav.samples[3]).toBeCloseTo(-32768 / 32768);
    } finally {
      fs.unlinkSync(tmpPath);
    }
  });

  it('throws for missing file', () => {
    expect(() => loadWav('/nonexistent/path.wav')).toThrow('WAV file not found');
  });

  it('throws for non-RIFF file', () => {
    const tmpPath = writeTempWav(Buffer.from('NOT A WAV FILE AT ALL!!!!!!!!!!!!!!!!!!!!!!XX'));
    try {
      expect(() => loadWav(tmpPath)).toThrow('Not a RIFF file');
    } finally {
      fs.unlinkSync(tmpPath);
    }
  });

  it('throws for non-PCM format', () => {
    const tmpPath = writeTempWav(buildWav({ audioFormat: 3 })); // float
    try {
      expect(() => loadWav(tmpPath)).toThrow('Unsupported WAV format');
      expect(() => loadWav(tmpPath)).toThrow('ffmpeg');
    } finally {
      fs.unlinkSync(tmpPath);
    }
  });

  it('throws for non-16-bit', () => {
    const tmpPath = writeTempWav(buildWav({ bitsPerSample: 24 }));
    try {
      expect(() => loadWav(tmpPath)).toThrow('Unsupported bit depth');
    } finally {
      fs.unlinkSync(tmpPath);
    }
  });

  it('throws for stereo', () => {
    const tmpPath = writeTempWav(buildWav({ channels: 2 }));
    try {
      expect(() => loadWav(tmpPath)).toThrow('Unsupported channel count');
    } finally {
      fs.unlinkSync(tmpPath);
    }
  });

  it('throws for non-44100Hz sample rate', () => {
    const tmpPath = writeTempWav(buildWav({ sampleRate: 48000 }));
    try {
      expect(() => loadWav(tmpPath)).toThrow('Unsupported sample rate');
    } finally {
      fs.unlinkSync(tmpPath);
    }
  });

  it('throws for file too small', () => {
    const tmpPath = writeTempWav(Buffer.from('RIFF'));
    try {
      expect(() => loadWav(tmpPath)).toThrow('too small');
    } finally {
      fs.unlinkSync(tmpPath);
    }
  });
});
