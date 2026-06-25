import { createHash } from "crypto";

export function cleanWowText(value: unknown, maxLength = 160) {
  return Array.from(String(value || "")
    .normalize("NFC")
    .replace(/[\u0000-\u001f\u007f]/g, " ")
    .replace(/\s+/g, " ")
    .trim())
    .slice(0, Math.max(0, maxLength))
    .join("");
}

export function normalizeWowLookupText(value: unknown, maxLength = 160) {
  return cleanWowText(value, maxLength)
    .toLocaleLowerCase("uk")
    .replace(/[ʼ’']/g, "'")
    .trim();
}

export function normalizeBattleNetNameSlug(value: unknown, maxLength = 80) {
  return normalizeWowLookupText(value, maxLength)
    .replace(/\s+/g, "-");
}

export function normalizeBattleNetRealmSlug(value: unknown, maxLength = 120) {
  return normalizeWowLookupText(value, maxLength)
    .replace(/\s+/g, "-");
}

function isSafeKeySegment(value: string) {
  return /^[a-z0-9-]+$/.test(value);
}

function hashUnicodeSegment(value: string, prefix: "u" | "r") {
  const digest = createHash("sha256").update(value, "utf8").digest("hex").slice(0, 24);
  return `${prefix}_${digest}`;
}

function normalizeKeySegment(value: unknown, prefix: "u" | "r") {
  const clean = normalizeWowLookupText(value, 160).replace(/\s+/g, "-");
  if (!clean) return "";

  // Already encoded segments are accepted as-is. This keeps existing saved
  // characters stable and makes form actions idempotent.
  if (/^[ur]_[a-f0-9]{12,64}$/.test(clean)) return clean;

  if (isSafeKeySegment(clean)) return clean.slice(0, 120);

  return hashUnicodeSegment(clean, prefix);
}

export function buildBattleNetCharacterKey(regionInput: unknown, realmSlugInput: unknown, nameInput: unknown) {
  const region = cleanWowText(regionInput, 12).toLocaleLowerCase();
  const safeRegion = /^[a-z]{2}$/.test(region) ? region : "eu";
  const realmSegment = normalizeKeySegment(realmSlugInput, "r");
  const nameSegment = normalizeKeySegment(nameInput, "u");
  if (!realmSegment || !nameSegment) return "";
  return `${safeRegion}:${realmSegment}:${nameSegment}`;
}

export function normalizeCharacterKey(value: unknown) {
  const raw = normalizeWowLookupText(value, 260);
  if (!raw) return "";

  const parts = raw.split(":").map((part) => part.trim()).filter(Boolean);
  if (parts.length < 3) return "";

  // Старі записи складу гільдії зберігали ключ як region:realm:name:id.
  // Для рейдів потрібна стабільна Battle.net-форма region:realm:name,
  // інакше вибір із сірого списку губиться під час save/read.
  const [regionInput, realmInput, nameInput] = parts;
  return buildBattleNetCharacterKey(regionInput, realmInput, nameInput);
}

export type CharacterProfileSlugSource = {
  key?: unknown;
  region?: unknown;
  realmSlug?: unknown;
  realmName?: unknown;
  normalizedName?: unknown;
  name?: unknown;
};

function normalizeUrlSlugSegment(value: unknown, maxLength = 120) {
  return normalizeWowLookupText(value, maxLength)
    .replace(/[:_]+/g, "-")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
}

function splitBattleNetCharacterKey(value: unknown) {
  const key = normalizeCharacterKey(value);
  if (!key) return null;
  const [region, realmSlug, normalizedName] = key.split(":");
  if (!region || !realmSlug || !normalizedName) return null;
  return { region, realmSlug, normalizedName };
}

export function buildCharacterProfileSlug(character: CharacterProfileSlugSource) {
  const keyParts = splitBattleNetCharacterKey(character.key);
  const region = cleanWowText(character.region || keyParts?.region || "eu", 12).toLocaleLowerCase();
  const safeRegion = /^[a-z]{2}$/.test(region) ? region : "eu";
  const realmSlug = normalizeUrlSlugSegment(character.realmSlug || character.realmName || keyParts?.realmSlug, 120);
  const nameSlug = normalizeUrlSlugSegment(character.normalizedName || character.name || keyParts?.normalizedName, 80);

  if (!nameSlug || !realmSlug) return "";
  return `${nameSlug}-${realmSlug}-${safeRegion}`;
}

export function normalizeCharacterProfileSlug(value: unknown) {
  return normalizeUrlSlugSegment(value, 260);
}

export function isCharacterProfileRouteMatch(character: CharacterProfileSlugSource, routeSegment: unknown) {
  const decoded = cleanWowText(routeSegment, 320);
  if (!decoded) return false;

  const routeSlug = normalizeCharacterProfileSlug(decoded);
  const canonicalSlug = normalizeCharacterProfileSlug(buildCharacterProfileSlug(character));
  if (routeSlug && canonicalSlug && routeSlug === canonicalSlug) return true;

  const routeKey = normalizeCharacterKey(decoded);
  const characterKey = normalizeCharacterKey(character.key);
  return Boolean(routeKey && characterKey && routeKey === characterKey);
}

export function normalizeWowAvatarImageUrl(value: unknown) {
  const text = cleanWowText(value, 700);
  if (!text) return null;

  try {
    const url = new URL(text);
    if (url.protocol !== "https:" && url.protocol !== "http:") return null;

    const path = url.pathname;
    const avatarPath = path.replace(/-(?:main-raw|main)\.png$/i, "-avatar.jpg");
    if (avatarPath !== path) {
      url.pathname = avatarPath;
      return url.toString();
    }

    if (/\.(?:png|jpe?g|webp)$/i.test(path)) return url.toString();
    return null;
  } catch {
    return null;
  }
}

export function pickWowAvatarImageUrl(...values: unknown[]) {
  for (const value of values) {
    const avatarUrl = normalizeWowAvatarImageUrl(value);
    if (avatarUrl) return avatarUrl;
  }
  return null;
}
