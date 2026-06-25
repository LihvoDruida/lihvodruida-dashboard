import "server-only";

import { FieldValue } from "firebase-admin/firestore";
import { getFirebaseAdminDb, hasFirebaseProfileConfig } from "@/lib/firebaseAdmin";
import { resilientRead } from "@/lib/runtimeResilience";
import { firebaseWrite } from "@/lib/firebaseAccess";
import type { DashboardSession } from "@/lib/auth";

export const DEFAULT_NICKNAME_TEMPLATE = "{name} [{main}, {alt}, {alt}]";
export const DEFAULT_ROLE_REMOVE_CONCURRENCY = 0;
export const DEFAULT_ROLE_REMOVE_MAX_CONCURRENCY = 5;
export const DEFAULT_NICKNAME_CLEANUP_CONCURRENCY = 0;
export const DEFAULT_NICKNAME_CLEANUP_MAX_CONCURRENCY = 4;

const SETTINGS_COLLECTION = "dashboardSettings";
const POLICY_DOC_ID = "discordNicknamePolicy";
const TOKEN_PATTERN = /\{(name|main|alt)\}/gi;

const POLICY_CACHE_TTL_MS = Math.max(60_000, Math.min(30 * 60_000, Number(process.env.GUILD_NICKNAME_POLICY_CACHE_TTL_MS || 10 * 60_000)));

declare global {
  // eslint-disable-next-line no-var
  var __mistblossomGuildNicknamePolicyCache: { policy: GuildNicknamePolicy; cachedAt: number } | undefined;
}

function nicknamePolicyCacheFresh() {
  const cached = globalThis.__mistblossomGuildNicknamePolicyCache;
  return Boolean(cached && Date.now() - cached.cachedAt < POLICY_CACHE_TTL_MS);
}

function setNicknamePolicyCache(policy: GuildNicknamePolicy) {
  globalThis.__mistblossomGuildNicknamePolicyCache = { policy, cachedAt: Date.now() };
  return policy;
}


export type GuildNicknamePolicy = {
  template: string;
  roleRemoveConcurrency: number;
  roleRemoveMaxConcurrency: number;
  nicknameCleanupConcurrency: number;
  nicknameCleanupMaxConcurrency: number;
  updatedAt?: string | null;
  updatedBy?: string | null;
};

function timestampToIso(value: unknown) {
  if (!value) return null;
  if (typeof value === "string") return value;
  const maybeTimestamp = value as { toDate?: () => Date } | null;
  if (maybeTimestamp && typeof maybeTimestamp.toDate === "function") return maybeTimestamp.toDate().toISOString();
  return null;
}

function sliceCodePoints(value: string, maxLength: number) {
  return Array.from(value || "").slice(0, Math.max(0, maxLength)).join("");
}

function codePointLength(value: string) {
  return Array.from(value || "").length;
}

function cleanTemplateText(value: unknown) {
  return Array.from(String(value || "")
    .normalize("NFC")
    .replace(/[\u0000-\u001f\u007f]/g, " ")
    .replace(/\s+/g, " ")
    .trim())
    .slice(0, 96)
    .join("");
}

function isSupportedNicknameTemplate(template: string) {
  if (!template || !/\{name\}/i.test(template) || !/\{(main|alt)\}/i.test(template)) return false;
  const unknownTokens = Array.from(template.matchAll(/\{([^}]+)\}/g))
    .map((match) => match[1]?.toLowerCase())
    .filter((token) => token && !["name", "main", "alt"].includes(token));
  return unknownTokens.length === 0;
}

function normalizeStoredTemplate(value: unknown, fallbackTemplate = DEFAULT_NICKNAME_TEMPLATE) {
  const template = cleanTemplateText(value);
  return isSupportedNicknameTemplate(template) ? template : fallbackTemplate;
}

function cleanIntegerSetting(value: unknown, fallback: number, min: number, max: number) {
  if (value === null || value === undefined || value === "") return fallback;
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.max(min, Math.min(max, Math.floor(number)));
}

