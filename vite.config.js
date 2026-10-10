import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'

export default defineConfig({
  plugins: [
    react(),
    // Manifest + service worker di-generate otomatis (Workbox). Aplikasi tanpa
    // mode offline: API (/api, /uploads) sengaja TIDAK di-cache (README §12),
    // hanya shell statis. SW harus di-serve lewat HTTPS (nginx :9999) agar
    // Chrome menawarkan "Install app".
    VitePWA({
      registerType: 'autoUpdate',
      manifest: {
        name: 'POS Minimarket',
        short_name: 'POS',
        description: 'Aplikasi Point of Sale minimarket',
        lang: 'id',
        start_url: '/',
        scope: '/',
        display: 'standalone',
        background_color: '#121212',
        theme_color: '#0a84ff',
        icons: [
          { src: 'pwa-192x192.png', sizes: '192x192', type: 'image/png' },
          { src: 'pwa-512x512.png', sizes: '512x512', type: 'image/png' },
          {
            src: 'pwa-512x512-maskable.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'maskable',
          },
        ],
      },
      workbox: {
        // SPA fallback cocok dengan try_files nginx. Precache hanya aset statis.
        navigateFallback: '/index.html',
        globPatterns: ['**/*.{js,css,html,svg,png,ico,woff2}'],
      },
    }),
  ],
  server: {
    port: 3000,
    host: true,
    proxy: {
      '/api': {
        target: 'http://localhost:5000',
        changeOrigin: true,
      },
      '/uploads': {
        target: 'http://localhost:5000',
        changeOrigin: true,
      },
    },
  },
})
