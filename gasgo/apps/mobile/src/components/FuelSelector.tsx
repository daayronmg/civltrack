import React from 'react';
import { Pressable, ScrollView, StyleSheet, Text } from 'react-native';
import * as Haptics from 'expo-haptics';
import { FUELS, PRIMARY_FUELS, type FuelCode } from '@gasgo/core';
import { colors, radius, spacing, TOUCH_TARGET } from '../theme';

interface Props {
  value: FuelCode;
  onChange: (fuel: FuelCode) => void;
  /** `true` para mostrar todos los combustibles oficiales, no solo los principales. */
  showAll?: boolean;
}

/** Selector rápido de combustible. Al cambiarlo, el mapa se actualiza solo. */
export function FuelSelector({ value, onChange, showAll = false }: Props) {
  const list = showAll ? FUELS : PRIMARY_FUELS;

  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      contentContainerStyle={styles.container}
      keyboardShouldPersistTaps="handled"
    >
      {list.map((fuel) => {
        const active = fuel.code === value;
        return (
          <Pressable
            key={fuel.code}
            accessibilityRole="button"
            accessibilityLabel={`Combustible ${fuel.label}`}
            accessibilityState={{ selected: active }}
            hitSlop={6}
            onPress={() => {
              if (active) return;
              void Haptics.selectionAsync();
              onChange(fuel.code);
            }}
            style={({ pressed }) => [
              styles.chip,
              active && styles.chipActive,
              pressed && styles.chipPressed,
            ]}
          >
            <Text style={[styles.label, active && styles.labelActive]}>{fuel.shortLabel}</Text>
          </Pressable>
        );
      })}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { gap: spacing.sm, paddingHorizontal: spacing.lg },
  chip: {
    minHeight: TOUCH_TARGET - 8,
    justifyContent: 'center',
    paddingHorizontal: spacing.lg,
    borderRadius: radius.pill,
    backgroundColor: colors.surfaceElevated,
    borderWidth: 1,
    borderColor: colors.border,
  },
  chipActive: { backgroundColor: colors.primary, borderColor: colors.primary },
  chipPressed: { opacity: 0.75 },
  label: { color: colors.textMuted, fontSize: 14, fontWeight: '700' },
  labelActive: { color: colors.onPrimary },
});