function normalizePolicyData(data: Record<string, unknown> | null | undefined, fallbackTemplate = DEFAULT_NICKNAME_TEMPLATE): GuildNicknamePolicy {
  return {
    template: normalizeStoredTemplate(data?.template, fallbackTemplate),
    roleRemoveConcurrency: cleanIntegerSetting(data?.roleRemoveConcurrency, DEFAULT_ROLE_REMOVE_CONCURRENCY, 0, 5),
    roleRemoveMaxConcurrency: cleanIntegerSetting(data?.roleRemoveMaxConcurrency, DEFAULT_ROLE_REMOVE_MAX_CONCURRENCY, 1, 5),
    nicknameCleanupConcurrency: cleanIntegerSetting(data?.nicknameCleanupConcurrency, DEFAULT_NICKNAME_CLEANUP_CONCURRENCY, 0, 4),
    nicknameCleanupMaxConcurrency: cleanIntegerSetting(data?.nicknameCleanupMaxConcurrency, DEFAULT_NICKNAME_CLEANUP_MAX_CONCURRENCY, 1, 4),
    updatedAt: timestampToIso(data?.updatedAt),
    updatedBy: typeof data?.updatedBy === "string" ? data.updatedBy : null,
  };
}

export function cleanNicknameTemplate(value: unknown) {
  const template = cleanTemplateText(value) || DEFAULT_NICKNAME_TEMPLATE;
  if (!/\{name\}/i.test(template)) {
    throw new Error("Шаблон ніку має містити {name}.");
  }
  if (!/\{(main|alt)\}/i.test(template)) {
    throw new Error("Шаблон ніку має містити хоча б одну змінну персонажа: {main} або {alt}.");
  }
  const unknownTokens = Array.from(template.matchAll(/\{([^}]+)\}/g))
    .map((match) => match[1]?.toLowerCase())
    .filter((token) => token && !["name", "main", "alt"].includes(token));
  if (unknownTokens.length) {
    throw new Error(`Невідомі змінні шаблону: ${Array.from(new Set(unknownTokens)).join(", ")}. Доступні: {name}, {main}, {alt}.`);
  }
  return template;
}

export function nicknameTemplateExample(templateInput: unknown = DEFAULT_NICKNAME_TEMPLATE) {
  const template = normalizeStoredTemplate(templateInput);
  return renderNicknameFromTemplate(template, {
    name: "Дмитро",
    characters: ["Khayen", "Krouli", "Sebas"],
  });
}

export async function getGuildNicknamePolicy(options: { bypassCache?: boolean } = {}): Promise<GuildNicknamePolicy> {
  if (!options.bypassCache && nicknamePolicyCacheFresh()) {
    return globalThis.__mistblossomGuildNicknamePolicyCache!.policy;
  }
  const fallback = globalThis.__mistblossomGuildNicknamePolicyCache?.policy || normalizePolicyData(null);
  if (!hasFirebaseProfileConfig()) return setNicknamePolicyCache(fallback);

  const policy = await resilientRead(
    "guild-nickname-policy",
    async () => {
      const snapshot = await getFirebaseAdminDb()
        .collection(SETTINGS_COLLECTION)
        .doc(POLICY_DOC_ID)
        .get();
      return snapshot.exists ? normalizePolicyData(snapshot.data() || null) : fallback;
    },
    {
      ttlMs: POLICY_CACHE_TTL_MS,
      timeoutMs: 2_000,
      fallback: () => fallback,
      circuitKey: "firebase-guild-nickname-policy-read",
      circuitTtlMs: 2 * 60_000,
      logEvent: "guild.nickname_policy_read_failed",
      bypassCache: options.bypassCache,
    },
  );
  return setNicknamePolicyCache(policy);
}

export async function setGuildNicknamePolicy(templateInput: unknown, actor?: DashboardSession | null) {
  const template = cleanNicknameTemplate(templateInput);
  if (!hasFirebaseProfileConfig()) throw new Error("Firebase не налаштований для збереження шаблону ніку.");
  await firebaseWrite(
    "settings",
    "guild-nickname-policy:save",
    () => getFirebaseAdminDb().collection(SETTINGS_COLLECTION).doc(POLICY_DOC_ID).set({
      template,
      updatedAt: FieldValue.serverTimestamp(),
      updatedBy: actor?.name || actor?.login || actor?.id || null,
    }, { merge: true }),
    { timeoutMs: 3_000, logEvent: "guild.nickname_policy_write_failed" },
  );
  return setNicknamePolicyCache({
    ...normalizePolicyData({ template }),
    updatedAt: new Date().toISOString(),
    updatedBy: actor?.name || actor?.login || actor?.id || null,
  });
}

