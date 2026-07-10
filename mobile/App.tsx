import React, { useState } from 'react';
import { StatusBar } from 'expo-status-bar';
import { Pressable, SafeAreaView, StyleSheet, Text, View } from 'react-native';
import { useKeepAwake } from 'expo-keep-awake';
import WalkScreen from './src/screens/WalkScreen';
import MidiCheckScreen from './src/screens/MidiCheckScreen';
import { useMidi } from './src/midi/useMidi';

// Mobile shell (plan B3): mirrors the desktop's mode model (jam | walk, default
// jam on desktop — here Walk leads since it's the ported surface; Jam lands in
// B7). "MIDI" is the diagnostics screen from the M1 smoke test.
type Mode = 'walk' | 'jam' | 'midi';

export default function App() {
  useKeepAwake();
  const midi = useMidi();
  const [mode, setMode] = useState<Mode>('walk');

  return (
    <SafeAreaView style={styles.root}>
      <View style={styles.header}>
        <Text style={styles.title}>The Tightening</Text>
        <View style={styles.modes}>
          {(['walk', 'jam', 'midi'] as const).map((m) => (
            <Pressable key={m} style={[styles.modeBtn, mode === m && styles.modeBtnActive]} onPress={() => setMode(m)}>
              <Text style={[styles.modeText, mode === m && styles.modeTextActive]}>
                {m === 'midi' ? 'MIDI' : m[0].toUpperCase() + m.slice(1)}
              </Text>
            </Pressable>
          ))}
        </View>
      </View>

      {mode === 'walk' && <WalkScreen midi={midi} />}
      {mode === 'jam' && (
        <View style={styles.placeholder}>
          <Text style={styles.placeholderText}>Jam mode is coming in a later step (B7).</Text>
          <Text style={styles.placeholderSub}>Walk mode and the MIDI check are live.</Text>
        </View>
      )}
      {mode === 'midi' && <MidiCheckScreen midi={midi} />}

      <StatusBar style="light" />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#0d1117', paddingTop: 40 },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderBottomColor: '#21262d',
    borderBottomWidth: 1,
  },
  title: { color: '#e8e8ea', fontSize: 17, fontWeight: '700' },
  modes: { flexDirection: 'row', gap: 6 },
  modeBtn: { paddingVertical: 6, paddingHorizontal: 12, borderRadius: 8, borderWidth: 1, borderColor: '#30363d' },
  modeBtnActive: { backgroundColor: '#1f6feb22', borderColor: '#58a6ff' },
  modeText: { color: '#8b949e', fontSize: 13, fontWeight: '600' },
  modeTextActive: { color: '#58a6ff' },
  placeholder: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 6 },
  placeholderText: { color: '#c9d1d9', fontSize: 15 },
  placeholderSub: { color: '#6e7681', fontSize: 13 },
});
