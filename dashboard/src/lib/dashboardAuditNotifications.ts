import "server-only";

import { FieldValue } from "firebase-admin/firestore";
import { getFirebaseAdminDb, hasFirebaseProfileConfig } from "@/lib/firebaseAdmin";
import { logDashboardEvent } from "@/lib/security";
import { resilientRead } from "@/lib/runtimeResilience";
import { firebaseWrite } from "@/lib/firebaseAccess";
import { discordApi } from "@/lib/discordAdmin";
import type { DashboardSession } from "@/lib/auth";
import { timestampToIso } from "@/lib/values";

const SETTINGS_COLLECTION = "dashboardSettings";
const ADMIN_AUDIT_LOG_POLICY_DOC_ID = "adminAuditLogPolicy";

const POLICY_CACHE_TTL_MS = Math.max(60_000, Math.min(30 * 60_000, Number(process.env.ADMIN_AUDIT_POLICY_CACHE_TTL_MS || 10 * 60_000)));
declare global {
  // eslint-disable-next-line no-var
  var __mistblossomAdminAuditDiscordPolicyCache: { policy: AdminAuditDiscordPolicy; cachedAt: number } | undefined;
  // eslint-disable-next-line no-var
  var __mistblossomAdminAuditDiscordPolicyErrorLoggedAt: number | undefined;
  // eslint-disable-next-line no-var
  var __mistblossomAdminAuditDiscordMessagesCache: { items: AdminAuditNotificationInput[]; cachedAt: number; channelId: string } | undefined;
}

function auditPolicyCacheFresh() {
  const cached = globalThis.__mistblossomAdminAuditDiscordPolicyCache;
  return Boolean(cached && Date.now() - cached.cachedAt < POLICY_CACHE_TTL_MS);
}

function setAuditPolicyCache(policy: AdminAuditDiscordPolicy) {
  globalThis.__mistblossomAdminAuditDiscordPolicyCache = { policy, cachedAt: Date.now() };
  return policy;
}

export type AdminAuditStatus = "success" | "warning" | "error" | "info";
export type AdminAuditDiscordMinStatus = "info" | "warning" | "error";

export type AdminAuditDiscordPolicy = {
  enabled: boolean;
  channelId: string;
  minStatus: AdminAuditDiscordMinStatus;
  includeSystemLogs: boolean;
  updatedAt?: string | null;
  updatedBy?: string | null;
  source: "firestore" | "defaults";
};

export type AdminAuditNotificationInput = {
  id: string;
  action: string;
  actorId: string;
  actorName: string | null;
  actorGroupId: string | null;
  isServerOwner: boolean;
  status: AdminAuditStatus;
  summary: string | null;
  details: Record<string, unknown>;
  createdAt: string | null;
};

type DiscordAuditEmbed = {
  title?: string;
  description?: string;
  timestamp?: string;
  footer?: { text?: string };
  fields?: Array<{ name?: string; value?: string; inline?: boolean }>;
};

type DiscordAuditMessage = {
  id?: string;
  channel_id?: string;
  timestamp?: string;
  embeds?: DiscordAuditEmbed[];
};

