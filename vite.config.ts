import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { VitePWA } from "vite-plugin-pwa";

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      // Vocabulary and replacement rules ship in the app bundle. Activate a
      // new bundle as soon as it is available so a stale PWA worker cannot
      // keep users on an older whitelist after a deployment.
      registerType: "autoUpdate",
      includeAssets: ["pwa-192.svg", "pwa-512.svg"],
      manifest: {
        name: "沉浸式小说背单词",
        short_name: "小说背单词",
        description: "本地读取小说，用 CET4 单词沉浸式替换中文词。",
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
        runtimeCaching: []
      }
    })
  ]
});