export async function setGuildDiscordManagementSettings(input: {
  template?: unknown;
  roleRemoveConcurrency?: unknown;
  roleRemoveMaxConcurrency?: unknown;
  nicknameCleanupConcurrency?: unknown;
  nicknameCleanupMaxConcurrency?: unknown;
}, actor?: DashboardSession | null) {
  const template = cleanNicknameTemplate(input.template);
  const roleRemoveMaxConcurrency = cleanIntegerSetting(input.roleRemoveMaxConcurrency, DEFAULT_ROLE_REMOVE_MAX_CONCURRENCY, 1, 5);
  const nicknameCleanupMaxConcurrency = cleanIntegerSetting(input.nicknameCleanupMaxConcurrency, DEFAULT_NICKNAME_CLEANUP_MAX_CONCURRENCY, 1, 4);
  const roleRemoveConcurrency = cleanIntegerSetting(input.roleRemoveConcurrency, DEFAULT_ROLE_REMOVE_CONCURRENCY, 0, roleRemoveMaxConcurrency);
  const nicknameCleanupConcurrency = cleanIntegerSetting(input.nicknameCleanupConcurrency, DEFAULT_NICKNAME_CLEANUP_CONCURRENCY, 0, nicknameCleanupMaxConcurrency);

  if (!hasFirebaseProfileConfig()) throw new Error("Firebase не налаштований для збереження Discord-налаштувань.");
  await firebaseWrite(
    "settings",
    "guild-discord-management:save",
    () => getFirebaseAdminDb().collection(SETTINGS_COLLECTION).doc(POLICY_DOC_ID).set({
      template,
      roleRemoveConcurrency,
      roleRemoveMaxConcurrency,
      nicknameCleanupConcurrency,
      nicknameCleanupMaxConcurrency,
      updatedAt: FieldValue.serverTimestamp(),
      updatedBy: actor?.name || actor?.login || actor?.id || null,
    }, { merge: true }),
    { timeoutMs: 3_000, logEvent: "guild.discord_management_write_failed" },
  );

  return setNicknamePolicyCache({
    ...normalizePolicyData({
      template,
      roleRemoveConcurrency,
      roleRemoveMaxConcurrency,
      nicknameCleanupConcurrency,
      nicknameCleanupMaxConcurrency,
    }),
    updatedAt: new Date().toISOString(),
    updatedBy: actor?.name || actor?.login || actor?.id || null,
  });
}

function cleanNicknamePart(value: unknown, maxLength: number) {
  return sliceCodePoints(String(value || "")
    .normalize("NFC")
    .replace(/[\u0000-\u001f\u007f]/g, " ")
    .replace(/[<>@#`*_~|{}[\]\\]/g, "")
    .replace(/\s+/g, " ")
    .trim(), maxLength).trim();
}

function normalizeCharacterNames(values: unknown) {
  const items = Array.isArray(values) ? values : String(values || "").split(/[,;]+/g);
  const seen = new Set<string>();
  const result: string[] = [];
  for (const item of items) {
    const name = cleanNicknamePart(item, 16);
    const key = name.normalize("NFC").toLocaleLowerCase("uk");
    if (!name || seen.has(key)) continue;
    seen.add(key);
    result.push(name);
    if (result.length >= 3) break;
  }
  return result;
}

function applyTemplate(template: string, parts: { name: string; main: string; alts: string[] }) {
  let altIndex = 0;
  const rendered = template.replace(TOKEN_PATTERN, (_, key: string) => {
    const token = key.toLowerCase();
    if (token === "name") return parts.name;
    if (token === "main") return parts.main;
    if (token === "alt") {
      const value = parts.alts[altIndex] || "";
      altIndex += 1;
      return value;
    }
    return "";
  });

  return rendered
    .replace(/,\s*(?=,|\]|\))/g, "")
    .replace(/\[\s*,\s*/g, "[")
    .replace(/\(\s*,\s*/g, "(")
    .replace(/,\s*\]/g, "]")
    .replace(/,\s*\)/g, ")")
    .replace(/\[\s*\]/g, "")
    .replace(/\(\s*\)/g, "")
    .replace(/\s+,/g, ",")
    .replace(/\s+/g, " ")
    .replace(/\[\s+/g, "[")
    .replace(/\s+\]/g, "]")
    .trim();
}

