import { useCallback, useEffect, useState } from 'react';
import { StatusBar } from 'expo-status-bar';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useKeepAwake } from 'expo-keep-awake';
import { requestMIDIAccess, type MIDIAccess } from '@motiz88/react-native-midi';
import { midiNoteToName } from 'theory-core';
import { presentBluetoothMidiPairing } from './modules/midi-ble-pairing';

// M1 smoke screen (plan A4): prove bidirectional MIDI + the theory-core link
// on device before any real port work. Replaced by the real app shell in B3.
export default function App() {
  useKeepAwake();

  const [access, setAccess] = useState<MIDIAccess | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [heldNotes, setHeldNotes] = useState<number[]>([]);
  const [log, setLog] = useState<string[]>([]);
  const [deviceTick, setDeviceTick] = useState(0);

  const appendLog = useCallback((line: string) => {
    setLog((prev) => [line, ...prev].slice(0, 8));
  }, []);

  useEffect(() => {
    let cancelled = false;
    requestMIDIAccess().then(
      (midi) => {
        if (cancelled) return;
        setAccess(midi);
        midi.onstatechange = () => setDeviceTick((t) => t + 1);
      },
      (e) => !cancelled && setError(String(e)),
    );
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!access) return;
    const held = new Set<number>();
    for (const input of access.inputs.values()) {
      input.onmidimessage = (event) => {
        const data = event.data;
        if (!data || data.length < 3) return;
        const status = data[0] & 0xf0;
        const note = data[1];
        const velocity = data[2];
        if (status === 0x90 && velocity > 0) {
          held.add(note);
          appendLog(`noteOn  ${midiNoteToName(note)} vel ${velocity} (${input.name})`);
        } else if (status === 0x80 || (status === 0x90 && velocity === 0)) {
          held.delete(note);
        } else {
          return;
        }
        setHeldNotes([...held].sort((a, b) => a - b));
      };
    }
    return () => {
      for (const input of access.inputs.values()) {
        input.onmidimessage = null;
      }
    };
  }, [access, deviceTick, appendLog]);

  const sendTestNote = useCallback(() => {
    const output = access ? [...access.outputs.values()][0] : undefined;
    if (!output) {
      appendLog('no MIDI output available');
      return;
    }
    output.send([0x90, 60, 100]);
    setTimeout(() => output.send([0x80, 60, 0]), 400);
    appendLog(`sent ${midiNoteToName(60)} to ${output.name}`);
  }, [access, appendLog]);

  const pair = useCallback(() => {
    presentBluetoothMidiPairing().catch((e) => appendLog(`pairing error: ${e}`));
  }, [appendLog]);

  const inputs = access ? [...access.inputs.values()] : [];
  const outputs = access ? [...access.outputs.values()] : [];

  return (
    <View style={styles.container}>
      <Text style={styles.title}>The Tightening — MIDI check</Text>
      <Text style={styles.status}>
        {error ? `MIDI error: ${error}` : access ? 'MIDI access granted' : 'Requesting MIDI access…'}
      </Text>

      <Text style={styles.heading}>Inputs ({inputs.length})</Text>
      {inputs.map((d) => (
        <Text key={d.id} style={styles.device}>{d.name ?? d.id}</Text>
      ))}
      <Text style={styles.heading}>Outputs ({outputs.length})</Text>
      {outputs.map((d) => (
        <Text key={d.id} style={styles.device}>{d.name ?? d.id}</Text>
      ))}

      <Text style={styles.heading}>Held notes</Text>
      <Text style={styles.held}>
        {heldNotes.length ? heldNotes.map((n) => midiNoteToName(n)).join('  ') : '—'}
      </Text>

      <View style={styles.buttons}>
        <Pressable style={styles.button} onPress={pair}>
          <Text style={styles.buttonText}>Pair Bluetooth MIDI</Text>
        </Pressable>
        <Pressable style={styles.button} onPress={sendTestNote}>
          <Text style={styles.buttonText}>Send test note (C4)</Text>
        </Pressable>
      </View>

      <Text style={styles.heading}>Recent messages</Text>
      <ScrollView style={styles.log}>
        {log.map((line, i) => (
          <Text key={i} style={styles.logLine}>{line}</Text>
        ))}
      </ScrollView>

      <StatusBar style="auto" />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#14161a',
    paddingTop: 64,
    paddingHorizontal: 20,
  },
  title: { color: '#e8e8ea', fontSize: 20, fontWeight: '600' },
  status: { color: '#9aa0a8', marginTop: 4 },
  heading: { color: '#e8e8ea', fontSize: 15, fontWeight: '600', marginTop: 18 },
  device: { color: '#9aa0a8', marginTop: 2 },
  held: { color: '#6fd18b', fontSize: 22, fontVariant: ['tabular-nums'], marginTop: 4 },
  buttons: { flexDirection: 'row', gap: 12, marginTop: 18 },
  button: {
    backgroundColor: '#2a2f38',
    paddingVertical: 10,
    paddingHorizontal: 14,
    borderRadius: 8,
  },
  buttonText: { color: '#e8e8ea', fontWeight: '500' },
  log: { marginTop: 6, maxHeight: 160 },
  logLine: { color: '#7f8792', fontFamily: 'Menlo', fontSize: 12, marginTop: 2 },
});
