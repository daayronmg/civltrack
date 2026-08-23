import React, { useEffect, useState } from 'react';
import {
  Alert as RNAlert,
  Linking,
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  View,
} from 'react-native';
import Constants from 'expo-constants';
import { FUELS, SOURCE_ATTRIBUTION, computeFreshness, getFuel } from '@gasgo/core';
import { api } from '../../src/lib/api';
import { useDevice } from '../../src/hooks/useDevice';
import { usePush } from '../../src/hooks/usePush';
import { usePreferences } from '../../src/hooks/usePreferences';
import { useSourceMeta } from '../../src/hooks/useStations';
import { preferences } from '../../src/lib/storage';
import { colors, radius as r, spacing, TOUCH_TARGET } from '../../src/theme';

/**
 * Perfil: vehículo, notificaciones, transparencia sobre la fuente y control de datos (RGPD).
 */
export default function ProfileScreen() {
  const { token, ensureToken, forget } = useDevice();
  const { enable, disable } = usePush();
  const { vehicle, setVehicle } = usePreferences();
  const { data: meta } = useSourceMeta();

  const [consumo, setConsumo] = useState(String(vehicle.consumptionPer100Km));
  const [deposito, setDeposito] = useState(String(vehicle.tankCapacityLiters));
  const [litros, setLitros] = useState(
    vehicle.typicalRefuelLiters ? String(vehicle.typicalRefuelLiters) : '',
  );
  const [pushConsent, setPushConsent] = useState(false);

  useEffect(() => {
    setConsumo(String(vehicle.consumptionPer100Km));
    setDeposito(String(vehicle.tankCapacityLiters));
    setLitros(vehicle.typicalRefuelLiters ? String(vehicle.typicalRefuelLiters) : '');
  }, [vehicle]);

  useEffect(() => {
    void preferences.getPushConsent().then(setPushConsent);
  }, []);

  function guardarVehiculo(): void {
    const consumption = Number(consumo.replace(',', '.'));
    const tank = Number(deposito.replace(',', '.'));
    const refuel = litros.trim() === '' ? undefined : Number(litros.replace(',', '.'));

    if (!Number.isFinite(consumption) || consumption <= 0 || consumption > 99) {
      RNAlert.alert('Consumo no válido', 'Introduce un consumo entre 0 y 99 L/100 km.');
      return;
    }
    if (!Number.isFinite(tank) || tank <= 0 || tank > 1000) {
      RNAlert.alert('Depósito no válido', 'Introduce una capacidad entre 0 y 1000 litros.');
      return;
    }
    if (refuel !== undefined && (!Number.isFinite(refuel) || refuel <= 0 || refuel > tank)) {
      RNAlert.alert('Litros no válidos', 'Los litros habituales no pueden superar la capacidad del depósito.');
      return;
    }

    void setVehicle({
      fuel: vehicle.fuel,
      consumptionPer100Km: consumption,
      tankCapacityLiters: tank,
      typicalRefuelLiters: refuel,
    });
    RNAlert.alert('Guardado', 'GASGO usará estos datos para calcular tu ahorro real.');
  }

  async function togglePush(value: boolean): Promise<void> {
    try {
      const deviceToken = await ensureToken();
      if (value) {
        const result = await enable(deviceToken);
        if (!result.ok) {
          RNAlert.alert('No se han podido activar', result.motivo ?? 'Inténtalo de nuevo.');
          return;
        }
      } else {
        await disable(deviceToken);
      }
      setPushConsent(value);
    } catch {
      RNAlert.alert('Error', 'No se ha podido actualizar la configuración de notificaciones.');
    }
  }

  function borrarDatos(): void {
    RNAlert.alert(
      'Eliminar mis datos',
      'Se borrarán del servidor tus alertas, favoritos y el identificador anónimo de este dispositivo. Esta acción no se puede deshacer.',
      [
        { text: 'Cancelar', style: 'cancel' },
        {
          text: 'Eliminar todo',
          style: 'destructive',
          onPress: async () => {
            await forget();
            await preferences.clearAll();
            RNAlert.alert('Hecho', 'Tus datos han sido eliminados.');
          },
        },
      ],
    );
  }

  async function exportarDatos(): Promise<void> {
    if (!token) {
      RNAlert.alert('Nada que exportar', 'Todavía no has guardado ningún dato en GASGO.');
      return;
    }
    try {
      const data = await api.exportData(token);
      RNAlert.alert('Tus datos', JSON.stringify(data, null, 2).slice(0, 900));
    } catch {
      RNAlert.alert('Error', 'No se han podido recuperar tus datos.');
    }
  }

  const freshness = meta?.lastSnapshotAt
    ? computeFreshness({ snapshotAt: new Date(meta.lastSnapshotAt) })
    : null;

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      {/* ------------------------------------------------------------ vehículo */}
      <Text style={styles.sectionTitle}>Tu vehículo</Text>
      <View style={styles.card}>
        <Text style={styles.label}>Combustible</Text>
        <View style={styles.fuelGrid}>
          {FUELS.filter((f) => f.primary).map((f) => (
            <Pressable
              key={f.code}
              accessibilityRole="button"
              accessibilityState={{ selected: vehicle.fuel === f.code }}
              onPress={() => void setVehicle({ ...vehicle, fuel: f.code })}
              style={[styles.fuelChip, vehicle.fuel === f.code && styles.fuelChipActive]}
            >
              <Text style={[styles.fuelText, vehicle.fuel === f.code && styles.fuelTextActive]}>
                {f.shortLabel}
              </Text>
            </Pressable>
          ))}
        </View>
        <Text style={styles.hint}>Ahora mismo: {getFuel(vehicle.fuel).label}</Text>

        <Text style={styles.label}>Consumo medio (L/100 km)</Text>
        <TextInput
          style={styles.input}
          value={consumo}
          onChangeText={setConsumo}
          keyboardType="decimal-pad"
          placeholder="6,5"
          placeholderTextColor={colors.textFaint}
        />

        <Text style={styles.label}>Capacidad del depósito (L)</Text>
        <TextInput
          style={styles.input}
          value={deposito}
          onChangeText={setDeposito}
          keyboardType="decimal-pad"
          placeholder="50"
          placeholderTextColor={colors.textFaint}
        />

        <Text style={styles.label}>Litros que sueles repostar</Text>
        <TextInput
          style={styles.input}
          value={litros}
          onChangeText={setLitros}
          keyboardType="decimal-pad"
          placeholder="40"
          placeholderTextColor={colors.textFaint}
        />

        <Pressable
          accessibilityRole="button"
          onPress={guardarVehiculo}
          style={({ pressed }) => [styles.primaryButton, pressed && styles.pressed]}
        >
          <Text style={styles.primaryText}>GUARDAR</Text>
        </Pressable>
        <Text style={styles.hint}>
          Con estos datos GASGO calcula si compensa desviarse a una gasolinera más barata.
        </Text>
      </View>

      {/* -------------------------------------------------------- notificaciones */}
      <Text style={styles.sectionTitle}>Notificaciones</Text>
      <View style={styles.card}>
        <View style={styles.switchRow}>
          <View style={{ flex: 1 }}>
            <Text style={styles.switchLabel}>Avisos de alertas de precio</Text>
            <Text style={styles.hint}>
              Solo se usan para avisarte cuando se cumple una alerta que tú hayas creado.
            </Text>
          </View>
          <Switch
            value={pushConsent}
            onValueChange={(value) => void togglePush(value)}
            trackColor={{ true: colors.primary, false: colors.border }}
            thumbColor={colors.text}
          />
        </View>
      </View>

      {/* ---------------------------------------------------------- transparencia */}
      <Text style={styles.sectionTitle}>De dónde salen los precios</Text>
      <View style={styles.card}>
        <Text style={styles.body}>{SOURCE_ATTRIBUTION}</Text>
        {meta?.hasData ? (
          <>
            <Text style={styles.hint}>
              Último volcado oficial: {new Date(meta.lastSnapshotAt!).toLocaleString('es-ES')}
              {freshness ? ` (${freshness.confirmedLabel.toLowerCase()})` : ''}
            </Text>
            <Text style={styles.hint}>{meta.stationCount} gasolineras activas en la base de datos.</Text>
          </>
        ) : (
          <Text style={styles.warning}>
            Todavía no hay datos oficiales cargados. GASGO no muestra precios hasta que existan.
          </Text>
        )}
        <Text style={styles.hint}>
          Los precios NO son en tiempo real: son los últimos que cada estación ha comunicado a la
          Administración. GASGO siempre te dice cuándo se confirmó cada uno.
        </Text>
        <Pressable
          accessibilityRole="link"
          onPress={() => void Linking.openURL('https://geoportalgasolineras.es/')}
          style={styles.linkButton}
        >
          <Text style={styles.link}>Ver el geoportal oficial ↗</Text>
        </Pressable>
      </View>

      {/* ------------------------------------------------------------ privacidad */}
      <Text style={styles.sectionTitle}>Privacidad y tus datos</Text>
      <View style={styles.card}>
        <Text style={styles.body}>
          GASGO no te pide correo ni cuenta. Tu ubicación se usa mientras usas la app y no se
          guarda ningún historial de posiciones.
        </Text>
        <Pressable accessibilityRole="button" onPress={() => void exportarDatos()} style={styles.secondaryButton}>
          <Text style={styles.secondaryText}>Exportar mis datos</Text>
        </Pressable>
        <Pressable accessibilityRole="button" onPress={borrarDatos} style={styles.dangerButton}>
          <Text style={styles.dangerText}>Eliminar mis datos</Text>
        </Pressable>
      </View>

      <Text style={styles.version}>
        GASGO {Constants.expoConfig?.version ?? '1.0.0'} · {api.baseUrl}
      </Text>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  content: { padding: spacing.lg, paddingBottom: spacing.xxl, gap: spacing.sm },
  sectionTitle: {
    color: colors.textMuted,
    fontSize: 12,
    fontWeight: '800',
    letterSpacing: 1,
    textTransform: 'uppercase',
    marginTop: spacing.lg,
    marginBottom: spacing.xs,
  },
  card: {
    backgroundColor: colors.surface,
    borderRadius: r.lg,
    padding: spacing.lg,
    gap: spacing.sm,
    borderWidth: 1,
    borderColor: colors.border,
  },
  label: { color: colors.textMuted, fontSize: 13, fontWeight: '700', marginTop: spacing.sm },
  input: {
    minHeight: TOUCH_TARGET,
    borderRadius: r.md,
    backgroundColor: colors.surfaceElevated,
    borderWidth: 1,
    borderColor: colors.border,
    paddingHorizontal: spacing.lg,
    color: colors.text,
    fontSize: 16,
    fontWeight: '600',
  },
  fuelGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  fuelChip: {
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
    borderRadius: r.pill,
    backgroundColor: colors.surfaceElevated,
    borderWidth: 1,
    borderColor: colors.border,
  },
  fuelChipActive: { backgroundColor: colors.primary, borderColor: colors.primary },
  fuelText: { color: colors.textMuted, fontSize: 13, fontWeight: '700' },
  fuelTextActive: { color: colors.onPrimary },
  hint: { color: colors.textFaint, fontSize: 12, lineHeight: 17 },
  body: { color: colors.textMuted, fontSize: 14, lineHeight: 20 },
  warning: { color: colors.warning, fontSize: 13, lineHeight: 19, fontWeight: '600' },
  primaryButton: {
    minHeight: TOUCH_TARGET,
    borderRadius: r.pill,
    backgroundColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: spacing.md,
  },
  primaryText: { color: colors.onPrimary, fontWeight: '900', fontSize: 15, letterSpacing: 0.5 },
  secondaryButton: {
    minHeight: TOUCH_TARGET,
    borderRadius: r.pill,
    backgroundColor: colors.surfaceElevated,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: colors.border,
  },
  secondaryText: { color: colors.text, fontWeight: '700', fontSize: 14 },
  dangerButton: {
    minHeight: TOUCH_TARGET,
    borderRadius: r.pill,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: colors.danger,
  },
  dangerText: { color: colors.danger, fontWeight: '700', fontSize: 14 },
  switchRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  switchLabel: { color: colors.text, fontSize: 15, fontWeight: '700' },
  linkButton: { paddingVertical: spacing.xs },
  link: { color: colors.info, fontSize: 13, fontWeight: '700' },
  version: { color: colors.textFaint, fontSize: 11, textAlign: 'center', marginTop: spacing.xl },
  pressed: { opacity: 0.85 },
});
