import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { VitePWA } from "vite-plugin-pwa";

// COOP/COEP:引擎多執行緒(SharedArrayBuffer)必需。
// 正式部署時由 public/_headers(Netlify/Cloudflare Pages)提供同樣標頭。
const coopCoep = {
  "Cross-Origin-Opener-Policy": "same-origin",
  "Cross-Origin-Embedder-Policy": "require-corp",
};

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: "autoUpdate",
      includeAssets: ["icons/apple-touch-icon.png"],
      manifest: {
        name: "象棋記譜",
        short_name: "象棋記譜",
        description:
          "面對面實體象棋對局的語音、拍照、點棋盤記譜工具，含本機引擎復盤與殘局解析（離線可用）",
        lang: "zh-TW",
        id: "/",
        scope: "/",
        display: "standalone",
        orientation: "portrait",
        start_url: "/",
        categories: ["games", "education", "utilities"],
        theme_color: "#7c4a21",
        background_color: "#f5e9d3",
        icons: [
          { src: "icons/icon-192.png", sizes: "192x192", type: "image/png" },
          { src: "icons/icon-512.png", sizes: "512x512", type: "image/png" },
          {
            src: "icons/icon-512.png",
            sizes: "512x512",
            type: "image/png",
            purpose: "maskable",
          },
        ],
      },
      workbox: {
        globPatterns: ["**/*.{js,css,html,svg,png,woff2,wasm}"],
        maximumFileSizeToCacheInBytes: 6 * 1024 * 1024,
        // NNUE 棋力檔(10.7MB)不預快取:首次使用引擎時下載並永久快取
        runtimeCaching: [
          {
            urlPattern: /\/engine\/.*\.nnue$/,
            handler: "CacheFirst",
            options: {
              cacheName: "nnue-v1",
              expiration: { maxEntries: 2 },
              cacheableResponse: { statuses: [0, 200] },
            },
          },
          {
            urlPattern: /\/models\/.*\.bin$/,
            handler: "CacheFirst",
            options: {
              cacheName: "models-v1",
              expiration: { maxEntries: 4 },
              cacheableResponse: { statuses: [0, 200] },
            },
          },
        ],
      },
    }),
  ],
  server: { headers: coopCoep },
  preview: { headers: coopCoep },
  build: { target: "es2021" },
});
