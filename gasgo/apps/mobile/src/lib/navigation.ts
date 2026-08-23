import { Linking, Platform } from 'react-native';

/**
 * Abre la app de mapas nativa con la gasolinera como destino.
 * iOS → Apple Maps; Android → Google Maps (con respaldo a un geo: genérico).
 */
export async function openDirections(params: {
  lat: number;
  lon: number;
  label: string;
}): Promise<boolean> {
  const { lat, lon, label } = params;
  const encoded = encodeURIComponent(label);

  const candidates =
    Platform.OS === 'ios'
      ? [`maps://?daddr=${lat},${lon}&dirflg=d`, `http://maps.apple.com/?daddr=${lat},${lon}`]
      : [
          `google.navigation:q=${lat},${lon}`,
          `geo:${lat},${lon}?q=${lat},${lon}(${encoded})`,
          `https://www.google.com/maps/dir/?api=1&destination=${lat},${lon}`,
        ];

  for (const url of candidates) {
    try {
      if (await Linking.canOpenURL(url)) {
        await Linking.openURL(url);
        return true;
      }
    } catch {
      // Probamos la siguiente opción.
    }
  }
  return false;
}
