import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    globals: false,
    testTimeout: 30_000,
    hookTimeout: 60_000,
    fileParallelism: false,
    include: ['test/**/*.test.ts'],
    // Los tests comparten IP: subimos los límites para no toparnos con el rate limit
    // mientras se ejercita el mismo código de producción.
    env: {
      RATE_LIMIT_MAX: '100000',
      DEVICE_REGISTRATIONS_PER_HOUR: '100000',
      // Red de seguridad: si un test olvidara inyectar un emisor falso, el envío
      // fallaría contra una dirección local en lugar de salir a Internet.
      EXPO_PUSH_URL: 'http://127.0.0.1:9/push-desactivado-en-tests',
    },
  },
});
