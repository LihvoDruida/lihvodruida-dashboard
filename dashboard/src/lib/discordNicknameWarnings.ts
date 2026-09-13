import "server-only";

import { mapConcurrentSettled } from "@/lib/concurrency";
import {
  fetchDiscordGuildMemberSnapshot,
  fetchDiscordGuildMembers,
  sendDiscordChannelUserWarning,
  sendDiscordDirectMessage,
  type DiscordGuildMemberModerationItem,
} from "@/lib/discordAdmin";
import { firebaseWrite } from "@/lib/firebaseAccess";
import { getFirebaseAdminDb, hasFirebaseProfileConfig } from "@/lib/firebaseAdmin";
import { getGuildNicknamePolicy, nicknameMatchesTemplate, nicknameTemplateExample } from "@/lib/guildNicknamePolicy";
import { buildProfileDiscordNicknamePlan, getProfileByDiscordUserId } from "@/lib/profiles";
import { resilientRead } from "@/lib/runtimeResilience";
import { dashboardPublicOrigin, timestampToIso } from "@/lib/values";
import { logDashboardEvent, safeErrorMessage } from "@/lib/security";

const STATE_COLLECTION = "dashboardSettings";
const STATE_DOC_ID = "discordNicknameWarningAutomation";
const MEMBER_STATE_COLLECTION = "discordNicknameWarningMembers";
const MAX_RECENT_RUNS = 8;
const STATE_CACHE_TTL_MS = 15_000;

export type NicknameWarningDelivery = "dm" | "channel";
export type NicknameWarningSource = "manual" | "automatic";
export type NicknameWarningRunStatus = "success" | "warning" | "error";

export type NicknameWarningRun = {
  id: string;
  source: NicknameWarningSource;
  status: NicknameWarningRunStatus;
  startedAt: string;
  completedAt: string;
  checked: number;
  invalid: number;
  notified: number;
  dm: number;
  channel: number;
  cooldownSkipped: number;
  deferredByBatch: number;
  correctedBeforeSend: number;
  failed: number;
  summary: string;
};

export type NicknameWarningAutomationState = {
  lastRunAt: string | null;
  lastRunStatus: NicknameWarningRunStatus | null;
  lastChecked: number;
  lastInvalid: number;
  lastNotified: number;
  lastDm: number;
  lastChannel: number;
  lastFailed: number;
  lastError: string | null;
  recentRuns: NicknameWarningRun[];
};

declare global {
  // eslint-disable-next-line no-var
  var __mistblossomNicknameWarningStateCache:
    | { value: NicknameWarningAutomationState; cachedAt: number }
    | undefined;
  // eslint-disable-next-line no-var
  var __mistblossomNicknameWarningExecution: { source: string; startedAt: number } | undefined;
}

function cleanNickname(value: unknown) {
  return Array.from(String(value || "")
    .normalize("NFC")
    .replace(/[\u0000-\u001f\u007f]/g, " ")
    .replace(/\s+/g, " ")
    .trim())
    .slice(0, 32)
    .join("");
}

function memberNickname(member: Pick<DiscordGuildMemberModerationItem, "nick">) {
  return cleanNickname(member.nick || "");
}

function invalidMember(member: Pick<DiscordGuildMemberModerationItem, "nick">, template: string) {
  const nickname = memberNickname(member);
  return !nickname || !nicknameMatchesTemplate(nickname, template);
}

function numberValue(value: unknown, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.max(0, Math.floor(number)) : fallback;
}

function cleanStatus(value: unknown): NicknameWarningRunStatus | null {
  const text = String(value || "").toLowerCase();
  if (text === "success" || text === "warning" || text === "error") return text;
  return null;
}

