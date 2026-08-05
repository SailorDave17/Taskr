import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'

// The install target is Android Chrome only — the household is single-platform
// (owner-confirmed at pickup of #4). iOS Safari meta tags are deliberately absent
// rather than added speculatively; see docs/hosting-decision.md.
export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['favicon.svg'],
      manifest: {
        name: 'Taskr',
        short_name: 'Taskr',
        description: 'Fair, time-budget allocation of household chores',
        theme_color: '#1f6f5c',
        background_color: '#12171c',
        display: 'standalone',
        start_url: '/',
        scope: '/',
        icons: [
          { src: 'icons/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
          { src: 'icons/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
          { src: 'icons/icon-512-maskable.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
    }),
  ],
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: './src/test/setup.js',
    // AC 4: a suite with zero tests must FAIL, not pass vacuously. This is
    // Vitest's default, but it is set explicitly because a default can change
    // under us and a check that cannot fail is worse than none.
    passWithNoTests: false,
  },
})
