import "server-only";

import fs from "node:fs/promises";
import path from "node:path";

import sharp from "sharp";

import type { DiscordGuildMemberModerationItem } from "@/lib/discordAdmin";
import type { DiscordWelcomeCardSettings } from "@/lib/discordWelcomeCardSettings";
import { logDashboardEvent } from "@/lib/security";

// Discord shows this card at roughly 550–620 CSS px on desktop. 1280×720 keeps
// a comfortable ~2x source resolution without paying the CPU/memory cost of
// composing 1600×900 for every join.
export const WELCOME_CARD_WIDTH = 1280;
export const WELCOME_CARD_HEIGHT = 720;
const CARD_RADIUS = 16;
const CENTER_X = 640;

// Vertical rhythm, top → bottom: portrait, gold greeting, ornament divider,
// hero nickname, number plaque. The block sits on a dark scrim in the portal
// so the text stays readable on the bright teal background; the stairs and
// foliage below stay visible.
const AVATAR_SIZE = 176;
const AVATAR_CENTER_X = CENTER_X;
const AVATAR_CENTER_Y = 176;
const AVATAR_TOP_Y = AVATAR_CENTER_Y - AVATAR_SIZE / 2;
const GREETING_CENTER_Y = 334;
const DIVIDER_Y = 383;
const NICKNAME_CENTER_Y = 440;
const LABEL_CENTER_Y = 528;
const LABEL_PLAQUE_HEIGHT = 56;
const LABEL_PLAQUE_PADDING_X = 34;

type WelcomeTextRole = "greeting" | "nickname" | "label";

// Bundled OFL fonts (see assets/fonts/welcome/OFL-*.txt). Spectral SC gives the
// carved small-caps look of WoW titles, Philosopher is close to the WoW UI
// face; both have full Ukrainian Cyrillic and the № sign.
const WELCOME_FONTS: Record<WelcomeTextRole, { file: string; family: string; fallbackFamily: string }> = {
  greeting: { file: "SpectralSC-Bold.ttf", family: "Spectral SC Bold", fallbackFamily: "DejaVu Serif Bold" },
  nickname: { file: "SpectralSC-ExtraBold.ttf", family: "Spectral SC ExtraBold", fallbackFamily: "DejaVu Serif Bold" },
  label: { file: "Philosopher-Bold.ttf", family: "Philosopher Bold", fallbackFamily: "DejaVu Sans Bold" },
};

type TextStyle = {
  role: WelcomeTextRole;
  size: number;
  minSize: number;
  maxWidth: number;
  /** Vertical gradient stops (0..1) or one solid colour. */
  fill: Array<[number, string]>;
  strokeWidth: number;
  shadowBlur: number;
  shadowOffsetY: number;
  shadowOpacity: number;
};

const GREETING_STYLE: TextStyle = {
  role: "greeting",
  size: 52,
  minSize: 32,
  maxWidth: 1000,
  fill: [[0, "#fff6d8"], [0.5, "#f2cd72"], [1, "#c38b2c"]],
  strokeWidth: 3,
  shadowBlur: 7,
  shadowOffsetY: 3,
  shadowOpacity: 0.9,
};

const NICKNAME_STYLE: TextStyle = {
  role: "nickname",
  size: 76,
  minSize: 38,
  maxWidth: 960,
  fill: [[0, "#ffffff"], [1, "#d9f4ff"]],
  strokeWidth: 4,
  shadowBlur: 9,
  shadowOffsetY: 4,
  shadowOpacity: 0.95,
};

const LABEL_STYLE: TextStyle = {
  role: "label",
  size: 33,
  minSize: 22,
  maxWidth: 520,
  fill: [[0, "#f8e7b4"]],
  strokeWidth: 2,
  shadowBlur: 4,
  shadowOffsetY: 2,
  shadowOpacity: 0.8,
};

