import "server-only";

import { createHmac, timingSafeEqual } from "crypto";
import { FieldValue } from "@/lib/db/firestoreCompat";
import { getDashboardUrl } from "@/lib/oauth";
import { getFirebaseAdminDb, hasFirebaseProfileConfig } from "@/lib/firebaseAdmin";
import { firebaseWrite } from "@/lib/firebaseAccess";
import {
  buildProfileDiscordNicknamePlan,
  cleanProfileGrammaticalGender,
  getMainCharacter,
  type DashboardProfile,
} from "@/lib/profiles";
import { resolveWowCharacterRole, wowRoleLabel } from "@/lib/wowRoles";

export type RulesOnboardingStepKey =
  | "profile_name"
  | "profile_gender"
  | "battlenet_characters"
  | "main_character"
  | "raid_role"
  | "discord_nickname";

export type RulesOnboardingStep = {
  key: RulesOnboardingStepKey;
  title: string;
  description: string;
  complete: boolean;
  href?: string;
};

const TOKEN_VERSION = 2;
const TOKEN_AUDIENCE = "mistblossom-rules-onboarding";
const DEFAULT_RULES_TOKEN_SECRET = "mistblossom-rules-onboarding-dev-secret";
const DEFAULT_RULES_TOKEN_TTL_SECONDS = 24 * 60 * 60;

function cleanSecret(value: unknown) {
  const text = String(value || "").trim();
  if (process.env.NODE_ENV === "production" && text === DEFAULT_RULES_TOKEN_SECRET) return "";
  return text.length >= 32 ? text : "";
}

function rulesTokenTtlSeconds() {
  const parsed = Number(process.env.RULES_TOKEN_TTL_SECONDS || DEFAULT_RULES_TOKEN_TTL_SECONDS);
  if (!Number.isFinite(parsed)) return DEFAULT_RULES_TOKEN_TTL_SECONDS;
  return Math.max(15 * 60, Math.min(7 * 24 * 60 * 60, Math.floor(parsed)));
}

function rulesTokenSecretCandidates() {
  const candidates = [
    process.env.DASHBOARD_RULES_TOKEN_SECRET,
    process.env.RULES_TOKEN_SECRET,
    process.env.SESSION_SECRET,
    process.env.NEXTAUTH_SECRET,
    process.env.AUTH_SECRET,
    process.env.DASHBOARD_RULES_TOKEN_SECRET_PREVIOUS,
    process.env.RULES_TOKEN_SECRET_PREVIOUS,
  ];
  // The fixed development key exists only so a local checkout can render the
  // onboarding page before secrets are provisioned. Production must never
  // accept a signature that an attacker can reproduce from source code.
  if (process.env.NODE_ENV !== "production") candidates.push(DEFAULT_RULES_TOKEN_SECRET);
  return Array.from(new Set(candidates.map(cleanSecret).filter(Boolean)));
}

function secret() {
  const value = rulesTokenSecretCandidates()[0];
  if (!value) {
    throw new Error("Rules onboarding token secret is not configured (32+ characters required).");
  }
  return value;
}

function cleanRoleIds(roleIds: unknown) {
  const values = Array.isArray(roleIds) ? roleIds : String(roleIds || "").split(/[,\.\s;]+/g);
  return Array.from(new Set(values.map((item) => String(item || "").trim()).filter((item) => /^\d{16,25}$/.test(item)))).slice(0, 10);
}

function cleanDiscordUserId(value: unknown) {
  const userId = String(value || "").trim();
  return /^\d{16,25}$/.test(userId) ? userId : "";
}

function cleanShortText(value: unknown, maxLength = 80) {
  return String(value || "")
    .replace(/[\u0000-\u001f\u007f]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, maxLength);
}

function cleanOptionalUrl(value: unknown) {
  const text = String(value || "").trim();
  if (!text) return "";
  try {
    const url = new URL(text);
    return url.protocol === "https:" ? url.toString().slice(0, 300) : "";
  } catch {
    return "";
  }
}

function base64UrlJson(value: unknown) {
  return Buffer.from(JSON.stringify(value), "utf8").toString("base64url");
}

function signPayloadWithSecret(payload: string, secretValue: string) {
  return createHmac("sha256", secretValue).update(payload).digest("base64url");
}

