/**
 * Catálogo de combustibles de GASGO.
 *
 * Cada entrada enlaza un código interno estable con la COLUMNA EXACTA que publica la API
 * oficial del Ministerio (`Precio <NombreProducto>`), respetando espacios y tildes.
 * Este fichero es la única traducción entre la fuente oficial y el dominio de GASGO.
 *
 * Si el Ministerio publica un producto nuevo, la columna aparecerá como desconocida en
 * `ingestion_runs.unknown_columns` y habrá que añadirla aquí; nunca se descarta en silencio.
 */

export type FuelCode =
  | 'G95E5'
  | 'G95E5_PREMIUM'
  | 'G95E10'
  | 'G98E5'
  | 'G98E10'
  | 'GOA'
  | 'GOA_PREMIUM'
  | 'GOB'
  | 'GOC'
  | 'GLP'
  | 'GNC'
  | 'GNL'
  | 'BIODIESEL'
  | 'BIOETANOL'
  | 'HIDROGENO'
  | 'AMONIACO'
  | 'METANOL';

export type FuelFamily = 'gasolina' | 'diesel' | 'gas' | 'otros';

/** Unidad en la que la fuente oficial publica el precio del producto. */
export type FuelUnit = 'eur_litro' | 'eur_kg';

export interface FuelDefinition {
  code: FuelCode;
  /** Nombre para la interfaz, en español. */
  label: string;
  /** Nombre corto para chips y marcadores del mapa. */
  shortLabel: string;
  family: FuelFamily;
  unit: FuelUnit;
  /** Columna literal del JSON oficial. */
  sourceColumn: string;
  /** Etiqueta europea de surtidor (Reglamento UE 2018/1832 / EN 16942), si aplica. */
  pumpLabel?: string;
  /** Rango absoluto plausible en España, usado por el sistema antierrores. */
  plausibleRange: { min: number; max: number };
  /** Combustibles principales: se ofrecen en el selector rápido de la pantalla del mapa. */
  primary: boolean;
}

/**
 * Rangos: son deliberadamente amplios. No sirven para "corregir" un precio, solo para
 * detectar valores imposibles (p. ej. un decimal desplazado: 1,489 → 0,149).
 */
