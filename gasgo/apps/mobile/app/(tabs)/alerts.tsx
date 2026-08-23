import React, { useCallback, useState } from 'react';
import {
  Alert as RNAlert,
  FlatList,
  Pressable,
  StyleSheet,
  Switch,
  Text,
  View,
} from 'react-native';
import { useFocusEffect, useRouter } from 'expo-router';
import { formatDistance, formatPrice, getFuel, priceUnitLabel } from '@gasgo/core';
import type { AlertRule } from '../../src/lib/types';
import { api } from '../../src/lib/api';
import { useDevice } from '../../src/hooks/useDevice';
import { EmptyState } from '../../src/components/EmptyState';
import { colors, radius as r, spacing, TOUCH_TARGET } from '../../src/theme';

export default function AlertsScreen() {
  const router = useRouter();
  const { token } = useDevice();
  const [alerts, setAlerts] = useState<AlertRule[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    if (!token) {
      setAlerts([]);
      setLoading(false);
      return;
    }
    try {
      const { alerts: list } = await api.alerts(token);
      setAlerts(list);
    } catch {
      setAlerts([]);
    } finally {
      setLoading(false);
    }
  }, [token]);

  useFocusEffect(
    useCallback(() => {
      setLoading(true);
      void load();
    }, [load]),
  );

  async function toggle(alert: AlertRule): Promise<void> {
    if (!token) return;
    setAlerts((current) =>
      current.map((a) => (a.id === alert.id ? { ...a, active: !a.active } : a)),
    );
    try {
      await api.toggleAlert(token, alert.id, !alert.active);
    } catch {
      void load();
    }
  }

  function confirmDelete(alert: AlertRule): void {
    RNAlert.alert('Eliminar alerta', '¿Seguro que quieres eliminar esta alerta?', [
      { text: 'Cancelar', style: 'cancel' },
      {
        text: 'Eliminar',
        style: 'destructive',
        onPress: async () => {
          if (!token) return;
          setAlerts((current) => current.filter((a) => a.id !== alert.id));
          try {
            await api.deleteAlert(token, alert.id);
          } catch {
            void load();
          }
        },
      },
    ]);
  }

  return (
    <View style={styles.container}>
      <FlatList
        data={alerts}
        keyExtractor={(item) => item.id}
        contentContainerStyle={styles.list}
        ItemSeparatorComponent={() => <View style={{ height: spacing.md }} />}
        renderItem={({ item }) => {
          const definition = getFuel(item.fuel);
          return (
            <View style={[styles.card, !item.active && styles.cardInactive]}>
              <View style={styles.cardHeader}>
                <Text style={styles.cardTitle} numberOfLines={1}>
                  {item.label ?? definition.label}
                </Text>
                <Switch
                  value={item.active}
                  onValueChange={() => void toggle(item)}
                  trackColor={{ true: colors.primary, false: colors.border }}
                  thumbColor={colors.text}
                />
              </View>

              <Text style={styles.condition}>
                Avísame cuando {definition.label.toLowerCase()} baje de{' '}
                <Text style={styles.threshold}>
                  {formatPrice(item.thresholdPrice)} {priceUnitLabel(definition)}
                </Text>{' '}
                a menos de {formatDistance(item.radiusMeters)}
              </Text>

              {item.lastTriggeredAt ? (
                <Text style={styles.meta}>
                  Último aviso: {new Date(item.lastTriggeredAt).toLocaleString('es-ES')}
                </Text>
              ) : (
                <Text style={styles.meta}>Todavía no se ha cumplido</Text>
              )}

              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Eliminar alerta"
                onPress={() => confirmDelete(item)}
                style={styles.deleteButton}
              >
                <Text style={styles.deleteText}>Eliminar</Text>
              </Pressable>
            </View>
          );
        }}
        ListEmptyComponent={
          loading ? (
            <EmptyState loading title="Cargando tus alertas…" />
          ) : (
            <EmptyState
              icon="🔔"
              title="Sin alertas todavía"
              message="Crea una alerta y GASGO te avisará cuando tu combustible baje del precio que elijas cerca de ti."
              actionLabel="Crear alerta"
              onAction={() => router.push('/alert/new')}
            />
          )
        }
      />

      {alerts.length > 0 ? (
        <Pressable
          accessibilityRole="button"
          onPress={() => router.push('/alert/new')}
          style={({ pressed }) => [styles.fab, pressed && styles.pressed]}
        >
          <Text style={styles.fabText}>+ NUEVA ALERTA</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  list: { padding: spacing.lg, paddingBottom: 100 },
  card: {
    backgroundColor: colors.surface,
    borderRadius: r.lg,
    padding: spacing.lg,
    gap: spacing.sm,
    borderWidth: 1,
    borderColor: colors.border,
  },
  cardInactive: { opacity: 0.55 },
  cardHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: spacing.md },
  cardTitle: { color: colors.text, fontSize: 17, fontWeight: '800', flex: 1 },
  condition: { color: colors.textMuted, fontSize: 14, lineHeight: 20 },
  threshold: { color: colors.primary, fontWeight: '800' },
  meta: { color: colors.textFaint, fontSize: 12 },
  deleteButton: { alignSelf: 'flex-start', paddingVertical: spacing.xs },
  deleteText: { color: colors.danger, fontSize: 13, fontWeight: '700' },
  fab: {
    position: 'absolute',
    left: spacing.lg,
    right: spacing.lg,
    bottom: spacing.lg,
    minHeight: TOUCH_TARGET + 6,
    borderRadius: r.pill,
    backgroundColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  fabText: { color: colors.onPrimary, fontWeight: '900', fontSize: 15, letterSpacing: 0.5 },
  pressed: { opacity: 0.85 },
});