function normalizeRun(value: unknown): NicknameWarningRun | null {
  if (!value || typeof value !== "object") return null;
  const row = value as Record<string, unknown>;
  const completedAt = timestampToIso(row.completedAt);
  const startedAt = timestampToIso(row.startedAt) || completedAt;
  if (!completedAt || !startedAt) return null;
  return {
    id: String(row.id || `${completedAt}:nickname-warning`).slice(0, 160),
    source: String(row.source || "automatic") === "manual" ? "manual" : "automatic",
    status: cleanStatus(row.status) || "warning",
    startedAt,
    completedAt,
    checked: numberValue(row.checked),
    invalid: numberValue(row.invalid),
    notified: numberValue(row.notified),
    dm: numberValue(row.dm),
    channel: numberValue(row.channel),
    cooldownSkipped: numberValue(row.cooldownSkipped),
    deferredByBatch: numberValue(row.deferredByBatch),
    correctedBeforeSend: numberValue(row.correctedBeforeSend),
    failed: numberValue(row.failed),
    summary: String(row.summary || "").slice(0, 1500),
  };
}

function defaultState(): NicknameWarningAutomationState {
  return {
    lastRunAt: null,
    lastRunStatus: null,
    lastChecked: 0,
    lastInvalid: 0,
    lastNotified: 0,
    lastDm: 0,
    lastChannel: 0,
    lastFailed: 0,
    lastError: null,
    recentRuns: [],
  };
}

function normalizeState(data: Record<string, unknown> | null | undefined): NicknameWarningAutomationState {
  const recentRuns = Array.isArray(data?.recentRuns)
    ? data!.recentRuns.map(normalizeRun).filter(Boolean).slice(0, MAX_RECENT_RUNS) as NicknameWarningRun[]
    : [];
  return {
    lastRunAt: timestampToIso(data?.lastRunAt),
    lastRunStatus: cleanStatus(data?.lastRunStatus),
    lastChecked: numberValue(data?.lastChecked),
    lastInvalid: numberValue(data?.lastInvalid),
    lastNotified: numberValue(data?.lastNotified),
    lastDm: numberValue(data?.lastDm),
    lastChannel: numberValue(data?.lastChannel),
    lastFailed: numberValue(data?.lastFailed),
    lastError: data?.lastError ? String(data.lastError).slice(0, 1500) : null,
    recentRuns,
  };
}

function setStateCache(value: NicknameWarningAutomationState) {
  globalThis.__mistblossomNicknameWarningStateCache = { value, cachedAt: Date.now() };
  return value;
}

export async function getNicknameWarningAutomationState(options: { fresh?: boolean } = {}) {
  const cached = globalThis.__mistblossomNicknameWarningStateCache;
  if (!options.fresh && cached && Date.now() - cached.cachedAt < STATE_CACHE_TTL_MS) return cached.value;
  const fallback = cached?.value || defaultState();
  if (!hasFirebaseProfileConfig()) return setStateCache(fallback);
  const value = await resilientRead(
    "discord-nickname-warning-state",
    async () => {
      const snapshot = await getFirebaseAdminDb().collection(STATE_COLLECTION).doc(STATE_DOC_ID).get();
      return snapshot.exists ? normalizeState(snapshot.data() || null) : fallback;
    },
    {
      ttlMs: STATE_CACHE_TTL_MS,
      timeoutMs: 2_500,
      fallback: () => fallback,
      circuitKey: "discord-nickname-warning-state-read",
      logEvent: "discord.nickname_warning.state_read_failed",
      bypassCache: options.fresh,
    },
  );
  return setStateCache(value);
}

export function nicknameWarningDue(lastRunAt: string | null | undefined, intervalHours: number, now = Date.now()) {
  const last = lastRunAt ? Date.parse(lastRunAt) : Number.NaN;
  if (!Number.isFinite(last)) return true;
  return now - last >= Math.max(1, intervalHours) * 60 * 60_000;
}

