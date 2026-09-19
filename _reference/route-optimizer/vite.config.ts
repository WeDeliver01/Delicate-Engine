import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "path";
import runtimeErrorOverlay from "@replit/vite-plugin-runtime-error-modal";
import { VitePWA } from "vite-plugin-pwa";

export default defineConfig({
  plugins: [
    react(),
    runtimeErrorOverlay(),
    VitePWA({
      registerType: "autoUpdate",
      includeAssets: [
        "favicon.png", "apple-touch-icon.png", "pwa-192x192.png", "pwa-512x512.png",
        "driver-icon-192x192.png", "driver-icon-512x512.png", "driver-apple-touch-icon.png",
        "driver-manifest.json",
      ],
      manifest: {
        name: "Delicate Courier — Route Optimizer",
        short_name: "Delicate Courier",
        description: "Last-mile delivery route planner for the Pretoria/Tshwane area. CSV import, route optimization, live traffic, and trip management.",
        theme_color: "#ea5c0b",
        background_color: "#0f172a",
        display: "standalone",
        start_url: "/",
        scope: "/",
        orientation: "any",
        icons: [
          {
            src: "/pwa-192x192.png?v=3",
            sizes: "192x192",
            type: "image/png",
            purpose: "any maskable",
          },
          {
            src: "/pwa-512x512.png?v=3",
            sizes: "512x512",
            type: "image/png",
            purpose: "any maskable",
          },
          {
            src: "/apple-touch-icon.png?v=3",
            sizes: "180x180",
            type: "image/png",
          },
          {
            src: "/mstile-144x144.png?v=3",
            sizes: "144x144",
            type: "image/png",
          },
        ],
      },
      workbox: {
        skipWaiting: true,
        clientsClaim: true,
        cleanupOutdatedCaches: true,
        navigateFallback: "index.html",
        navigateFallbackDenylist: [/^\/api/, /^\/driver/],
        runtimeCaching: [
          {
            urlPattern: ({ url }: { url: URL }) => url.pathname.startsWith("/api/"),
            handler: "NetworkFirst" as const,
            options: {
              cacheName: "api-cache",
              expiration: {
                maxEntries: 50,
                maxAgeSeconds: 300,
              },
              networkTimeoutSeconds: 10,
            },
          },
          {
            urlPattern: ({ url }: { url: URL }) =>
              url.origin === self.location.origin &&
              /\.(png|jpg|jpeg|svg|gif|webp|ico)$/.test(url.pathname),
            handler: "CacheFirst" as const,
            options: {
              cacheName: "local-images-cache",
              expiration: {
                maxEntries: 60,
                maxAgeSeconds: 60 * 60 * 24 * 30,
              },
              cacheableResponse: {
                statuses: [0, 200],
              },
            },
          },
          {
            urlPattern: /^https:\/\/fonts\.googleapis\.com\/.*/i,
            handler: "CacheFirst" as const,
            options: {
              cacheName: "google-fonts-cache",
              expiration: {
                maxEntries: 10,
                maxAgeSeconds: 60 * 60 * 24 * 365,
              },
              cacheableResponse: {
                statuses: [0, 200],
              },
            },
          },
          {
            urlPattern: /^https:\/\/fonts\.gstatic\.com\/.*/i,
            handler: "CacheFirst" as const,
            options: {
              cacheName: "gstatic-fonts-cache",
              expiration: {
                maxEntries: 30,
                maxAgeSeconds: 60 * 60 * 24 * 365,
              },
              cacheableResponse: {
                statuses: [0, 200],
              },
            },
          },
        ],
      },
    }),
    ...(process.env.NODE_ENV !== "production" &&
    process.env.REPL_ID !== undefined
      ? [
          await import("@replit/vite-plugin-cartographer").then((m) =>
            m.cartographer(),
          ),
          await import("@replit/vite-plugin-dev-banner").then((m) =>
            m.devBanner(),
          ),
        ]
      : []),
  ],
  resolve: {
    alias: {
      "@": path.resolve(import.meta.dirname, "client", "src"),
      "@shared": path.resolve(import.meta.dirname, "shared"),
      "@assets": path.resolve(import.meta.dirname, "attached_assets"),
    },
  },
  root: path.resolve(import.meta.dirname, "client"),
  build: {
    outDir: path.resolve(import.meta.dirname, "dist/public"),
    emptyOutDir: true,
    target: "es2020",
  },
  server: {
    fs: {
      strict: true,
      deny: ["**/.*"],
    },
  },
});
