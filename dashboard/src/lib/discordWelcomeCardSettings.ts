import "server-only";

import { FieldValue } from "@/lib/db/firestoreCompat";
import { getFirebaseAdminDb, hasFirebaseProfileConfig } from "@/lib/firebaseAdmin";
import { resilientRead } from "@/lib/runtimeResilience";
import { firebaseWrite } from "@/lib/firebaseAccess";
import type { DashboardSession } from "@/lib/auth";
import { timestampToIso } from "@/lib/values";

const SETTINGS_COLLECTION = "dashboardSettings";
const SETTINGS_DOC_ID = "discordWelcomeCardSettings";
const SETTINGS_CACHE_TTL_MS = Math.max(10_000, Math.min(5 * 60_000, Number(process.env.DISCORD_WELCOME_CARD_SETTINGS_CACHE_TTL_MS || 30_000)));

const DEFAULT_GREETINGS = [
  "Ishnu-alah!",
  "Elune-adore.",
  "Shan'do alah!",
  "Ласкаво просимо до гільдії!",
  "Нехай Елуна береже твій шлях!",
  "Вітаємо серед нічних вартових!",
] as const;

const DEFAULT_MESSAGE_TEMPLATE = "🌿 Новий мандрівник у Mistblossom Vanguard — {mention}";
const DEFAULT_LABEL_PREFIX = "Мурлок";
const DEFAULT_FILE_NAME = "mistblossom-welcome.png";

export type DiscordWelcomeCardSettings = {
  enabled: boolean;
  channelId: string;
  messageTemplate: string;
  greetings: string[];
  labelPrefix: string;
  fileName: string;
  updatedAt?: string | null;
  updatedBy?: string | null;
};

declare global {
  // eslint-disable-next-line no-var
  var __mistblossomDiscordWelcomeCardSettingsCache: { settings: DiscordWelcomeCardSettings; cachedAt: number } | undefined;
}

function cleanSnowflake(value: unknown) {
  const text = String(value || "").trim();
  return /^\d{16,25}$/.test(text) ? text : "";
}

function cleanText(value: unknown, max = 240) {
  return Array.from(String(value || "")
    .normalize("NFC")
    .replace(/[\u0000-\u001f\u007f]/g, " ")
    .replace(/\s+/g, " ")
    .trim())
    .slice(0, Math.max(0, max))
    .join("");
}

function cleanMultilineText(value: unknown, max = 1200) {
  return Array.from(String(value || "")
    .normalize("NFC")
    .replace(/\r\n/g, "\n")
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, " ")
    .trim())
    .slice(0, Math.max(0, max))
    .join("");
}

function cleanBool(value: unknown, fallback = false) {
  if (typeof value === "boolean") return value;
  const text = String(value ?? "").trim().toLowerCase();
  if (["1", "true", "yes", "on", "enabled", "увімкнено"].includes(text)) return true;
  if (["0", "false", "no", "off", "disabled", "вимкнено"].includes(text)) return false;
  return fallback;
}

function parseGreetings(value: unknown) {
  const input = Array.isArray(value)
    ? value.map((item) => cleanText(item, 96)).filter(Boolean)
    : cleanMultilineText(value, 2000)
      .split(/\n+/g)
      .map((line) => cleanText(line, 96))
      .filter(Boolean);
  const seen = new Set<string>();
  const result: string[] = [];
  for (const item of input) {
    const key = item.toLocaleLowerCase("uk");
    if (!item || seen.has(key)) continue;
    seen.add(key);
    result.push(item);
    if (result.length >= 24) break;
  }
  return result.length ? result : [...DEFAULT_GREETINGS];
}

function normalizeSettings(data: Record<string, unknown> | null | undefined): DiscordWelcomeCardSettings {
  return {
    enabled: cleanBool(data?.enabled, false),
    channelId: cleanSnowflake(data?.channelId),
    messageTemplate: cleanMultilineText(data?.messageTemplate, 600) || DEFAULT_MESSAGE_TEMPLATE,
    greetings: parseGreetings(data?.greetings),
    labelPrefix: cleanText(data?.labelPrefix, 24) || DEFAULT_LABEL_PREFIX,
    fileName: cleanText(data?.fileName, 60) || DEFAULT_FILE_NAME,
    updatedAt: timestampToIso(data?.updatedAt),
    updatedBy: typeof data?.updatedBy === "string" ? data.updatedBy : null,
  };
}

