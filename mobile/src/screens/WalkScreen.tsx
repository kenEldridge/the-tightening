import React, { useEffect, useMemo, useState } from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { findChordPath, getAllChordNames } from 'theory-core';
import CircleOfFifths from '../components/CircleOfFifths';
import PathStrip from '../components/PathStrip';
import type { Midi } from '../midi/useMidi';

// Minimal Walk mode (plan B4 + a slice of B5): pick From/To, path computed via
// theory-core Dijkstra, played progress tracked from live MIDI. Edge-type
// constraints, return trip, endless mode and moods follow in B5 proper.

type PathState = NonNullable<ReturnType<typeof findChordPath>> | null;

interface Props {
  midi: Midi;
}

export default function WalkScreen({ midi }: Props) {
  const [fromChord, setFromChord] = useState('C');
  const [toChord, setToChord] = useState('F#');
  const [picking, setPicking] = useState<'from' | 'to' | null>(null);
  const [currentStep, setCurrentStep] = useState(0);
  const [info, setInfo] = useState<string | null>(null);

  const path: PathState = useMemo(() => findChordPath(fromChord, toChord, {}), [fromChord, toChord]);

  useEffect(() => setCurrentStep(0), [fromChord, toChord]);

  const completed = !!path && currentStep >= path.chordNames.length;

  // Advance when the awaited chord is played.
  useEffect(() => {
    if (!path || completed) return;
    if (midi.matchedChords.includes(path.chordNames[currentStep])) {
      setCurrentStep((s) => s + 1);
    }
  }, [midi.matchedChords, path, currentStep, completed]);

  const allNames = useMemo(() => getAllChordNames(), []);

  return (
    <View style={styles.container}>
      <View style={styles.controls}>
        <Chooser label="From" value={fromChord} onPress={() => setPicking('from')} />
        <Text style={styles.controlsArrow}>→</Text>
        <Chooser label="To" value={toChord} onPress={() => setPicking('to')} />
        <Pressable style={styles.reset} onPress={() => setCurrentStep(0)}>
          <Text style={styles.resetText}>Reset</Text>
        </Pressable>
      </View>

      <View style={styles.circle}>
        <CircleOfFifths
          walkPath={path ? { nodes: path.chordNames, edgeTypes: path.edgeTypes, currentStep } : undefined}
          matchedChords={midi.matchedChords}
          onNodePress={(name) => {
            setInfo(null);
            setToChord(name); // tap a node = walk there
          }}
          onEdgeInfo={setInfo}
        />
      </View>

      {path ? (
        <PathStrip
          chordNames={path.chordNames}
          edgeTypes={path.edgeTypes}
          explanations={path.explanations}
          currentStep={currentStep}
          completed={completed}
          onArrowPress={setInfo}
        />
      ) : (
        <Text style={styles.noPath}>No path between those chords.</Text>
      )}

      {info && (
        <Pressable style={styles.infoCard} onPress={() => setInfo(null)}>
          <Text style={styles.infoText}>{info}</Text>
          <Text style={styles.infoDismiss}>tap to dismiss</Text>
        </Pressable>
      )}

      <Modal visible={picking !== null} transparent animationType="fade" onRequestClose={() => setPicking(null)}>
        <Pressable style={styles.modalBackdrop} onPress={() => setPicking(null)}>
          <View style={styles.modalCard}>
            <Text style={styles.modalTitle}>{picking === 'from' ? 'Start chord' : 'Destination chord'}</Text>
            <ScrollView>
              {([['Major', allNames.major], ['Minor', allNames.minor], ['Diminished', allNames.dim]] as const).map(([label, names]) => (
                <View key={label}>
                  <Text style={styles.modalSection}>{label}</Text>
                  <View style={styles.modalGrid}>
                    {names.map((name) => (
                      <Pressable
                        key={name}
                        style={styles.modalChip}
                        onPress={() => {
                          if (picking === 'from') setFromChord(name);
                          else setToChord(name);
                          setPicking(null);
                        }}
                      >
                        <Text style={styles.modalChipText}>{name}</Text>
                      </Pressable>
                    ))}
                  </View>
                </View>
              ))}
            </ScrollView>
          </View>
        </Pressable>
      </Modal>
    </View>
  );
}

function Chooser({ label, value, onPress }: { label: string; value: string; onPress: () => void }) {
  return (
    <Pressable style={styles.chooser} onPress={onPress}>
      <Text style={styles.chooserLabel}>{label}</Text>
      <Text style={styles.chooserValue}>{value}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  controls: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 16, paddingVertical: 8 },
  controlsArrow: { color: '#8b949e', fontSize: 16 },
  chooser: {
    flexDirection: 'row',
    alignItems: 'baseline',
    gap: 7,
    backgroundColor: '#161b22',
    borderColor: '#30363d',
    borderWidth: 1,
    borderRadius: 8,
    paddingVertical: 7,
    paddingHorizontal: 12,
  },
  chooserLabel: { color: '#8b949e', fontSize: 11 },
  chooserValue: { color: '#c9d1d9', fontSize: 16, fontWeight: '700' },
  reset: { marginLeft: 'auto', paddingVertical: 7, paddingHorizontal: 12 },
  resetText: { color: '#58a6ff', fontSize: 13 },
  circle: { flex: 1, aspectRatio: 1, alignSelf: 'center', maxWidth: '100%' },
  noPath: { color: '#f85149', textAlign: 'center', padding: 12 },
  infoCard: {
    position: 'absolute',
    bottom: 90,
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
  modalBackdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.6)', justifyContent: 'center', padding: 24 },
  modalCard: { backgroundColor: '#0d1117', borderColor: '#30363d', borderWidth: 1, borderRadius: 12, padding: 16, maxHeight: '80%' },
  modalTitle: { color: '#c9d1d9', fontSize: 16, fontWeight: '700', marginBottom: 8 },
  modalSection: { color: '#8b949e', fontSize: 12, marginTop: 10, marginBottom: 6 },
  modalGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  modalChip: {
    backgroundColor: '#161b22',
    borderColor: '#30363d',
    borderWidth: 1,
    borderRadius: 8,
    paddingVertical: 8,
    paddingHorizontal: 12,
    minWidth: 52,
    alignItems: 'center',
  },
  modalChipText: { color: '#c9d1d9', fontSize: 14, fontWeight: '600' },
});