const BACKGROUND_FILE_NAME = "discord-welcome-card-night-elf-base.png";
const AVATAR_CACHE_TTL_MS = 10 * 60_000;
const AVATAR_NEGATIVE_CACHE_TTL_MS = 45_000;
const AVATAR_CACHE_MAX = 128;
const RENDER_CACHE_TTL_MS = 60_000;
const RENDER_CACHE_MAX = 8;
const MAX_AVATAR_BYTES = 5 * 1024 * 1024;

// Final Discord attachment encoding. Strictly lossless: no palette, no
// quantization, every RGBA pixel survives the round-trip byte-for-byte.
// Adaptive per-row filtering is what actually shrinks a photographic card
// (~2.4 MB → ~1.6 MB at 1280×720). Levels 8–9 win <0.3% over 7 while costing
// 1.5–3× CPU, which matters on the 2 vCPU host; level 7 is the sweet spot.
const WELCOME_CARD_PNG_OPTIONS = {
  compressionLevel: 7,
  adaptiveFiltering: true,
  palette: false,
  force: true,
} as const;

type PreparedBackground = {
  data: Buffer;
  width: number;
  height: number;
  channels: 4;
};

type AvatarCacheEntry = {
  expiresAt: number;
  promise: Promise<Buffer>;
};

type RenderCacheEntry = {
  expiresAt: number;
  promise: Promise<DiscordWelcomeCardRenderResult>;
};

declare global {
  // eslint-disable-next-line no-var
  var __mistblossomWelcomeBackgroundPromise: Promise<PreparedBackground> | undefined;
  // eslint-disable-next-line no-var
  var __mistblossomWelcomeAvatarCache: Map<string, AvatarCacheEntry> | undefined;
  // eslint-disable-next-line no-var
  var __mistblossomWelcomeFallbackAvatarPromise: Promise<Buffer> | undefined;
  // eslint-disable-next-line no-var
  var __mistblossomWelcomeRenderCache: Map<string, RenderCacheEntry> | undefined;
  // eslint-disable-next-line no-var
  var __mistblossomWelcomeRenderActive: number | undefined;
  // eslint-disable-next-line no-var
  var __mistblossomWelcomeRenderQueue: Array<() => void> | undefined;
  // eslint-disable-next-line no-var
  var __mistblossomWelcomeFontsPromise: Promise<ResolvedWelcomeFonts> | undefined;
}

