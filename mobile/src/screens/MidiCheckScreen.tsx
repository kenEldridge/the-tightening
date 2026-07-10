import React, { useCallback } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { midiNoteToName } from 'theory-core';
import { presentBluetoothMidiPairing } from '../../modules/midi-ble-pairing';
import type { Midi } from '../midi/useMidi';

// The plan's A4/M1 smoke surface: device lists, held notes, test note,
// Bluetooth pairing. Kept as a diagnostics screen now that the shell exists.
export default function MidiCheckScreen({ midi }: { midi: Midi }) {
  const pair = useCallback(() => {
    presentBluetoothMidiPairing().catch(() => {
      /* surfaced via device list simply not changing; pairing sheet is iOS-only */
    });
  }, []);

  return (
    <ScrollView style={styles.container} contentContainerStyle={{ paddingBottom: 32 }}>
      <Text style={styles.status}>
        {midi.error ? `MIDI error: ${midi.error}` : midi.access ? 'MIDI access granted' : 'Requesting MIDI access…'}
      </Text>

      <Text style={styles.heading}>Inputs ({midi.inputs.length})</Text>
      {midi.inputs.map((d) => (
        <Text key={d.id} style={styles.device}>{d.name ?? d.id}</Text>
      ))}
      <Text style={styles.heading}>Outputs ({midi.outputs.length})</Text>
      {midi.outputs.map((d) => (
        <Text key={d.id} style={styles.device}>{d.name ?? d.id}</Text>
      ))}

      <Text style={styles.heading}>Held notes</Text>
      <Text style={styles.held}>
        {midi.heldNotes.length ? midi.heldNotes.map((n) => midiNoteToName(n)).join('  ') : '—'}
      </Text>
      <Text style={styles.heading}>Matched chords</Text>
      <Text style={styles.matched}>{midi.matchedChords.length ? midi.matchedChords.join('  ') : '—'}</Text>

      <View style={styles.buttons}>
        <Pressable style={styles.button} onPress={pair}>
          <Text style={styles.buttonText}>Pair Bluetooth MIDI</Text>
        </Pressable>
        <Pressable style={styles.button} onPress={() => midi.sendNote(60)}>
          <Text style={styles.buttonText}>Send test note (C4)</Text>
        </Pressable>
      </View>

      <Text style={styles.heading}>Recent messages</Text>
      {midi.log.map((line, i) => (
        <Text key={i} style={styles.logLine}>{line}</Text>
      ))}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, paddingHorizontal: 20 },
  status: { color: '#9aa0a8', marginTop: 8 },
  heading: { color: '#e8e8ea', fontSize: 15, fontWeight: '600', marginTop: 18 },
  device: { color: '#9aa0a8', marginTop: 2 },
  held: { color: '#6fd18b', fontSize: 22, marginTop: 4 },
  matched: { color: '#58a6ff', fontSize: 16, marginTop: 4 },
  buttons: { flexDirection: 'row', gap: 12, marginTop: 18 },
  button: { backgroundColor: '#2a2f38', paddingVertical: 10, paddingHorizontal: 14, borderRadius: 8 },
  buttonText: { color: '#e8e8ea', fontWeight: '500' },
  logLine: { color: '#7f8792', fontSize: 12, marginTop: 2 },
});