function signPayload(payload: string) {
  return signPayloadWithSecret(payload, secret());
}

function verifySignature(payload: string, signature: string) {
  try {
    const left = Buffer.from(signature, "base64url");
    return rulesTokenSecretCandidates().some((secretValue) => {
      const expected = signPayloadWithSecret(payload, secretValue);
      const right = Buffer.from(expected, "base64url");
      return left.length === right.length && timingSafeEqual(left, right);
    });
  } catch {
    return false;
  }
}

export type CreateRulesRoleTokenOptions = {
  discordUserId?: string | null;
  discordUsername?: string | null;
  discordGlobalName?: string | null;
  discordDisplayName?: string | null;
  discordAvatarUrl?: string | null;
  discordGuildId?: string | null;
  memberRoleIds?: string[] | null;
};

export function createRulesRoleToken(
  roleIdsInput: string[],
  options: CreateRulesRoleTokenOptions = {},
) {
  const roleIds = cleanRoleIds(roleIdsInput);
  if (!roleIds.length) throw new Error("Для правил потрібно вибрати роль, яка буде видана після реєстрації.");
  const discordUserId = cleanDiscordUserId(options.discordUserId);
  const discordGuildId = cleanDiscordUserId(options.discordGuildId);
  const memberRoleIds = cleanRoleIds(options.memberRoleIds || []);
  const discordUsername = cleanShortText(options.discordUsername, 80);
  const discordGlobalName = cleanShortText(options.discordGlobalName, 80);
  const discordDisplayName = cleanShortText(options.discordDisplayName, 80);
  const discordAvatarUrl = cleanOptionalUrl(options.discordAvatarUrl);
  const issuedAt = Math.floor(Date.now() / 1000);
  const payload = base64UrlJson({
    v: TOKEN_VERSION,
    aud: TOKEN_AUDIENCE,
    iat: issuedAt,
    exp: issuedAt + rulesTokenTtlSeconds(),
    r: roleIds,
    ...(discordUserId ? { u: discordUserId } : {}),
    ...(discordGuildId ? { g: discordGuildId } : {}),
    ...(discordUsername ? { un: discordUsername } : {}),
    ...(discordGlobalName ? { gn: discordGlobalName } : {}),
    ...(discordDisplayName ? { dn: discordDisplayName } : {}),
    ...(discordAvatarUrl ? { av: discordAvatarUrl } : {}),
    ...(memberRoleIds.length ? { mr: memberRoleIds } : {}),
  });
  return `${payload}.${signPayload(payload)}`;
}

export type ParsedRulesRoleToken = {
  roleIds: string[];
  discordUserId: string | null;
  discordGuildId: string | null;
  discordUser: {
    id: string;
    username: string;
    globalName: string;
    displayName: string;
    avatarUrl: string;
    memberRoleIds: string[];
  } | null;
};

function emptyRulesRoleToken(): ParsedRulesRoleToken {
  return { roleIds: [], discordUserId: null, discordGuildId: null, discordUser: null };
}

export function parseRulesRoleTokenDetails(tokenInput: unknown): ParsedRulesRoleToken {
  const token = String(tokenInput || "").trim();
  const [payload, signature, extra] = token.split(".");
  if (!payload || !signature || extra || !verifySignature(payload, signature)) {
    return emptyRulesRoleToken();
  }
  try {
    const parsed = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
    const version = Number(parsed?.v);
    if (version !== 1 && version !== TOKEN_VERSION) return emptyRulesRoleToken();
    if (version === TOKEN_VERSION && parsed?.aud !== TOKEN_AUDIENCE) return emptyRulesRoleToken();

    const issuedAt = Number(parsed?.iat || 0);
    const expiresAt = Number(parsed?.exp || 0);
    const now = Math.floor(Date.now() / 1000);
    if (!Number.isFinite(issuedAt) || issuedAt <= 0 || issuedAt > now + 60) return emptyRulesRoleToken();
    if (version === TOKEN_VERSION) {
      if (!Number.isFinite(expiresAt) || expiresAt <= now || expiresAt < issuedAt) return emptyRulesRoleToken();
      if (expiresAt - issuedAt > 7 * 24 * 60 * 60 + 60) return emptyRulesRoleToken();
    } else if (now - issuedAt > rulesTokenTtlSeconds()) {
      // Legacy v1 tokens are accepted only during a bounded migration window
      // and only when signed with one of the current strong secrets above.
      return emptyRulesRoleToken();
    }

    const discordUserId = cleanDiscordUserId(parsed?.u);
    const memberRoleIds = cleanRoleIds(parsed?.mr || []);
    const discordUser = discordUserId
      ? {
          id: discordUserId,
          username: cleanShortText(parsed?.un, 80),
          globalName: cleanShortText(parsed?.gn, 80),
          displayName: cleanShortText(parsed?.dn, 80),
          avatarUrl: cleanOptionalUrl(parsed?.av),
          memberRoleIds,
        }
      : null;
    return {
      roleIds: cleanRoleIds(parsed?.r),
      discordUserId: discordUserId || null,
      discordGuildId: cleanDiscordUserId(parsed?.g) || null,
      discordUser,
    };
  } catch {
    return emptyRulesRoleToken();
  }
}

