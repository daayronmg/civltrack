/**
 * Caché en memoria con invalidación por volcado.
 *
 * La clave incluye la marca de tiempo del último volcado oficial: cuando entra uno nuevo,
 * todas las entradas anteriores dejan de usarse solas. Nunca se sirve un precio de un
 * volcado antiguo como si fuera del actual.
 */
export class SnapshotCache {
  private entries = new Map<string, { value: unknown; expiresAt: number }>();

  constructor(
    private readonly ttlMs = 60_000,
    private readonly maxEntries = 1_000,
  ) {}

  private compose(key: string, snapshotAt: Date | null): string {
    return `${snapshotAt ? snapshotAt.getTime() : 'sin-datos'}::${key}`;
  }

  get<T>(key: string, snapshotAt: Date | null): T | undefined {
    const composed = this.compose(key, snapshotAt);
    const entry = this.entries.get(composed);
    if (!entry) return undefined;
    if (entry.expiresAt < Date.now()) {
      this.entries.delete(composed);
      return undefined;
    }
    return entry.value as T;
  }

  set(key: string, snapshotAt: Date | null, value: unknown): void {
    if (this.entries.size >= this.maxEntries) {
      // Purga simple: fuera lo más antiguo insertado.
      const oldest = this.entries.keys().next().value;
      if (oldest !== undefined) this.entries.delete(oldest);
    }
    this.entries.set(this.compose(key, snapshotAt), {
      value,
      expiresAt: Date.now() + this.ttlMs,
    });
  }

  clear(): void {
    this.entries.clear();
  }

  get size(): number {
    return this.entries.size;
  }
}