function escapeXml(value: string) {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function cleanText(value: unknown, max: number) {
  return Array.from(String(value || "")
    .normalize("NFC")
    .replace(/[\u0000-\u001f\u007f]/g, " ")
    .replace(/\s+/g, " ")
    .trim())
    .slice(0, Math.max(0, max))
    .join("");
}

function hashString(value: string) {
  let hash = 2166136261;
  for (const char of value) {
    hash ^= char.codePointAt(0) || 0;
    hash = Math.imul(hash, 16777619);
  }
  return Math.abs(hash >>> 0);
}

function pickDeterministic<T>(items: readonly T[], seed: string, fallback: T): T {
  if (!items.length) return fallback;
  const index = hashString(seed) % items.length;
  return items[index] ?? fallback;
}

function backgroundCandidates() {
  return [
    path.join(process.cwd(), "public", "assets", BACKGROUND_FILE_NAME),
    path.join(process.cwd(), "dashboard", "public", "assets", BACKGROUND_FILE_NAME),
  ];
}

// Static readability layer, baked into the background once per process:
// soft top/bottom vignette, a dark elliptical scrim behind the text block and
// a teal halo behind the portrait.
const GLOW_SVG = Buffer.from(`
  <svg width="${WELCOME_CARD_WIDTH}" height="${WELCOME_CARD_HEIGHT}" xmlns="http://www.w3.org/2000/svg">
    <defs>
      <linearGradient id="vignette" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0" stop-color="#02060c" stop-opacity="0.35" />
        <stop offset="0.22" stop-color="#02060c" stop-opacity="0" />
        <stop offset="0.78" stop-color="#02060c" stop-opacity="0" />
        <stop offset="1" stop-color="#02060c" stop-opacity="0.45" />
      </linearGradient>
      <radialGradient id="scrim" cx="0.5" cy="0.5" r="0.5">
        <stop offset="0" stop-color="#030a14" stop-opacity="0.66" />
        <stop offset="0.5" stop-color="#030a14" stop-opacity="0.5" />
        <stop offset="0.82" stop-color="#030a14" stop-opacity="0.16" />
        <stop offset="1" stop-color="#030a14" stop-opacity="0" />
      </radialGradient>
      <radialGradient id="halo" cx="${AVATAR_CENTER_X}" cy="${AVATAR_CENTER_Y}" r="150" gradientUnits="userSpaceOnUse">
        <stop offset="0.55" stop-color="#9ff3ff" stop-opacity="0.35" />
        <stop offset="1" stop-color="#9ff3ff" stop-opacity="0" />
      </radialGradient>
    </defs>
    <rect width="${WELCOME_CARD_WIDTH}" height="${WELCOME_CARD_HEIGHT}" fill="url(#vignette)" />
    <ellipse cx="${CENTER_X}" cy="420" rx="640" ry="230" fill="url(#scrim)" />
    <circle cx="${AVATAR_CENTER_X}" cy="${AVATAR_CENTER_Y}" r="150" fill="url(#halo)" />
  </svg>
`);

// Portrait frame and ornament divider never overlap dynamic content, so they
// are baked into the prepared background as well.
const FRAME_SVG = (() => {
  const r = AVATAR_SIZE / 2;
  const cy = AVATAR_CENTER_Y;
  const cx = AVATAR_CENTER_X;
  return Buffer.from(`
    <svg width="${WELCOME_CARD_WIDTH}" height="${WELCOME_CARD_HEIGHT}" xmlns="http://www.w3.org/2000/svg">
      <defs>
        <linearGradient id="gold" x1="0" y1="${cy - r - 12}" x2="0" y2="${cy + r + 12}" gradientUnits="userSpaceOnUse">
          <stop offset="0" stop-color="#fff0bd" />
          <stop offset="0.45" stop-color="#e6b85a" />
          <stop offset="1" stop-color="#9c6a22" />
        </linearGradient>
        <linearGradient id="lineLeft" x1="0" x2="1">
          <stop offset="0" stop-color="#e9c170" stop-opacity="0" />
          <stop offset="1" stop-color="#f3d58e" />
        </linearGradient>
        <linearGradient id="lineRight" x1="1" x2="0">
          <stop offset="0" stop-color="#e9c170" stop-opacity="0" />
          <stop offset="1" stop-color="#f3d58e" />
        </linearGradient>
        <filter id="frameShadow" x="-50%" y="-50%" width="200%" height="200%">
          <feDropShadow dx="0" dy="3" stdDeviation="5" flood-color="#02060c" flood-opacity="0.8" />
        </filter>
      </defs>
      <g filter="url(#frameShadow)">
        <circle cx="${cx}" cy="${cy}" r="${r + 9}" fill="none" stroke="url(#gold)" stroke-width="7" />
      </g>
      <circle cx="${cx}" cy="${cy}" r="${r + 3}" fill="none" stroke="#0b1a26" stroke-width="3" />
      <circle cx="${cx}" cy="${cy}" r="${r + 15}" fill="none" stroke="#bff6ff" stroke-opacity="0.55" stroke-width="1.5" />
      <path d="M${cx} ${cy + r + 4} l9 11 l-9 11 l-9 -11 z" fill="url(#gold)" stroke="#3a2708" stroke-width="1.5" />
      <g>
        <rect x="${CENTER_X - 250}" y="${DIVIDER_Y - 1}" width="226" height="2" fill="url(#lineLeft)" />
        <rect x="${CENTER_X + 24}" y="${DIVIDER_Y - 1}" width="226" height="2" fill="url(#lineRight)" />
        <path d="M${CENTER_X} ${DIVIDER_Y - 9} l9 9 l-9 9 l-9 -9 z" fill="#f3d58e" stroke="#3a2708" stroke-width="1.2" />
        <circle cx="${CENTER_X - 18}" cy="${DIVIDER_Y}" r="2.6" fill="#f3d58e" />
        <circle cx="${CENTER_X + 18}" cy="${DIVIDER_Y}" r="2.6" fill="#f3d58e" />
      </g>
    </svg>
  `);
})();

const ROUNDED_MASK_SVG = Buffer.from(`
  <svg width="${WELCOME_CARD_WIDTH}" height="${WELCOME_CARD_HEIGHT}" xmlns="http://www.w3.org/2000/svg">
    <rect x="0" y="0" width="${WELCOME_CARD_WIDTH}" height="${WELCOME_CARD_HEIGHT}" rx="${CARD_RADIUS}" ry="${CARD_RADIUS}" fill="#fff" />
  </svg>
`);

async function prepareBackground(): Promise<PreparedBackground> {
  let source: Buffer | null = null;
  let lastError: unknown = null;
  for (const candidate of backgroundCandidates()) {
    try {
      source = await fs.readFile(candidate);
      break;
    } catch (error) {
      lastError = error;
    }
  }
  if (!source) {
    throw new Error(`Welcome-card background is missing: ${lastError instanceof Error ? lastError.message : "asset not found"}`);
  }

  // Static resize + glow is paid once per Node process. Per-card work only adds
  // avatar, ring, dynamic text and the final 16px mask.
  const lit = await sharp(source)
    .resize(WELCOME_CARD_WIDTH, WELCOME_CARD_HEIGHT, { fit: "cover", position: "centre", fastShrinkOnLoad: true })
    .ensureAlpha()
    .composite([{ input: GLOW_SVG }])
    .raw()
    .toBuffer({ resolveWithObject: true });

  // Second pass: frame/divider and the transparent 16px rounded corners.
  // Dynamic layers stay inside the safe area, so per-card renders no longer
  // rasterize full-canvas SVGs at all.
  const prepared = await sharp(lit.data, {
    raw: { width: lit.info.width, height: lit.info.height, channels: 4 },
  })
    .composite([
      { input: FRAME_SVG },
      { input: ROUNDED_MASK_SVG, blend: "dest-in" },
    ])
    .raw()
    .toBuffer({ resolveWithObject: true });

  if (prepared.info.width !== WELCOME_CARD_WIDTH || prepared.info.height !== WELCOME_CARD_HEIGHT || prepared.info.channels !== 4) {
    throw new Error("Welcome-card background preprocessing returned an unexpected pixel layout.");
  }
  return {
    data: prepared.data,
    width: prepared.info.width,
    height: prepared.info.height,
    channels: 4,
  };
}

async function loadPreparedBackground() {
  if (!globalThis.__mistblossomWelcomeBackgroundPromise) {
    globalThis.__mistblossomWelcomeBackgroundPromise = prepareBackground().catch((error) => {
      globalThis.__mistblossomWelcomeBackgroundPromise = undefined;
      throw error;
    });
  }
  return globalThis.__mistblossomWelcomeBackgroundPromise;
}

function avatarCache() {
  const cache = globalThis.__mistblossomWelcomeAvatarCache || new Map<string, AvatarCacheEntry>();
  globalThis.__mistblossomWelcomeAvatarCache = cache;
  return cache;
}


function renderConcurrencyLimit() {
  const parsed = Number(process.env.WELCOME_CARD_RENDER_CONCURRENCY || 2);
  return Math.max(1, Math.min(4, Number.isFinite(parsed) ? Math.floor(parsed) : 2));
}

async function withRenderSlot<T>(task: () => Promise<T>): Promise<T> {
  const limit = renderConcurrencyLimit();
  globalThis.__mistblossomWelcomeRenderActive ||= 0;
  globalThis.__mistblossomWelcomeRenderQueue ||= [];

  if (globalThis.__mistblossomWelcomeRenderActive >= limit) {
    await new Promise<void>((resolve) => {
      globalThis.__mistblossomWelcomeRenderQueue!.push(resolve);
    });
  }

  globalThis.__mistblossomWelcomeRenderActive += 1;
  try {
    return await task();
  } finally {
    globalThis.__mistblossomWelcomeRenderActive = Math.max(0, (globalThis.__mistblossomWelcomeRenderActive || 1) - 1);
    const next = globalThis.__mistblossomWelcomeRenderQueue!.shift();
    if (next) next();
  }
}

function renderCache() {
  const cache = globalThis.__mistblossomWelcomeRenderCache || new Map<string, RenderCacheEntry>();
  globalThis.__mistblossomWelcomeRenderCache = cache;
  return cache;
}

function pruneCache<T extends { expiresAt: number }>(cache: Map<string, T>, maxEntries: number) {
  const now = Date.now();
  for (const [key, entry] of cache) {
    if (entry.expiresAt <= now) cache.delete(key);
  }
  while (cache.size > maxEntries) {
    const first = cache.keys().next().value as string | undefined;
    if (!first) break;
    cache.delete(first);
  }
}

const AVATAR_MASK_SVG = Buffer.from(`
  <svg width="${AVATAR_SIZE}" height="${AVATAR_SIZE}" xmlns="http://www.w3.org/2000/svg">
    <circle cx="${AVATAR_SIZE / 2}" cy="${AVATAR_SIZE / 2}" r="${AVATAR_SIZE / 2}" fill="#fff" />
  </svg>
`);

async function circleAvatar(input: Buffer) {
  return sharp(input)
    .resize(AVATAR_SIZE, AVATAR_SIZE, { fit: "cover", position: "centre", fastShrinkOnLoad: true })
    .ensureAlpha()
    .composite([{ input: AVATAR_MASK_SVG, blend: "dest-in" }])
    .png({ compressionLevel: 3, adaptiveFiltering: false })
    .toBuffer();
}

async function fallbackAvatar() {
  if (!globalThis.__mistblossomWelcomeFallbackAvatarPromise) {
    globalThis.__mistblossomWelcomeFallbackAvatarPromise = sharp({
      create: { width: AVATAR_SIZE, height: AVATAR_SIZE, channels: 4, background: { r: 60, g: 83, b: 110, alpha: 1 } },
    })
      .composite([{ input: AVATAR_MASK_SVG, blend: "dest-in" }])
      .png({ compressionLevel: 3, adaptiveFiltering: false })
      .toBuffer();
  }
  return globalThis.__mistblossomWelcomeFallbackAvatarPromise;
}

async function fetchAvatarCircle(url: string | null) {
  const safeUrl = String(url || "").trim();
  if (!safeUrl) return fallbackAvatar();

  const cache = avatarCache();
  pruneCache(cache, AVATAR_CACHE_MAX);
  const existing = cache.get(safeUrl);
  if (existing && existing.expiresAt > Date.now()) return existing.promise;

  const promise = (async () => {
    try {
      const response = await fetch(safeUrl, {
        cache: "no-store",
        signal: AbortSignal.timeout(4_000),
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const contentType = String(response.headers.get("content-type") || "").toLowerCase();
      if (contentType && !contentType.startsWith("image/")) throw new Error(`unexpected content-type ${contentType}`);
      const contentLength = Number(response.headers.get("content-length") || 0);
      if (Number.isFinite(contentLength) && contentLength > MAX_AVATAR_BYTES) throw new Error("avatar response is too large");
      const bytes = Buffer.from(await response.arrayBuffer());
      if (!bytes.length || bytes.length > MAX_AVATAR_BYTES) throw new Error("avatar body is empty or too large");
      return await circleAvatar(bytes);
    } catch (error) {
      logDashboardEvent("warn", "discord.welcome_card_avatar_fetch_failed", undefined, {
        url: safeUrl.slice(0, 300),
        error: error instanceof Error ? error.message : String(error || "unknown"),
      });
      const fallback = await fallbackAvatar();
      cache.set(safeUrl, {
        expiresAt: Date.now() + AVATAR_NEGATIVE_CACHE_TTL_MS,
        promise: Promise.resolve(fallback),
      });
      return fallback;
    }
  })();

  cache.set(safeUrl, { expiresAt: Date.now() + AVATAR_CACHE_TTL_MS, promise });
  pruneCache(cache, AVATAR_CACHE_MAX);
  return promise;
}

function welcomeFontDirCandidates() {
  return [
    path.join(process.cwd(), "assets", "fonts", "welcome"),
    path.join(process.cwd(), "dashboard", "assets", "fonts", "welcome"),
  ];
}

type ResolvedWelcomeFont = { family: string; fontfile: string | null };
type ResolvedWelcomeFonts = Record<WelcomeTextRole, ResolvedWelcomeFont>;

async function resolveWelcomeFonts(): Promise<ResolvedWelcomeFonts> {
  const resolved = {} as ResolvedWelcomeFonts;
  const missing: string[] = [];
  for (const role of Object.keys(WELCOME_FONTS) as WelcomeTextRole[]) {
    const font = WELCOME_FONTS[role];
    let fontfile: string | null = null;
    for (const dir of welcomeFontDirCandidates()) {
      const candidate = path.join(dir, font.file);
      try {
        await fs.access(candidate);
        fontfile = candidate;
        break;
      } catch {
        // try next layout
      }
    }
    if (!fontfile) missing.push(font.file);
    resolved[role] = fontfile ? { family: font.family, fontfile } : { family: font.fallbackFamily, fontfile: null };
  }
  if (missing.length) {
    // A missing bundled font must not block a newcomer's welcome: fall back to
    // the DejaVu faces installed in the runtime image and make it visible.
    logDashboardEvent("warn", "discord.welcome_card_fonts_missing", undefined, { missing });
  }
  return resolved;
}

function loadWelcomeFonts() {
  globalThis.__mistblossomWelcomeFontsPromise ||= resolveWelcomeFonts();
  return globalThis.__mistblossomWelcomeFontsPromise;
}

type RawLayer = { data: Buffer; width: number; height: number };

/** Single-channel coverage mask of one line of text, shrunk to fit maxWidth. */
async function renderTextMask(text: string, font: ResolvedWelcomeFont, style: TextStyle): Promise<RawLayer | null> {
  if (!text) return null;
  let size = style.size;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const rendered = await sharp({
      text: {
        text: escapeXml(text),
        font: `${font.family} ${size}`,
        ...(font.fontfile ? { fontfile: font.fontfile } : {}),
        dpi: 72,
        wrap: "none",
      },
    })
      .extractChannel(0)
      .toColourspace("b-w")
      .raw()
      .toBuffer({ resolveWithObject: true });
    if (rendered.info.width <= style.maxWidth || size <= style.minSize) {
      return { data: rendered.data, width: rendered.info.width, height: rendered.info.height };
    }
    size = Math.max(style.minSize, Math.floor((size * style.maxWidth) / rendered.info.width));
  }
  return null;
}

function hexToRgb(hex: string) {
  const value = Number.parseInt(hex.replace("#", ""), 16);
  return { r: (value >> 16) & 255, g: (value >> 8) & 255, b: value & 255 };
}

async function colorizeMask(mask: Buffer, width: number, height: number, fill: Array<[number, string]>, fillTop: number, fillBottom: number) {
  const alpha = { raw: { width, height, channels: 1 as const } };
  if (fill.length === 1) {
    return sharp({ create: { width, height, channels: 3, background: hexToRgb(fill[0][1]) } })
      .joinChannel(mask, alpha)
      .raw()
      .toBuffer();
  }
  const stops = fill.map(([offset, color]) => `<stop offset="${offset}" stop-color="${color}" />`).join("");
  const gradient = await sharp(Buffer.from(`
    <svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg">
      <defs><linearGradient id="fill" x1="0" y1="${fillTop}" x2="0" y2="${fillBottom}" gradientUnits="userSpaceOnUse">${stops}</linearGradient></defs>
      <rect width="${width}" height="${height}" fill="url(#fill)" />
    </svg>
  `))
    .removeAlpha()
    .raw()
    .toBuffer();
  return sharp(gradient, { raw: { width, height, channels: 3 } })
    .joinChannel(mask, alpha)
    .raw()
    .toBuffer();
}

type StyledTextLayer = RawLayer & { textWidth: number; textHeight: number; padding: number };

/**
 * Readable text on a busy painting: soft dark drop shadow, dark outline
 * (dilated coverage) and a vertical colour gradient fill.
 */
async function renderStyledText(text: string, style: TextStyle): Promise<StyledTextLayer | null> {
  const fonts = await loadWelcomeFonts();
  const mask = await renderTextMask(text, fonts[style.role], style);
  if (!mask) return null;

  const padding = Math.ceil(style.shadowBlur * 3 + style.strokeWidth + style.shadowOffsetY + 4);
  const width = mask.width + padding * 2;
  const height = mask.height + padding * 2;
  const single = { raw: { width, height, channels: 1 as const } };

  // Every single-band step ends with toColourspace("b-w"): libvips otherwise
  // promotes raw output to 3-band sRGB and the buffers stop lining up.
  const fillMask = await sharp(mask.data, { raw: { width: mask.width, height: mask.height, channels: 1 } })
    .extend({ top: padding, bottom: padding, left: padding, right: padding, background: "#000000" })
    .toColourspace("b-w")
    .raw()
    .toBuffer();
  // Soft outline = blurred coverage boosted back to opaque. Unlike morphology
  // this is anti-aliased and does not depend on dilate/erode semantics, which
  // differ between Sharp releases.
  const strokeMask = await sharp(fillMask, single)
    .blur(0.4 + style.strokeWidth * 0.55)
    .linear(3.6, 0)
    .toColourspace("b-w")
    .raw()
    .toBuffer();
  const shadowMask = await sharp(strokeMask, single)
    .blur(style.shadowBlur)
    .linear(style.shadowOpacity, 0)
    .toColourspace("b-w")
    .raw()
    .toBuffer();
  const strokeAlpha = await sharp(strokeMask, single).linear(0.92, 0).toColourspace("b-w").raw().toBuffer();

  const [shadowLayer, strokeLayer, fillLayer] = await Promise.all([
    colorizeMask(shadowMask, width, height, [[0, "#02060c"]], 0, height),
    colorizeMask(strokeAlpha, width, height, [[0, "#08101a"]], 0, height),
    colorizeMask(fillMask, width, height, style.fill, padding, padding + mask.height),
  ]);
  const rgba = { raw: { width, height, channels: 4 as const } };
  const data = await sharp({ create: { width, height, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } })
    .composite([
      // Padding is larger than the offset, so the shifted shadow never clips.
      { input: shadowLayer, ...rgba, top: style.shadowOffsetY, left: 0 },
      { input: strokeLayer, ...rgba, top: 0, left: 0 },
      { input: fillLayer, ...rgba, top: 0, left: 0 },
    ])
    .raw()
    .toBuffer();

  return { data, width, height, textWidth: mask.width, textHeight: mask.height, padding };
}

function centeredLayer(layer: RawLayer, centerY: number) {
  return {
    input: layer.data,
    raw: { width: layer.width, height: layer.height, channels: 4 as const },
    left: Math.round(CENTER_X - layer.width / 2),
    top: Math.round(centerY - layer.height / 2),
  };
}

function labelPlaqueSvg(textWidth: number) {
  const width = Math.min(WELCOME_CARD_WIDTH - 80, Math.max(180, Math.ceil(textWidth + LABEL_PLAQUE_PADDING_X * 2)));
  const height = LABEL_PLAQUE_HEIGHT;
  const radius = height / 2;
  return {
    width,
    height,
    svg: Buffer.from(`
      <svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg">
        <rect x="1" y="1" width="${width - 2}" height="${height - 2}" rx="${radius - 1}" fill="#06111c" fill-opacity="0.74" stroke="#e2b95f" stroke-opacity="0.9" stroke-width="1.6" />
        <rect x="6" y="6" width="${width - 12}" height="${height - 12}" rx="${radius - 6}" fill="none" stroke="#bff6ff" stroke-opacity="0.22" stroke-width="1" />
      </svg>
    `),
  };
}

export type DiscordWelcomeCardRenderResult = {
  buffer: Buffer;
  fileName: string;
  contentType: string;
  greeting: string;
  label: string;
};

function renderCacheKey(member: DiscordGuildMemberModerationItem, settings: DiscordWelcomeCardSettings, greeting: string, number: string, nickname: string) {
  return [
    member.userId,
    member.avatarUrl || member.defaultAvatarUrl || "fallback",
    nickname,
    greeting,
    number,
    settings.labelPrefix,
    settings.fileName,
  ].join("\u001f");
}

async function renderUncached(
  member: DiscordGuildMemberModerationItem,
  settings: DiscordWelcomeCardSettings,
  greeting: string,
  number: string,
  nickname: string,
): Promise<DiscordWelcomeCardRenderResult> {
  const label = number ? `${settings.labelPrefix} №${number}` : settings.labelPrefix;
  const [background, avatarPng] = await Promise.all([
    loadPreparedBackground(),
    fetchAvatarCircle(member.avatarUrl || member.defaultAvatarUrl || null),
  ]);

  const buffer = await withRenderSlot(async () => {
    const [greetingLayer, nicknameLayer, labelLayer] = await Promise.all([
      renderStyledText(greeting, GREETING_STYLE),
      renderStyledText(nickname, NICKNAME_STYLE),
      renderStyledText(label, LABEL_STYLE),
    ]);

    const layers: sharp.OverlayOptions[] = [
      { input: avatarPng, top: AVATAR_TOP_Y, left: Math.round(AVATAR_CENTER_X - AVATAR_SIZE / 2) },
    ];
    if (labelLayer) {
      const plaque = labelPlaqueSvg(labelLayer.textWidth);
      layers.push({
        input: plaque.svg,
        left: Math.round(CENTER_X - plaque.width / 2),
        top: Math.round(LABEL_CENTER_Y - plaque.height / 2),
      });
    }
    if (greetingLayer) layers.push(centeredLayer(greetingLayer, GREETING_CENTER_Y));
    if (nicknameLayer) layers.push(centeredLayer(nicknameLayer, NICKNAME_CENTER_Y));
    if (labelLayer) layers.push(centeredLayer(labelLayer, LABEL_CENTER_Y));

    return sharp(background.data, {
      raw: { width: background.width, height: background.height, channels: background.channels },
    })
      .composite(layers)
      .png(WELCOME_CARD_PNG_OPTIONS)
      .toBuffer();
  });

  return {
    buffer,
    fileName: settings.fileName || "mistblossom-welcome.png",
    contentType: "image/png",
    greeting,
    label,
  };
}

export async function renderDiscordWelcomeCard(
  member: DiscordGuildMemberModerationItem,
  settings: DiscordWelcomeCardSettings,
  options: { greetingOverride?: string | null; numberOverride?: string | null } = {},
): Promise<DiscordWelcomeCardRenderResult> {
  const greeting = cleanText(
    options.greetingOverride || pickDeterministic(settings.greetings, `${member.userId}:${member.joinedAt || ""}`, "Ishnu-alah!"),
    80,
  ) || "Ishnu-alah!";
  // The member number is resolved upstream (server join order, see
  // discordMemberJoinNumber.ts). The renderer never invents one.
  const number = cleanText(options.numberOverride, 8);
  const nickname = cleanText(member.displayName || member.username || member.userId, 40) || `Discord ${member.userId.slice(-6)}`;
  const key = renderCacheKey(member, settings, greeting, number, nickname);
  const cache = renderCache();
  pruneCache(cache, RENDER_CACHE_MAX);
  const cached = cache.get(key);
  if (cached && cached.expiresAt > Date.now()) return cached.promise;

  const promise = renderUncached(member, settings, greeting, number, nickname).catch((error) => {
    cache.delete(key);
    throw error;
  });
  cache.set(key, { expiresAt: Date.now() + RENDER_CACHE_TTL_MS, promise });
  pruneCache(cache, RENDER_CACHE_MAX);
  return promise;
}
