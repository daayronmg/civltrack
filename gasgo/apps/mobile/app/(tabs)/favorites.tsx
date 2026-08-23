import React, { useCallback, useState } from 'react';
import { FlatList, Pressable, StyleSheet, Text, View } from 'react-native';
import { useFocusEffect, useRouter } from 'expo-router';
import { haversineMeters, formatDistance } from '@gasgo/core';
import { api } from '../../src/lib/api';
import { useDevice } from '../../src/hooks/useDevice';
import { useLocation } from '../../src/hooks/useLocation';
import { EmptyState } from '../../src/components/EmptyState';
import { colors, radius as r, spacing } from '../../src/theme';

interface Favorite {
  id: string;
  brand: string;
  address: string;
  municipality: string;
  lat: number;
  lon: number;
}

export default function FavoritesScreen() {
  const router = useRouter();
  const { token } = useDevice();
  const { coords } = useLocation(false);
  const [favorites, setFavorites] = useState<Favorite[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    if (!token) {
      setFavorites([]);
      setLoading(false);
      return;
    }
    try {
      const { favorites: list } = await api.favorites(token);
      setFavorites(list);
    } catch {
      setFavorites([]);
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

  return (
    <View style={styles.container}>
      <FlatList
        data={favorites}
        keyExtractor={(item) => item.id}
        contentContainerStyle={styles.list}
        ItemSeparatorComponent={() => <View style={{ height: spacing.md }} />}
        renderItem={({ item }) => (
          <Pressable
            accessibilityRole="button"
            onPress={() => router.push(`/station/${item.id}`)}
            style={({ pressed }) => [styles.card, pressed && styles.pressed]}
          >
            <View style={{ flex: 1 }}>
              <Text style={styles.brand} numberOfLines={1}>
                {item.brand}
              </Text>
              <Text style={styles.address} numberOfLines={1}>
                {item.address} · {item.municipality}
              </Text>
              {coords ? (
                <Text style={styles.distance}>
                  📍 {formatDistance(haversineMeters(coords, { lat: item.lat, lon: item.lon }))}
                </Text>
              ) : null}
            </View>
            <Text style={styles.chevron}>›</Text>
          </Pressable>
        )}
        ListEmptyComponent={
          loading ? (
            <EmptyState loading title="Cargando favoritos…" />
          ) : (
            <EmptyState
              icon="❤️"
              title="Sin favoritos"
              message="Guarda las gasolineras que más usas para tenerlas siempre a mano."
              actionLabel="Ver el mapa"
              onAction={() => router.push('/')}
            />
          )
        }
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  list: { padding: spacing.lg },
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    backgroundColor: colors.surface,
    borderRadius: r.lg,
    padding: spacing.lg,
    borderWidth: 1,
    borderColor: colors.border,
  },
  pressed: { opacity: 0.85 },
  brand: { color: colors.text, fontSize: 17, fontWeight: '800' },
  address: { color: colors.textMuted, fontSize: 13, marginTop: 2 },
  distance: { color: colors.textFaint, fontSize: 12, marginTop: 4, fontWeight: '600' },
  chevron: { color: colors.textFaint, fontSize: 28, fontWeight: '300' },
});