export function parseRulesRoleToken(tokenInput: unknown) {
  return parseRulesRoleTokenDetails(tokenInput).roleIds;
}

export function rulesAcceptPath(roleIds: string[]) {
  return `/rules/accept?rt=${encodeURIComponent(createRulesRoleToken(roleIds))}`;
}

export function rulesAcceptPathForDiscordUser(
  roleIds: string[],
  discordUserId: string,
  options: Omit<CreateRulesRoleTokenOptions, "discordUserId"> = {},
) {
  return `/rules/accept?rt=${encodeURIComponent(createRulesRoleToken(roleIds, { ...options, discordUserId }))}`;
}

export function rulesAcceptUrl(roleIds: string[]) {
  return `${getDashboardUrl()}${rulesAcceptPath(roleIds)}`;
}

export function rulesAcceptUrlForDiscordUser(
  roleIds: string[],
  discordUserId: string,
  options: Omit<CreateRulesRoleTokenOptions, "discordUserId"> = {},
) {
  return `${getDashboardUrl()}${rulesAcceptPathForDiscordUser(roleIds, discordUserId, options)}`;
}

export function rulesLoginPath(roleToken: string) {
  const safeToken = String(roleToken || "").trim();
  const next = safeToken ? `/rules/accept?rt=${encodeURIComponent(safeToken)}` : "/rules/accept";
  return `/api/auth/discord/start?force=1&next=${encodeURIComponent(next)}`;
}

export function rulesLoginUrl(roleIds: string[]) {
  const token = createRulesRoleToken(roleIds);
  return `${getDashboardUrl()}${rulesLoginPath(token)}`;
}

export function parseRulesRoleIdsFromUrl(urlInput: unknown) {
  const raw = String(urlInput || "").trim();
  if (!raw) return [] as string[];

  function roleIdsFromMaybeUrl(value: string) {
    try {
      const url = new URL(value, getDashboardUrl());
      const directToken = url.searchParams.get("rt");
      if (directToken) return parseRulesRoleToken(directToken);
      const next = url.searchParams.get("next");
      if (!next) return [] as string[];
      const nested = new URL(next, getDashboardUrl());
      return parseRulesRoleToken(nested.searchParams.get("rt"));
    } catch {
      return [] as string[];
    }
  }

  return roleIdsFromMaybeUrl(raw);
}

