/**
 * Sistema visual de GASGO.
 * Oscuro por defecto: el mapa es el protagonista y los precios deben destacar sobre él.
 */

export const colors = {
  background: '#0B0F14',
  surface: '#151B23',
  surfaceElevated: '#1D2530',
  border: '#263140',

  text: '#F2F6FA',
  textMuted: '#93A1B0',
  textFaint: '#5D6C7C',

  /** Verde GASGO: precio bueno, acción principal. */
  primary: '#00E08F',
  primaryDark: '#00B673',
  onPrimary: '#04140D',

  /** Escala de precio: del más barato al más caro. */
  priceBest: '#00E08F',
  priceGood: '#7BE04A',
  priceMid: '#F2C14E',
  priceHigh: '#F28C4E',
  priceWorst: '#F2555A',

  warning: '#F2C14E',
  danger: '#F2555A',
  info: '#4EA8F2',
} as const;

export const spacing = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 24,
  xxl: 32,
} as const;

export const radius = {
  sm: 8,
  md: 12,
  lg: 18,
  xl: 26,
  pill: 999,
} as const;

export const typography = {
  display: { fontSize: 34, fontWeight: '800' as const, letterSpacing: -0.8 },
  title: { fontSize: 22, fontWeight: '700' as const, letterSpacing: -0.4 },
  price: { fontSize: 28, fontWeight: '800' as const, letterSpacing: -0.8 },
  body: { fontSize: 15, fontWeight: '500' as const },
  label: { fontSize: 13, fontWeight: '600' as const },
  caption: { fontSize: 12, fontWeight: '500' as const },
} as const;

/** Área mínima táctil recomendada por Apple y Google. */
export const TOUCH_TARGET = 44;

export const shadow = {
  card: {
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.35,
    shadowRadius: 16,
    elevation: 8,
  },
  marker: {
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.3,
    shadowRadius: 4,
    elevation: 4,
  },
} as const;

/**
 * Color del marcador según la posición del precio dentro del rango visible.
 * Ratio 0 = el más barato del entorno, 1 = el más caro.
 */
export function priceColor(ratio: number): string {
  if (!Number.isFinite(ratio)) return colors.priceMid;
  if (ratio <= 0.15) return colors.priceBest;
  if (ratio <= 0.35) return colors.priceGood;
  if (ratio <= 0.65) return colors.priceMid;
  if (ratio <= 0.85) return colors.priceHigh;
  return colors.priceWorst;
}