function unescapeDiscordText(value: unknown) {
  return String(value || "")
    .replace(/\\([`*_~|>])/g, "$1")
    .replace(/^`|`$/g, "")
    .trim();
}

function parseDescriptionLine(description: string, label: string) {
  const escaped = label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = description.match(new RegExp(`\\*\\*${escaped}:\\*\\*\\s*([^\\n]+)`, "i"));
  return unescapeDiscordText(match?.[1] || "");
}

function statusFromDiscordLabel(value: unknown): AdminAuditStatus {
  const text = String(value || "").trim().toLowerCase();
  if (text.includes("помил") || text === "error") return "error";
  if (text.includes("поперед") || text === "warning") return "warning";
  if (text.includes("усп") || text === "success") return "success";
  return "info";
}

function parseFieldValue(value: unknown) {
  const cleaned = unescapeDiscordText(value);
  if (!cleaned) return "";
  const numeric = Number(cleaned);
  if (Number.isFinite(numeric) && cleaned.length <= 18) return numeric;
  if (cleaned === "true") return true;
  if (cleaned === "false") return false;
  return cleaned;
}

function parseAuditEmbed(message: DiscordAuditMessage, embed: DiscordAuditEmbed): AdminAuditNotificationInput | null {
  const description = String(embed.description || "");
  const footer = String(embed.footer?.text || "");
  if (!description.includes("**Дія:**") && !footer.includes("/dashboard/logs")) return null;

  const action = parseDescriptionLine(description, "Дія") || "admin.action";
  const actor = parseDescriptionLine(description, "Автор") || "Discord log";
  const summary = parseDescriptionLine(description, "Підсумок") || "Дію виконано.";
  const details: Record<string, unknown> = {
    auditStorage: "discord",
    discordMessageId: message.id || null,
    discordChannelId: message.channel_id || null,
  };

  for (const field of embed.fields || []) {
    const key = String(field.name || "").trim();
    if (!key || /token|secret|password|authorization|cookie|signature/i.test(key)) continue;
    const parsed = parseFieldValue(field.value);
    if (parsed !== "") details[key.slice(0, 80)] = parsed;
  }

  const footerId = footer.split("•").map((part) => part.trim()).find((part) => part && part !== "Mistblossom Vanguard" && part !== "/dashboard/logs");
  return {
    id: footerId || `discord-${message.id || Math.random().toString(36).slice(2, 10)}`,
    action: action.slice(0, 120),
    actorId: actor.slice(0, 80),
    actorName: actor.slice(0, 100),
    actorGroupId: null,
    isServerOwner: actor.toLowerCase().includes("власник"),
    status: statusFromDiscordLabel(parseDescriptionLine(description, "Статус")),
    summary: summary.slice(0, 260),
    details,
    createdAt: embed.timestamp || message.timestamp || null,
  };
}

function discordAuditCacheFresh(channelId: string, ttlMs: number) {
  const cached = globalThis.__mistblossomAdminAuditDiscordMessagesCache;
  return Boolean(cached && cached.channelId === channelId && Date.now() - cached.cachedAt < ttlMs);
}

export async function listAdminAuditLogsFromDiscord(limitInput: unknown = 50, options: { cacheTtlMs?: number } = {}) {
  const policy = await getAdminAuditDiscordPolicy();
  const limit = Math.max(10, Math.min(250, Math.floor(Number(limitInput) || 50)));
  const cacheTtlMs = Math.max(5_000, Math.min(120_000, Math.floor(Number(options.cacheTtlMs) || 30_000)));
  if (!policy.enabled || !policy.channelId) return [] as AdminAuditNotificationInput[];
  if (discordAuditCacheFresh(policy.channelId, cacheTtlMs)) {
    return (globalThis.__mistblossomAdminAuditDiscordMessagesCache?.items || []).slice(0, limit);
  }

  const token = process.env.DISCORD_BOT_TOKEN;
  if (!token) return [] as AdminAuditNotificationInput[];

  const items: AdminAuditNotificationInput[] = [];
  let before: string | null = null;
  for (let page = 0; page < 3 && items.length < limit; page += 1) {
    const pageLimit = Math.min(100, Math.max(10, limit - items.length));
    const params = new URLSearchParams();
    params.set("limit", String(pageLimit));
    if (before) params.set("before", before);

    let messages: DiscordAuditMessage[] = [];
    try {
      const path = `/channels/${policy.channelId}/messages?${params.toString()}`;
      const payload = await discordApi<DiscordAuditMessage[]>(path, { method: "GET" });
      messages = Array.isArray(payload) ? payload : [];
    } catch (error) {
      logDashboardEvent("warn", "admin.audit.discord_read_failed", undefined, {
        message: error instanceof Error ? error.message.slice(0, 240) : String(error || "Discord API error").slice(0, 240),
      });
      break;
    }
    if (!Array.isArray(messages) || messages.length === 0) break;
    before = String(messages[messages.length - 1]?.id || "") || null;

    for (const message of messages) {
      for (const embed of message.embeds || []) {
        const parsed = parseAuditEmbed(message, embed);
        if (parsed) items.push(parsed);
        if (items.length >= limit) break;
      }
      if (items.length >= limit) break;
    }
  }

  globalThis.__mistblossomAdminAuditDiscordMessagesCache = {
    items,
    cachedAt: Date.now(),
    channelId: policy.channelId,
  };
  return items.slice(0, limit);
}

function cleanChannelId(value: unknown) {
  const text = String(value || "").trim();
  return /^\d{16,25}$/.test(text) ? text : "";
}

function cleanMinStatus(value: unknown): AdminAuditDiscordMinStatus {
  const status = String(value || "").trim().toLowerCase();
  return status === "error" || status === "warning" || status === "info" ? status : "warning";
}
function defaultPolicy(): AdminAuditDiscordPolicy {
  return {
    enabled: false,
    channelId: "",
    minStatus: "warning",
    includeSystemLogs: true,
    updatedAt: null,
    updatedBy: null,
    source: "defaults",
  };
}

function normalizePolicy(raw: Record<string, unknown> | null | undefined): AdminAuditDiscordPolicy {
  const fallback = defaultPolicy();
  if (!raw) return fallback;
  const channelId = cleanChannelId(raw.channelId);
  return {
    enabled: Boolean(raw.enabled) && Boolean(channelId),
    channelId,
    minStatus: cleanMinStatus(raw.minStatus || fallback.minStatus),
    includeSystemLogs: raw.includeSystemLogs === undefined ? fallback.includeSystemLogs : Boolean(raw.includeSystemLogs),
    updatedAt: timestampToIso(raw.updatedAt),
    updatedBy: typeof raw.updatedBy === "string" ? raw.updatedBy : null,
    source: "firestore",
  };
}

export async function getAdminAuditDiscordPolicy(options: { bypassCache?: boolean } = {}): Promise<AdminAuditDiscordPolicy> {
  if (!options.bypassCache && auditPolicyCacheFresh()) {
    return globalThis.__mistblossomAdminAuditDiscordPolicyCache!.policy;
  }
  if (!hasFirebaseProfileConfig()) return setAuditPolicyCache(defaultPolicy());

  const policy = await resilientRead(
    "getAdminAuditDiscordPolicy",
    async () => {
      const snapshot = await getFirebaseAdminDb()
        .collection(SETTINGS_COLLECTION)
        .doc(ADMIN_AUDIT_LOG_POLICY_DOC_ID)
        .get();
      return snapshot.exists
        ? normalizePolicy(snapshot.data() || null)
        : globalThis.__mistblossomAdminAuditDiscordPolicyCache?.policy || defaultPolicy();
    },
    {
      ttlMs: POLICY_CACHE_TTL_MS,
      timeoutMs: 2_000,
      circuitKey: "firebase-audit-policy-read",
      circuitTtlMs: 90_000,
      bypassCache: Boolean(options.bypassCache),
      fallback: () => globalThis.__mistblossomAdminAuditDiscordPolicyCache?.policy || defaultPolicy(),
      logEvent: "admin.audit.discord_policy_read_failed",
    },
  );
  return setAuditPolicyCache(policy);
}

export async function setAdminAuditDiscordPolicy(input: {
  enabled?: unknown;
  channelId?: unknown;
  minStatus?: unknown;
  includeSystemLogs?: unknown;
}, actor?: DashboardSession | null) {
  if (!hasFirebaseProfileConfig()) throw new Error("Firebase не налаштований для збереження параметрів журналу.");
  const channelId = cleanChannelId(input.channelId);
  const enabled = input.enabled === "1" || input.enabled === "on" || input.enabled === "true" || input.enabled === true;
  if (enabled && !channelId) throw new Error("Вкажи коректний Discord channel ID для дублювання журналу.");
  const minStatus = cleanMinStatus(input.minStatus);
  const includeSystemLogs = input.includeSystemLogs === "1" || input.includeSystemLogs === "on" || input.includeSystemLogs === "true" || input.includeSystemLogs === true;

  await firebaseWrite(
    "settings",
    "admin-audit-policy:save",
    () => getFirebaseAdminDb().collection(SETTINGS_COLLECTION).doc(ADMIN_AUDIT_LOG_POLICY_DOC_ID).set({
      enabled,
      channelId,
      minStatus,
      includeSystemLogs,
      updatedAt: FieldValue.serverTimestamp(),
      updatedBy: actor?.name || actor?.login || actor?.id || null,
    }, { merge: true }),
    { timeoutMs: 3_000, logEvent: "admin.audit.policy_write_failed" },
  );

  return setAuditPolicyCache({
    enabled: enabled && Boolean(channelId),
    channelId,
    minStatus,
    includeSystemLogs,
    updatedAt: new Date().toISOString(),
    updatedBy: actor?.name || actor?.login || actor?.id || null,
    source: "firestore",
  });
}

function shouldPublishStatus(status: AdminAuditStatus, minStatus: AdminAuditDiscordMinStatus) {
  if (minStatus === "info") return true;
  if (minStatus === "warning") return status === "warning" || status === "error";
  return status === "error";
}

function statusLabel(status: AdminAuditStatus) {
  if (status === "success") return "Успішно";
  if (status === "warning") return "Попередження";
  if (status === "error") return "Помилка";
  return "Інфо";
}

function statusColor(status: AdminAuditStatus) {
  if (status === "success") return 0x5fd380;
  if (status === "warning") return 0xffbe58;
  if (status === "error") return 0xed4245;
  return 0x669fff;
}

function actionTitle(action: string) {
  const map: Record<string, string> = {
    "applications.status.update": "Заявка: зміна статусу",
    "applications.status.update_failed": "Заявка: помилка зміни статусу",
    "applications.bulk_status.update": "Заявки: масова зміна статусів",
    "applications.bulk_status.update_failed": "Заявки: помилка масової зміни",
    "content.create": "Контент: створено матеріал",
    "content.create_failed": "Контент: помилка створення",
    "content.update": "Контент: оновлено матеріал",
    "content.update_failed": "Контент: помилка оновлення",
    "content.delete": "Контент: видалено матеріал",
    "content.delete_failed": "Контент: помилка видалення",
    "raids.save": "Рейд: збережено",
    "raids.save_failed": "Рейд: помилка збереження",
    "raids.discord.publish": "Рейд: Discord-публікація",
    "raids.discord.publish_failed": "Рейд: помилка Discord-публікації",
    "raids.close": "Рейд: закрито",
    "raids.close_failed": "Рейд: помилка закриття",
    "raids.delete": "Рейд: видалено",
    "raids.delete_failed": "Рейд: помилка видалення",
    "raids.bench_priority.save": "Рейди: сірий список збережено",
    "raids.bench_priority.save_failed": "Рейди: помилка сірого списку",
    "access_group.upsert": "Права: групу збережено",
    "access_group.delete": "Права: групу видалено",
    "access_group.impersonate": "Права: перегляд як група",
    "access_group.impersonate.end": "Права: перегляд завершено",
    "discord.member.roles.manual_add_blocked": "Discord: ручну видачу ролі заблоковано",
    "discord.member.roles.manual_remove_blocked": "Discord: ручне зняття ролі заблоковано",
    "admin.logs.discord_settings.update": "Журнал: Discord-дублювання оновлено",
    "admin.logs.discord_settings.update_failed": "Журнал: помилка Discord-дублювання",
    "admin.background_api.settings.update": "API: фонові налаштування оновлено",
    "admin.background_api.settings.update_failed": "API: помилка фонових налаштувань",
  };
  return map[action] || action.replace(/[._-]+/g, " ").trim();
}

function markdownEscape(value: unknown) {
  return String(value ?? "")
    .replace(/\\/g, "\\\\")
    .replace(/`/g, "ʼ")
    .replace(/\*/g, "﹡")
    .replace(/_/g, "﹍")
    .replace(/~/g, "∼")
    .replace(/\|/g, "¦")
    .replace(/>/g, "›")
    .replace(/@/g, "＠")
    .trim();
}

function redactAuditValue(value: unknown, depth = 0): unknown {
  if (value === null || value === undefined) return value;
  if (depth > 3) return "[max-depth]";
  if (typeof value === "string") {
    return value
      .replace(/ghp_[A-Za-z0-9_]+/g, "[redacted]")
      .replace(/github_pat_[A-Za-z0-9_]+/g, "[redacted]")
      .replace(/Bot\s+[A-Za-z0-9._-]+/g, "Bot [redacted]")
      .replace(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g, "[email]")
      .slice(0, 320);
  }
  if (typeof value === "number" || typeof value === "boolean") return value;
  if (Array.isArray(value)) return value.slice(0, 8).map((item) => redactAuditValue(item, depth + 1));
  if (typeof value === "object") {
    return Object.fromEntries(Object.entries(value as Record<string, unknown>).slice(0, 12).map(([key, item]) => {
      if (/token|secret|password|authorization|cookie|signature|private/i.test(key)) return [key, "[redacted]"];
      return [key, redactAuditValue(item, depth + 1)];
    }));
  }
  return String(value).slice(0, 180);
}

function compactValue(value: unknown) {
  const redacted = redactAuditValue(value);
  if (Array.isArray(redacted)) return redacted.map((item) => typeof item === "object" ? JSON.stringify(item) : String(item)).join(", ");
  if (redacted && typeof redacted === "object") return JSON.stringify(redacted);
  return String(redacted ?? "");
}

function detailFields(details: Record<string, unknown>) {
  const preferred = [
    "checked", "checkedProfiles", "checkedDiscordProfiles", "checkedDiscordMembers", "targets", "targetProfilesTotal",
    "changed", "deletedProfilesTotal", "removedRoles", "addedRoles", "failed", "errorsTotal", "raidId", "issueNumber",
    "issueNumbers", "status", "enabled", "characterKeys", "manualNames", "path", "kind", "channelId", "messageId", "durationMs", "concurrency",
  ];
  const used = new Set<string>();
  const fields: Array<{ name: string; value: string; inline?: boolean }> = [];
  for (const key of preferred) {
    if (!(key in details)) continue;
    const rawValue = details[key];
    if (rawValue === null || rawValue === undefined || rawValue === "") continue;
    const value = compactValue(rawValue).slice(0, 900);
    if (!value) continue;
    fields.push({ name: key, value: `\`${markdownEscape(value).slice(0, 900)}\``, inline: true });
    used.add(key);
    if (fields.length >= 8) return fields;
  }

  const previewKeys = Object.keys(details).filter((key) => !used.has(key) && !/token|secret|password|authorization|cookie|signature|auditId|auditKey/i.test(key));
  for (const key of previewKeys.slice(0, 4)) {
    const rawValue = details[key];
    if (rawValue === null || rawValue === undefined || rawValue === "") continue;
    const value = compactValue(rawValue).slice(0, 900);
    if (!value) continue;
    fields.push({ name: key, value: `\`${markdownEscape(value).slice(0, 900)}\``, inline: true });
    if (fields.length >= 8) break;
  }
  return fields;
}

function dashboardLogUrl() {
  const base = process.env.DASHBOARD_URL || process.env.NEXT_PUBLIC_DASHBOARD_URL || process.env.ADMIN_DASHBOARD_URL || process.env.NEXT_PUBLIC_ADMIN_DASHBOARD_URL || process.env.NEXTAUTH_URL || "";
  if (!base) return "";
  try {
    return new URL("/dashboard/logs", base).toString();
  } catch {
    return "";
  }
}

function auditDuplicateIdentity(item: AdminAuditNotificationInput) {
  const details = item.details || {};
  return JSON.stringify({
    id: item.id,
    action: item.action,
    status: item.status,
    summary: item.summary,
    pollId: details.pollId || null,
    raidId: details.raidId || null,
    messageId: details.messageId || null,
    channelId: details.channelId || null,
  });
}

function sameAuditNotification(a: AdminAuditNotificationInput, b: AdminAuditNotificationInput) {
  if (a.id && b.id && a.id === b.id) return true;
  const aDetails = a.details || {};
  const bDetails = b.details || {};
  const samePrimaryRef = Boolean(
    (aDetails.pollId && aDetails.pollId === bDetails.pollId) ||
    (aDetails.raidId && aDetails.raidId === bDetails.raidId) ||
    (aDetails.messageId && aDetails.messageId === bDetails.messageId)
  );
  return Boolean(
    samePrimaryRef &&
    a.action === b.action &&
    a.status === b.status &&
    String(a.summary || "") === String(b.summary || "")
  );
}

async function recentDiscordAuditAlreadyExists(item: AdminAuditNotificationInput) {
  const recent = await listAdminAuditLogsFromDiscord(40, { cacheTtlMs: 1_000 }).catch(() => []);
  const cutoff = Date.now() - 10 * 60_000;
  const identity = auditDuplicateIdentity(item);
  return recent.some((entry) => {
    const createdAtMs = Date.parse(entry.createdAt || "");
    if (Number.isFinite(createdAtMs) && createdAtMs < cutoff) return false;
    return auditDuplicateIdentity(entry) === identity || sameAuditNotification(item, entry);
  });
}

function auditEmbed(item: AdminAuditNotificationInput) {
  const actor = [item.actorName || item.actorId || "невідомо", item.actorGroupId ? `група ${item.actorGroupId}` : null, item.isServerOwner ? "власник сервера" : null]
    .filter(Boolean)
    .join(" • ");
  const summary = markdownEscape(item.summary || "Дію виконано.").slice(0, 1200);
  const logUrl = dashboardLogUrl();

  return {
    title: `🧾 ${actionTitle(item.action)}`.slice(0, 256),
    description: [
      `**Статус:** ${statusLabel(item.status)}`,
      `**Дія:** \`${markdownEscape(item.action).slice(0, 110)}\``,
      `**Автор:** ${markdownEscape(actor || "невідомо")}`,
      `**Підсумок:** ${summary}`,
      logUrl ? `**Журнал:** ${logUrl}` : "",
    ].filter(Boolean).join("\n"),
    color: statusColor(item.status),
    fields: detailFields(item.details).slice(0, 10),
    footer: { text: `Mistblossom Vanguard • /dashboard/logs • ${item.id.slice(0, 36)}` },
    timestamp: item.createdAt || new Date().toISOString(),
  };
}

export async function publishAdminAuditToDiscord(item: AdminAuditNotificationInput) {
  const policy = await getAdminAuditDiscordPolicy();
  if (!policy.enabled || !policy.channelId) return { skipped: true, reason: "disabled" };
  if (!policy.includeSystemLogs && item.actorId === "system") return { skipped: true, reason: "system_logs_disabled" };
  if (!shouldPublishStatus(item.status, policy.minStatus)) return { skipped: true, reason: "below_min_status" };

  if (!process.env.DISCORD_BOT_TOKEN) return { skipped: true, reason: "DISCORD_BOT_TOKEN is missing" };

  try {
    if (await recentDiscordAuditAlreadyExists(item)) {
      logDashboardEvent("debug", "admin.audit.discord_duplicate_skipped", undefined, {
        action: item.action,
        status: item.status,
        id: item.id,
      });
      return { skipped: true, reason: "duplicate" };
    }

    const payload = await discordApi<{ id?: string }>(`/channels/${policy.channelId}/messages`, {
      method: "POST",
      body: JSON.stringify({
        allowed_mentions: { parse: [] },
        embeds: [auditEmbed(item)],
      }),
    });
    const messageId = payload?.id || null;
    const cached = globalThis.__mistblossomAdminAuditDiscordMessagesCache;
    if (cached?.channelId === policy.channelId) {
      cached.items = [
        {
          ...item,
          details: {
            ...(item.details || {}),
            auditStorage: "discord",
            discordChannelId: policy.channelId,
            discordMessageId: messageId,
          },
          createdAt: item.createdAt || new Date().toISOString(),
        },
        ...cached.items,
      ].slice(0, 250);
      cached.cachedAt = Date.now();
    }
    return { ok: true, channelId: policy.channelId, messageId };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : "Discord API error" };
  }
}

export function summarizeAdminAuditDiscordPolicy(policy: AdminAuditDiscordPolicy) {
  if (!policy.enabled) return "Discord-журнал вимкнено. Firebase-журнал не використовується, тому /dashboard/logs покаже тільки тимчасові локальні записи.";
  const statusText = policy.minStatus === "info" ? "усі записи" : policy.minStatus === "warning" ? "warning/error" : "тільки error";
  const systemText = policy.includeSystemLogs ? "системні записи увімкнені" : "системні записи вимкнені";
  return `Discord-журнал увімкнено: канал ${policy.channelId}, ${statusText}, ${systemText}. Записи зберігаються в Discord і читаються назад із каналу.`;
}

export function statusOptions() {
  return [
    { value: "info", label: "Усі записи: info / success / warning / error" },
    { value: "warning", label: "Тільки важливі: warning / error" },
    { value: "error", label: "Тільки помилки: error" },
  ] as const;
}