export function isRulesAcceptPath(value: unknown) {
  const path = String(value || "").trim();
  return /^\/rules\/accept(?:[/?#]|$)/.test(path);
}

export function normalizeRulesAcceptPath(value: unknown, status?: "incomplete" | "completed" | "completed_owner_nickname_manual" | "completed_nickname_manual") {
  const path = String(value || "").trim();
  if (!isRulesAcceptPath(path)) return "";

  try {
    const url = new URL(path, getDashboardUrl());
    if (url.pathname !== "/rules/accept") return "";
    if (status) url.searchParams.set("status", status);
    return `${url.pathname}${url.search}${url.hash}`;
  } catch {
    return status ? `/rules/accept?status=${encodeURIComponent(status)}` : "/rules/accept";
  }
}


export function rulesOnboardingStatus(profile: DashboardProfile | null | undefined, nicknameTemplate?: string) {
  const profileHref = profile?.profileId ? `/profile/${profile.profileId}` : "/profile";
  const settingsHref = profile?.profileId ? `/profile/${profile.profileId}/settings?setup=1` : "/profile";
  const main = profile ? getMainCharacter(profile) : null;
  const hasName = Boolean(profile?.preferredName && profile.preferredName.trim().length >= 2);
  const hasGender = Boolean(profile && cleanProfileGrammaticalGender(profile.grammaticalGender) !== "unspecified");
  const hasCharacters = Boolean(profile?.characters?.length);
  const hasMain = Boolean(main?.key && profile?.mainCharacterKey);
  const manualRaidRole = profile?.raidRolePreference?.characterKey === main?.key ? profile?.raidRolePreference?.role : null;
  const autoRaidRole = main ? resolveWowCharacterRole({
    className: main.className,
    activeSpecName: main.activeSpecName,
    activeSpecId: main.activeSpecId,
    activeSpecRole: main.activeSpecRole,
  }) : null;
  // Auto is a valid choice: once the main exists, the default raid role can be
  // derived from the main character spec. A manual override is optional.
  const hasRaidRole = Boolean(hasMain && (manualRaidRole || autoRaidRole));
  const nicknamePlan = buildProfileDiscordNicknamePlan(profile, nicknameTemplate);
  const hasNicknameTemplate = Boolean(nicknamePlan.value && nicknamePlan.hasRequiredName && hasMain);

  const steps: RulesOnboardingStep[] = [
    {
      key: "profile_name",
      title: "Імʼя",
      description: hasName ? `Вказано: ${profile?.preferredName}` : "Вкажи імʼя, яке буде основою серверного ніку.",
      complete: hasName,
      href: settingsHref,
    },
    {
      key: "profile_gender",
      title: "Стать / звертання",
      description: hasGender ? "Звертання вибрано." : "Вибери, як система має формувати персональні повідомлення.",
      complete: hasGender,
      href: settingsHref,
    },
    {
      key: "battlenet_characters",
      title: "Персонажі Battle.net",
      description: hasCharacters ? `Додано персонажів: ${profile?.characters.length}` : "Підключи Battle.net і додай персонажів до профілю.",
      complete: hasCharacters,
      href: profileHref,
    },
    {
      key: "main_character",
      title: "Мейн-персонаж",
      description: hasMain ? `Мейн: ${main?.name}` : "Вибери основного персонажа.",
      complete: hasMain,
      href: profileHref,
    },
    {
      key: "raid_role",
      title: "Роль у рейді для мейна",
      description: hasRaidRole
        ? manualRaidRole
          ? `Вручну: ${wowRoleLabel(manualRaidRole)}.`
          : `Авто зі спеки мейна: ${wowRoleLabel(autoRaidRole)}.`
        : "Вибери мейна або роль у рейді для мейна: авто, танк, хіл або ДД.",
      complete: hasRaidRole,
      href: settingsHref,
    },
    {
      key: "discord_nickname",
      title: "Серверний нік Discord",
      description: hasNicknameTemplate
        ? `Буде встановлено: ${nicknamePlan.value}`
        : "Після завершення система автоматично поставить нік за глобальним шаблоном із налаштувань керування.",
      complete: hasNicknameTemplate,
      href: settingsHref,
    },
  ];

  return {
    complete: steps.every((step) => step.complete),
    steps,
    mainCharacter: main,
    nicknamePlan,
    missing: steps.filter((step) => !step.complete),
  };
}

export async function markRulesOnboardingCompleted(profileId: string, input: { roleIds: string[]; nickname?: string | null }) {
  if (!hasFirebaseProfileConfig()) return;
  const cleanProfileId = String(profileId || "").trim();
  if (!/^id[a-f0-9]{16,40}$/.test(cleanProfileId)) return;
  await firebaseWrite(
    "rules",
    `profile:${cleanProfileId}:rules-onboarding`,
    () => getFirebaseAdminDb().collection("dashboardProfiles").doc(cleanProfileId).set({
      rulesOnboarding: {
        completedAt: FieldValue.serverTimestamp(),
        roleIds: cleanRoleIds(input.roleIds),
        nickname: input.nickname || null,
      },
      updatedAt: FieldValue.serverTimestamp(),
    }, { merge: true }),
    {
      timeoutMs: 3_000,
      logEvent: "rules.onboarding_write_failed",
      fallback: () => undefined,
    },
  );
}
