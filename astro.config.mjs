import { defineConfig } from 'astro/config';

export default defineConfig({
  // No integrations — vanilla JS only
  build: {
    assets: 'assets'
  },
  vite: {
    build: {
      rollupOptions: {
        output: {
          manualChunks: {
            three: ['three'],
            gsap: ['gsap'],
          }
        }
      }
    }
  }
});
