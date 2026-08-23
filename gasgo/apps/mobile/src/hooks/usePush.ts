import { useCallback } from 'react';
import { Platform } from 'react-native';
import * as Notifications from 'expo-notifications';
import * as Device from 'expo-device';
import Constants from 'expo-constants';
import { api } from '../lib/api';
import { preferences } from '../lib/storage';

Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowBanner: true,
    shouldShowList: true,
    shouldPlaySound: true,
    shouldSetBadge: false,
  }),
});

/**
 * Notificaciones push para las alertas de precio.
 *
 * El consentimiento es explícito y revocable (RGPD). Si el usuario lo retira, el token se
 * borra del servidor: la alerta puede seguir existiendo pero deja de notificar.
 */
export function usePush() {
  const enable = useCallback(async (deviceToken: string): Promise<{ ok: boolean; motivo?: string }> => {
    if (!Device.isDevice) {
      return { ok: false, motivo: 'Las notificaciones solo funcionan en un dispositivo real.' };
    }

    const existing = await Notifications.getPermissionsAsync();
    let status = existing.status;
    if (status !== 'granted') {
      const requested = await Notifications.requestPermissionsAsync();
      status = requested.status;
    }
    if (status !== 'granted') {
      return { ok: false, motivo: 'No has concedido permiso de notificaciones.' };
    }

    if (Platform.OS === 'android') {
      await Notifications.setNotificationChannelAsync('alertas-precio', {
        name: 'Alertas de precio',
        importance: Notifications.AndroidImportance.HIGH,
        vibrationPattern: [0, 200, 100, 200],
        lightColor: '#00E08F',
      });
    }

    const projectId =
      Constants.expoConfig?.extra?.eas?.projectId ?? Constants.easConfig?.projectId ?? undefined;

    const { data: pushToken } = await Notifications.getExpoPushTokenAsync(
      projectId ? { projectId } : undefined,
    );

    await api.setPushToken(deviceToken, pushToken, true);
    await preferences.setPushConsent(true);
    return { ok: true };
  }, []);

  const disable = useCallback(async (deviceToken: string): Promise<void> => {
    await api.setPushToken(deviceToken, null, false);
    await preferences.setPushConsent(false);
  }, []);

  return { enable, disable };
}
