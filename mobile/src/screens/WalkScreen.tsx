import React, { useEffect, useMemo, useState } from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import { getAllChordNames } from 'theory-core';
import type { EdgeType } from 'theory-core';
import CircleOfFifths from '../components/CircleOfFifths';
import PathStrip from '../components/PathStrip';
import WalkPanel from '../components/WalkPanel';
import DidYouKnow from '../components/DidYouKnow';
import { useWalkState } from '../walk/useWalkState';
import type { Midi } from '../midi/useMidi';
import { loadJSON, saveJSON } from '../storage';

const ZOOM_KEY = 'circleZoom.v1';

// Full Walk mode (B5+B6): circle + path strip + the desktop panel's control
// surface (moods, presets, Out/Back constraints, trips) + "hear path" playback.

interface Props {
  midi: Midi;
}

export default function WalkScreen({ midi }: Props) {
  const walk = useWalkState(midi.matchedChords);
  const [picking, setPicking] = useState<'from' | 'to' | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [dynamicZoom, setDynamicZoom] = useState(true);
  useEffect(() => {
    loadJSON<boolean>(ZOOM_KEY).then((v) => v !== null && setDynamicZoom(v));
  }, []);
  const toggleDynamicZoom = () => {
    setDynamicZoom((v) => {
      saveJSON(ZOOM_KEY, !v);
      return !v;
    });
  };
  const { width, height } = useWindowDimensions();
  // iPad / landscape: circle left, controls right.
  const isWide = width >= 700 && width > height * 0.9;
  const circleSize = isWide ? Math.min(height - 120, width - 420) : Math.min(width, 480);

  const { walkState } = walk;
  const path = walkState.path;
  const allNames = useMemo(() => getAllChordNames(), []);

  // Endless mode can swap the path mid-playback — cut stale notes off.
  useEffect(() => {
    midi.stopPlayback();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [path]);

  const hearPath = () => {
    if (midi.playingChord !== null) {
      midi.stopPlayback();
    } else if (path) {
      if (!midi.playChords(path.chordNames)) setInfo('No MIDI output found — connect the piano first (MIDI tab).');
    }
  };

  const circle = (
    <View style={{ width: circleSize, height: circleSize, alignSelf: 'center' }}>
      <CircleOfFifths
        walkPath={
          path
            ? { nodes: path.chordNames, edgeTypes: path.edgeTypes as EdgeType[], currentStep: walkState.currentStep }
            : undefined
        }
        matchedChords={midi.playingChord ? [...midi.matchedChords, midi.playingChord] : midi.matchedChords}
        dynamicView={dynamicZoom}
        onNodePress={(name) => {
          setInfo(null);
          walk.setTo(name); // tap a node = walk there
        }}
        onEdgeInfo={setInfo}
      />
    </View>
  );

  const controls = (
    <>
      {path ? (
        <PathStrip
          chordNames={path.chordNames}
          edgeTypes={path.edgeTypes as EdgeType[]}
          explanations={path.explanations}
          currentStep={walkState.currentStep}
          completed={walkState.completed}
          onArrowPress={setInfo}
        />
      ) : (
        <Text style={styles.noPath}>
          {walkState.fromChord && walkState.toChord && walkState.fromChord === walkState.toChord
            ? 'Pick two different chords.'
            : 'No path found with current constraints.'}
        </Text>
      )}

      {walkState.currentStep > 0 && !walkState.completed && (
        <Pressable onPress={walk.resetProgress} style={{ alignSelf: 'center' }}>
          <Text style={styles.resetText}>Reset progress</Text>
        </Pressable>
      )}

      <WalkPanel
        walk={walk}
        onPickFrom={() => setPicking('from')}
        onPickTo={() => setPicking('to')}
        onInfo={setInfo}
        onHearPath={hearPath}
        isPlaying={midi.playingChord !== null}
        dynamicZoom={dynamicZoom}
        onToggleDynamicZoom={toggleDynamicZoom}
      />

      <DidYouKnow />
    </>
  );

  return (
    <View style={styles.container}>
      {isWide ? (
        <View style={styles.wideRow}>
          <View style={styles.widerCircle}>{circle}</View>
          <ScrollView style={styles.widePanel} contentContainerStyle={{ paddingBottom: 32 }}>
            {controls}
          </ScrollView>
        </View>
      ) : (
        <ScrollView contentContainerStyle={{ paddingBottom: 32 }}>
          {circle}
          {controls}
        </ScrollView>
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
              {([['Major', allNames.major], ['Minor', allNames.minor], ['Diminished', allNames.dim]] as const).map(
                ([label, names]) => (
                  <View key={label}>
                    <Text style={styles.modalSection}>{label}</Text>
                    <View style={styles.modalGrid}>
                      {names.map((name) => {
                        // Destination picking respects reachability under the active preset/constraints.
                        const unreachable =
                          picking === 'to' && walk.reachableToChords !== null && !walk.reachableToChords.has(name);
                        return (
                          <Pressable
                            key={name}
                            style={[styles.modalChip, unreachable && styles.modalChipDisabled]}
                            disabled={unreachable}
                            onPress={() => {
                              if (picking === 'from') walk.setFrom(name);
                              else walk.setTo(name);
                              setPicking(null);
                            }}
                          >
                            <Text style={[styles.modalChipText, unreachable && styles.modalChipTextDisabled]}>{name}</Text>
                          </Pressable>
                        );
                      })}
                    </View>
                  </View>
                ),
              )}
            </ScrollView>
          </View>
        </Pressable>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  wideRow: { flex: 1, flexDirection: 'row' },
  widerCircle: { flex: 1, justifyContent: 'center' },
  widePanel: { width: 400, borderLeftColor: '#21262d', borderLeftWidth: 1 },
  noPath: { color: '#f85149', textAlign: 'center', padding: 12 },
  resetText: { color: '#58a6ff', fontSize: 13, paddingVertical: 4 },
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
  modalChipDisabled: { opacity: 0.25 },
  modalChipText: { color: '#c9d1d9', fontSize: 14, fontWeight: '600' },
  modalChipTextDisabled: { color: '#6e7681' },
});
