import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import * as Haptics from 'expo-haptics';
import { colors, radius as r, spacing, TOUCH_TARGET } from '../theme';

/** Radios que pide el diseño, más la opción de buscar en toda la zona. */
export const RADIUS_OPTIONS = [
  { meters: 2_000, label: '2 km' },
  { meters: 5_000, label: '5 km' },
  { meters: 10_000, label: '10 km' },
  { meters: 20_000, label: '20 km' },
  { meters: 50_000, label: '50 km' },
  { meters: 100_000, label: 'Toda mi zona' },
] as const;

interface Props {
  value: number;
  onChange: (meters: number) => void;
}

export function RadiusSelector({ value, onChange }: Props) {
  return (
    <View style={styles.row}>
      {RADIUS_OPTIONS.map((option) => {
        const active = option.meters === value;
        return (
          <Pressable
            key={option.meters}
            accessibilityRole="button"
            accessibilityLabel={`Radio ${option.label}`}
            accessibilityState={{ selected: active }}
            hitSlop={6}
            onPress={() => {
              void Haptics.selectionAsync();
              onChange(option.meters);
            }}
            style={({ pressed }) => [styles.chip, active && styles.chipActive, pressed && styles.pressed]}
          >
            <Text style={[styles.label, active && styles.labelActive]}>{option.label}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  chip: {
    minHeight: TOUCH_TARGET - 10,
    justifyContent: 'center',
    paddingHorizontal: spacing.md,
    borderRadius: r.pill,
    backgroundColor: colors.surfaceElevated,
    borderWidth: 1,
    borderColor: colors.border,
  },
  chipActive: { backgroundColor: colors.primary, borderColor: colors.primary },
  pressed: { opacity: 0.75 },
  label: { color: colors.textMuted, fontSize: 13, fontWeight: '700' },
  labelActive: { color: colors.onPrimary },
});
