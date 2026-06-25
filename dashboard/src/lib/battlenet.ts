import { createHash } from "crypto";
import { ApiHttpError, apiFetchJson } from "@/lib/apiHttp";
import { getDashboardUrl } from "@/lib/oauth";
import { getAdaptiveConcurrency, mapConcurrent, readIntegerEnv } from "@/lib/concurrency";
import { buildBattleNetCharacterKey, normalizeBattleNetNameSlug, normalizeBattleNetRealmSlug } from "@/lib/wowCharacters";
import { resolveWowCharacterRole, type WowCharacterRole } from "@/lib/wowRoles";

export type BattleNetRegion = "us" | "eu" | "kr" | "tw";

export type BattleNetProfileUnavailableReason =
  | "not_found"
  | "forbidden";

export function isBattleNetCharacterProfileUnavailableError(error: unknown) {
  return (
    error instanceof ApiHttpError &&
    (error.status === 404 || error.status === 403)
  );
}

export function battleNetProfileUnavailableReason(
  error: unknown,
): BattleNetProfileUnavailableReason | null {
  if (!(error instanceof ApiHttpError)) return null;
  if (error.status === 404) return "not_found";
  if (error.status === 403) return "forbidden";
  return null;
}

const ALL_BATTLE_NET_REGIONS: BattleNetRegion[] = ["eu", "us", "kr", "tw"];
export const BATTLE_NET_REGIONS: BattleNetRegion[] = ALL_BATTLE_NET_REGIONS;

export function getEnabledBattleNetRegions(): BattleNetRegion[] {
  const raw = process.env.BATTLENET_ENABLED_REGIONS || process.env.BATTLENET_REGIONS || "eu";
  const values = String(raw)
    .split(",")
    .map((item) => item.trim().toLowerCase())
    .filter(Boolean);

  const enabled = values.filter((item): item is BattleNetRegion => (ALL_BATTLE_NET_REGIONS as string[]).includes(item));
  return Array.from(new Set(enabled.length ? enabled : ["eu"]));
}

export function getPrimaryBattleNetRegion(): BattleNetRegion {
  return getEnabledBattleNetRegions()[0] || "eu";
}

export type BattleNetAccountInfo = {
  accountLabel: string | null;
  accountIdHash: string | null;
};

export type BattleNetGuildCharacterStatus = "guild_master" | "officer" | "member";

export type BattleNetGuildRankInfo = {
  rank: number | null;
  status: BattleNetGuildCharacterStatus | null;
  label: string | null;
  key?: string | null;
  region?: BattleNetRegion | string | null;
  characterName?: string | null;
  normalizedName?: string | null;
  realmSlug?: string | null;
};

export type BattleNetCharacterCandidate = {
  key: string;
  source: "battlenet";
  region: BattleNetRegion;
  name: string;
  normalizedName: string;
  realmSlug: string;
  realmName: string;
  level: number | null;
  faction: string | null;
  className: string | null;
  activeSpecName: string | null;
  activeSpecId: number | null;
  activeSpecRole: WowCharacterRole;
  raceName: string | null;
  genderName: string | null;
  guildName: string | null;
  guildRealmSlug: string | null;
  guildRank: number | null;
  guildStatus: BattleNetGuildCharacterStatus | null;
  guildStatusLabel: string | null;
  profileUrl: string;
  avatarUrl: string | null;
  renderUrl: string | null;
  mediaUrl: string | null;
  verifiedGuild: boolean;
  itemLevel?: number | null;
  lastSeenAt: string;
};

export const BNET_OAUTH_STATE_COOKIE = "__Host-mistblossom_bnet_state";
const DEFAULT_GUILD_NAME = "Mistblossom Vanguard";
const DEFAULT_GUILD_REALM = "terokkar";
const DEFAULT_LOCALE_BY_REGION: Record<BattleNetRegion, string> = {
  us: "en_US",
  eu: "en_GB",
  kr: "ko_KR",
  tw: "zh_TW",
};

function cleanText(value: unknown, maxLength = 160) {
  return Array.from(String(value || "")
    .normalize("NFC")
    .replace(/[\u0000-\u001f\u007f]/g, " ")
    .replace(/\s+/g, " ")
    .trim())
    .slice(0, Math.max(0, maxLength))
    .join("");
}

