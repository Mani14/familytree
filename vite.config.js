import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  // Relative base so the build works from any subpath (e.g. GitHub Pages
  // project sites at username.github.io/repo-name/) without hardcoding it.
  base: './',
  build: {
    rollupOptions: {
      output: {
        // Split the two largest always-loaded dependencies into their own
        // chunks. They change far less often than app code, so a deploy that
        // only touches components no longer busts their cached copy — repeat
        // visitors re-download just the small app chunk, not ~800KB of vendor.
        manualChunks(id) {
          if (!id.includes('node_modules')) return undefined;
          if (id.includes('firebase') || id.includes('@firebase')) return 'firebase';
          if (id.includes('framer-motion') || id.includes('motion-dom') || id.includes('motion-utils')) return 'framer-motion';
          return undefined;
        },
      },
    },
  },
});
