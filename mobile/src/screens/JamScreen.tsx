import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, TextInput, View, useWindowDimensions } from 'react-native';
import { addProgression, editProgression, emptyGraphState, midiNoteToName, parseChordInput, removeProgression } from 'theory-core';
import type { GraphState } from 'theory-core';
import CircleOfFifths from '../components/CircleOfFifths';
import type { Midi } from '../midi/useMidi';
import { loadJSON, saveJSON } from '../storage';

// Progressions persist as plain {name, chords} pairs (B8); the graph (Maps/
// Sets, colors) is rebuilt through addProgression so colors stay stable by
// insertion order, matching a fresh session.
const JAM_KEY = 'jamProgressions.v1';
type SavedProgression = { name: string; chords: string[] };

// Jam mode (B7): build progressions, see them classified on the circle, and
// get live MIDI highlighting (matched chords + next-candidate suggestions).
// Session-only, like the desktop before save/load — persistence is B8.

interface Props {
  midi: Midi;
}

export default function JamScreen({ midi }: Props) {
  const [graphState, setGraphState] = useState<GraphState>(emptyGraphState);
  const [name, setName] = useState('');
  const [chords, setChords] = useState('');
  const [editingName, setEditingName] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const { width, height } = useWindowDimensions();
  const isWide = width >= 700 && width > height * 0.9;
  const circleSize = isWide ? Math.min(height - 120, width - 420) : Math.min(width, 480);
  const loaded = useRef(false);

  // Restore progressions once, rebuilding the graph in saved order.
  useEffect(() => {
    let cancelled = false;
    loadJSON<SavedProgression[]>(JAM_KEY).then((saved) => {
      if (cancelled) return;
      if (saved && saved.length > 0) {
        let state = emptyGraphState();
        for (const p of saved) {
          const result = addProgression(state, p.name, p.chords);
          if (!result.error) state = result.state;
        }
        setGraphState(state);
      }
      loaded.current = true;
    });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!loaded.current) return;
    saveJSON(
      JAM_KEY,
      graphState.progressions.map((p) => ({ name: p.name, chords: p.chords })),
    );
  }, [graphState.progressions]);

  const submit = useCallback(() => {
    setError(null);
    const trimmedName = name.trim();
    if (!trimmedName) {
      setError('Progression name is required');
      return;
    }
    const { chords: parsed, error: parseError } = parseChordInput(chords);
    if (parseError) {
      setError(parseError);
      return;
    }
    const result = editingName
      ? editProgression(graphState, editingName, trimmedName, parsed!)
      : addProgression(graphState, trimmedName, parsed!);
    if (result.error) {
      setError(result.error);
      return;
    }
    setGraphState(result.state);
    setName('');
    setChords('');
    setEditingName(null);
  }, [name, chords, editingName, graphState]);

  const startEdit = useCallback((progName: string) => {
    const prog = graphState.progressions.find((p) => p.name === progName);
    if (!prog) return;
    setEditingName(prog.name);
    setName(prog.name);
    setChords(prog.chords.join(', '));
    setError(null);
  }, [graphState]);

  const cancelEdit = useCallback(() => {
    setEditingName(null);
    setName('');
    setChords('');
    setError(null);
  }, []);

  const heldNames = useMemo(() => midi.heldNotes.map(midiNoteToName).join('  '), [midi.heldNotes]);

  const circle = (
    <View style={{ width: circleSize, height: circleSize, alignSelf: 'center' }}>
      <CircleOfFifths
        graphState={graphState}
        jamMatchedChords={midi.matchedChords}
        matchedChords={[]}
        onEdgeInfo={setInfo}
        onNodePress={(n) => setChords((c) => (c.trim() ? `${c}, ${n}` : n))}
      />
    </View>
  );

  const panel = (
    <>
        {/* Held notes / matched chords strip */}
        <View style={styles.heldRow}>
          <Text style={styles.heldNotes}>{heldNames || 'Play the piano…'}</Text>
          {midi.matchedChords.length > 0 && <Text style={styles.heldChords}>{midi.matchedChords.join('  ')}</Text>}
        </View>

        {/* Progression entry */}
        <View style={styles.form}>
          <TextInput
            style={styles.input}
            value={name}
            onChangeText={setName}
            placeholder="Name (e.g. Verse)"
            placeholderTextColor="#6e7681"
          />
          <TextInput
            style={styles.input}
            value={chords}
            onChangeText={setChords}
            placeholder="Chords (e.g. G, D, Am, G) — or tap nodes"
            placeholderTextColor="#6e7681"
            autoCapitalize="characters"
            autoCorrect={false}
          />
          <View style={styles.btnRow}>
            <Pressable style={styles.addBtn} onPress={submit}>
              <Text style={styles.addBtnText}>{editingName ? 'Save' : 'Add progression'}</Text>
            </Pressable>
            {editingName && (
              <Pressable style={styles.cancelBtn} onPress={cancelEdit}>
                <Text style={styles.cancelBtnText}>Cancel</Text>
              </Pressable>
            )}
          </View>
          {error && <Text style={styles.error}>{error}</Text>}
        </View>

        {/* Progression list */}
        {graphState.progressions.map((prog) => (
          <View key={prog.name} style={[styles.progRow, editingName === prog.name && { opacity: 0.5 }]}>
            <View style={[styles.bullet, { backgroundColor: prog.color }]} />
            <Text style={styles.progText} numberOfLines={1}>
              {prog.name}: {prog.chords.join(' → ')}
            </Text>
            <Pressable onPress={() => startEdit(prog.name)} hitSlop={8}>
              <Text style={styles.progAction}>✎</Text>
            </Pressable>
            <Pressable onPress={() => setGraphState((prev) => removeProgression(prev, prog.name))} hitSlop={8}>
              <Text style={[styles.progAction, { color: '#f85149' }]}>✕</Text>
            </Pressable>
          </View>
        ))}
    </>
  );

  return (
    <View style={styles.container}>
      {isWide ? (
        <View style={styles.wideRow}>
          <View style={styles.widerCircle}>{circle}</View>
          <ScrollView
            style={styles.widePanel}
            contentContainerStyle={{ paddingBottom: 32 }}
            keyboardShouldPersistTaps="handled"
          >
            {panel}
          </ScrollView>
        </View>
      ) : (
        <ScrollView contentContainerStyle={{ paddingBottom: 32 }} keyboardShouldPersistTaps="handled">
          {circle}
          {panel}
        </ScrollView>
      )}

      {info && (
        <Pressable style={styles.infoCard} onPress={() => setInfo(null)}>
          <Text style={styles.infoText}>{info}</Text>
          <Text style={styles.infoDismiss}>tap to dismiss</Text>
        </Pressable>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  wideRow: { flex: 1, flexDirection: 'row' },
  widerCircle: { flex: 1, justifyContent: 'center' },
  widePanel: { width: 400, borderLeftColor: '#21262d', borderLeftWidth: 1 },
  heldRow: { alignItems: 'center', paddingVertical: 6, gap: 2 },
  heldNotes: { color: '#6fd18b', fontSize: 16 },
  heldChords: { color: '#58a6ff', fontSize: 14, fontWeight: '600' },
  form: { paddingHorizontal: 16, gap: 8, marginTop: 6 },
  input: {
    backgroundColor: '#161b22',
    borderColor: '#30363d',
    borderWidth: 1,
    borderRadius: 8,
    color: '#c9d1d9',
    paddingVertical: 9,
    paddingHorizontal: 12,
    fontSize: 14,
  },
  btnRow: { flexDirection: 'row', gap: 8 },
  addBtn: { backgroundColor: '#238636', borderRadius: 8, paddingVertical: 9, paddingHorizontal: 16, flex: 1, alignItems: 'center' },
  addBtnText: { color: '#fff', fontSize: 13.5, fontWeight: '700' },
  cancelBtn: { borderColor: '#30363d', borderWidth: 1, borderRadius: 8, paddingVertical: 9, paddingHorizontal: 16 },
  cancelBtnText: { color: '#8b949e', fontSize: 13.5 },
  error: { color: '#f85149', fontSize: 12.5 },
  progRow: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 16, paddingVertical: 7 },
  bullet: { width: 9, height: 9, borderRadius: 5 },
  progText: { color: '#c9d1d9', fontSize: 13, flex: 1 },
  progAction: { color: '#8b949e', fontSize: 15, paddingHorizontal: 4 },
  infoCard: {
    position: 'absolute',
    bottom: 24,
    left: 16,
    right: 16,
    backgroundColor: '#161b22',
    borderColor: '#30363d',
    borderWidth: 1,
    borderRadius: 10,
    padding: 12,
  },
  infoText: { color: '#c9d1d9', fontSize: 13, lineHeight: 19 },
  infoDismiss: { color: '#6e7681', fontSize: 10, marginTop: 6 },
});
