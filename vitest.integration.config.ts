import { defineConfig } from 'vitest/config';
import { loadEnv } from 'vite';

export default defineConfig({
  test: {
    include: ['**/*.integration.test.ts'],
    environment: 'node',
    testTimeout: 60000, // 60s for API calls
    env: loadEnv('', process.cwd(), ''),
  },
});
