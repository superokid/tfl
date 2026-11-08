import { cloudflare } from '@cloudflare/vite-plugin';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [react(), cloudflare()],
  environments: {
    client: {
      build: {
        rolldownOptions: {
          output: {
            // React in its own chunk so the size check can budget app code separately (SPEC §3).
            codeSplitting: {
              groups: [{ name: 'vendor', test: /node_modules[\\/](react|react-dom|scheduler)[\\/]/ }],
            },
          },
        },
      },
    },
  },
});