export function renderNicknameFromTemplate(templateInput: unknown, input: { name: string; characters: string[]; maxLength?: number }) {
  const template = normalizeStoredTemplate(templateInput);
  const maxLength = Math.max(16, Math.min(32, Math.floor(Number(input.maxLength || 32))));
  const baseName = cleanNicknamePart(input.name, 32) || "Учасник";
  const allCharacters = normalizeCharacterNames(input.characters);
  const main = allCharacters[0] || "";
  const alts = allCharacters.slice(1, 3);

  for (let count = alts.length; count >= 0; count -= 1) {
    const currentAlts = alts.slice(0, count);
    const candidate = applyTemplate(template, { name: baseName, main, alts: currentAlts });
    if (candidate && codePointLength(candidate) <= maxLength) return candidate;
  }

  const minimal = applyTemplate(template, { name: baseName, main, alts: [] });
  if (minimal && codePointLength(minimal) <= maxLength) return minimal;
  return sliceCodePoints(baseName, maxLength).trim() || "Учасник";
}

function escapeRegexChar(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function templateLiteralToRegex(literal: string) {
  let output = "";
  let pendingWhitespace = false;

  for (const char of literal) {
    if (/\s/u.test(char)) {
      if (output.endsWith("\\s*")) continue;
      pendingWhitespace = true;
      continue;
    }

    if (char === ",") {
      output += "\\s*,\\s*";
      pendingWhitespace = false;
      continue;
    }

    if (char === "[") {
      output += "\\[\\s*";
      pendingWhitespace = false;
      continue;
    }

    if (char === "]") {
      output += "\\s*\\]";
      pendingWhitespace = false;
      continue;
    }

    if (char === "(") {
      output += "\\(\\s*";
      pendingWhitespace = false;
      continue;
    }

    if (char === ")") {
      output += "\\s*\\)";
      pendingWhitespace = false;
      continue;
    }

    if (pendingWhitespace) {
      output += "\\s+";
      pendingWhitespace = false;
    }
    output += escapeRegexChar(char);
  }

  if (pendingWhitespace) output += "\\s+";
  return output;
}

function characterNicknamePattern() {
  return "[^\\[\\],\\n]{2,16}";
}

export function nicknameTemplateToRegex(templateInput: unknown) {
  const template = normalizeStoredTemplate(templateInput);
  let output = "";
  let lastIndex = 0;
  let seenCharacterToken = false;
  const pattern = /\{(name|main|alt)\}/gi;

  for (const match of template.matchAll(pattern)) {
    const token = match[1].toLowerCase();
    const literal = template.slice(lastIndex, match.index);

    if (token === "name") {
      output += templateLiteralToRegex(literal);
      output += "[^\\[\\]\\n]{2,32}";
    } else {
      const characterToken = characterNicknamePattern();
      if (seenCharacterToken) {
        output += `(?:${templateLiteralToRegex(literal)}${characterToken})?`;
      } else {
        output += templateLiteralToRegex(literal);
        output += characterToken;
        seenCharacterToken = true;
      }
    }

    lastIndex = (match.index || 0) + match[0].length;
  }

  output += templateLiteralToRegex(template.slice(lastIndex));
  return new RegExp(`^\\s*${output}\\s*$`, "iu");
}

export function nicknameMatchesTemplate(nicknameInput: unknown, templateInput: unknown) {
  const nickname = String(nicknameInput || "").normalize("NFC").replace(/\s+/g, " ").trim();
  if (!nickname) return false;
  return nicknameTemplateToRegex(templateInput).test(nickname);
}