function cacheFresh() {
  const cached = globalThis.__mistblossomDiscordWelcomeCardSettingsCache;
  return Boolean(cached && Date.now() - cached.cachedAt < SETTINGS_CACHE_TTL_MS);
}

function setCache(settings: DiscordWelcomeCardSettings) {
  globalThis.__mistblossomDiscordWelcomeCardSettingsCache = { settings, cachedAt: Date.now() };
  return settings;
}

export function defaultDiscordWelcomeGreetings() {
  return [...DEFAULT_GREETINGS];
}

export function renderDiscordWelcomeMessageTemplate(templateInput: unknown, params: {
  mention: string;
  username: string;
  displayName: string;
  greeting: string;
  label: string;
}) {
  const template = cleanMultilineText(templateInput, 600) || DEFAULT_MESSAGE_TEMPLATE;
  return template
    .replace(/\{mention\}/gi, params.mention)
    .replace(/\{username\}/gi, params.username)
    .replace(/\{displayName\}/gi, params.displayName)
    .replace(/\{greeting\}/gi, params.greeting)
    .replace(/\{label\}/gi, params.label)
    .trim()
    .slice(0, 1800);
}

export async function getDiscordWelcomeCardSettings(options: { bypassCache?: boolean } = {}): Promise<DiscordWelcomeCardSettings> {
  if (!options.bypassCache && cacheFresh()) return globalThis.__mistblossomDiscordWelcomeCardSettingsCache!.settings;
  const fallback = globalThis.__mistblossomDiscordWelcomeCardSettingsCache?.settings || normalizeSettings(null);
  if (!hasFirebaseProfileConfig()) return setCache(fallback);

  const settings = await resilientRead(
    "discord-welcome-card-settings",
    async () => {
      const snapshot = await getFirebaseAdminDb().collection(SETTINGS_COLLECTION).doc(SETTINGS_DOC_ID).get();
      return snapshot.exists ? normalizeSettings(snapshot.data() || null) : fallback;
    },
    {
      ttlMs: SETTINGS_CACHE_TTL_MS,
      timeoutMs: 2_000,
      fallback: () => fallback,
      circuitKey: "firebase-discord-welcome-card-settings-read",
      circuitTtlMs: 60_000,
      logEvent: "discord.welcome_card_settings_read_failed",
      bypassCache: options.bypassCache,
    },
  );

  return setCache(settings);
}

export async function setDiscordWelcomeCardSettings(input: {
  enabled?: unknown;
  channelId?: unknown;
  messageTemplate?: unknown;
  greetings?: unknown;
  labelPrefix?: unknown;
  fileName?: unknown;
}, actor?: DashboardSession | null) {
  const enabled = cleanBool(input.enabled, false);
  const channelId = cleanSnowflake(input.channelId);
  const messageTemplate = cleanMultilineText(input.messageTemplate, 600) || DEFAULT_MESSAGE_TEMPLATE;
  const greetings = parseGreetings(input.greetings);
  const labelPrefix = cleanText(input.labelPrefix, 24) || DEFAULT_LABEL_PREFIX;
  const rawFileName = cleanText(input.fileName, 60) || DEFAULT_FILE_NAME;
  const fileName = rawFileName.toLowerCase().endsWith(".png") ? rawFileName : `${rawFileName}.png`;

  if (enabled && !channelId) {
    throw new Error("Для картки привітання потрібно вибрати Discord-канал.");
  }
  if (!hasFirebaseProfileConfig()) {
    throw new Error("Firebase не налаштований для збереження welcome-карток.");
  }

  await firebaseWrite(
    "settings",
    "discord-welcome-card-settings:save",
    () => getFirebaseAdminDb().collection(SETTINGS_COLLECTION).doc(SETTINGS_DOC_ID).set({
      enabled,
      channelId,
      messageTemplate,
      greetings,
      labelPrefix,
      fileName,
      updatedAt: FieldValue.serverTimestamp(),
      updatedBy: actor?.name || actor?.login || actor?.id || null,
    }, { merge: true }),
    { timeoutMs: 3_000, logEvent: "discord.welcome_card_settings_write_failed" },
  );

  return setCache({
    enabled,
    channelId,
    messageTemplate,
    greetings,
    labelPrefix,
    fileName,
    updatedAt: new Date().toISOString(),
    updatedBy: actor?.name || actor?.login || actor?.id || null,
  });
}
