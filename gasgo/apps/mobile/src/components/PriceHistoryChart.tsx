import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { formatPrice } from '@gasgo/core';
import type { PriceHistory } from '../lib/types';
import { colors, radius, spacing } from '../theme';

/**
 * Evolución del precio con datos REALES del histórico de GASGO.
 *
 * Si no hay puntos suficientes, no se dibuja una curva inventada: se dice que aún no hay
 * histórico. El gráfico se construye con Views (sin dependencias de dibujo).
 */
export function PriceHistoryChart({ history }: { history: PriceHistory }) {
  const points = history.points;

  if (points.length < 2) {
    return (
      <View style={styles.empty}>
        <Text style={styles.emptyText}>
          {points.length === 0
            ? 'GASGO todavía no tiene histórico propio de esta gasolinera. Aparecerá en cuanto registremos cambios de precio.'
            : 'Solo hay un registro: el precio no ha cambiado desde que GASGO lo sigue.'}
        </Text>
      </View>
    );
  }

  const prices = points.map((p) => p.price);
  const min = Math.min(...prices);
  const max = Math.max(...prices);
  const range = max - min || 0.001;

  return (
    <View style={styles.container}>
      <View style={styles.chart}>
        {points.map((point, index) => {
          const height = 12 + ((point.price - min) / range) * 76;
          const isLast = index === points.length - 1;
          return (
            <View key={`${point.at}-${index}`} style={styles.barColumn}>
              <View
                style={[
                  styles.bar,
                  { height, backgroundColor: isLast ? colors.primary : colors.border },
                ]}
              />
            </View>
          );
        })}
      </View>

      <View style={styles.axis}>
        <Text style={styles.axisText}>
          {new Date(points[0]!.at).toLocaleDateString('es-ES', { day: '2-digit', month: 'short' })}
        </Text>
        <Text style={styles.axisText}>
          mín {formatPrice(min)} · máx {formatPrice(max)}
        </Text>
        <Text style={styles.axisText}>
          {new Date(points.at(-1)!.at).toLocaleDateString('es-ES', { day: '2-digit', month: 'short' })}
        </Text>
      </View>
    </View>
  );
}

/** Comparativa con los precios de referencia del histórico real. */
export function PriceComparison({ history }: { history: PriceHistory }) {
  const rows: Array<[string, number | null]> = [
    ['Hace 24 h', history.ago24h],
    ['Hace 7 días', history.ago7d],
    ['Hace 30 días', history.ago30d],
  ];

  return (
    <View style={styles.comparison}>
      {rows.map(([label, value]) => {
        const diff = value !== null && history.current !== null ? history.current - value : null;
        return (
          <View key={label} style={styles.comparisonRow}>
            <Text style={styles.comparisonLabel}>{label}</Text>
            {value === null ? (
              <Text style={styles.comparisonMissing}>Sin datos</Text>
            ) : (
              <View style={styles.comparisonValue}>
                <Text style={styles.comparisonPrice}>{formatPrice(value)}</Text>
                {diff !== null ? (
                  <Text
                    style={[
                      styles.comparisonDiff,
                      { color: diff > 0 ? colors.priceBest : diff < 0 ? colors.danger : colors.textFaint },
                    ]}
                  >
                    {diff > 0 ? '↓' : diff < 0 ? '↑' : '='} {Math.abs(diff).toFixed(3).replace('.', ',')}
                  </Text>
                ) : null}
              </View>
            )}
          </View>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { gap: spacing.sm },
  chart: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    height: 100,
    gap: 2,
    paddingHorizontal: spacing.xs,
  },
  barColumn: { flex: 1, justifyContent: 'flex-end', alignItems: 'center' },
  bar: { width: '100%', minWidth: 3, borderRadius: 2 },
  axis: { flexDirection: 'row', justifyContent: 'space-between' },
  axisText: { color: colors.textFaint, fontSize: 11 },
  empty: { padding: spacing.md, backgroundColor: colors.surfaceElevated, borderRadius: radius.md },
  emptyText: { color: colors.textMuted, fontSize: 13, lineHeight: 18 },
  comparison: { gap: spacing.sm },
  comparisonRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  comparisonLabel: { color: colors.textMuted, fontSize: 14 },
  comparisonValue: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  comparisonPrice: { color: colors.text, fontSize: 15, fontWeight: '700' },
  comparisonDiff: { fontSize: 13, fontWeight: '700' },
  comparisonMissing: { color: colors.textFaint, fontSize: 13 },
});
