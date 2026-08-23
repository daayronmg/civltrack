import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { computeFreshness, type Freshness } from '@gasgo/core';
import { colors, radius, spacing } from '../theme';

interface Props {
  snapshotAt: string;
  valueSince?: string | null;
  compact?: boolean;
}

const LEVEL_COLOR: Record<Freshness['level'], string> = {
  fresco: colors.primary,
  reciente: colors.priceGood,
  antiguo: colors.warning,
  obsoleto: colors.danger,
};

/**
 * Antigüedad del precio.
 *
 * Nunca dice «en tiempo real»: el texto sale de @gasgo/core, que solo sabe hablar de
 * cuándo se confirmó el dato en el volcado oficial.
 */
export function FreshnessBadge({ snapshotAt, valueSince, compact }: Props) {
  const freshness = computeFreshness({
    snapshotAt: new Date(snapshotAt),
    valueSince: valueSince ? new Date(valueSince) : null,
  });
  const color = LEVEL_COLOR[freshness.level];

  return (
    <View style={styles.container}>
      <View style={[styles.badge, { borderColor: color }]}>
        <View style={[styles.dot, { backgroundColor: color }]} />
        <Text style={[styles.text, { color }]} numberOfLines={1}>
          {compact ? freshness.confirmedLabel.replace('Confirmado ', '') : freshness.confirmedLabel}
        </Text>
      </View>

      {!compact && freshness.unchangedLabel ? (
        <Text style={styles.unchanged}>{freshness.unchangedLabel}</Text>
      ) : null}

      {!compact && freshness.warning ? (
        <Text style={styles.warning}>⚠ {freshness.warning}</Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { gap: spacing.xs },
  badge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    alignSelf: 'flex-start',
    paddingHorizontal: spacing.sm,
    paddingVertical: 4,
    borderRadius: radius.pill,
    borderWidth: 1,
  },
  dot: { width: 6, height: 6, borderRadius: 3 },
  text: { fontSize: 12, fontWeight: '700' },
  unchanged: { color: colors.textFaint, fontSize: 12 },
  warning: { color: colors.warning, fontSize: 12, lineHeight: 16 },
});
