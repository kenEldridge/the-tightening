import React, { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { INSIGHTS } from 'theory-core';

function randomIndex(except: number): number {
  if (INSIGHTS.length < 2) return 0;
  let i = except;
  while (i === except) i = Math.floor(Math.random() * INSIGHTS.length);
  return i;
}

export default function DidYouKnow() {
  const [index, setIndex] = useState(() => Math.floor(Math.random() * INSIGHTS.length));
  const insight = INSIGHTS[index];
  if (!insight) return null;

  return (
    <View style={styles.wrap}>
      <View style={styles.headerRow}>
        <Text style={styles.header}>Did you know?</Text>
        <Text style={styles.category}>{insight.category}</Text>
      </View>
      <Text style={styles.text}>{insight.text}</Text>
      <Pressable style={styles.next} onPress={() => setIndex((i) => randomIndex(i))}>
        <Text style={styles.nextText}>Next tip</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    backgroundColor: '#161b22',
    borderColor: '#30363d',
    borderWidth: 1,
    borderRadius: 10,
    padding: 12,
    marginHorizontal: 16,
    marginTop: 14,
  },
  headerRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline' },
  header: { color: '#e8e8ea', fontSize: 13, fontWeight: '700' },
  category: { color: '#6e7681', fontSize: 11 },
  text: { color: '#9aa0a8', fontSize: 13, lineHeight: 19, marginTop: 6 },
  next: { alignSelf: 'flex-end', marginTop: 8, paddingVertical: 4, paddingHorizontal: 8 },
  nextText: { color: '#58a6ff', fontSize: 12, fontWeight: '600' },
});
