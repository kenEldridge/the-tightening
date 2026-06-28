import type { MidiEvent } from '../types/index';

const TICKS_PER_QUARTER = 960;
const TEMPO_MICROS = 500000; // 120 BPM

function msToTick(ms: number): number {
  return Math.round(ms * TICKS_PER_QUARTER / (TEMPO_MICROS / 1000));
}

function writeVlq(bytes: number[], value: number): void {
  const parts: number[] = [value & 0x7F];
  let v = value >>> 7;
  while (v > 0) {
    parts.push((v & 0x7F) | 0x80);
    v >>>= 7;
  }
  for (let i = parts.length - 1; i >= 0; i--) bytes.push(parts[i]);
}

export function encodeMidi(events: MidiEvent[], recordingEndMs: number): ArrayBuffer {
  const filtered = events
    .filter(e => e.type === 'noteOn' || e.type === 'noteOff' || e.type === 'cc')
    .map(e => ({ ...e, tick: msToTick(e.offsetMs) }))
    .sort((a, b) => a.tick - b.tick || (a.type === 'noteOff' ? -1 : 1));

  // Track held notes to flush at end
  const held = new Map<number, number>(); // note → channel
  for (const ev of filtered) {
    if (ev.type === 'noteOn') held.set(ev.note, ev.channel);
    else if (ev.type === 'noteOff') held.delete(ev.note);
  }
  const endTick = msToTick(recordingEndMs);
  const flushNoteOffs = Array.from(held.entries()).map(([note, channel]) => ({
    type: 'noteOff' as const, note, velocity: 0, channel, offsetMs: recordingEndMs, tick: endTick,
  }));

  const all = [...filtered, ...flushNoteOffs]
    .sort((a, b) => a.tick - b.tick || (a.type === 'noteOff' ? -1 : 1));

  const track: number[] = [];

  // Tempo meta event at tick 0
  writeVlq(track, 0);
  track.push(0xFF, 0x51, 0x03,
    (TEMPO_MICROS >>> 16) & 0xFF,
    (TEMPO_MICROS >>> 8) & 0xFF,
    TEMPO_MICROS & 0xFF,
  );

  let prevTick = 0;
  for (const ev of all) {
    writeVlq(track, Math.max(0, ev.tick - prevTick));
    prevTick = ev.tick;
    const ch = ev.channel & 0x0F;
    if (ev.type === 'noteOn') {
      track.push(0x90 | ch, ev.note & 0x7F, ev.velocity & 0x7F);
    } else if (ev.type === 'noteOff') {
      track.push(0x80 | ch, ev.note & 0x7F, 0x00);
    } else {
      track.push(0xB0 | ch, ev.note & 0x7F, ev.velocity & 0x7F);
    }
  }

  // End of track
  writeVlq(track, 0);
  track.push(0xFF, 0x2F, 0x00);

  const buf = new ArrayBuffer(22 + track.length);
  const v = new DataView(buf);
  const a = new Uint8Array(buf);
  const ws = (off: number, s: string) => {
    for (let i = 0; i < s.length; i++) v.setUint8(off + i, s.charCodeAt(i));
  };

  ws(0, 'MThd');
  v.setUint32(4, 6, false);
  v.setUint16(8, 0, false);
  v.setUint16(10, 1, false);
  v.setUint16(12, TICKS_PER_QUARTER, false);
  ws(14, 'MTrk');
  v.setUint32(18, track.length, false);
  a.set(track, 22);

  return buf;
}
