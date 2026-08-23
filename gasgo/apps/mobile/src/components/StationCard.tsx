import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { formatDistance, formatPrice, getFuel, priceUnitLabel, type FuelCode } from '@gasgo/core';
import type { StationSummary } from '../lib/types';
import { colors, radius, shadow, spacing } from '../theme';
import { FreshnessBadge } from './FreshnessBadge';

interface Props {
  station: StationSummary;
  fuel: FuelCode;
  onPress: () => void;
  /** Etiqueta destacada: «MÁS BARATA», «MEJOR OPCIÓN»… */
  highlight?: string;
  /** Ahorro estimado frente a la referencia, en euros. */
  savings?: number;
}

export function StationCard({ station, fuel, onPress, highlight, savings }: Props) {
  const definition = getFuel(fuel);

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${station.brand}, ${
        station.price ? `${formatPrice(station.price.price)} euros` : 'sin precio'
      }, a ${formatDistance(station.distanceMeters)}`}
      onPress={onPress}
      style={({ pressed }) => [styles.card, highlight && styles.cardHighlight, pressed && styles.pressed]}
    >
      {highlight ? (
        <View style={styles.highlightRow}>
          <Text style={styles.highlightText}>{highlight}</Text>
          {savings !== undefined && savings > 0 ? (
            <Text style={styles.savings}>
              Ahorras ≈ {savings.toFixed(2).replace('.', ',')} €
            </Text>
          ) : null}
        </View>
      ) : null}

      <View style={styles.row}>
        <View style={styles.info}>
          <Text style={styles.brand} numberOfLines={1}>
            {station.brand}
          </Text>
          <Text style={styles.address} numberOfLines={1}>
            {station.address}
          </Text>
          <View style={styles.metaRow}>
            <Text style={styles.distance}>📍 {formatDistance(station.distanceMeters)}</Text>
            {!station.publicSale ? <Text style={styles.restricted}>Venta restringida</Text> : null}
          </View>
        </View>

        <View style={styles.priceBlock}>
          {station.price ? (
            <>
              <Text style={styles.price}>{formatPrice(station.price.price)}</Text>
              <Text style={styles.unit}>{priceUnitLabel(definition)}</Text>
            </>
          ) : (
            <Text style={styles.noPrice}>Sin dato</Text>
          )}
        </View>
      </View>

      {station.price ? (
        <FreshnessBadge snapshotAt={station.price.snapshotAt} valueSince={station.price.valueSince} compact />
      ) : null}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    padding: spacing.lg,
    gap: spacing.sm,
    borderWidth: 1,
    borderColor: colors.border,
    ...shadow.card,
  },
  cardHighlight: { borderColor: colors.primary, backgroundColor: colors.surfaceElevated },
  pressed: { opacity: 0.85 },
  highlightRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  highlightText: { color: colors.primary, fontSize: 12, fontWeight: '800', letterSpacing: 0.8 },
  savings: { color: colors.primary, fontSize: 13, fontWeight: '700' },
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  info: { flex: 1, gap: 2 },
  brand: { color: colors.text, fontSize: 17, fontWeight: '800' },
  address: { color: colors.textMuted, fontSize: 13 },
  metaRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, marginTop: 2 },
  distance: { color: colors.textFaint, fontSize: 13, fontWeight: '600' },
  restricted: { color: colors.warning, fontSize: 11, fontWeight: '700' },
  priceBlock: { alignItems: 'flex-end' },
  price: { color: colors.text, fontSize: 26, fontWeight: '800', letterSpacing: -1 },
  unit: { color: colors.textFaint, fontSize: 12, fontWeight: '600' },
  noPrice: { color: colors.textFaint, fontSize: 14 },
});
