import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { VitePWA } from "vite-plugin-pwa";

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      // Activate a new bundle as soon as it is available so a stale PWA worker
      // cannot keep users on an older replacement whitelist after a deploy.
      registerType: "autoUpdate",
      includeAssets: ["pwa-192.svg", "pwa-512.svg"],
      manifest: {
        name: "沉浸式小说背单词",
        short_name: "小说背单词",
        description: "本地读取小说，用可选英语词库沉浸式替换中文词。",
        theme_color: "#14615c",
        background_color: "#f6f3ec",
        display: "standalone",
        orientation: "portrait",
        icons: [
          {
            src: "/pwa-192.svg",
            sizes: "192x192",
            type: "image/svg+xml",
            purpose: "any maskable"
          },
          {
            src: "/pwa-512.svg",
            sizes: "512x512",
            type: "image/svg+xml",
            purpose: "any maskable"
          }
        ]
      },
      workbox: {
        globPatterns: ["**/*.{js,css,html,svg,json,webp}"],
        // Large vocabulary packs are selected after the shell opens. Do not
        // make a first install download every pack; cache a selected pack on
        // demand so it remains available offline after first use.
        globIgnores: ["**/*-map-*.js"],
        runtimeCaching: [
          {
            urlPattern: /\/assets\/(?:cet6|ielts|toefl)-map-[^/]+\.js$/,
            handler: "CacheFirst",
            options: {
              cacheName: "vocabulary-packs-v1",
              expiration: { maxEntries: 4, maxAgeSeconds: 60 * 60 * 24 * 365 },
            },
          },
        ]
      }
    })
  ]
});
