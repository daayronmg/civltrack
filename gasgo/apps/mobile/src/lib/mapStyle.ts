/**
 * Estilo oscuro del mapa (Android/Google Maps).
 * Objetivo: bajar el ruido del mapa para que los precios sean lo único que destaque.
 * En iOS con MapKit se usa el modo oscuro del sistema, que ya cumple ese papel.
 */
export const MAP_DARK_STYLE = [
  { elementType: 'geometry', stylers: [{ color: '#0F141A' }] },
  { elementType: 'labels.text.stroke', stylers: [{ color: '#0F141A' }] },
  { elementType: 'labels.text.fill', stylers: [{ color: '#7A8A99' }] },
  { featureType: 'poi', stylers: [{ visibility: 'off' }] },
  { featureType: 'transit', stylers: [{ visibility: 'off' }] },
  {
    featureType: 'road',
    elementType: 'geometry',
    stylers: [{ color: '#1B232C' }],
  },
  {
    featureType: 'road.arterial',
    elementType: 'geometry',
    stylers: [{ color: '#232C36' }],
  },
  {
    featureType: 'road.highway',
    elementType: 'geometry',
    stylers: [{ color: '#2C3844' }],
  },
  {
    featureType: 'road',
    elementType: 'labels.text.fill',
    stylers: [{ color: '#6B7B8B' }],
  },
  { featureType: 'water', elementType: 'geometry', stylers: [{ color: '#080C10' }] },
  {
    featureType: 'water',
    elementType: 'labels.text.fill',
    stylers: [{ color: '#3D4C5C' }],
  },
  {
    featureType: 'administrative',
    elementType: 'geometry.stroke',
    stylers: [{ color: '#2A343F' }],
  },
];
