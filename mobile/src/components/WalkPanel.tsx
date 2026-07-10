import React, { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { CYCLE_PRESETS, EDGE_TYPE_INFO, EDGE_TYPE_ORDER, MOODS, edgeTypeColor } from 'theory-core';
import type { CyclePreset, EdgeType } from 'theory-core';
import type { useWalkState } from '../walk/useWalkState';

// Port of WalkMode.tsx's control surface. Preset hover-tooltips become
// long-press → info callback (top songs); number input becomes a stepper.

type Walk = ReturnType<typeof useWalkState>;

interface Props {
  walk: Walk;
  onPickFrom: () => void;
  onPickTo: () => void;
  onInfo: (text: string) => void;
  onHearPath: () => void;
  isPlaying: boolean;
  dynamicZoom: boolean;
  onToggleDynamicZoom: () => void;
}

function presetInfoText(preset: CyclePreset): string {
  const edges = preset.loop.split(' ') as EdgeType[];
  const pattern = edges.map((et) => EDGE_TYPE_INFO[et]?.label ?? et).join(' › ');
  const songs = preset.topSongs
    .slice(0, 6)
    .map(({ title, chords }) => `• ${title} — ${chords}`)
    .join('\n');
  return `${pattern}\n${preset.songCount} songs use this shape, e.g.:\n${songs}`;
}

export default function WalkPanel({ walk, onPickFrom, onPickTo, onInfo, onHearPath, isPlaying, dynamicZoom, onToggleDynamicZoom }: Props) {
  const { walkState, activeTab, setActiveTab, legOptions, hasLegConstraints } = walk;
  const { fromChord, toChord, options, repeatCount, pathsCompleted, path } = walkState;
  const mood = walkState.mood ?? 'any';
  const [showAllPresets, setShowAllPresets] = useState(false);

  const keyLabel = fromChord ? fromChord.replace(/m$|dim$/, '') : '—';
  const presets = showAllPresets ? CYCLE_PRESETS : CYCLE_PRESETS.slice(0, 8);

  return (
    <View style={styles.panel}>
      {/* Mood */}
      <Text style={styles.sectionLabel}>Mood</Text>
      <View style={styles.row}>
        {MOODS.map((m) => (
          <Pressable
            key={m.id}
            style={[styles.chip, mood === m.id && styles.chipActive]}
            onPress={() => walk.setMood(m.id)}
            onLongPress={() => onInfo(m.blurb)}
          >
            <Text style={[styles.chipText, mood === m.id && styles.chipTextActive]}>
              {m.emoji} {m.label}
            </Text>
          </Pressable>
        ))}
      </View>

      {/* Key + From/To */}
      <View style={[styles.row, { marginTop: 12, alignItems: 'center' }]}>
        <Text style={styles.sectionLabelInline}>Key</Text>
        <Pressable style={styles.stepBtn} onPress={() => walk.transposeKey(11)} disabled={!fromChord}>
          <Text style={styles.stepBtnText}>−</Text>
        </Pressable>
        <Text style={styles.keyLabel}>{keyLabel}</Text>
        <Pressable style={styles.stepBtn} onPress={() => walk.transposeKey(1)} disabled={!fromChord}>
          <Text style={styles.stepBtnText}>+</Text>
        </Pressable>
        <View style={{ width: 14 }} />
        <Pressable style={styles.chooser} onPress={onPickFrom}>
          <Text style={styles.chooserLabel}>From</Text>
          <Text style={styles.chooserValue}>{fromChord || '—'}</Text>
        </Pressable>
        <Text style={styles.arrowGlyph}>→</Text>
        <Pressable style={styles.chooser} onPress={onPickTo}>
          <Text style={styles.chooserLabel}>To</Text>
          <Text style={styles.chooserValue}>{toChord || '—'}</Text>
        </Pressable>
      </View>

      {/* Cycle presets */}
      <View style={[styles.rowBetween, { marginTop: 14 }]}>
        <Text style={styles.sectionLabel}>Patterns (long-press for songs)</Text>
        <Pressable onPress={() => setShowAllPresets((s) => !s)}>
          <Text style={styles.link}>{showAllPresets ? 'fewer' : `all ${CYCLE_PRESETS.length}`}</Text>
        </Pressable>
      </View>
      <View style={styles.presetWrap}>
        {presets.map((preset) => (
          <Pressable
            key={preset.loop}
            style={[styles.preset, walk.isPresetActive(preset) && styles.presetActive]}
            onPress={() => walk.applyPreset(preset)}
            onLongPress={() => onInfo(presetInfoText(preset))}
          >
            <Text style={styles.presetPattern}>
              {preset.loop.split(' ').map((et, i) => (
                <Text key={i}>
                  {i > 0 && <Text style={styles.presetSep}> › </Text>}
                  <Text style={{ color: edgeTypeColor(et as EdgeType) }}>
                    {EDGE_TYPE_INFO[et as EdgeType]?.shortLabel ?? et}
                  </Text>
                </Text>
              ))}
            </Text>
            <Text style={styles.presetCount}>{preset.songCount}</Text>
          </Pressable>
        ))}
      </View>

      {/* Constraints with Out/Back tabs */}
      <View style={[styles.rowBetween, { marginTop: 14 }]}>
        <Text style={styles.sectionLabel}>Must include</Text>
        <View style={styles.tabs}>
          {(['out', 'back'] as const).map((tab) => (
            <Pressable key={tab} style={[styles.tab, activeTab === tab && styles.tabActive]} onPress={() => setActiveTab(tab)}>
              <Text style={[styles.tabText, activeTab === tab && styles.tabTextActive]}>{tab === 'out' ? 'Out' : 'Back'}</Text>
            </Pressable>
          ))}
        </View>
      </View>
      <View style={styles.togglesGrid}>
        {EDGE_TYPE_ORDER.map((edgeType) => {
          const on = !!legOptions[edgeType];
          return (
            <Pressable
              key={edgeType}
              style={[styles.toggle, on && styles.toggleOn]}
              onPress={() => walk.toggleConstraint(edgeType)}
              onLongPress={() => onInfo(`${EDGE_TYPE_INFO[edgeType].label}: ${EDGE_TYPE_INFO[edgeType].description}`)}
            >
              <View style={[styles.swatch, { backgroundColor: edgeTypeColor(edgeType) }]} />
              <Text style={[styles.toggleText, on && styles.toggleTextOn]}>{EDGE_TYPE_INFO[edgeType].label}</Text>
            </Pressable>
          );
        })}
      </View>
      {hasLegConstraints && (
        <Pressable onPress={walk.clearConstraints} style={{ alignSelf: 'flex-start' }}>
          <Text style={styles.link}>Clear constraints</Text>
        </Pressable>
      )}
      {activeTab === 'back' && !options.returnTrip && (
        <Text style={styles.hint}>Return trip is off — these apply once you enable it.</Text>
      )}

      {/* Trip toggles */}
      <View style={[styles.row, { marginTop: 14, flexWrap: 'wrap' }]}>
        <Check label="Return trip" checked={options.returnTrip} onPress={walk.toggleReturnTrip} />
        <Check label="Endless" checked={options.endless} onPress={walk.toggleEndless} />
        <Check label="Random pattern" checked={!!options.randomPattern} onPress={walk.toggleRandomPattern} />
        <Check label="Dynamic zoom" checked={dynamicZoom} onPress={onToggleDynamicZoom} />
      </View>
      {options.endless && (
        <View style={[styles.row, { marginTop: 8, alignItems: 'center' }]}>
          <Text style={styles.hint}>Repeat</Text>
          <Pressable style={styles.stepBtn} onPress={() => walk.setRepeatCount(repeatCount - 1)}>
            <Text style={styles.stepBtnText}>−</Text>
          </Pressable>
          <Text style={styles.keyLabel}>{repeatCount}</Text>
          <Pressable style={styles.stepBtn} onPress={() => walk.setRepeatCount(repeatCount + 1)}>
            <Text style={styles.stepBtnText}>+</Text>
          </Pressable>
          <Text style={styles.hint}>× before advancing</Text>
        </View>
      )}

      {/* Hear path + score */}
      <View style={[styles.rowBetween, { marginTop: 14 }]}>
        <Pressable style={[styles.hearBtn, !path && styles.hearBtnDisabled]} onPress={onHearPath} disabled={!path}>
          <Text style={styles.hearBtnText}>{isPlaying ? '■ Stop' : '▶ Hear path'}</Text>
        </Pressable>
        <View style={{ alignItems: 'flex-end', gap: 2 }}>
          {options.endless && repeatCount > 1 && (
            <Text style={styles.hint}>
              Advances in {Math.max(1, repeatCount - walkState.currentPathCompletions)} pass
              {repeatCount - walkState.currentPathCompletions !== 1 ? 'es' : ''}
            </Text>
          )}
          {pathsCompleted > 0 && <Text style={styles.score}>Paths completed: {pathsCompleted}</Text>}
        </View>
      </View>
    </View>
  );
}

function Check({ label, checked, onPress }: { label: string; checked: boolean; onPress: () => void }) {
  return (
    <Pressable style={styles.check} onPress={onPress}>
      <View style={[styles.checkbox, checked && styles.checkboxOn]}>{checked && <Text style={styles.checkmark}>✓</Text>}</View>
      <Text style={styles.checkLabel}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  panel: { paddingHorizontal: 16, paddingTop: 10 },
  sectionLabel: { color: '#8b949e', fontSize: 12, marginBottom: 6 },
  sectionLabelInline: { color: '#8b949e', fontSize: 12, marginRight: 4 },
  row: { flexDirection: 'row', gap: 8, alignItems: 'center' },
  rowBetween: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 },
  chip: { borderColor: '#30363d', borderWidth: 1, borderRadius: 16, paddingVertical: 6, paddingHorizontal: 10 },
  chipActive: { borderColor: '#58a6ff', backgroundColor: '#1f6feb22' },
  chipText: { color: '#8b949e', fontSize: 12.5, fontWeight: '600' },
  chipTextActive: { color: '#58a6ff' },
  stepBtn: {
    width: 30,
    height: 30,
    borderRadius: 8,
    borderColor: '#30363d',
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  stepBtnText: { color: '#c9d1d9', fontSize: 17, lineHeight: 20 },
  keyLabel: { color: '#c9d1d9', fontSize: 15, fontWeight: '700', minWidth: 26, textAlign: 'center' },
  chooser: {
    flexDirection: 'row',
    alignItems: 'baseline',
    gap: 6,
    backgroundColor: '#161b22',
    borderColor: '#30363d',
    borderWidth: 1,
    borderRadius: 8,
    paddingVertical: 6,
    paddingHorizontal: 10,
  },
  chooserLabel: { color: '#8b949e', fontSize: 10 },
  chooserValue: { color: '#c9d1d9', fontSize: 15, fontWeight: '700' },
  arrowGlyph: { color: '#8b949e', fontSize: 15 },
  link: { color: '#58a6ff', fontSize: 12, fontWeight: '600', paddingVertical: 4 },
  presetWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 7 },
  preset: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
    backgroundColor: '#161b22',
    borderColor: '#30363d',
    borderWidth: 1,
    borderRadius: 8,
    paddingVertical: 6,
    paddingHorizontal: 9,
  },
  presetActive: { borderColor: '#f5a623', borderWidth: 2 },
  presetPattern: { fontSize: 12, fontWeight: '700' },
  presetSep: { color: '#6e7681' },
  presetCount: { color: '#6e7681', fontSize: 10.5 },
  tabs: { flexDirection: 'row', gap: 4 },
  tab: { borderColor: '#30363d', borderWidth: 1, borderRadius: 7, paddingVertical: 4, paddingHorizontal: 12 },
  tabActive: { borderColor: '#58a6ff', backgroundColor: '#1f6feb22' },
  tabText: { color: '#8b949e', fontSize: 12, fontWeight: '600' },
  tabTextActive: { color: '#58a6ff' },
  togglesGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 7, marginBottom: 8 },
  toggle: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    borderColor: '#30363d',
    borderWidth: 1,
    borderRadius: 8,
    paddingVertical: 6,
    paddingHorizontal: 9,
    width: '48%',
  },
  toggleOn: { borderColor: '#58a6ff', backgroundColor: '#1f6feb15' },
  swatch: { width: 10, height: 10, borderRadius: 3 },
  toggleText: { color: '#8b949e', fontSize: 12 },
  toggleTextOn: { color: '#c9d1d9' },
  hint: { color: '#6e7681', fontSize: 12 },
  check: { flexDirection: 'row', alignItems: 'center', gap: 6, marginRight: 10, paddingVertical: 4 },
  checkbox: {
    width: 18,
    height: 18,
    borderRadius: 4,
    borderColor: '#30363d',
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  checkboxOn: { borderColor: '#58a6ff', backgroundColor: '#1f6feb33' },
  checkmark: { color: '#58a6ff', fontSize: 12, fontWeight: '700' },
  checkLabel: { color: '#c9d1d9', fontSize: 13 },
  hearBtn: { backgroundColor: '#238636', borderRadius: 8, paddingVertical: 9, paddingHorizontal: 16 },
  hearBtnDisabled: { backgroundColor: '#21262d' },
  hearBtnText: { color: '#ffffff', fontSize: 13.5, fontWeight: '700' },
  score: { color: '#f5a623', fontSize: 13, fontWeight: '600' },
});
