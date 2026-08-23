import React, { useState } from 'react';
import {
  ActivityIndicator,
  Alert as RNAlert,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useQuery } from '@tanstack/react-query';
import {
  computeFreshness,
  formatDistance,
  formatEuros,
  formatPrice,
  fullTankCost,
  getFuel,
  priceUnitLabel,
  type FuelCode,
} from '@gasgo/core';
import { api } from '../../src/lib/api';
import { openDirections } from '../../src/lib/navigation';
import { useLocation } from '../../src/hooks/useLocation';
import { usePreferences } from '../../src/hooks/usePreferences';
import { useDevice } from '../../src/hooks/useDevice';
import { FreshnessBadge } from '../../src/components/FreshnessBadge';
import { PriceHistoryChart, PriceComparison } from '../../src/components/PriceHistoryChart';
import { SourceFooter } from '../../src/components/SourceFooter';
import { EmptyState } from '../../src/components/EmptyState';
import { colors, radius as r, spacing, TOUCH_TARGET } from '../../src/theme';

export default function StationDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const { coords } = useLocation(false);
  const { fuel, vehicle } = usePreferences();
  const { token, ensureToken } = useDevice();

  const [selectedFuel, setSelectedFuel] = useState<FuelCode>(fuel);
  const [favorito, setFavorito] = useState(false);

  const { data, isLoading, error } = useQuery({
    queryKey: ['station', id, coords?.lat.toFixed(3), coords?.lon.toFixed(3)],
    enabled: Boolean(id),
    queryFn: () => api.station(id!, coords ?? undefined),
  });

  const { data: historyData } = useQuery({
    queryKey: ['history', id, selectedFuel],
    enabled: Boolean(id),
    queryFn: () => api.history(id!, selectedFuel, 30),
  });

  if (isLoading) {
    return (
      <View style={styles.centered}>
        <ActivityIndicator color={colors.primary} size="large" />
      </View>
    );
  }

  if (error || !data) {
    return (
      <View style={styles.centered}>
        <EmptyState
          icon="⚠️"
          title="No se ha podido cargar la gasolinera"
          message={error instanceof Error ? error.message : undefined}
          actionLabel="Volver"
          onAction={() => router.back()}
        />
      </View>
    );
  }

  const station = data.station;
  const priceEntry = station.prices.find((p) => p.fuel === selectedFuel) ?? station.prices[0];
  const definition = getFuel(priceEntry?.fuel ?? selectedFuel);

  async function alternarFavorito(): Promise<void> {
    try {
      const deviceToken = token ?? (await ensureToken());
      if (favorito) {
        await api.removeFavorite(deviceToken, station.id);
        setFavorito(false);
      } else {
        await api.addFavorite(deviceToken, station.id);
        setFavorito(true);
      }
    } catch {
      RNAlert.alert('Error', 'No se ha podido actualizar tus favoritos.');
    }
  }

  async function comoLlegar(): Promise<void> {
    const abierta = await openDirections({
      lat: station.lat,
      lon: station.lon,
      label: station.brand,
    });
    if (!abierta) {
      RNAlert.alert('Sin app de mapas', 'No se ha encontrado ninguna aplicación de navegación.');
    }
  }

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <View style={styles.header}>
        <Text style={styles.brand}>{station.brand}</Text>
        <Text style={styles.address}>
          {station.address}
          {station.postalCode ? `, ${station.postalCode}` : ''} · {station.municipality} (
          {station.province})
        </Text>
        <View style={styles.metaRow}>
          {station.distanceMeters !== null ? (
            <Text style={styles.distance}>📍 {formatDistance(station.distanceMeters)}</Text>
          ) : null}
          {station.schedule ? <Text style={styles.schedule}>🕐 {station.schedule}</Text> : null}
        </View>
        {!station.publicSale ? (
          <Text style={styles.restricted}>
            ⚠ Venta restringida: esta estación no vende al público general.
          </Text>
        ) : null}
      </View>

      {/* Precio del combustible seleccionado */}
      {priceEntry ? (
        <View style={styles.priceCard}>
          <Text style={styles.priceFuel}>{definition.label}</Text>
          <View style={styles.priceRow}>
            <Text style={styles.priceValue}>{formatPrice(priceEntry.price)}</Text>
            <Text style={styles.priceUnit}>{priceUnitLabel(definition)}</Text>
          </View>
          <FreshnessBadge snapshotAt={priceEntry.snapshotAt} valueSince={priceEntry.valueSince} />
          <Text style={styles.tank}>
            Llenar tu depósito de {vehicle.tankCapacityLiters} L aquí:{' '}
            <Text style={styles.tankValue}>{formatEuros(fullTankCost(priceEntry.price, vehicle))}</Text>
          </Text>
        </View>
      ) : (
        <View style={styles.priceCard}>
          <Text style={styles.priceFuel}>Sin precio disponible para este combustible.</Text>
        </View>
      )}

      {/* Todos los combustibles de la estación */}
      {station.prices.length > 1 ? (
        <>
          <Text style={styles.sectionTitle}>Todos los combustibles</Text>
          <View style={styles.card}>
            {station.prices.map((price) => {
              const fuelDef = getFuel(price.fuel);
              const activo = price.fuel === selectedFuel;
              return (
                <Pressable
                  key={price.fuel}
                  accessibilityRole="button"
                  accessibilityState={{ selected: activo }}
                  onPress={() => setSelectedFuel(price.fuel)}
                  style={[styles.fuelRow, activo && styles.fuelRowActive]}
                >
                  <Text style={[styles.fuelName, activo && styles.fuelNameActive]}>{fuelDef.label}</Text>
                  <Text style={[styles.fuelPrice, activo && styles.fuelNameActive]}>
                    {formatPrice(price.price)} {priceUnitLabel(fuelDef)}
                  </Text>
                </Pressable>
              );
            })}
          </View>
        </>
      ) : null}

      {/* Histórico real */}
      <Text style={styles.sectionTitle}>Evolución del precio</Text>
      <View style={styles.card}>
        {historyData ? (
          <>
            <PriceHistoryChart history={historyData.history} />
            <View style={styles.divider} />
            <PriceComparison history={historyData.history} />
            {historyData.history.historySince ? (
              <Text style={styles.historyNote}>
                GASGO sigue esta gasolinera desde el{' '}
                {new Date(historyData.history.historySince).toLocaleDateString('es-ES')}.
              </Text>
            ) : null}
          </>
        ) : (
          <ActivityIndicator color={colors.primary} />
        )}
      </View>

      {/* Acciones */}
      <View style={styles.actions}>
        <Pressable
          accessibilityRole="button"
          onPress={() => void comoLlegar()}
          style={({ pressed }) => [styles.primaryButton, pressed && styles.pressed]}
        >
          <Text style={styles.primaryText}>CÓMO LLEGAR</Text>
        </Pressable>

        <View style={styles.actionRow}>
          <Pressable
            accessibilityRole="button"
            onPress={() => void alternarFavorito()}
            style={({ pressed }) => [styles.secondaryButton, pressed && styles.pressed]}
          >
            <Text style={styles.secondaryText}>{favorito ? '❤️ En favoritos' : '🤍 Guardar'}</Text>
          </Pressable>
          <Pressable
            accessibilityRole="button"
            onPress={() =>
              router.push({
                pathname: '/alert/new',
                params: {
                  fuel: selectedFuel,
                  price: priceEntry ? String(priceEntry.price) : '',
                  lat: String(station.lat),
                  lon: String(station.lon),
                },
              })
            }
            style={({ pressed }) => [styles.secondaryButton, pressed && styles.pressed]}
          >
            <Text style={styles.secondaryText}>🔔 Crear alerta</Text>
          </Pressable>
        </View>
      </View>

      <SourceFooter snapshotAt={priceEntry?.snapshotAt} />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  centered: { flex: 1, backgroundColor: colors.background, justifyContent: 'center' },
  content: { padding: spacing.lg, paddingBottom: spacing.xxl, gap: spacing.sm },
  header: { gap: spacing.xs },
  brand: { color: colors.text, fontSize: 28, fontWeight: '900', letterSpacing: -0.8 },
  address: { color: colors.textMuted, fontSize: 14, lineHeight: 20 },
  metaRow: { flexDirection: 'row', gap: spacing.lg, marginTop: spacing.xs, flexWrap: 'wrap' },
  distance: { color: colors.text, fontSize: 14, fontWeight: '700' },
  schedule: { color: colors.textMuted, fontSize: 13 },
  restricted: { color: colors.warning, fontSize: 13, fontWeight: '600', marginTop: spacing.xs },
  priceCard: {
    backgroundColor: colors.surface,
    borderRadius: r.xl,
    padding: spacing.lg,
    gap: spacing.sm,
    borderWidth: 1,
    borderColor: colors.primary,
    marginTop: spacing.md,
  },
  priceFuel: { color: colors.textMuted, fontSize: 14, fontWeight: '700' },
  priceRow: { flexDirection: 'row', alignItems: 'baseline', gap: spacing.sm },
  priceValue: { color: colors.primary, fontSize: 44, fontWeight: '900', letterSpacing: -2 },
  priceUnit: { color: colors.textMuted, fontSize: 16, fontWeight: '700' },
  tank: { color: colors.textMuted, fontSize: 13, marginTop: spacing.xs },
  tankValue: { color: colors.text, fontWeight: '800' },
  sectionTitle: {
    color: colors.textMuted,
    fontSize: 12,
    fontWeight: '800',
    letterSpacing: 1,
    textTransform: 'uppercase',
    marginTop: spacing.lg,
  },
  card: {
    backgroundColor: colors.surface,
    borderRadius: r.lg,
    padding: spacing.lg,
    gap: spacing.sm,
    borderWidth: 1,
    borderColor: colors.border,
  },
  fuelRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.sm,
    borderRadius: r.sm,
    minHeight: TOUCH_TARGET,
  },
  fuelRowActive: { backgroundColor: colors.surfaceElevated },
  fuelName: { color: colors.textMuted, fontSize: 14 },
  fuelNameActive: { color: colors.text, fontWeight: '700' },
  fuelPrice: { color: colors.text, fontSize: 15, fontWeight: '700' },
  divider: { height: 1, backgroundColor: colors.border, marginVertical: spacing.sm },
  historyNote: { color: colors.textFaint, fontSize: 11, marginTop: spacing.xs },
  actions: { gap: spacing.sm, marginTop: spacing.lg },
  actionRow: { flexDirection: 'row', gap: spacing.sm },
  primaryButton: {
    minHeight: TOUCH_TARGET + 8,
    borderRadius: r.pill,
    backgroundColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  primaryText: { color: colors.onPrimary, fontSize: 16, fontWeight: '900', letterSpacing: 0.5 },
  secondaryButton: {
    flex: 1,
    minHeight: TOUCH_TARGET,
    borderRadius: r.pill,
    backgroundColor: colors.surfaceElevated,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: colors.border,
  },
  secondaryText: { color: colors.text, fontSize: 14, fontWeight: '700' },
  pressed: { opacity: 0.85 },
});
