import React from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { respellChordName, edgeTypeColor, edgeTypeShortLabel } from 'theory-core';
import type { EdgeType, NoteSpelling } from 'theory-core';

interface Props {
  chordNames: string[];
  edgeTypes: EdgeType[];
  explanations: string[];
  currentStep: number;
  completed: boolean;
  noteSpelling?: NoteSpelling;
  onArrowPress?: (explanation: string) => void;
}

export default function PathStrip({ chordNames, edgeTypes, explanations, currentStep, completed, noteSpelling = 'sharps', onArrowPress }: Props) {
  if (chordNames.length === 0) return null;

  return (
    <View style={styles.wrap}>
      <Text style={styles.label}>
        Path ({chordNames.length - 1} step{chordNames.length - 1 !== 1 ? 's' : ''}){completed ? '  —  complete!' : ''}
      </Text>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.steps}>
        {chordNames.map((name, i) => {
          const done = i < currentStep;
          const active = i === currentStep;
          return (
            <React.Fragment key={i}>
              <View style={[styles.step, done && styles.stepDone, active && styles.stepActive]}>
                <Text style={styles.stepNum}>{i + 1}</Text>
                <Text style={[styles.stepChord, done && styles.stepChordDone]}>
                  {respellChordName(name, noteSpelling)}
                  {done ? ' ✓' : ''}
                </Text>
              </View>
              {i < edgeTypes.length && (
                <Pressable onPress={onArrowPress ? () => onArrowPress(explanations[i]) : undefined} style={styles.arrow}>
                  <Text style={[styles.arrowGlyph, { color: edgeTypeColor(edgeTypes[i]) }]}>→</Text>
                  <Text style={[styles.arrowLabel, { color: edgeTypeColor(edgeTypes[i]) }]}>{edgeTypeShortLabel(edgeTypes[i])}</Text>
                </Pressable>
              )}
            </React.Fragment>
          );
        })}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { paddingVertical: 8 },
  label: { color: '#8b949e', fontSize: 12, marginBottom: 6, paddingHorizontal: 16 },
  steps: { alignItems: 'center', paddingHorizontal: 16 },
  step: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    backgroundColor: '#161b22',
    borderColor: '#30363d',
    borderWidth: 1,
    borderRadius: 8,
    paddingVertical: 5,
    paddingHorizontal: 9,
  },
  stepDone: { borderColor: '#2ecc71' },
  stepActive: { borderColor: '#f5a623', borderWidth: 2 },
  stepNum: { color: '#6e7681', fontSize: 10, fontWeight: '700' },
  stepChord: { color: '#c9d1d9', fontSize: 14, fontWeight: '600' },
  stepChordDone: { color: '#2ecc71' },
  arrow: { alignItems: 'center', paddingHorizontal: 7 },
  arrowGlyph: { fontSize: 15, lineHeight: 16 },
  arrowLabel: { fontSize: 8.5, fontWeight: '600' },
});
