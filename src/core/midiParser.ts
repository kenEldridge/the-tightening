import type { MidiEvent } from '../types/index';

function readVlq(bytes: Uint8Array, offset: number): { value: number; len: number } {
  let value = 0;
  let len = 0;
  let byte: number;
  do {
    byte = bytes[offset + len];
    value = (value << 7) | (byte & 0x7F);
    len++;
  } while (byte & 0x80);
  return { value, len };
}

export function parseMidi(buffer: ArrayBuffer): MidiEvent[] {
  const bytes = new Uint8Array(buffer);
  const view = new DataView(buffer);
  const events: MidiEvent[] = [];

  if (bytes[0] !== 0x4D || bytes[1] !== 0x54 || bytes[2] !== 0x68 || bytes[3] !== 0x64) return events;

  const division = view.getUint16(12, false);
  let tempoMicros = 500000;

  let pos = 14;
  while (pos + 8 <= bytes.length) {
    const chunkType = String.fromCharCode(bytes[pos], bytes[pos+1], bytes[pos+2], bytes[pos+3]);
    const chunkLen = view.getUint32(pos + 4, false);
    pos += 8;

    if (chunkType !== 'MTrk') { pos += chunkLen; continue; }

    const trackEnd = pos + chunkLen;
    let trackPos = pos;
    let absTick = 0;
    let running = 0;

    while (trackPos < trackEnd) {
      const delta = readVlq(bytes, trackPos);
      trackPos += delta.len;
      absTick += delta.value;

      const offsetMs = (absTick * (tempoMicros / 1000)) / division;

      let status = bytes[trackPos];

      if (status === 0xFF) {
        // Meta event
        trackPos++;
        const metaType = bytes[trackPos++];
        const metaLen = readVlq(bytes, trackPos);
        trackPos += metaLen.len;
        if (metaType === 0x51 && metaLen.value === 3) {
          tempoMicros = (bytes[trackPos] << 16) | (bytes[trackPos+1] << 8) | bytes[trackPos+2];
        }
        trackPos += metaLen.value;
        continue;
      }

      if (status === 0xF0 || status === 0xF7) {
        trackPos++;
        const len = readVlq(bytes, trackPos);
        trackPos += len.len + len.value;
        continue;
      }

      if (status & 0x80) { running = status; trackPos++; }
      else { status = running; }

      const msgType = status & 0xF0;
      const channel = status & 0x0F;
      const d1 = bytes[trackPos++];
      let d2 = 0;
      if (msgType !== 0xC0 && msgType !== 0xD0) d2 = bytes[trackPos++];

      if (msgType === 0x90 && d2 > 0) {
        events.push({ type: 'noteOn', note: d1, velocity: d2, channel, offsetMs });
      } else if (msgType === 0x80 || (msgType === 0x90 && d2 === 0)) {
        events.push({ type: 'noteOff', note: d1, velocity: 0, channel, offsetMs });
      } else if (msgType === 0xB0 && d1 === 64) {
        events.push({ type: 'cc', note: 64, velocity: d2, channel, offsetMs });
      }
    }

    pos += chunkLen;
  }

  return events.sort((a, b) => a.offsetMs - b.offsetMs);
}
