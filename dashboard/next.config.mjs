const hstsValue =
  process.env.SECURITY_HSTS_HEADER ||
  "max-age=31536000; includeSubDomains";

import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

// Корінь монорепозиторію. Спільний пакет `shared/` лежить поруч із
// `dashboard/`, тому і трасування файлів, і резолвер Turbopack мають
// бачити рівень вище — інакше локальна залежність
// `@mistblossom/discord-contract` не резолвиться.
const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");

/** @type {import('next').NextConfig} */
const nextConfig = {
  outputFileTracingRoot: repoRoot,
  turbopack: {
    root: repoRoot,
  },
  // Збірка в самодостатній пакет: `.next/standalone` містить server.js і рівно
  // ті node_modules, які реально потрібні. Саме це кладеться в образ, тому
  // на сервері не треба ні `npm ci`, ні всього дерева залежностей.
  output: "standalone",
  poweredByHeader: false,
  reactStrictMode: true,
  experimental: {
    cpus: Number(process.env.NEXT_BUILD_CPUS || 2),
  },
  typescript: {
    // Збірка не запускає окремий TypeScript-воркер, щоб деплой не витрачав
    // хвилини на перевірку, яку вже зробив CI. Строгий шлюз — `npm run build:ci`.
    ignoreBuildErrors: true,
  },
  images: {
    remotePatterns: [
      { protocol: "https", hostname: "cdn.discordapp.com" },
      { protocol: "https", hostname: "media.discordapp.net" },
      { protocol: "https", hostname: "render.worldofwarcraft.com" },
      { protocol: "https", hostname: "cdnassets.raider.io" },
      { protocol: "https", hostname: "raider.io" },
    ],
  },
  async headers() {
    return [
      {
        source: "/(.*)",
        headers: [
          { key: "Strict-Transport-Security", value: hstsValue },
          { key: "X-Frame-Options", value: "DENY" },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "X-DNS-Prefetch-Control", value: "off" },
          { key: "Referrer-Policy", value: "same-origin" },
          { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
          { key: "Cross-Origin-Resource-Policy", value: "same-site" },
          { key: "Origin-Agent-Cluster", value: "?1" },
          {
            key: "Permissions-Policy",
            value:
              "accelerometer=(), autoplay=(), bluetooth=(), camera=(), display-capture=(), encrypted-media=(), fullscreen=(self), geolocation=(), gyroscope=(), magnetometer=(), microphone=(), midi=(), payment=(), picture-in-picture=(), publickey-credentials-get=(self), screen-wake-lock=(), serial=(), sync-xhr=(), usb=(), xr-spatial-tracking=()",
          },
        ],
      },
      {
        source: "/api/(.*)",
        headers: [
          {
            key: "Cache-Control",
            value: "no-store, no-cache, must-revalidate, proxy-revalidate",
          },
          { key: "Pragma", value: "no-cache" },
          { key: "Expires", value: "0" },
        ],
      },
    ];
  },
};

export default nextConfig;
