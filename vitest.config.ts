import { defineConfig } from 'vitest/config';

// Separate from vite.config.ts so the Cloudflare plugin doesn't load in unit tests.
export default defineConfig({
  test: {
    include: ['test/**/*.test.ts'],
    environment: 'node',
  },
});
