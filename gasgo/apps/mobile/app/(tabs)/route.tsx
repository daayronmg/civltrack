import React, { useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useRouter } from 'expo-router';
import { formatDistance, formatEuros, formatPrice, getFuel, priceUnitLabel } from '@gasgo/core';
import { api, ApiError, type RouteStation } from '../../src/lib/api';
import { EmptyState } from '../../src/components/EmptyState';
import { FreshnessBadge } from '../../src/components/FreshnessBadge';
import { SourceFooter } from '../../src/components/SourceFooter';
import { usePreferences } from '../../src/hooks/usePreferences';
import { useLocation } from '../../src/hooks/useLocation';
import { geocode, routeBetween, type GeocodeResult } from '../../src/lib/routing';
import { colors, radius as r, spacing, TOUCH_TARGET } from '../../src/theme';

/**
 * GASGO ROUTE — «Buscar gasolineras en mi ruta».
 *
 * El trazado se obtiene de un proveedor de rutas abierto (OSRM); los PRECIOS siguen
 * viniendo exclusivamente de nuestro backend, es decir, de la fuente oficial.
 */
export default function RouteScreen() {
  const router = useRouter();
  const { coords } = useLocation();
  const { vehicle, fuel } = usePreferences();

  const [origen, setOrigen] = useState('');
  const [destino, setDestino] = useState('');
  const [cargando, setCargando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [resultado, setResultado] = useState<{
    stations: RouteStation[];
    best: RouteStation | null;
    routeLengthMeters: number;
  } | null>(null);

  const definition = getFuel(fuel);

  async function buscar(): Promise<void> {
    setError(null);
    setResultado(null);

    if (destino.trim().length < 3) {
      setError('Escribe el destino.');
      return;
    }

    setCargando(true);
    try {
      let inicio: GeocodeResult | null = null;
      if (origen.trim().length >= 3) {
        inicio = await geocode(origen.trim());
      } else if (coords) {
        inicio = { lat: coords.lat, lon: coords.lon, label: 'Tu ubicación' };
      }
      if (!inicio) {
        setError('No se ha podido determinar el punto de salida.');
        return;
      }

      const fin = await geocode(destino.trim());
      if (!fin) {
        setError(`No se encuentra «${destino}».`);
        return;
      }

      const ruta = await routeBetween(inicio, fin);
      if (!ruta) {
        setError('No se ha podido calcular la ruta. Inténtalo de nuevo.');
        return;
      }

      const respuesta = await api.routeStations({
        polyline: ruta.polyline,
        corridorMeters: 3_000,
        vehicle: { ...vehicle, fuel },
      });

      setResultado({
        stations: respuesta.stations,
        best: respuesta.best,
        routeLengthMeters: respuesta.routeLengthMeters,
      });
      if (respuesta.stations.length === 0) {
        setError(respuesta.mensaje ?? 'No hay gasolineras con ese combustible en la ruta.');
      }
    } catch (e) {
      setError(
        e instanceof ApiError && e.isSinDatos
          ? 'GASGO todavía no tiene datos oficiales cargados.'
          : e instanceof Error
            ? e.message
            : 'Error inesperado.',
      );
    } finally {
      setCargando(false);
    }
  }

  return (
    <View style={styles.container}>
      <View style={styles.form}>
        <TextInput
          style={styles.input}
          placeholder="Salida (vacío = tu ubicación)"
          placeholderTextColor={colors.textFaint}
          value={origen}
          onChangeText={setOrigen}
          autoCorrect={false}
          returnKeyType="next"
        />
        <TextInput
          style={styles.input}
          placeholder="Destino — p. ej. Madrid"
          placeholderTextColor={colors.textFaint}
          value={destino}
          onChangeText={setDestino}
          autoCorrect={false}
          returnKeyType="search"
          onSubmitEditing={() => void buscar()}
        />
        <Pressable
          accessibilityRole="button"
          onPress={() => void buscar()}
          disabled={cargando}
          style={({ pressed }) => [styles.searchButton, (pressed || cargando) && styles.pressed]}
        >
          {cargando ? (
            <ActivityIndicator color={colors.onPrimary} />
          ) : (
            <Text style={styles.searchText}>BUSCAR EN MI RUTA</Text>
          )}
        </Pressable>
      </View>

      {resultado && resultado.stations.length > 0 ? (
        <FlatList
          data={resultado.stations}
          keyExtractor={(item) => item.station.id}
          contentContainerStyle={styles.list}
          ItemSeparatorComponent={() => <View style={{ height: spacing.md }} />}
          ListHeaderComponent={
            <View style={styles.summary}>
              <Text style={styles.summaryTitle}>
                {formatDistance(resultado.routeLengthMeters)} de ruta ·{' '}
                {resultado.stations.length} gasolineras con {definition.label}
              </Text>
              <Text style={styles.summaryText}>
                Ordenadas por coste total: precio del combustible más lo que gastas en salir de la
                ruta y volver a ella.
              </Text>
            </View>
          }
          renderItem={({ item, index }) => (
            <Pressable
              accessibilityRole="button"
              onPress={() => router.push(`/station/${item.station.id}`)}
              style={({ pressed }) => [
                styles.card,
                index === 0 && styles.cardBest,
                pressed && styles.pressed,
              ]}
            >
              {index === 0 ? <Text style={styles.bestLabel}>🏆 MEJOR PARADA DE LA RUTA</Text> : null}

              <View style={styles.cardRow}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.brand} numberOfLines={1}>
                    ⛽ {item.station.brand}
                  </Text>
                  <Text style={styles.meta}>
                    📍 {formatDistance(item.distanceFromRouteMeters)} de la ruta · ⏱️ +
                    {item.detourMinutes} min
                  </Text>
                  <Text style={styles.meta}>
                    Km {Math.round(item.alongRouteMeters / 1000)} del trayecto
                  </Text>
                </View>
                <View style={styles.priceBlock}>
                  {item.station.price ? (
                    <>
                      <Text style={styles.price}>{formatPrice(item.station.price.price)}</Text>
                      <Text style={styles.unit}>{priceUnitLabel(definition)}</Text>
                    </>
                  ) : null}
                </View>
              </View>

              {item.savingsVsBaseline > 0 ? (
                <Text style={styles.savings}>
                  💰 Ahorro estimado: {formatEuros(item.savingsVsBaseline)}
                </Text>
              ) : null}

              {item.station.price ? (
                <FreshnessBadge
                  snapshotAt={item.station.price.snapshotAt}
                  valueSince={item.station.price.valueSince}
                  compact
                />
              ) : null}
            </Pressable>
          )}
          ListFooterComponent={<SourceFooter />}
        />
      ) : (
        <EmptyState
          icon="🛣️"
          title={error ?? 'Busca las mejores gasolineras de tu trayecto'}
          message={
            error
              ? undefined
              : 'Indica a dónde vas y GASGO analizará la ruta para encontrar dónde te conviene repostar.'
          }
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  form: { padding: spacing.lg, gap: spacing.sm, borderBottomWidth: 1, borderBottomColor: colors.border },
  input: {
    minHeight: TOUCH_TARGET + 4,
    borderRadius: r.md,
    backgroundColor: colors.surfaceElevated,
    borderWidth: 1,
    borderColor: colors.border,
    paddingHorizontal: spacing.lg,
    color: colors.text,
    fontSize: 15,
  },
  searchButton: {
    minHeight: TOUCH_TARGET + 4,
    borderRadius: r.pill,
    backgroundColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: spacing.xs,
  },
  searchText: { color: colors.onPrimary, fontWeight: '900', fontSize: 15, letterSpacing: 0.5 },
  pressed: { opacity: 0.85 },
  list: { padding: spacing.lg, paddingBottom: spacing.xxl },
  summary: { marginBottom: spacing.md, gap: 4 },
  summaryTitle: { color: colors.text, fontSize: 15, fontWeight: '800' },
  summaryText: { color: colors.textMuted, fontSize: 12, lineHeight: 17 },
  card: {
    backgroundColor: colors.surface,
    borderRadius: r.lg,
    padding: spacing.lg,
    gap: spacing.sm,
    borderWidth: 1,
    borderColor: colors.border,
  },
  cardBest: { borderColor: colors.primary },
  bestLabel: { color: colors.primary, fontSize: 11, fontWeight: '900', letterSpacing: 1 },
  cardRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  brand: { color: colors.text, fontSize: 17, fontWeight: '800' },
  meta: { color: colors.textMuted, fontSize: 12, marginTop: 2 },
  priceBlock: { alignItems: 'flex-end' },
  price: { color: colors.text, fontSize: 24, fontWeight: '800', letterSpacing: -0.8 },
  unit: { color: colors.textFaint, fontSize: 11 },
  savings: { color: colors.primary, fontSize: 13, fontWeight: '700' },
});
