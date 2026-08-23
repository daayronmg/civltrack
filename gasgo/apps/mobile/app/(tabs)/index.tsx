import React, { useCallback, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import MapView, { Marker, PROVIDER_DEFAULT, type Region } from 'react-native-maps';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import {
  boundingBox,
  formatDistance,
  formatPrice,
  getFuel,
  priceUnitLabel,
  type FuelCode,
} from '@gasgo/core';
import { FuelSelector } from '../../src/components/FuelSelector';
import { PriceMarker } from '../../src/components/PriceMarker';
import { FreshnessBadge } from '../../src/components/FreshnessBadge';
import { EmptyState } from '../../src/components/EmptyState';
import { RADIUS_OPTIONS } from '../../src/components/RadiusSelector';
import { useLocation } from '../../src/hooks/useLocation';
import { useNearbyStations } from '../../src/hooks/useStations';
import { usePreferences } from '../../src/hooks/usePreferences';
import { colors, radius as r, shadow, spacing, TOUCH_TARGET } from '../../src/theme';
import { ApiError } from '../../src/lib/api';
import { MAP_DARK_STYLE } from '../../src/lib/mapStyle';

/** Zoom inicial coherente con el radio elegido. */
function regionForRadius(lat: number, lon: number, radiusMeters: number): Region {
  const box = boundingBox({ lat, lon }, radiusMeters);
  return {
    latitude: lat,
    longitude: lon,
    latitudeDelta: Math.max(0.01, (box.maxLat - box.minLat) * 1.3),
    longitudeDelta: Math.max(0.01, (box.maxLon - box.minLon) * 1.3),
  };
}

export default function MapScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const mapRef = useRef<MapView | null>(null);

  const { coords, status, request } = useLocation();
  const { fuel, setFuel, radius, setRadius } = usePreferences();
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const { data, isLoading, error, refetch, isRefetching } = useNearbyStations({
    coords,
    fuel,
    radius,
  });

  const stations = data?.stations ?? [];
  const fuelDefinition = getFuel(fuel);

  /** Rango de precios visible, para colorear los marcadores. */
  const priceRange = useMemo(() => {
    const prices = stations.map((s) => s.price?.price).filter((p): p is number => typeof p === 'number');
    if (prices.length === 0) return null;
    return { min: Math.min(...prices), max: Math.max(...prices) };
  }, [stations]);

  const cheapest = useMemo(
    () => stations.find((s) => s.id === data?.cheapestStationId) ?? null,
    [stations, data?.cheapestStationId],
  );

  const selected = useMemo(
    () => stations.find((s) => s.id === selectedId) ?? null,
    [stations, selectedId],
  );

  const centerOnUser = useCallback(async () => {
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    const position = coords ?? (await request());
    if (position) {
      mapRef.current?.animateToRegion(regionForRadius(position.lat, position.lon, radius), 500);
    }
  }, [coords, radius, request]);

  const cycleRadius = useCallback(() => {
    void Haptics.selectionAsync();
    const index = RADIUS_OPTIONS.findIndex((option) => option.meters === radius);
    const next = RADIUS_OPTIONS[(index + 1) % RADIUS_OPTIONS.length]!;
    void setRadius(next.meters);
    if (coords) {
      mapRef.current?.animateToRegion(regionForRadius(coords.lat, coords.lon, next.meters), 400);
    }
  }, [coords, radius, setRadius]);

  const radiusLabel =
    RADIUS_OPTIONS.find((option) => option.meters === radius)?.label ?? `${radius / 1000} km`;

  // ---------------------------------------------------------------- permisos
  if (status === 'denegado' || status === 'servicios_desactivados') {
    return (
      <View style={[styles.container, styles.centered]}>
        <EmptyState
          icon="📍"
          title={
            status === 'denegado' ? 'GASGO necesita tu ubicación' : 'Activa la ubicación del móvil'
          }
          message={
            status === 'denegado'
              ? 'La usamos solo mientras tienes la app abierta, para buscar gasolineras cerca de ti. No guardamos tu recorrido.'
              : 'Enciende el GPS para poder buscar las gasolineras más baratas a tu alrededor.'
          }
          actionLabel="Reintentar"
          onAction={() => void request()}
        />
      </View>
    );
  }

  if (!coords) {
    return (
      <View style={[styles.container, styles.centered]}>
        <EmptyState loading title="Buscando tu ubicación…" message="Un momento." />
      </View>
    );
  }

  // ----------------------------------------------------------------- pantalla
  return (
    <View style={styles.container}>
      <MapView
        ref={mapRef}
        style={StyleSheet.absoluteFill}
        provider={PROVIDER_DEFAULT}
        customMapStyle={MAP_DARK_STYLE}
        initialRegion={regionForRadius(coords.lat, coords.lon, radius)}
        showsUserLocation
        showsMyLocationButton={false}
        showsCompass={false}
        toolbarEnabled={false}
        onPress={() => setSelectedId(null)}
      >
        {stations.map((station) => {
          if (!station.price) return null;
          const ratio =
            priceRange && priceRange.max > priceRange.min
              ? (station.price.price - priceRange.min) / (priceRange.max - priceRange.min)
              : 0;
          return (
            <Marker
              key={station.id}
              coordinate={{ latitude: station.lat, longitude: station.lon }}
              onPress={(event) => {
                event.stopPropagation();
                void Haptics.selectionAsync();
                setSelectedId(station.id);
              }}
              tracksViewChanges={false}
              anchor={{ x: 0.5, y: 1 }}
            >
              <PriceMarker
                price={station.price.price}
                ratio={ratio}
                isCheapest={station.id === data?.cheapestStationId}
                selected={station.id === selectedId}
              />
            </Marker>
          );
        })}
      </MapView>

      {/* Cabecera: combustible y radio */}
      <View style={[styles.header, { paddingTop: insets.top + spacing.sm }]}>
        <View style={styles.headerRow}>
          <Text style={styles.logo}>GASGO</Text>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`Radio de búsqueda: ${radiusLabel}. Tocar para cambiar.`}
            onPress={cycleRadius}
            style={({ pressed }) => [styles.radiusButton, pressed && styles.pressed]}
          >
            <Ionicons name="resize" size={14} color={colors.text} />
            <Text style={styles.radiusText}>{radiusLabel}</Text>
          </Pressable>
        </View>
        <FuelSelector value={fuel} onChange={(next: FuelCode) => void setFuel(next)} />
      </View>

      {/* Botón de centrar en mi ubicación */}
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Centrar el mapa en mi ubicación"
        onPress={centerOnUser}
        style={({ pressed }) => [
          styles.locateButton,
          { bottom: selected || cheapest ? 220 : 120 },
          pressed && styles.pressed,
        ]}
      >
        <Ionicons name="locate" size={22} color={colors.text} />
      </Pressable>

      {(isLoading || isRefetching) && (
        <View style={[styles.loading, { top: insets.top + 110 }]}>
          <ActivityIndicator color={colors.primary} size="small" />
          <Text style={styles.loadingText}>Consultando precios oficiales…</Text>
        </View>
      )}

      {/* Panel inferior */}
      <View style={[styles.bottomPanel, { paddingBottom: insets.bottom + spacing.sm }]}>
        {error ? (
          <View style={styles.errorCard}>
            <Text style={styles.errorTitle}>
              {error instanceof ApiError && error.isSinDatos
                ? 'Sin datos oficiales todavía'
                : 'No se han podido cargar los precios'}
            </Text>
            <Text style={styles.errorMessage}>
              {error instanceof ApiError && error.isSinDatos
                ? 'GASGO no muestra precios inventados: en cuanto se ingiera el volcado oficial, aparecerán aquí.'
                : error.message}
            </Text>
            <Pressable onPress={() => void refetch()} style={styles.retryButton}>
              <Text style={styles.retryText}>Reintentar</Text>
            </Pressable>
          </View>
        ) : selected ? (
          <SelectedStationCard
            station={selected}
            fuel={fuel}
            onOpen={() => router.push(`/station/${selected.id}`)}
            onClose={() => setSelectedId(null)}
          />
        ) : cheapest?.price ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`Más barata cerca de ti: ${cheapest.brand}, ${formatPrice(
              cheapest.price.price,
            )} euros, a ${formatDistance(cheapest.distanceMeters)}`}
            onPress={() => router.push(`/station/${cheapest.id}`)}
            style={({ pressed }) => [styles.cheapestCard, pressed && styles.pressed]}
          >
            <Text style={styles.cheapestLabel}>🏆 MÁS BARATA CERCA DE TI</Text>
            <View style={styles.cheapestRow}>
              <View style={{ flex: 1 }}>
                <Text style={styles.cheapestBrand} numberOfLines={1}>
                  {cheapest.brand}
                </Text>
                <Text style={styles.cheapestMeta}>
                  {fuelDefinition.label} · 📍 {formatDistance(cheapest.distanceMeters)}
                </Text>
              </View>
              <View style={styles.priceBlock}>
                <Text style={styles.cheapestPrice}>{formatPrice(cheapest.price.price)}</Text>
                <Text style={styles.priceUnit}>{priceUnitLabel(fuelDefinition)}</Text>
              </View>
            </View>
            <FreshnessBadge
              snapshotAt={cheapest.price.snapshotAt}
              valueSince={cheapest.price.valueSince}
              compact
            />
          </Pressable>
        ) : !isLoading ? (
          <View style={styles.errorCard}>
            <Text style={styles.errorTitle}>Ninguna gasolinera con {fuelDefinition.label}</Text>
            <Text style={styles.errorMessage}>
              Prueba a ampliar el radio de búsqueda o a cambiar de combustible.
            </Text>
          </View>
        ) : null}
      </View>
    </View>
  );
}

