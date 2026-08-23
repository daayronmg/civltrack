import React, { useMemo, useState } from 'react';
import { FlatList, Pressable, RefreshControl, StyleSheet, Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import { computeBestOption, formatEuros, getFuel } from '@gasgo/core';
import { FuelSelector } from '../../src/components/FuelSelector';
import { RadiusSelector } from '../../src/components/RadiusSelector';
import { StationCard } from '../../src/components/StationCard';
import { EmptyState } from '../../src/components/EmptyState';
import { SourceFooter } from '../../src/components/SourceFooter';
import { useLocation } from '../../src/hooks/useLocation';
import { useNearbyStations } from '../../src/hooks/useStations';
import { usePreferences } from '../../src/hooks/usePreferences';
import { colors, radius as r, spacing } from '../../src/theme';
import { ApiError } from '../../src/lib/api';

type Orden = 'precio' | 'distancia' | 'mejor';

/**
 * Lista de gasolineras.
 *
 * El orden «Mejor opción» usa el MISMO motor que el backend (@gasgo/core), ejecutado aquí
 * con el vehículo del usuario: cambiar de criterio no requiere otra llamada de red.
 */
export default function ListScreen() {
  const router = useRouter();
  const { coords } = useLocation();
  const { fuel, setFuel, radius, setRadius, vehicle } = usePreferences();
  const [orden, setOrden] = useState<Orden>('precio');

  const { data, isLoading, error, refetch, isRefetching } = useNearbyStations({
    coords,
    fuel,
    radius,
    order: orden === 'distancia' ? 'distancia' : 'precio',
  });

  const stations = data?.stations ?? [];
  const definition = getFuel(fuel);

  const { ordenadas, mejor } = useMemo(() => {
    const conPrecio = stations.filter((s) => s.price);
    if (conPrecio.length === 0) return { ordenadas: stations, mejor: null };

    const resultado = computeBestOption(
      conPrecio.map((s) => ({
        stationId: s.id,
        price: s.price!.price,
        straightLineMeters: s.distanceMeters,
      })),
      { ...vehicle, fuel },
    );

    if (orden !== 'mejor' || !resultado) {
      return { ordenadas: stations, mejor: resultado };
    }

    const posicion = new Map(resultado.ranking.map((evaluacion, index) => [evaluacion.stationId, index]));
    return {
      ordenadas: [...stations].sort(
        (a, b) => (posicion.get(a.id) ?? 9999) - (posicion.get(b.id) ?? 9999),
      ),
      mejor: resultado,
    };
  }, [stations, orden, vehicle, fuel]);

  return (
    <View style={styles.container}>
      <View style={styles.controls}>
        <FuelSelector value={fuel} onChange={(next) => void setFuel(next)} />
        <View style={styles.controlBlock}>
          <RadiusSelector value={radius} onChange={(next) => void setRadius(next)} />
        </View>
        <View style={styles.controlBlock}>
          <View style={styles.ordenRow}>
            {(['precio', 'distancia', 'mejor'] as const).map((option) => (
              <Pressable
                key={option}
                accessibilityRole="button"
                accessibilityState={{ selected: orden === option }}
                onPress={() => setOrden(option)}
                style={[styles.ordenChip, orden === option && styles.ordenChipActive]}
              >
                <Text style={[styles.ordenText, orden === option && styles.ordenTextActive]}>
                  {option === 'precio' ? 'Más barata' : option === 'distancia' ? 'Más cerca' : 'Mejor opción'}
                </Text>
              </Pressable>
            ))}
          </View>
        </View>
      </View>

      <FlatList
        data={ordenadas}
        keyExtractor={(item) => item.id}
        contentContainerStyle={styles.list}
        refreshControl={
          <RefreshControl refreshing={isRefetching} onRefresh={() => void refetch()} tintColor={colors.primary} />
        }
        ItemSeparatorComponent={() => <View style={{ height: spacing.md }} />}
        ListHeaderComponent={
          orden === 'mejor' && mejor ? (
            <View style={styles.explainer}>
              <Text style={styles.explainerTitle}>Ordenado por coste total</Text>
              <Text style={styles.explainerText}>
                Con {vehicle.consumptionPer100Km} L/100 km y {mejor.best.liters} L de repostaje. Incluye
                el combustible que gastas en el desvío.
                {mejor.savingsVsBaseline > 0
                  ? ` La mejor opción te ahorra ≈ ${formatEuros(mejor.savingsVsBaseline)} frente a la más cercana.`
                  : ''}
              </Text>
            </View>
          ) : undefined
        }
        renderItem={({ item, index }) => {
          const evaluacion = mejor?.ranking.find((e) => e.stationId === item.id);
          const esMejor = mejor?.best.stationId === item.id;
          const esMasBarata = data?.cheapestStationId === item.id;

          return (
            <StationCard
              station={item}
              fuel={fuel}
              highlight={
                orden === 'mejor' && esMejor
                  ? '🏆 MEJOR OPCIÓN PARA TI'
                  : orden !== 'mejor' && esMasBarata && index === 0
                    ? '🏆 MÁS BARATA'
                    : undefined
              }
              savings={
                esMejor && mejor ? mejor.savingsVsBaseline : evaluacion && mejor
                  ? Math.round((mejor.baseline.totalCost - evaluacion.totalCost) * 100) / 100
                  : undefined
              }
              onPress={() => router.push(`/station/${item.id}`)}
            />
          );
        }}
        ListEmptyComponent={
          isLoading ? (
            <EmptyState loading title="Cargando precios oficiales…" />
          ) : error ? (
            <EmptyState
              icon="⚠️"
              title={
                error instanceof ApiError && error.isSinDatos
                  ? 'Sin datos oficiales todavía'
                  : 'No se han podido cargar los precios'
              }
              message={
                error instanceof ApiError && error.isSinDatos
                  ? 'GASGO no inventa precios. En cuanto haya volcado oficial, aparecerán aquí.'
                  : error.message
              }
              actionLabel="Reintentar"
              onAction={() => void refetch()}
            />
          ) : (
            <EmptyState
              title={`Ninguna gasolinera con ${definition.label}`}
              message="Amplía el radio de búsqueda o cambia de combustible."
            />
          )
        }
        ListFooterComponent={
          stations.length > 0 ? <SourceFooter snapshotAt={data?.snapshotAt} /> : undefined
        }
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  controls: { paddingVertical: spacing.md, gap: spacing.md, borderBottomWidth: 1, borderBottomColor: colors.border },
  controlBlock: { paddingHorizontal: spacing.lg },
  ordenRow: { flexDirection: 'row', gap: spacing.sm },
  ordenChip: {
    flex: 1,
    alignItems: 'center',
    paddingVertical: spacing.sm,
    borderRadius: r.pill,
    backgroundColor: colors.surfaceElevated,
    borderWidth: 1,
    borderColor: colors.border,
  },
  ordenChipActive: { backgroundColor: colors.primary, borderColor: colors.primary },
  ordenText: { color: colors.textMuted, fontSize: 13, fontWeight: '700' },
  ordenTextActive: { color: colors.onPrimary },
  list: { padding: spacing.lg, paddingBottom: spacing.xxl },
  explainer: {
    backgroundColor: colors.surfaceElevated,
    borderRadius: r.md,
    padding: spacing.md,
    marginBottom: spacing.md,
    gap: 4,
  },
  explainerTitle: { color: colors.text, fontSize: 13, fontWeight: '800' },
  explainerText: { color: colors.textMuted, fontSize: 12, lineHeight: 17 },
});