export const FUELS: readonly FuelDefinition[] = [
  {
    code: 'G95E5',
    label: 'Gasolina 95 E5',
    shortLabel: '95',
    family: 'gasolina',
    unit: 'eur_litro',
    sourceColumn: 'Precio Gasolina 95 E5',
    pumpLabel: 'E5',
    plausibleRange: { min: 0.7, max: 3.5 },
    primary: true,
  },
  {
    code: 'G95E5_PREMIUM',
    label: 'Gasolina 95 E5 Premium',
    shortLabel: '95+',
    family: 'gasolina',
    unit: 'eur_litro',
    sourceColumn: 'Precio Gasolina 95 E5 Premium',
    pumpLabel: 'E5',
    plausibleRange: { min: 0.7, max: 3.8 },
    primary: false,
  },
  {
    code: 'G95E10',
    label: 'Gasolina 95 E10',
    shortLabel: '95 E10',
    family: 'gasolina',
    unit: 'eur_litro',
    sourceColumn: 'Precio Gasolina 95 E10',
    pumpLabel: 'E10',
    plausibleRange: { min: 0.7, max: 3.5 },
    primary: false,
  },
  {
    code: 'G98E5',
    label: 'Gasolina 98 E5',
    shortLabel: '98',
    family: 'gasolina',
    unit: 'eur_litro',
    sourceColumn: 'Precio Gasolina 98 E5',
    pumpLabel: 'E5',
    plausibleRange: { min: 0.7, max: 3.8 },
    primary: true,
  },
  {
    code: 'G98E10',
    label: 'Gasolina 98 E10',
    shortLabel: '98 E10',
    family: 'gasolina',
    unit: 'eur_litro',
    sourceColumn: 'Precio Gasolina 98 E10',
    pumpLabel: 'E10',
    plausibleRange: { min: 0.7, max: 3.8 },
    primary: false,
  },
  {
    code: 'GOA',
    label: 'Gasóleo A',
    shortLabel: 'Diésel',
    family: 'diesel',
    unit: 'eur_litro',
    sourceColumn: 'Precio Gasoleo A',
    pumpLabel: 'B7',
    plausibleRange: { min: 0.7, max: 3.5 },
    primary: true,
  },
  {
    code: 'GOA_PREMIUM',
    label: 'Gasóleo Premium',
    shortLabel: 'Diésel+',
    family: 'diesel',
    unit: 'eur_litro',
    sourceColumn: 'Precio Gasoleo Premium',
    pumpLabel: 'B7',
    plausibleRange: { min: 0.7, max: 3.8 },
    primary: true,
  },
  {
    code: 'GOB',
    label: 'Gasóleo B (agrícola)',
    shortLabel: 'Gasóleo B',
    family: 'diesel',
    unit: 'eur_litro',
    sourceColumn: 'Precio Gasoleo B',
    plausibleRange: { min: 0.4, max: 3.0 },
    primary: false,
  },
  {
    code: 'GOC',
    label: 'Gasóleo C (calefacción)',
    shortLabel: 'Gasóleo C',
    family: 'diesel',
    unit: 'eur_litro',
    sourceColumn: 'Precio Gasoleo C',
    plausibleRange: { min: 0.4, max: 3.0 },
    primary: false,
  },
  {
    code: 'GLP',
    label: 'Gases licuados del petróleo (GLP)',
    shortLabel: 'GLP',
    family: 'gas',
    unit: 'eur_litro',
    sourceColumn: 'Precio Gases licuados del petróleo',
    pumpLabel: 'LPG',
    plausibleRange: { min: 0.3, max: 2.5 },
    primary: true,
  },
  {
    code: 'GNC',
    label: 'Gas natural comprimido (GNC)',
    shortLabel: 'GNC',
    family: 'gas',
    unit: 'eur_kg',
    sourceColumn: 'Precio Gas Natural Comprimido',
    pumpLabel: 'CNG',
    plausibleRange: { min: 0.3, max: 4.0 },
    primary: true,
  },
  {
    code: 'GNL',
    label: 'Gas natural licuado (GNL)',
    shortLabel: 'GNL',
    family: 'gas',
    unit: 'eur_kg',
    sourceColumn: 'Precio Gas Natural Licuado',
    pumpLabel: 'LNG',
    plausibleRange: { min: 0.3, max: 4.0 },
    primary: false,
  },
  {
    code: 'BIODIESEL',
    label: 'Biodiésel',
    shortLabel: 'Biodiésel',
    family: 'otros',
    unit: 'eur_litro',
    sourceColumn: 'Precio Biodiesel',
    plausibleRange: { min: 0.4, max: 3.5 },
    primary: false,
  },
  {
    code: 'BIOETANOL',
    label: 'Bioetanol',
    shortLabel: 'Bioetanol',
    family: 'otros',
    unit: 'eur_litro',
    sourceColumn: 'Precio Bioetanol',
    pumpLabel: 'E85',
    plausibleRange: { min: 0.4, max: 3.5 },
    primary: false,
  },
  {
    code: 'HIDROGENO',
    label: 'Hidrógeno',
    shortLabel: 'H₂',
    family: 'otros',
    unit: 'eur_kg',
    sourceColumn: 'Precio Hidrogeno',
    pumpLabel: 'H2',
    plausibleRange: { min: 1, max: 30 },
    primary: false,
  },
  {
    code: 'AMONIACO',
    label: 'Amoniaco',
    shortLabel: 'NH₃',
    family: 'otros',
    unit: 'eur_kg',
    sourceColumn: 'Precio Amoniaco',
    plausibleRange: { min: 0.1, max: 30 },
    primary: false,
  },
  {
    code: 'METANOL',
    label: 'Metanol',
    shortLabel: 'Metanol',
    family: 'otros',
    unit: 'eur_litro',
    sourceColumn: 'Precio Metanol',
    plausibleRange: { min: 0.1, max: 30 },
    primary: false,
  },
] as const;

const BY_CODE = new Map<FuelCode, FuelDefinition>(FUELS.map((f) => [f.code, f]));
const BY_COLUMN = new Map<string, FuelDefinition>(FUELS.map((f) => [f.sourceColumn, f]));

export function getFuel(code: FuelCode): FuelDefinition {
  const fuel = BY_CODE.get(code);
  if (!fuel) throw new Error(`Combustible desconocido: ${code}`);
  return fuel;
}

export function findFuel(code: string): FuelDefinition | undefined {
  return BY_CODE.get(code as FuelCode);
}

/** Traduce una columna del JSON oficial a su definición, o `undefined` si no la conocemos. */
export function fuelFromSourceColumn(column: string): FuelDefinition | undefined {
  return BY_COLUMN.get(column);
}

export function isFuelCode(value: string): value is FuelCode {
  return BY_CODE.has(value as FuelCode);
}

export const PRIMARY_FUELS: readonly FuelDefinition[] = FUELS.filter((f) => f.primary);

/** Unidad mostrada junto al precio: «€/L» o «€/kg». */
export function priceUnitLabel(fuel: FuelDefinition): string {
  return fuel.unit === 'eur_kg' ? '€/kg' : '€/L';
}