function envFlag(name: string, fallback = false) {
  const raw = process.env[name];
  if (raw === undefined || raw === null || raw === "") return fallback;
  return ["1", "true", "yes", "on"].includes(String(raw).toLowerCase());
}

function getBattleNetRequestTimeoutMs() {
  return readIntegerEnv("BATTLENET_REQUEST_TIMEOUT_MS", 10_000, 2_500, 30_000);
}

function getBattleNetRetryCount() {
  return readIntegerEnv("BATTLENET_REQUEST_RETRIES", 2, 0, 5);
}

function getBattleNetRetryDelayMs(attempt: number, retryAfterHeader?: string | null) {
  const retryAfter = Number(retryAfterHeader || 0);
  if (Number.isFinite(retryAfter) && retryAfter > 0) {
    return Math.min(15_000, Math.max(500, retryAfter * 1000));
  }
  return Math.min(8_000, 450 * Math.pow(2, Math.max(0, attempt)));
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function getBattleNetScanConcurrency(total: number) {
  return getAdaptiveConcurrency(total, {
    profile: "external-api",
    envKey: "BATTLENET_SCAN_CONCURRENCY",
    maxEnvKey: "BATTLENET_SCAN_MAX_CONCURRENCY",
    min: 2,
    max: 12,
  });
}

export function normalizeBattleNetRegion(value?: string | null): BattleNetRegion {
  const clean = String(value || "").trim().toLowerCase();
  return (ALL_BATTLE_NET_REGIONS as string[]).includes(clean) ? clean as BattleNetRegion : "eu";
}

export function getDefaultBattleNetRegion(): BattleNetRegion {
  return normalizeBattleNetRegion(process.env.BATTLENET_DEFAULT_REGION || process.env.BATTLE_NET_DEFAULT_REGION || process.env.WOW_REGION || getPrimaryBattleNetRegion());
}

export function getBattleNetLocale(region: BattleNetRegion = getDefaultBattleNetRegion()) {
  return process.env.BATTLENET_LOCALE || process.env.BATTLE_NET_LOCALE || process.env.BLIZZARD_LOCALE || DEFAULT_LOCALE_BY_REGION[region];
}

export function battleNetRedirectUri() {
  return `${getDashboardUrl()}/api/auth/battlenet/callback`;
}

function battleNetOAuthBase(region: BattleNetRegion = getDefaultBattleNetRegion()) {
  return `https://${region}.battle.net/oauth`;
}

function battleNetApiBase(region: BattleNetRegion = getDefaultBattleNetRegion()) {
  return `https://${region}.api.blizzard.com`;
}

function profileNamespace(region: BattleNetRegion = getDefaultBattleNetRegion()) {
  return `profile-${region}`;
}

function getBattleNetClient() {
  const clientId = process.env.BATTLENET_CLIENT_ID || process.env.BATTLE_NET_CLIENT_ID || process.env.BLIZZARD_CLIENT_ID;
  const clientSecret = process.env.BATTLENET_CLIENT_SECRET || process.env.BATTLE_NET_CLIENT_SECRET || process.env.BLIZZARD_CLIENT_SECRET;

  if (!clientId || !clientSecret) {
    throw new Error("Battle.net OAuth env is not configured.");
  }

  return { clientId, clientSecret };
}

function basicAuth(clientId: string, clientSecret: string) {
  return Buffer.from(`${clientId}:${clientSecret}`, "utf8").toString("base64");
}

export function buildBattleNetOAuthUrl(state: string, regionInput?: string | null) {
  const region = normalizeBattleNetRegion(regionInput || getDefaultBattleNetRegion());
  const { clientId } = getBattleNetClient();
  const url = new URL(`${battleNetOAuthBase(region)}/authorize`);
  url.searchParams.set("client_id", clientId);
  url.searchParams.set("redirect_uri", battleNetRedirectUri());
  url.searchParams.set("response_type", "code");
  url.searchParams.set("scope", "openid wow.profile");
  url.searchParams.set("state", state);
  return url.toString();
}

function hashBattleNetAccountId(value: string) {
  return createHash("sha256").update(value).digest("hex").slice(0, 16);
}

export async function fetchBattleNetUserInfo(accessToken: string, regionInput?: string | null): Promise<BattleNetAccountInfo | null> {
  const region = normalizeBattleNetRegion(regionInput || getDefaultBattleNetRegion());
  const response = await fetch(`${battleNetOAuthBase(region)}/userinfo`, {
    headers: { Authorization: `Bearer ${accessToken}`, Accept: "application/json" },
    cache: "no-store",
  });

  const raw = await response.text();
  let data: any = null;
  try {
    data = raw ? JSON.parse(raw) : null;
  } catch {
    data = null;
  }

  if (!response.ok || !data) return null;

  const label = cleanText(data?.battletag || data?.battle_tag || data?.preferred_username || "", 120) || null;
  const rawId = cleanText(data?.id || data?.sub || "", 200) || null;

  return {
    accountLabel: label,
    accountIdHash: rawId ? hashBattleNetAccountId(rawId) : null,
  };
}

export async function exchangeBattleNetCode(code: string, regionInput?: string | null) {
  const region = normalizeBattleNetRegion(regionInput || getDefaultBattleNetRegion());
  const { clientId, clientSecret } = getBattleNetClient();
  const body = new URLSearchParams({
    grant_type: "authorization_code",
    code,
    redirect_uri: battleNetRedirectUri(),
  });

  const response = await fetch(`${battleNetOAuthBase(region)}/token`, {
    method: "POST",
    headers: {
      Authorization: `Basic ${basicAuth(clientId, clientSecret)}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body,
    cache: "no-store",
  });

  const raw = await response.text();
  let data: any = null;
  try {
    data = raw ? JSON.parse(raw) : null;
  } catch {
    data = null;
  }

  if (!response.ok) {
    throw new Error(data?.error_description || data?.error || raw || `Battle.net OAuth error ${response.status}`);
  }

  if (!data?.access_token) {
    throw new Error("Battle.net OAuth response does not contain access_token.");
  }

  return data as { access_token: string; token_type?: string; expires_in?: number; scope?: string };
}


type BattleNetApplicationToken = {
  accessToken: string;
  expiresAt: number;
};

const battleNetApplicationTokenCache = new Map<BattleNetRegion, BattleNetApplicationToken>();
const battleNetGuildRankMapCache = new Map<string, { checkedAt: number; ranks: Map<string, BattleNetGuildRankInfo> }>();

function guildRankCacheTtlMs() {
  const value = Number(process.env.BATTLENET_GUILD_RANK_CACHE_SECONDS || 600);
  return Math.max(60, Math.min(3600, Number.isFinite(value) ? Math.floor(value) : 600)) * 1000;
}

async function fetchBattleNetApplicationToken(regionInput?: string | null) {
  const region = normalizeBattleNetRegion(regionInput || getDefaultBattleNetRegion());
  const cached = battleNetApplicationTokenCache.get(region);
  if (cached && cached.expiresAt > Date.now() + 60_000) return cached.accessToken;

  const { clientId, clientSecret } = getBattleNetClient();
  const body = new URLSearchParams({ grant_type: "client_credentials" });
  const response = await fetch(`${battleNetOAuthBase(region)}/token`, {
    method: "POST",
    headers: {
      Authorization: `Basic ${basicAuth(clientId, clientSecret)}`,
      "Content-Type": "application/x-www-form-urlencoded",
      Accept: "application/json",
    },
    body,
    cache: "no-store",
  });

  const raw = await response.text();
  let data: any = null;
  try {
    data = raw ? JSON.parse(raw) : null;
  } catch {
    data = null;
  }

  if (!response.ok || !data?.access_token) {
    throw new Error(data?.error_description || data?.error || raw || `Battle.net application token error ${response.status}`);
  }

  const expiresIn = Number(data?.expires_in || 0);
  battleNetApplicationTokenCache.set(region, {
    accessToken: String(data.access_token),
    expiresAt: Date.now() + Math.max(60, expiresIn - 60) * 1000,
  });

  return String(data.access_token);
}

export async function checkBattleNetApplicationAccess(regionInput?: string | null) {
  await fetchBattleNetApplicationToken(regionInput);
  return true;
}

async function bnetFetch(
  accessToken: string,
  path: string,
  params?: Record<string, string>,
  regionInput?: string | null,
  options?: { timeoutMs?: number; retries?: number },
) {
  const region = normalizeBattleNetRegion(regionInput || getDefaultBattleNetRegion());
  const locale = getBattleNetLocale(region);
  const url = new URL(`${battleNetApiBase(region)}${path}`);
  url.searchParams.set("namespace", profileNamespace(region));
  url.searchParams.set("locale", locale);
  for (const [key, value] of Object.entries(params || {})) {
    url.searchParams.set(key, value);
  }

  return apiFetchJson<any>(url, {
    label: "Battle.net API",
    timeoutMs: Math.max(2_500, Math.min(30_000, Math.floor(Number(options?.timeoutMs || getBattleNetRequestTimeoutMs())))),
    retries: Math.max(0, Math.min(5, Math.floor(Number(options?.retries ?? getBattleNetRetryCount())))),
    headers: { Authorization: `Bearer ${accessToken}`, Accept: "application/json" },
    cache: "no-store",
  });
}

export async function fetchBattleNetApplicationData(
  path: string,
  params?: Record<string, string>,
  regionInput?: string | null,
  options?: { timeoutMs?: number; retries?: number },
) {
  const region = normalizeBattleNetRegion(regionInput || getDefaultBattleNetRegion());
  const accessToken = await fetchBattleNetApplicationToken(region);
  return bnetFetch(accessToken, path, params, region, options);
}


function pickLocalizedName(value: any): string | null {
  if (!value) return null;
  if (typeof value === "string") return cleanText(value, 120) || null;
  if (typeof value.name === "string") return cleanText(value.name, 120) || null;
  if (typeof value.name?.en_GB === "string") return cleanText(value.name.en_GB, 120) || null;
  const localized = Object.values(value.name || {}).find((item) => typeof item === "string" && item.trim());
  return localized ? cleanText(localized, 120) || null : null;
}

function pickActiveSpecId(value: any): number | null {
  const id = Number(value?.id || value?.key?.href?.match?.(/specialization\/(\d+)/)?.[1]);
  return Number.isFinite(id) && id > 0 ? Math.floor(id) : null;
}

function normalizeGuildName(value: unknown) {
  return cleanText(value, 120).normalize("NFC").toLocaleLowerCase("uk");
}

function guildSlug(value: unknown) {
  return cleanText(value, 140)
    .normalize("NFC")
    .toLocaleLowerCase("uk")
    .replace(/[ʼ’']/g, "")
    .replace(/[^\p{L}\p{N}]+/gu, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
}

function guildRosterConfig(regionInput?: string | null) {
  const region = normalizeBattleNetRegion(regionInput || getDefaultBattleNetRegion());
  const guildName = cleanText(process.env.GUILD_ROSTER_NAME || process.env.WOW_GUILD_NAME || process.env.BATTLENET_ALLOWED_GUILD_NAME || DEFAULT_GUILD_NAME, 140) || DEFAULT_GUILD_NAME;
  const realmSlug = normalizeBattleNetRealmSlug(process.env.GUILD_ROSTER_REALM || process.env.WOW_REALM || process.env.WOW_GUILD_REALM || process.env.BATTLENET_ALLOWED_GUILD_REALM || DEFAULT_GUILD_REALM) || DEFAULT_GUILD_REALM;
  return { region, guildName, guildSlug: guildSlug(guildName) || guildSlug(DEFAULT_GUILD_NAME), realmSlug };
}

export function guildStatusFromRank(rankInput: unknown): BattleNetGuildRankInfo {
  const rank = Number(rankInput);
  const normalizedRank = Number.isFinite(rank) && rank >= 0 ? Math.floor(rank) : null;
  if (normalizedRank === null) return { rank: null, status: null, label: null };
  if (normalizedRank === 0) return { rank: normalizedRank, status: "guild_master", label: "Глава" };
  if (normalizedRank === 1) return { rank: normalizedRank, status: "officer", label: "Офіцер" };
  return { rank: normalizedRank, status: "member", label: "Учасник" };
}

function guildRankMapKey(region: BattleNetRegion | string, realmSlug: unknown, name: unknown) {
  const key = buildBattleNetCharacterKey(region, normalizeBattleNetRealmSlug(realmSlug), normalizeBattleNetNameSlug(name));
  return key || "";
}

export async function fetchBattleNetGuildRankMap(regionInput?: string | null): Promise<Map<string, BattleNetGuildRankInfo>> {
  const config = guildRosterConfig(regionInput);
  const cacheKey = `${config.region}:${config.realmSlug}:${config.guildSlug}`;
  const cached = battleNetGuildRankMapCache.get(cacheKey);
  if (cached && Date.now() - cached.checkedAt < guildRankCacheTtlMs()) return new Map(cached.ranks);

  const accessToken = await fetchBattleNetApplicationToken(config.region);
  const roster = await bnetFetch(
    accessToken,
    `/data/wow/guild/${encodeURIComponent(config.realmSlug)}/${encodeURIComponent(config.guildSlug)}/roster`,
    { namespace: `profile-${config.region}` },
    config.region,
  );
  const members = Array.isArray(roster?.members) ? roster.members : [];
  const map = new Map<string, BattleNetGuildRankInfo>();
  for (const entry of members) {
    const character = entry?.character || {};
    const name = cleanText(character?.name, 80);
    const realmSlug = normalizeBattleNetRealmSlug(character?.realm?.slug || character?.realm?.name || config.realmSlug);
    const key = guildRankMapKey(config.region, realmSlug, name);
    if (!key) continue;
    const rankInfo = guildStatusFromRank(entry?.rank);
    map.set(key, {
      ...rankInfo,
      key,
      region: config.region,
      characterName: name,
      normalizedName: normalizeBattleNetNameSlug(name),
      realmSlug,
    });
  }
  battleNetGuildRankMapCache.set(cacheKey, { checkedAt: Date.now(), ranks: new Map(map) });
  return map;
}

function isMistblossomGuild(characterProfile: any) {
  const configuredGuildName = process.env.WOW_GUILD_NAME || process.env.BATTLENET_ALLOWED_GUILD_NAME || DEFAULT_GUILD_NAME;
  const configuredRealm = cleanText(process.env.WOW_GUILD_REALM || process.env.BATTLENET_ALLOWED_GUILD_REALM || "", 120).toLowerCase();
  const guild = characterProfile?.guild || null;
  const guildName = normalizeGuildName(guild?.name || guild?.guild?.name);
  const targetName = normalizeGuildName(configuredGuildName);
  if (!guildName || guildName !== targetName) return false;

  if (!configuredRealm) return true;
  const guildRealmSlug = normalizeBattleNetRealmSlug(guild?.realm?.slug || guild?.realm?.name || "");
  const targetRealm = normalizeBattleNetRealmSlug(configuredRealm);
  return guildRealmSlug === targetRealm;
}

function mediaAssetUrl(media: any, preferredKeys: string[]) {
  const assets = Array.isArray(media?.assets) ? media.assets : [];
  for (const key of preferredKeys) {
    const asset = assets.find((item: any) => String(item?.key || "").toLowerCase() === key.toLowerCase());
    if (asset?.value) return cleanText(asset.value, 500);
  }
  const fallback = assets.find((item: any) => item?.value);
  return fallback?.value ? cleanText(fallback.value, 500) : null;
}

function characterProfileUrl(region: string, realmSlug: string, name: string) {
  return `https://worldofwarcraft.blizzard.com/${region}/character/${region}/${encodeURIComponent(realmSlug)}/${encodeURIComponent(normalizeBattleNetNameSlug(name))}`;
}

function flattenUserCharacters(profile: any) {
  const accounts = Array.isArray(profile?.wow_accounts) ? profile.wow_accounts : [];
  const characters: any[] = [];
  for (const account of accounts) {
    const accountCharacters = Array.isArray(account?.characters) ? account.characters : [];
    for (const character of accountCharacters) characters.push(character);
  }
  return characters;
}

// Do not cap Battle.net account characters by count. Some users legitimately have
// dozens or hundreds of characters across WoW accounts, and a hard scan cap silently
// hides valid characters from the profile UI. Stability is controlled by request
// concurrency, timeout and retry settings instead.

function numberOrNull(value: unknown) {
  const number = Number(value);
  return Number.isFinite(number) ? Number(number) : null;
}

function normalizeAccountCharacter(character: any, region: BattleNetRegion) {
  const name = cleanText(character?.name, 80);
  const normalizedName = normalizeBattleNetNameSlug(name);
  const realmSlug = normalizeBattleNetRealmSlug(character?.realm?.slug || character?.realm?.name || character?.realm?.id || "");
  const key = buildBattleNetCharacterKey(region, realmSlug, normalizedName);
  if (!name || !normalizedName || !realmSlug || !key) return null;
  return { ...character, name, normalizedName, realmSlug, key };
}

function dedupeUserCharacters(profile: any, region: BattleNetRegion) {
  const byKey = new Map<string, any>();
  for (const character of flattenUserCharacters(profile)) {
    const normalized = normalizeAccountCharacter(character, region);
    if (!normalized || byKey.has(normalized.key)) continue;
    byKey.set(normalized.key, normalized);
  }
  return Array.from(byKey.values());
}

function candidateFromAccountSummary(
  character: any,
  region: BattleNetRegion,
  guildRankMap: Map<string, BattleNetGuildRankInfo>,
  lastSeenAt: string,
): BattleNetCharacterCandidate | null {
  const normalized = normalizeAccountCharacter(character, region);
  if (!normalized) return null;

  const activeSpecName = pickLocalizedName(character?.active_spec || character?.active_specialization);
  const activeSpecId = pickActiveSpecId(character?.active_spec || character?.active_specialization);
  const className = pickLocalizedName(character?.character_class || character?.playable_class);
  const rankInfo = guildRankMap.get(normalized.key) || guildStatusFromRank(null);
  const guild = character?.guild || null;
  const summaryGuildName = cleanText(guild?.name || guild?.guild?.name || "", 120) || null;
  const summaryGuildRealmSlug = normalizeBattleNetRealmSlug(guild?.realm?.slug || guild?.realm?.name || "") || null;
  const verifiedGuild = Boolean(rankInfo.status) || isMistblossomGuild(character);

  return {
    key: normalized.key,
    source: "battlenet" as const,
    region,
    name: normalized.name,
    normalizedName: normalized.normalizedName,
    realmSlug: normalized.realmSlug,
    realmName: cleanText(character?.realm?.name || character?.realm?.slug || normalized.realmSlug, 120),
    level: numberOrNull(character?.level),
    faction: pickLocalizedName(character?.faction),
    className,
    activeSpecName,
    activeSpecId,
    activeSpecRole: resolveWowCharacterRole({ activeSpecName, activeSpecId, className }),
    raceName: pickLocalizedName(character?.race || character?.playable_race),
    genderName: pickLocalizedName(character?.gender),
    guildName: verifiedGuild ? (summaryGuildName || DEFAULT_GUILD_NAME) : summaryGuildName,
    guildRealmSlug: verifiedGuild ? (summaryGuildRealmSlug || normalized.realmSlug) : summaryGuildRealmSlug,
    guildRank: rankInfo.rank,
    guildStatus: rankInfo.status,
    guildStatusLabel: rankInfo.label,
    profileUrl: characterProfileUrl(region, normalized.realmSlug, normalized.normalizedName),
    avatarUrl: null,
    renderUrl: null,
    mediaUrl: null,
    verifiedGuild,
    itemLevel: null,
    lastSeenAt,
  } satisfies BattleNetCharacterCandidate;
}

function compareBattleNetCandidates(a: BattleNetCharacterCandidate, b: BattleNetCharacterCandidate) {
  if (a.verifiedGuild !== b.verifiedGuild) return a.verifiedGuild ? -1 : 1;
  const levelDelta = (b.level || 0) - (a.level || 0);
  if (levelDelta) return levelDelta;
  const realmDelta = a.realmName.localeCompare(b.realmName, "uk");
  if (realmDelta) return realmDelta;
  return a.name.localeCompare(b.name, "uk");
}

export async function fetchBattleNetGuildCharacters(accessToken: string, regionInput?: string | null) {
  const startedAt = Date.now();
  const region = normalizeBattleNetRegion(regionInput || getDefaultBattleNetRegion());
  const profile = await bnetFetch(accessToken, "/profile/user/wow", undefined, region);
  const allCharacters = dedupeUserCharacters(profile, region);

  const charactersToScan = allCharacters;
  const concurrency = getBattleNetScanConcurrency(charactersToScan.length);
  const guildRankMap = await fetchBattleNetGuildRankMap(region).catch(() => new Map<string, BattleNetGuildRankInfo>());
  const onlyGuildCharacters = envFlag("BATTLENET_ONLY_GUILD_CHARACTERS", false);
  let fallbackCharacters = 0;

  const { results: candidates, meta } = await mapConcurrent(charactersToScan, async (character) => {
    const fallback = candidateFromAccountSummary(character, region, guildRankMap, new Date().toISOString());
    if (!fallback) return null;

    const nameSlug = normalizeBattleNetNameSlug(character.name);
    const realmSlug = character.realmSlug;

    try {
      const details = await bnetFetch(accessToken, `/profile/wow/character/${encodeURIComponent(realmSlug)}/${encodeURIComponent(nameSlug)}`, undefined, region);
      const media = await bnetFetch(accessToken, `/profile/wow/character/${encodeURIComponent(realmSlug)}/${encodeURIComponent(nameSlug)}/character-media`, undefined, region).catch(() => null);

      const normalizedName = normalizeBattleNetNameSlug(details?.name || character.name);
      const cleanRealmSlug = normalizeBattleNetRealmSlug(details?.realm?.slug || realmSlug);
      const characterKey = buildBattleNetCharacterKey(region, cleanRealmSlug, normalizedName);
      if (!characterKey) return onlyGuildCharacters && !fallback.verifiedGuild ? null : fallback;

      const rankInfoFromRoster = guildRankMap.get(characterKey) || null;
      const verifiedGuild = isMistblossomGuild(details) || Boolean(rankInfoFromRoster);
      if (!verifiedGuild && onlyGuildCharacters) return null;

      const avatarUrl = mediaAssetUrl(media, ["avatar", "inset"]);
      const renderUrl = mediaAssetUrl(media, ["main-raw", "main"]);
      const guildName = cleanText(details?.guild?.name || "", 120) || (verifiedGuild ? DEFAULT_GUILD_NAME : null);
      const guildRealmSlug = cleanText(details?.guild?.realm?.slug || details?.guild?.realm?.name || "", 120).toLowerCase() || (verifiedGuild ? cleanRealmSlug : null);
      const activeSpecName = pickLocalizedName(details?.active_spec || details?.active_specialization || character?.active_spec);
      const activeSpecId = pickActiveSpecId(details?.active_spec || details?.active_specialization || character?.active_spec);
      const className = pickLocalizedName(details?.character_class || details?.playable_class || character?.playable_class);
      const guildRankInfo = verifiedGuild ? rankInfoFromRoster || guildStatusFromRank(null) : guildStatusFromRank(null);

      return {
        key: characterKey,
        source: "battlenet" as const,
        region,
        name: cleanText(details?.name || character.name, 80),
        normalizedName,
        realmSlug: cleanRealmSlug,
        realmName: cleanText(details?.realm?.name || character?.realm?.name || realmSlug, 120),
        level: numberOrNull(details?.level ?? character?.level),
        faction: pickLocalizedName(details?.faction || character?.faction),
        className,
        activeSpecName,
        activeSpecId,
        activeSpecRole: resolveWowCharacterRole({ activeSpecName, activeSpecId, className }),
        raceName: pickLocalizedName(details?.race || details?.playable_race || character?.playable_race),
        genderName: pickLocalizedName(details?.gender || character?.gender),
        guildName,
        guildRealmSlug,
        guildRank: guildRankInfo.rank,
        guildStatus: guildRankInfo.status,
        guildStatusLabel: guildRankInfo.label,
        profileUrl: characterProfileUrl(region, cleanRealmSlug, normalizedName),
        avatarUrl,
        renderUrl,
        mediaUrl: media?._links?.self?.href || null,
        verifiedGuild,
        itemLevel: numberOrNull(details?.equipped_item_level ?? details?.average_item_level),
        lastSeenAt: new Date().toISOString(),
      } satisfies BattleNetCharacterCandidate;
    } catch {
      fallbackCharacters += 1;
      if (!fallback.verifiedGuild && onlyGuildCharacters) return null;
      return fallback;
    }
  }, {
    profile: "external-api",
    concurrency,
    failFast: false,
  });

  const filtered = candidates.filter(Boolean) as BattleNetCharacterCandidate[];
  const guildCharacters = filtered.filter((character) => character.verifiedGuild).length;
  return {
    region,
    totalCharacters: allCharacters.length,
    scannedCharacters: charactersToScan.length,
    eligibleCharacters: filtered.length,
    guildCharacters,
    otherCharacters: Math.max(0, filtered.length - guildCharacters),
    concurrency: meta.concurrency,
    failedCharacters: meta.failed,
    fallbackCharacters,
    durationMs: Date.now() - startedAt,
    characters: filtered.sort(compareBattleNetCandidates),
  };
}

export async function fetchBattleNetCharacterSnapshot(
  input: Pick<
    BattleNetCharacterCandidate,
    "region" | "name" | "normalizedName" | "realmSlug"
  > & {
    guildRankInfo?: BattleNetGuildRankInfo | null;
    skipGuildRankMap?: boolean;
  },
): Promise<BattleNetCharacterCandidate | null> {
  const region = normalizeBattleNetRegion(input.region || getDefaultBattleNetRegion());
  const realmSlug = normalizeBattleNetRealmSlug(input.realmSlug);
  const nameSlug = normalizeBattleNetNameSlug(input.normalizedName || input.name);
  if (!realmSlug || !nameSlug) return null;

  const accessToken = await fetchBattleNetApplicationToken(region);
  let details: any = null;
  try {
    details = await bnetFetch(
      accessToken,
      `/profile/wow/character/${encodeURIComponent(realmSlug)}/${encodeURIComponent(nameSlug)}`,
      undefined,
      region,
    );
  } catch (error) {
    // Battle.net/WoW does not expose a dedicated "banned" state for a
    // character profile. A 404/403 can mean an inactive, renamed, transferred,
    // private, low-level or not-yet-indexed character, while the character may
    // still exist in the guild roster endpoint. Treat it as a soft
    // profile-unavailable state instead of a hard sync failure.
    if (isBattleNetCharacterProfileUnavailableError(error)) return null;
    throw error;
  }

  const [media, guildRankMap] = await Promise.all([
    bnetFetch(accessToken, `/profile/wow/character/${encodeURIComponent(realmSlug)}/${encodeURIComponent(nameSlug)}/character-media`, undefined, region).catch(() => null),
    input.guildRankInfo || input.skipGuildRankMap
      ? Promise.resolve(new Map<string, BattleNetGuildRankInfo>())
      : fetchBattleNetGuildRankMap(region).catch(() => new Map<string, BattleNetGuildRankInfo>()),
  ]);

  const verifiedGuild = Boolean(input.guildRankInfo?.status) || isMistblossomGuild(details);
  if (!verifiedGuild && envFlag("BATTLENET_ONLY_GUILD_CHARACTERS", false)) {
    return null;
  }

  const avatarUrl = mediaAssetUrl(media, ["avatar", "inset"]);
  const renderUrl = mediaAssetUrl(media, ["main-raw", "main"]);
  const guildName = cleanText(details?.guild?.name || "", 120) || null;
  const guildRealmSlug = cleanText(details?.guild?.realm?.slug || details?.guild?.realm?.name || "", 120).toLowerCase() || null;
  const normalizedName = normalizeBattleNetNameSlug(details?.name || input.name);
  const cleanRealmSlug = normalizeBattleNetRealmSlug(details?.realm?.slug || realmSlug);
  const activeSpecName = pickLocalizedName(details?.active_spec || details?.active_specialization);
  const activeSpecId = pickActiveSpecId(details?.active_spec || details?.active_specialization);
  const className = pickLocalizedName(details?.character_class || details?.playable_class);
  const characterKey = buildBattleNetCharacterKey(region, cleanRealmSlug, normalizedName);
  if (!characterKey) return null;
  const guildRankInfo = verifiedGuild
    ? input.guildRankInfo || guildRankMap.get(characterKey) || guildStatusFromRank(null)
    : guildStatusFromRank(null);

  return {
    key: characterKey,
    source: "battlenet" as const,
    region,
    name: cleanText(details?.name || input.name, 80),
    normalizedName,
    realmSlug: cleanRealmSlug,
    realmName: cleanText(details?.realm?.name || realmSlug, 120),
    level: Number.isFinite(Number(details?.level)) ? Number(details.level) : null,
    faction: pickLocalizedName(details?.faction),
    className,
    activeSpecName,
    activeSpecId,
    activeSpecRole: resolveWowCharacterRole({ activeSpecName, activeSpecId, className }),
    raceName: pickLocalizedName(details?.race || details?.playable_race),
    genderName: pickLocalizedName(details?.gender),
    guildName,
    guildRealmSlug,
    guildRank: guildRankInfo.rank,
    guildStatus: guildRankInfo.status,
    guildStatusLabel: guildRankInfo.label,
    profileUrl: characterProfileUrl(region, cleanRealmSlug, normalizedName),
    avatarUrl,
    renderUrl,
    mediaUrl: media?._links?.self?.href || null,
    verifiedGuild,
    itemLevel: Number.isFinite(Number(details?.equipped_item_level || details?.average_item_level)) ? Number(details?.equipped_item_level || details?.average_item_level) : null,
    lastSeenAt: new Date().toISOString(),
  };
}

