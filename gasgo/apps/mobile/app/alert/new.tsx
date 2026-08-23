import React, { useState } from 'react';
import {
  ActivityIndicator,
  Alert as RNAlert,
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { formatDistance, getFuel, priceUnitLabel, type FuelCode } from '@gasgo/core';
import { api } from '../../src/lib/api';
import { useDevice } from '../../src/hooks/useDevice';
import { usePush } from '../../src/hooks/usePush';
import { useLocation } from '../../src/hooks/useLocation';
import { usePreferences } from '../../src/hooks/usePreferences';
import { FuelSelector } from '../../src/components/FuelSelector';
import { RadiusSelector } from '../../src/components/RadiusSelector';
import { preferences } from '../../src/lib/storage';
import { colors, radius as r, spacing, TOUCH_TARGET } from '../../src/theme';

/**
 * Alta de alerta: «Avísame cuando el diésel baje de 1,40 €/L a menos de 10 km».
 * La ubicación de referencia es la actual o la de la gasolinera desde la que se abrió.
 */
export default function NewAlertScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{ fuel?: string; price?: string; lat?: string; lon?: string }>();
  const { coords } = useLocation(false);
  const { fuel: fuelPref } = usePreferences();
  const { ensureToken } = useDevice();
  const { enable } = usePush();

  const [fuel, setFuel] = useState<FuelCode>((params.fuel as FuelCode) ?? fuelPref);
  const [precio, setPrecio] = useState(
    params.price ? (Number(params.price) - 0.02).toFixed(3).replace('.', ',') : '',
  );
  const [radio, setRadio] = useState(10_000);
  const [notificar, setNotificar] = useState(true);
  const [guardando, setGuardando] = useState(false);

  const definition = getFuel(fuel);

  const lat = params.lat ? Number(params.lat) : coords?.lat;
  const lon = params.lon ? Number(params.lon) : coords?.lon;

  async function crear(): Promise<void> {
    const umbral = Number(precio.replace(',', '.'));
    if (!Number.isFinite(umbral) || umbral <= 0 || umbral > 20) {
      RNAlert.alert('Precio no válido', 'Escribe el precio a partir del cual quieres el aviso.');
      return;
    }
    if (lat === undefined || lon === undefined) {
      RNAlert.alert('Sin ubicación', 'Necesitamos un punto de referencia para buscar en ese radio.');
      return;
    }

    setGuardando(true);
    try {
      const token = await ensureToken();

      if (notificar) {
        const permiso = await enable(token);
        if (!permiso.ok) {
          RNAlert.alert(
            'Alerta creada sin avisos',
            `${permiso.motivo ?? ''} Podrás activar las notificaciones más tarde desde Perfil.`,
          );
        }
      } else {
        await preferences.setPushConsent(false);
      }

      await api.createAlert(token, {
        fuel,
        thresholdPrice: umbral,
        radiusMeters: radio,
        lat,
        lon,
        label: `${definition.label} por debajo de ${precio}`,
      });

      router.back();
    } catch (error) {
      RNAlert.alert(
        'No se ha podido crear la alerta',
        error instanceof Error ? error.message : 'Inténtalo de nuevo.',
      );
    } finally {
      setGuardando(false);
    }
  }

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <Text style={styles.label}>Combustible</Text>
      <View style={styles.selectorWrapper}>
        <FuelSelector value={fuel} onChange={setFuel} showAll />
      </View>

      <Text style={styles.label}>Avísame cuando baje de</Text>
      <View style={styles.priceInputRow}>
        <TextInput
          style={styles.priceInput}
          value={precio}
          onChangeText={setPrecio}
          keyboardType="decimal-pad"
          placeholder="1,400"
          placeholderTextColor={colors.textFaint}
          accessibilityLabel="Precio del aviso"
        />
        <Text style={styles.unit}>{priceUnitLabel(definition)}</Text>
      </View>

      <Text style={styles.label}>A menos de</Text>
      <RadiusSelector value={radio} onChange={setRadio} />
      <Text style={styles.hint}>
        Se buscará en {formatDistance(radio)} alrededor de{' '}
        {params.lat ? 'la gasolinera seleccionada' : 'tu ubicación actual'}.
      </Text>

      <View style={styles.switchRow}>
        <View style={{ flex: 1 }}>
          <Text style={styles.switchLabel}>Avisarme con una notificación</Text>
          <Text style={styles.hint}>
            Necesita tu permiso. Solo se usa para esta alerta y puedes retirarlo cuando quieras.
          </Text>
        </View>
        <Switch
          value={notificar}
          onValueChange={setNotificar}
          trackColor={{ true: colors.primary, false: colors.border }}
          thumbColor={colors.text}
        />
      </View>

      <Pressable
        accessibilityRole="button"
        onPress={() => void crear()}
        disabled={guardando}
        style={({ pressed }) => [styles.primaryButton, (pressed || guardando) && styles.pressed]}
      >
        {guardando ? (
          <ActivityIndicator color={colors.onPrimary} />
        ) : (
          <Text style={styles.primaryText}>CREAR ALERTA</Text>
        )}
      </Pressable>

      <Text style={styles.disclaimer}>
        GASGO comprobará la alerta cada vez que ingiera un volcado oficial nuevo. Solo se avisa con
        precios validados: nunca con un dato marcado como anómalo.
      </Text>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  content: { padding: spacing.lg, gap: spacing.md, paddingBottom: spacing.xxl },
  label: {
    color: colors.textMuted,
    fontSize: 12,
    fontWeight: '800',
    letterSpacing: 1,
    textTransform: 'uppercase',
    marginTop: spacing.md,
  },
  selectorWrapper: { marginHorizontal: -spacing.lg },
  priceInputRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  priceInput: {
    flex: 1,
    minHeight: TOUCH_TARGET + 12,
    borderRadius: r.md,
    backgroundColor: colors.surfaceElevated,
    borderWidth: 1,
    borderColor: colors.border,
    paddingHorizontal: spacing.lg,
    color: colors.text,
    fontSize: 28,
    fontWeight: '800',
  },
  unit: { color: colors.textMuted, fontSize: 16, fontWeight: '700' },
  hint: { color: colors.textFaint, fontSize: 12, lineHeight: 17 },
  switchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    backgroundColor: colors.surface,
    borderRadius: r.lg,
    padding: spacing.lg,
    borderWidth: 1,
    borderColor: colors.border,
    marginTop: spacing.md,
  },
  switchLabel: { color: colors.text, fontSize: 15, fontWeight: '700' },
  primaryButton: {
    minHeight: TOUCH_TARGET + 8,
    borderRadius: r.pill,
    backgroundColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: spacing.lg,
  },
  primaryText: { color: colors.onPrimary, fontSize: 16, fontWeight: '900', letterSpacing: 0.5 },
  pressed: { opacity: 0.85 },
  disclaimer: { color: colors.textFaint, fontSize: 11, lineHeight: 16, marginTop: spacing.md },
});