function SelectedStationCard({
  station,
  fuel,
  onOpen,
  onClose,
}: {
  station: NonNullable<ReturnType<typeof useNearbyStations>['data']>['stations'][number];
  fuel: FuelCode;
  onOpen: () => void;
  onClose: () => void;
}) {
  const definition = getFuel(fuel);

  return (
    <View style={styles.selectedCard}>
      <View style={styles.selectedHeader}>
        <Text style={styles.selectedBrand} numberOfLines={1}>
          {station.brand}
        </Text>
        <Pressable accessibilityRole="button" accessibilityLabel="Cerrar" onPress={onClose} hitSlop={10}>
          <Ionicons name="close" size={20} color={colors.textMuted} />
        </Pressable>
      </View>

      <View style={styles.selectedRow}>
        <View style={{ flex: 1 }}>
          <Text style={styles.selectedFuel}>{definition.label}</Text>
          <Text style={styles.selectedDistance}>📍 {formatDistance(station.distanceMeters)}</Text>
          <Text style={styles.selectedAddress} numberOfLines={1}>
            {station.address}
          </Text>
        </View>
        {station.price ? (
          <View style={styles.priceBlock}>
            <Text style={styles.selectedPrice}>{formatPrice(station.price.price)}</Text>
            <Text style={styles.priceUnit}>{priceUnitLabel(definition)}</Text>
          </View>
        ) : null}
      </View>

      {station.price ? (
        <FreshnessBadge snapshotAt={station.price.snapshotAt} valueSince={station.price.valueSince} />
      ) : null}

      <Pressable
        accessibilityRole="button"
        onPress={onOpen}
        style={({ pressed }) => [styles.primaryButton, pressed && styles.pressed]}
      >
        <Text style={styles.primaryButtonText}>VER GASOLINERA</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  centered: { justifyContent: 'center' },
  header: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    paddingBottom: spacing.md,
    backgroundColor: 'rgba(11,15,20,0.92)',
    gap: spacing.md,
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.lg,
  },
  logo: { color: colors.text, fontSize: 22, fontWeight: '900', letterSpacing: -0.5 },
  radiusButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    minHeight: TOUCH_TARGET - 10,
    paddingHorizontal: spacing.md,
    borderRadius: r.pill,
    backgroundColor: colors.surfaceElevated,
    borderWidth: 1,
    borderColor: colors.border,
  },
  radiusText: { color: colors.text, fontSize: 13, fontWeight: '700' },
  locateButton: {
    position: 'absolute',
    right: spacing.lg,
    width: TOUCH_TARGET + 6,
    height: TOUCH_TARGET + 6,
    borderRadius: (TOUCH_TARGET + 6) / 2,
    backgroundColor: colors.surfaceElevated,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: colors.border,
    ...shadow.card,
  },
  loading: {
    position: 'absolute',
    alignSelf: 'center',
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
    borderRadius: r.pill,
    backgroundColor: colors.surfaceElevated,
  },
  loadingText: { color: colors.textMuted, fontSize: 12, fontWeight: '600' },
  bottomPanel: { position: 'absolute', left: 0, right: 0, bottom: 0, padding: spacing.lg },
  cheapestCard: {
    backgroundColor: colors.surface,
    borderRadius: r.xl,
    padding: spacing.lg,
    gap: spacing.sm,
    borderWidth: 1,
    borderColor: colors.primary,
    ...shadow.card,
  },
  cheapestLabel: { color: colors.primary, fontSize: 11, fontWeight: '900', letterSpacing: 1 },
  cheapestRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  cheapestBrand: { color: colors.text, fontSize: 19, fontWeight: '800' },
  cheapestMeta: { color: colors.textMuted, fontSize: 13, marginTop: 2 },
  cheapestPrice: { color: colors.primary, fontSize: 30, fontWeight: '900', letterSpacing: -1.2 },
  priceBlock: { alignItems: 'flex-end' },
  priceUnit: { color: colors.textFaint, fontSize: 12, fontWeight: '600' },
  selectedCard: {
    backgroundColor: colors.surface,
    borderRadius: r.xl,
    padding: spacing.lg,
    gap: spacing.md,
    borderWidth: 1,
    borderColor: colors.border,
    ...shadow.card,
  },
  selectedHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  selectedBrand: { color: colors.text, fontSize: 20, fontWeight: '800', flex: 1 },
  selectedRow: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.md },
  selectedFuel: { color: colors.textMuted, fontSize: 14, fontWeight: '600' },
  selectedDistance: { color: colors.text, fontSize: 14, fontWeight: '700', marginTop: 4 },
  selectedAddress: { color: colors.textFaint, fontSize: 12, marginTop: 2 },
  selectedPrice: { color: colors.text, fontSize: 32, fontWeight: '900', letterSpacing: -1.2 },
  primaryButton: {
    minHeight: TOUCH_TARGET + 4,
    borderRadius: r.pill,
    backgroundColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  primaryButtonText: { color: colors.onPrimary, fontSize: 15, fontWeight: '900', letterSpacing: 0.5 },
  errorCard: {
    backgroundColor: colors.surface,
    borderRadius: r.lg,
    padding: spacing.lg,
    gap: spacing.sm,
    borderWidth: 1,
    borderColor: colors.border,
  },
  errorTitle: { color: colors.text, fontSize: 16, fontWeight: '800' },
  errorMessage: { color: colors.textMuted, fontSize: 13, lineHeight: 18 },
  retryButton: {
    alignSelf: 'flex-start',
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
    borderRadius: r.pill,
    backgroundColor: colors.surfaceElevated,
    marginTop: spacing.xs,
  },
  retryText: { color: colors.primary, fontWeight: '800', fontSize: 13 },
  pressed: { opacity: 0.85 },
});
