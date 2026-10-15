import "server-only";

import { listPublishedGuildRulesMessages } from "@/lib/guildRulesDocument";
import { getGuildNicknamePolicy, type GuildNicknamePolicy } from "@/lib/guildNicknamePolicy";

const RULE_IDS_CACHE_TTL_MS = 5 * 60_000;
declare global {
  // eslint-disable-next-line no-var
  var __mistblossomConfiguredRulesRoleIdsCache:
    | { roleIds: string[]; cachedAt: number }
    | undefined;
}

function cleanRoleIds(values: unknown) {
  const source = Array.isArray(values) ? values : [];
  return Array.from(
    new Set(
      source
        .map((item) => String(item || "").trim())
        .filter((item) => /^\d{16,25}$/.test(item)),
    ),
  ).slice(0, 10);
}

export async function resolveConfiguredRulesRoleIds(
  policy?: GuildNicknamePolicy | null,
  options: { bypassCache?: boolean } = {},
) {
  const cached = globalThis.__mistblossomConfiguredRulesRoleIdsCache;
  if (
    !options.bypassCache &&
    cached &&
    Date.now() - cached.cachedAt < RULE_IDS_CACHE_TTL_MS &&
    cached.roleIds.length
  ) {
    return [...cached.roleIds];
  }

  const messages = await listPublishedGuildRulesMessages();
  const rulesMessage = messages.find(
    (message) => message.rulesType === "guild" && message.roleIds.length > 0,
  );
  const fromMessage = cleanRoleIds(rulesMessage?.roleIds || []);
  if (fromMessage.length) {
    globalThis.__mistblossomConfiguredRulesRoleIdsCache = {
      roleIds: fromMessage,
      cachedAt: Date.now(),
    };
    return [...fromMessage];
  }

  const currentPolicy = policy || (await getGuildNicknamePolicy());
  const fallback = cleanRoleIds(
    currentPolicy.nicknameNewcomerRoleId ? [currentPolicy.nicknameNewcomerRoleId] : [],
  );
  if (fallback.length) {
    globalThis.__mistblossomConfiguredRulesRoleIdsCache = {
      roleIds: fallback,
      cachedAt: Date.now(),
    };
  }
  return fallback;
}

export async function tokenRulesRolesAreCurrentlyAllowed(roleIds: string[]) {
  const configured = await resolveConfiguredRulesRoleIds(undefined, { bypassCache: true });
  if (!configured.length) return false;
  const allowed = new Set(configured);
  return roleIds.length > 0 && roleIds.every((roleId) => allowed.has(roleId));
}
