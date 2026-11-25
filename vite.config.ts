import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';
import { fileURLToPath, URL } from 'node:url';

import { env } from 'node:process';

const rawWebBase = env.VITE_WEB_BASE?.trim();
const normalizedWebBase = rawWebBase ? `${rawWebBase.replace(/\/+$/, '')}/` : '';
const webBase = normalizedWebBase || './';
const manifestScope = normalizedWebBase || '/';

// https://vitejs.dev/config/
export default defineConfig({
  base: webBase,
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: [
        'apple-touch-icon.png',
        'pwa-192x192.png',
        'pwa-512x512.png',
        'pwa-maskable-512x512.png',
        'icons/school-app-icon.png',
        'library/field-guide-educational-duty.pdf',
        'library/law-08-04.pdf',
      ],
      manifest: {
        id: manifestScope,
        name: 'الإشراف التربوي',
        short_name: 'الإشراف',
        description: 'برنامج الإشراف التربوي لإدارة المؤسسة المدرسية والعمل دون إنترنت.',
        lang: 'ar',
        dir: 'rtl',
        categories: ['education', 'productivity'],
        theme_color: '#1e6fd9',
        background_color: '#ffffff',
        display: 'standalone',
        display_override: ['standalone'],
        prefer_related_applications: false,
        start_url: manifestScope,
        scope: manifestScope,
        shortcuts: [
          {
            name: 'الغيابات والتأخرات',
            short_name: 'الغيابات',
            url: `${manifestScope}?tab=absences`,
            icons: [{ src: `${manifestScope}pwa-192x192.png`, sizes: '192x192', type: 'image/png' }],
          },
          {
            name: 'الدخول اليومي',
            short_name: 'الدخول',
            url: `${manifestScope}?tab=entry`,
            icons: [{ src: `${manifestScope}pwa-192x192.png`, sizes: '192x192', type: 'image/png' }],
          },
          {
            name: 'البحث السريع',
            short_name: 'بحث',
            url: `${manifestScope}?tab=search`,
            icons: [{ src: `${manifestScope}pwa-192x192.png`, sizes: '192x192', type: 'image/png' }],
          },
        ],
        icons: [
          {
            src: `${manifestScope}pwa-192x192.png`,
            sizes: '192x192',
            type: 'image/png',
            purpose: 'any',
          },
          {
            src: `${manifestScope}pwa-512x512.png`,
            sizes: '512x512',
            type: 'image/png',
            purpose: 'any',
          },
          {
            src: `${manifestScope}pwa-maskable-512x512.png`,
            sizes: '512x512',
            type: 'image/png',
            purpose: 'maskable',
          },
        ],
      },
      workbox: {
        globPatterns: ['**/*.{js,mjs,css,html,ico,png,svg,woff,woff2,pdf}'],
        maximumFileSizeToCacheInBytes: 10 * 1024 * 1024,
        runtimeCaching: [
          {
            urlPattern: ({ url }) => url.pathname.includes('/pdfjs/'),
            handler: 'CacheFirst',
            options: {
              cacheName: 'pdfjs-static-assets',
              expiration: {
                maxEntries: 250,
                maxAgeSeconds: 60 * 60 * 24 * 365,
              },
            },
          },
        ],
      },
      devOptions: {
        enabled: true,
        type: 'module',
      },
    }),
  ],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  build: {
    target: ['es2015', 'chrome55', 'safari12'],
    cssTarget: 'chrome55',
  },
  optimizeDeps: {
    exclude: ['lucide-react'],
    esbuildOptions: {
      target: 'es2015',
    },
  },
  server: {
    host: '0.0.0.0',
    port: 3000,
    allowedHosts: true,
    hmr: env.DISABLE_HMR !== 'true',
    watch: env.DISABLE_HMR === 'true' ? null : {},
  },
});
