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
const AVATAR_SIZE = 194;
const AVATAR_CENTER_X = 640;
const AVATAR_TOP_Y = 120;
const GREETING_Y = 376;
const NICKNAME_Y = 480;
const LABEL_Y = 544;
const BACKGROUND_FILE_NAME = "discord-welcome-card-night-elf-base.png";
const AVATAR_CACHE_TTL_MS = 10 * 60_000;
const AVATAR_NEGATIVE_CACHE_TTL_MS = 45_000;
const AVATAR_CACHE_MAX = 128;
const RENDER_CACHE_TTL_MS = 60_000;
const RENDER_CACHE_MAX = 8;
const MAX_AVATAR_BYTES = 5 * 1024 * 1024;

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

function welcomeNumber(userId: string) {
  return String(1000 + (hashString(String(userId || "member")) % 9000));
}

function backgroundCandidates() {
  return [
    path.join(process.cwd(), "public", "assets", BACKGROUND_FILE_NAME),
    path.join(process.cwd(), "dashboard", "public", "assets", BACKGROUND_FILE_NAME),
  ];
}

const GLOW_SVG = Buffer.from(`
  <svg width="${WELCOME_CARD_WIDTH}" height="${WELCOME_CARD_HEIGHT}" xmlns="http://www.w3.org/2000/svg">
    <defs>
      <filter id="softGlow" x="-50%" y="-50%" width="200%" height="200%">
        <feGaussianBlur stdDeviation="14" result="blur" />
      </filter>
    </defs>
    <circle cx="${AVATAR_CENTER_X}" cy="${AVATAR_TOP_Y + AVATAR_SIZE / 2}" r="${AVATAR_SIZE / 2 + 15}" fill="rgba(167,244,255,0.28)" filter="url(#softGlow)" />
    <ellipse cx="${AVATAR_CENTER_X}" cy="456" rx="256" ry="144" fill="rgba(24,11,56,0.16)" filter="url(#softGlow)" />
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
  const prepared = await sharp(source)
    .resize(WELCOME_CARD_WIDTH, WELCOME_CARD_HEIGHT, { fit: "cover", position: "centre", fastShrinkOnLoad: true })
    .ensureAlpha()
    .composite([{ input: GLOW_SVG }])
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

const FRAME_SVG = (() => {
  const size = AVATAR_SIZE + 13;
  const centerY = AVATAR_TOP_Y + AVATAR_SIZE / 2;
  return Buffer.from(`
    <svg width="${WELCOME_CARD_WIDTH}" height="${WELCOME_CARD_HEIGHT}" xmlns="http://www.w3.org/2000/svg">
      <defs>
        <filter id="ringGlow" x="-50%" y="-50%" width="200%" height="200%">
          <feDropShadow dx="0" dy="0" stdDeviation="8" flood-color="#b8fdff" flood-opacity="0.85" />
        </filter>
      </defs>
      <circle cx="${AVATAR_CENTER_X}" cy="${centerY}" r="${size / 2}" fill="none" stroke="#eefeff" stroke-width="6" filter="url(#ringGlow)" />
      <circle cx="${AVATAR_CENTER_X}" cy="${centerY}" r="${size / 2 - 6}" fill="none" stroke="rgba(102,229,255,0.65)" stroke-width="3" />
    </svg>
  `);
})();

const ROUNDED_MASK_SVG = Buffer.from(`
  <svg width="${WELCOME_CARD_WIDTH}" height="${WELCOME_CARD_HEIGHT}" xmlns="http://www.w3.org/2000/svg">
    <rect x="0" y="0" width="${WELCOME_CARD_WIDTH}" height="${WELCOME_CARD_HEIGHT}" rx="${CARD_RADIUS}" ry="${CARD_RADIUS}" fill="#fff" />
  </svg>
`);

function textSvg(params: { greeting: string; nickname: string; label: string }) {
  const greeting = escapeXml(cleanText(params.greeting, 80));
  const nickname = escapeXml(cleanText(params.nickname, 48));
  const label = escapeXml(cleanText(params.label, 40));

  return Buffer.from(`
    <svg width="${WELCOME_CARD_WIDTH}" height="${WELCOME_CARD_HEIGHT}" xmlns="http://www.w3.org/2000/svg">
      <defs>
        <filter id="textShadow" x="-50%" y="-50%" width="200%" height="200%">
          <feDropShadow dx="0" dy="4" stdDeviation="6" flood-color="#07111f" flood-opacity="0.9" />
        </filter>
      </defs>
      <g text-anchor="middle" filter="url(#textShadow)">
        <text x="${AVATAR_CENTER_X}" y="${GREETING_Y}" fill="#f4fbff" font-size="59" font-family="DejaVu Serif, Georgia, 'Times New Roman', serif" font-weight="700">${greeting}</text>
        <text x="${AVATAR_CENTER_X}" y="${NICKNAME_Y}" fill="#f8fbff" font-size="45" font-family="DejaVu Serif, Georgia, 'Times New Roman', serif" font-weight="600">${nickname}</text>
        <text x="${AVATAR_CENTER_X}" y="${LABEL_Y}" fill="rgba(232,244,255,0.92)" font-size="30" font-family="DejaVu Sans, Arial, Helvetica, sans-serif" font-weight="500">${label}</text>
      </g>
      <g stroke="rgba(214,252,255,0.92)" fill="none" stroke-width="2">
        <path d="M442 395 C464 381, 481 380, 498 390" />
        <path d="M838 395 C816 381, 799 380, 782 390" />
        <path d="M504 428 H776" />
        <path d="M622 431 q18 22 37 0" />
      </g>
    </svg>
  `);
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
  const label = `${settings.labelPrefix} №${number}`;
  const [background, avatarPng] = await Promise.all([
    loadPreparedBackground(),
    fetchAvatarCircle(member.avatarUrl || member.defaultAvatarUrl || null),
  ]);

  const buffer = await withRenderSlot(() => sharp(background.data, {
    raw: { width: background.width, height: background.height, channels: background.channels },
  })
    .composite([
      { input: avatarPng, top: AVATAR_TOP_Y, left: Math.round(AVATAR_CENTER_X - AVATAR_SIZE / 2) },
      { input: FRAME_SVG },
      { input: textSvg({ greeting, nickname, label }) },
      { input: ROUNDED_MASK_SVG, blend: "dest-in" },
    ])
    .png({ compressionLevel: 3, adaptiveFiltering: false })
    .toBuffer());

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
  const number = cleanText(options.numberOverride || welcomeNumber(member.userId), 8) || welcomeNumber(member.userId);
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
