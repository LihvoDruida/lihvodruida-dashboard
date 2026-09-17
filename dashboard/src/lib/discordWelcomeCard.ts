import "server-only";

import fs from "node:fs/promises";
import path from "node:path";

import sharp from "sharp";

import type { DiscordGuildMemberModerationItem } from "@/lib/discordAdmin";
import type { DiscordWelcomeCardSettings } from "@/lib/discordWelcomeCardSettings";
import { logDashboardEvent } from "@/lib/security";

const OUTPUT_WIDTH = 1600;
const OUTPUT_HEIGHT = 900;
const AVATAR_SIZE = 242;
const AVATAR_CENTER_X = 800;
const AVATAR_TOP_Y = 150;
const GREETING_Y = 470;
const NICKNAME_Y = 600;
const LABEL_Y = 680;
const BACKGROUND_ASSET = path.join(process.cwd(), "public", "assets", "discord-welcome-card-night-elf-base.png");

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
  const digits = String(userId || "").replace(/\D/g, "");
  const tail = digits.slice(-4);
  return tail.padStart(4, "0");
}

async function loadBackground() {
  return fs.readFile(BACKGROUND_ASSET);
}

async function fetchAvatarBuffer(url: string | null) {
  const safeUrl = String(url || "").trim();
  if (!safeUrl) return null;
  try {
    const response = await fetch(safeUrl, { cache: "no-store" });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return Buffer.from(await response.arrayBuffer());
  } catch (error) {
    logDashboardEvent("warn", "discord.welcome_card_avatar_fetch_failed", undefined, {
      url: safeUrl.slice(0, 300),
      error: error instanceof Error ? error.message : String(error || "unknown"),
    });
    return null;
  }
}

function avatarMaskSvg(size: number) {
  return Buffer.from(`
    <svg width="${size}" height="${size}" xmlns="http://www.w3.org/2000/svg">
      <circle cx="${size / 2}" cy="${size / 2}" r="${size / 2}" fill="#fff" />
    </svg>
  `);
}

async function circleAvatar(input: Buffer, size: number) {
  return sharp(input)
    .resize(size, size, { fit: "cover", position: "centre" })
    .composite([{ input: avatarMaskSvg(size), blend: "dest-in" }])
    .png()
    .toBuffer();
}

function glowSvg() {
  return Buffer.from(`
    <svg width="${OUTPUT_WIDTH}" height="${OUTPUT_HEIGHT}" xmlns="http://www.w3.org/2000/svg">
      <defs>
        <filter id="softGlow" x="-50%" y="-50%" width="200%" height="200%">
          <feGaussianBlur stdDeviation="18" result="blur" />
        </filter>
      </defs>
      <circle cx="${AVATAR_CENTER_X}" cy="${AVATAR_TOP_Y + AVATAR_SIZE / 2}" r="${AVATAR_SIZE / 2 + 18}" fill="rgba(167,244,255,0.28)" filter="url(#softGlow)" />
      <ellipse cx="${AVATAR_CENTER_X}" cy="570" rx="320" ry="180" fill="rgba(24,11,56,0.16)" filter="url(#softGlow)" />
    </svg>
  `);
}

function textSvg(params: { greeting: string; nickname: string; label: string }) {
  const greeting = escapeXml(cleanText(params.greeting, 80));
  const nickname = escapeXml(cleanText(params.nickname, 48));
  const label = escapeXml(cleanText(params.label, 40));

  return Buffer.from(`
    <svg width="${OUTPUT_WIDTH}" height="${OUTPUT_HEIGHT}" xmlns="http://www.w3.org/2000/svg">
      <defs>
        <filter id="textShadow" x="-50%" y="-50%" width="200%" height="200%">
          <feDropShadow dx="0" dy="5" stdDeviation="8" flood-color="#07111f" flood-opacity="0.9" />
        </filter>
      </defs>
      <g text-anchor="middle" filter="url(#textShadow)">
        <text x="${AVATAR_CENTER_X}" y="${GREETING_Y}" fill="#f4fbff" font-size="74" font-family="Georgia, 'Times New Roman', serif" font-weight="700">${greeting}</text>
        <text x="${AVATAR_CENTER_X}" y="${NICKNAME_Y}" fill="#f8fbff" font-size="56" font-family="Georgia, 'Times New Roman', serif" font-weight="600">${nickname}</text>
        <text x="${AVATAR_CENTER_X}" y="${LABEL_Y}" fill="rgba(232,244,255,0.92)" font-size="38" font-family="Arial, Helvetica, sans-serif" font-weight="500">${label}</text>
      </g>
      <g stroke="rgba(214,252,255,0.92)" fill="none" stroke-width="2">
        <path d="M552 494 C580 476, 601 475, 622 487" />
        <path d="M1048 494 C1020 476, 999 475, 978 487" />
        <path d="M630 535 H970" />
        <path d="M777 539 q23 28 46 0" />
      </g>
    </svg>
  `);
}

function frameSvg() {
  const size = AVATAR_SIZE + 16;
  const centerY = AVATAR_TOP_Y + AVATAR_SIZE / 2;
  const centerX = AVATAR_CENTER_X;
  return Buffer.from(`
    <svg width="${OUTPUT_WIDTH}" height="${OUTPUT_HEIGHT}" xmlns="http://www.w3.org/2000/svg">
      <defs>
        <filter id="ringGlow" x="-50%" y="-50%" width="200%" height="200%">
          <feDropShadow dx="0" dy="0" stdDeviation="10" flood-color="#b8fdff" flood-opacity="0.85" />
        </filter>
      </defs>
      <circle cx="${centerX}" cy="${centerY}" r="${size / 2}" fill="none" stroke="#eefeff" stroke-width="8" filter="url(#ringGlow)" />
      <circle cx="${centerX}" cy="${centerY}" r="${size / 2 - 7}" fill="none" stroke="rgba(102,229,255,0.65)" stroke-width="4" />
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

export async function renderDiscordWelcomeCard(member: DiscordGuildMemberModerationItem, settings: DiscordWelcomeCardSettings): Promise<DiscordWelcomeCardRenderResult> {
  const greeting = pickDeterministic(settings.greetings, `${member.userId}:${member.joinedAt || ""}`, "Ishnu-alah!");
  const number = welcomeNumber(member.userId);
  const label = `${settings.labelPrefix} №${number}`;
  const nickname = cleanText(member.displayName || member.username || member.userId, 40) || `Discord ${member.userId.slice(-6)}`;

  const [background, avatarSource] = await Promise.all([
    loadBackground(),
    fetchAvatarBuffer(member.avatarUrl || member.defaultAvatarUrl || null),
  ]);

  const avatarPng = avatarSource
    ? await circleAvatar(avatarSource, AVATAR_SIZE)
    : await sharp({
      create: { width: AVATAR_SIZE, height: AVATAR_SIZE, channels: 4, background: { r: 60, g: 83, b: 110, alpha: 1 } },
    }).png().toBuffer();

  const buffer = await sharp(background)
    .resize(OUTPUT_WIDTH, OUTPUT_HEIGHT, { fit: "cover", position: "centre" })
    .composite([
      { input: glowSvg() },
      { input: avatarPng, top: AVATAR_TOP_Y, left: Math.round(AVATAR_CENTER_X - AVATAR_SIZE / 2) },
      { input: frameSvg() },
      { input: textSvg({ greeting, nickname, label }) },
    ])
    .png()
    .toBuffer();

  return {
    buffer,
    fileName: settings.fileName || "mistblossom-welcome.png",
    contentType: "image/png",
    greeting,
    label,
  };
}