export function acquireNicknameWarningExecution(source: string) {
  const now = Date.now();
  const current = globalThis.__mistblossomNicknameWarningExecution;
  if (current && now - current.startedAt < 60 * 60_000) return null;
  const lock = { source: String(source || "unknown").slice(0, 80), startedAt: now };
  globalThis.__mistblossomNicknameWarningExecution = lock;
  let released = false;
  return {
    release() {
      if (released) return;
      released = true;
      if (globalThis.__mistblossomNicknameWarningExecution === lock) {
        globalThis.__mistblossomNicknameWarningExecution = undefined;
      }
    },
  };
}

function warningSignature(template: string, nickname: string | null) {
  return `${String(template || "").trim()}|${String(nickname || "<missing>").normalize("NFC").trim()}`.slice(0, 180);
}

async function recentMemberWarning(userId: string, signature: string, cooldownHours: number) {
  if (!hasFirebaseProfileConfig()) return false;
  const snapshot = await getFirebaseAdminDb().collection(MEMBER_STATE_COLLECTION).doc(userId).get().catch(() => null);
  if (!snapshot?.exists) return false;
  const data = snapshot.data() || {};
  const last = timestampToIso(data.lastNotifiedAt);
  const sameSignature = String(data.signature || "") === signature;
  const lastMs = last ? Date.parse(last) : Number.NaN;
  return sameSignature && Number.isFinite(lastMs) && Date.now() - lastMs < Math.max(1, cooldownHours) * 60 * 60_000;
}

async function recordMemberWarning(input: {
  userId: string;
  signature: string;
  nickname: string | null;
  delivery: NicknameWarningDelivery;
  channelId: string | null;
  messageId: string | null;
  template: string;
}) {
  if (!hasFirebaseProfileConfig()) return;
  const now = new Date().toISOString();
  await firebaseWrite(
    "settings",
    `discord-nickname-warning-member:${input.userId}`,
    () => getFirebaseAdminDb().collection(MEMBER_STATE_COLLECTION).doc(input.userId).set({
      ...input,
      lastNotifiedAt: now,
      updatedAt: now,
    }, { merge: true }),
    { timeoutMs: 3_500, logEvent: "discord.nickname_warning.member_state_write_failed" },
  );
}

async function suggestedNickname(userId: string, template: string) {
  const profile = await getProfileByDiscordUserId(userId).catch(() => null);
  if (!profile) return null;
  return buildProfileDiscordNicknamePlan(profile, template).value || null;
}

function warningMessage(input: {
  nickname: string | null;
  template: string;
  suggested: string | null;
}) {
  const profileUrl = `${dashboardPublicOrigin()}/profile`;
  const lines = [
    "⚠️ **Mistblossom Vanguard — некоректний серверний нік**",
    "Твій серверний нік не відповідає правилам гільдії. Це попередження, ролі та доступи автоматично не змінюються.",
    "",
    `**Поточний нік:** ${input.nickname ? `\`${input.nickname}\`` : "не встановлено"}`,
    `**Формат:** \`Імʼя [Мейн, Альт1, Альт2]\``,
    `**Шаблон:** \`${input.template}\``,
    `**Приклад:** \`${nicknameTemplateExample(input.template)}\``,
  ];
  if (input.suggested) lines.push(`**Рекомендований нік для твого профілю:** \`${input.suggested}\``);
  lines.push(
    "",
    "**Як виправити:**",
    `1. Відкрий профіль: ${profileUrl}`,
    "2. Вкажи імʼя, мейн-персонажа та до 2 альтів.",
    "3. Онови Discord-нік через профіль або зміни серверний нік вручну у правильному форматі.",
    "",
    "Після виправлення наступна автоматична перевірка більше не надсилатиме це попередження.",
  );
  return lines.join("\n").slice(0, 1900);
}

export async function inspectNicknameWarnings(limitInput: unknown = 0) {
  const policy = await getGuildNicknamePolicy();
  const raw = Number(limitInput);
  const limit = Number.isFinite(raw) && raw > 0 ? Math.min(50_000, Math.floor(raw)) : 50_000;
  const members = await fetchDiscordGuildMembers(limit);
  const invalid = members.filter((member) => invalidMember(member, policy.template));
  return {
    template: policy.template,
    checked: members.length,
    invalidTotal: invalid.length,
    missingNicknameTotal: invalid.filter((member) => !memberNickname(member)).length,
    preview: invalid.slice(0, 100).map((member) => ({
      userId: member.userId,
      name: member.displayName,
      serverNickname: memberNickname(member) || null,
    })),
  };
}

export async function sendNicknameWarnings(input: {
  limit?: unknown;
  source: NicknameWarningSource;
  force?: boolean;
}) {
  const policy = await getGuildNicknamePolicy({ bypassCache: input.source === "automatic" });
  const rawLimit = Number(input.limit);
  const requestedLimit = Number.isFinite(rawLimit) && rawLimit > 0 ? Math.min(50_000, Math.floor(rawLimit)) : 50_000;
  const members = await fetchDiscordGuildMembers(requestedLimit);
  const invalid = members.filter((member) => invalidMember(member, policy.template));
  const startedAt = new Date().toISOString();

  let preCooldownSkipped = 0;
  let eligibleMembers = invalid;
  if (!input.force && invalid.length) {
    const preflight = await mapConcurrentSettled(
      invalid,
      async (member) => {
        const nickname = memberNickname(member) || null;
        const signature = warningSignature(policy.template, nickname);
        return { member, cooldown: await recentMemberWarning(member.userId, signature, policy.nicknameReminderCooldownHours) };
      },
      { profile: "io", concurrency: 8, min: 1, max: 12 },
    );
    const eligible: DiscordGuildMemberModerationItem[] = [];
    for (const item of preflight.results) {
      if (!item.ok) {
        eligible.push(item.item);
        continue;
      }
      if (item.value.cooldown) preCooldownSkipped += 1;
      else eligible.push(item.value.member);
    }
    eligibleMembers = eligible;
  }

  const targets = eligibleMembers.slice(0, Math.max(1, policy.nicknameReminderBatchLimit));
  const deferredByBatch = Math.max(0, eligibleMembers.length - targets.length);

  const { results, meta } = await mapConcurrentSettled(
    targets,
    async (member) => {
      const fresh = await fetchDiscordGuildMemberSnapshot(member.userId).catch(() => null);
      if (!fresh) {
        throw new Error("Discord-учасника не вдалося перечитати перед попередженням.");
      }
      const nickname = memberNickname(fresh) || null;
      if (!invalidMember(fresh, policy.template)) {
        return { userId: member.userId, name: fresh.displayName, status: "corrected" as const, delivery: null, nickname };
      }

      const signature = warningSignature(policy.template, nickname);
      if (!input.force && await recentMemberWarning(member.userId, signature, policy.nicknameReminderCooldownHours)) {
        return { userId: member.userId, name: fresh.displayName, status: "cooldown" as const, delivery: null, nickname };
      }

      const suggested = await suggestedNickname(member.userId, policy.template);
      const content = warningMessage({ nickname, template: policy.template, suggested });
      let dmError: string | null = null;
      try {
        const sent = await sendDiscordDirectMessage({ userId: member.userId, content });
        await recordMemberWarning({
          userId: member.userId,
          signature,
          nickname,
          delivery: "dm",
          channelId: sent.channelId,
          messageId: sent.messageId,
          template: policy.template,
        });
        logDashboardEvent("info", "discord.nickname_warning.sent", undefined, {
          source: input.source,
          userId: member.userId,
          name: fresh.displayName,
          delivery: "dm",
          nickname,
        }, { category: "action" });
        return { userId: member.userId, name: fresh.displayName, status: "sent" as const, delivery: "dm" as const, nickname };
      } catch (error) {
        dmError = safeErrorMessage(error, "DM недоступні.");
      }

      if (!policy.nicknameReminderChannelId) {
        throw new Error(`DM недоступні (${dmError}). Fallback-канал не налаштований.`);
      }

      const sent = await sendDiscordChannelUserWarning({
        channelId: policy.nicknameReminderChannelId,
        userId: member.userId,
        content,
      });
      await recordMemberWarning({
        userId: member.userId,
        signature,
        nickname,
        delivery: "channel",
        channelId: sent.channelId,
        messageId: sent.messageId,
        template: policy.template,
      });
      logDashboardEvent("info", "discord.nickname_warning.sent", undefined, {
        source: input.source,
        userId: member.userId,
        name: fresh.displayName,
        delivery: "channel",
        nickname,
        fallbackReason: dmError,
        channelId: sent.channelId,
      }, { category: "action" });
      return { userId: member.userId, name: fresh.displayName, status: "sent" as const, delivery: "channel" as const, nickname };
    },
    {
      profile: "external-api",
      concurrency: policy.nicknameCleanupConcurrency || undefined,
      min: 1,
      max: policy.nicknameCleanupMaxConcurrency || 1,
    },
  );

  const ok = results.filter((result) => result.ok);
  const failed = results.filter((result) => !result.ok);
  const sent = ok.filter((result) => result.value.status === "sent");
  const dm = sent.filter((result) => result.value.delivery === "dm");
  const channel = sent.filter((result) => result.value.delivery === "channel");
  const cooldown = ok.filter((result) => result.value.status === "cooldown");
  const cooldownSkipped = preCooldownSkipped + cooldown.length;
  const corrected = ok.filter((result) => result.value.status === "corrected");
  const summary = `Перевірено ${members.length}; некоректних ${invalid.length}; попереджено ${sent.length} (DM ${dm.length}, канал ${channel.length}); cooldown ${cooldownSkipped}; відкладено лімітом ${deferredByBatch}; виправили до відправки ${corrected.length}; помилок ${failed.length}.`;
  const status: NicknameWarningRunStatus = failed.length ? "warning" : "success";
  const completedAt = new Date().toISOString();
  const run: NicknameWarningRun = {
    id: `${Date.now()}:${input.source}`,
    source: input.source,
    status,
    startedAt,
    completedAt,
    checked: members.length,
    invalid: invalid.length,
    notified: sent.length,
    dm: dm.length,
    channel: channel.length,
    cooldownSkipped,
    deferredByBatch,
    correctedBeforeSend: corrected.length,
    failed: failed.length,
    summary,
  };
  const previous = await getNicknameWarningAutomationState({ fresh: true });
  const nextState: NicknameWarningAutomationState = {
    lastRunAt: completedAt,
    lastRunStatus: status,
    lastChecked: members.length,
    lastInvalid: invalid.length,
    lastNotified: sent.length,
    lastDm: dm.length,
    lastChannel: channel.length,
    lastFailed: failed.length,
    lastError: failed.length ? failed.slice(0, 3).map((item) => safeErrorMessage(item.error, "Discord warning failed")).join(" | ") : null,
    recentRuns: [run, ...previous.recentRuns].slice(0, MAX_RECENT_RUNS),
  };

  if (hasFirebaseProfileConfig()) {
    await firebaseWrite(
      "settings",
      `discord-nickname-warning-state:${input.source}`,
      () => getFirebaseAdminDb().collection(STATE_COLLECTION).doc(STATE_DOC_ID).set(nextState, { merge: true }),
      { timeoutMs: 4_000, logEvent: "discord.nickname_warning.state_write_failed" },
    );
  }
  setStateCache(nextState);

  return {
    ...run,
    template: policy.template,
    missingNicknameTotal: invalid.filter((member) => !memberNickname(member)).length,
    batchLimit: policy.nicknameReminderBatchLimit,
    concurrency: meta.concurrency,
    durationMs: meta.durationMs,
    sent: sent.slice(0, 100).map((item) => item.value),
    sentTotal: sent.length,
    errors: failed.slice(0, 100).map((item) => ({
      userId: item.item.userId,
      name: item.item.displayName,
      error: safeErrorMessage(item.error, "Discord warning failed"),
    })),
    errorsTotal: failed.length,
  };
}
