import "server-only";

import { mapConcurrentSettled } from "@/lib/concurrency";
import {
  fetchDiscordGuildMemberSnapshot,
  fetchDiscordGuildMembers,
  fetchDiscordGuildSnapshot,
  sendDiscordChannelUserWarning,
  sendDiscordDirectMessage,
  type DiscordGuildMemberModerationItem,
} from "@/lib/discordAdmin";
import { firebaseWrite } from "@/lib/firebaseAccess";
import { getFirebaseAdminDb, hasFirebaseProfileConfig } from "@/lib/firebaseAdmin";
import { getGuildNicknamePolicy, nicknameMatchesTemplate, nicknameTemplateExample, VALID_NICKNAME_STRUCTURES, type GuildNicknamePolicy } from "@/lib/guildNicknamePolicy";
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
export type NicknameWarningRunMode = "full" | "priority";
export type NicknameCheckStatus = "valid" | "invalid";

export type NicknameWarningRun = {
  id: string;
  source: NicknameWarningSource;
  mode: NicknameWarningRunMode;
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
  lastFullScanAt: string | null;
  lastFullScanTemplate: string | null;
  trackedValid: number;
  trackedInvalid: number;
  lastPriorityRunAt: string | null;
  lastPriorityChecked: number;
  nextInvalidCheckAt: string | null;
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

function missingMemberSnapshot(member: DiscordGuildMemberModerationItem) {
  return !member.nick && !member.username && !member.globalName && member.roleIds.length === 0 && member.displayName === "Discord";
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
    mode: String(row.mode || "full") === "priority" ? "priority" : "full",
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
    lastFullScanAt: null,
    lastFullScanTemplate: null,
    trackedValid: 0,
    trackedInvalid: 0,
    lastPriorityRunAt: null,
    lastPriorityChecked: 0,
    nextInvalidCheckAt: null,
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
    lastFullScanAt: timestampToIso(data?.lastFullScanAt),
    lastFullScanTemplate: data?.lastFullScanTemplate ? String(data.lastFullScanTemplate).slice(0, 96) : null,
    trackedValid: numberValue(data?.trackedValid),
    trackedInvalid: numberValue(data?.trackedInvalid),
    lastPriorityRunAt: timestampToIso(data?.lastPriorityRunAt),
    lastPriorityChecked: numberValue(data?.lastPriorityChecked),
    nextInvalidCheckAt: timestampToIso(data?.nextInvalidCheckAt),
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

export function nicknameFullScanDue(
  state: Pick<NicknameWarningAutomationState, "lastFullScanAt" | "lastFullScanTemplate">,
  policy: Pick<GuildNicknamePolicy, "template" | "nicknameValidRecheckHours">,
  now = Date.now(),
) {
  if (!state.lastFullScanAt || state.lastFullScanTemplate !== policy.template) return true;
  return nicknameWarningDue(state.lastFullScanAt, policy.nicknameValidRecheckHours, now);
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

type NicknameMemberCheckRecord = {
  userId: string;
  displayName: string;
  nickname: string | null;
  checkStatus: NicknameCheckStatus;
  template: string;
  lastCheckedAt: string;
  nextCheckAt: string;
  nextCheckAtMs: number;
};

function buildMemberCheckRecord(
  member: Pick<DiscordGuildMemberModerationItem, "userId" | "displayName" | "nick">,
  policy: Pick<GuildNicknamePolicy, "template" | "nicknameInvalidRecheckHours" | "nicknameValidRecheckHours">,
  checkedAtMs = Date.now(),
): NicknameMemberCheckRecord {
  const nickname = memberNickname(member) || null;
  const checkStatus: NicknameCheckStatus = invalidMember(member, policy.template) ? "invalid" : "valid";
  const intervalHours = checkStatus === "invalid" ? policy.nicknameInvalidRecheckHours : policy.nicknameValidRecheckHours;
  const nextCheckAtMs = checkedAtMs + Math.max(1, intervalHours) * 60 * 60_000;
  return {
    userId: member.userId,
    displayName: String(member.displayName || `Discord ${member.userId.slice(-6)}`).slice(0, 120),
    nickname,
    checkStatus,
    template: policy.template,
    lastCheckedAt: new Date(checkedAtMs).toISOString(),
    nextCheckAt: new Date(nextCheckAtMs).toISOString(),
    nextCheckAtMs,
  };
}

async function writeMemberCheckRecords(records: NicknameMemberCheckRecord[], options: { cleanupMissing?: boolean } = {}) {
  if (!hasFirebaseProfileConfig()) return;
  const db = getFirebaseAdminDb();
  const currentIds = new Set(records.map((record) => record.userId));
  const staleRefs: any[] = [];

  if (options.cleanupMissing) {
    const snapshot = await db.collection(MEMBER_STATE_COLLECTION).limit(5000).get().catch(() => null);
    for (const doc of snapshot?.docs || []) {
      if (!currentIds.has(doc.id)) staleRefs.push(doc.ref);
    }
  }

  await firebaseWrite(
    "settings",
    `discord-nickname-check-state:${options.cleanupMissing ? "full" : "partial"}`,
    async () => {
      const operations: Array<{ type: "set"; record: NicknameMemberCheckRecord } | { type: "delete"; ref: any }> = [
        ...records.map((record) => ({ type: "set" as const, record })),
        ...staleRefs.map((ref) => ({ type: "delete" as const, ref })),
      ];
      for (let index = 0; index < operations.length; index += 400) {
        const batch = db.batch();
        for (const operation of operations.slice(index, index + 400)) {
          if (operation.type === "delete") {
            batch.delete(operation.ref);
            continue;
          }
          const record = operation.record;
          batch.set(db.collection(MEMBER_STATE_COLLECTION).doc(record.userId), {
            userId: record.userId,
            displayName: record.displayName,
            nickname: record.nickname,
            checkStatus: record.checkStatus,
            template: record.template,
            lastCheckedAt: record.lastCheckedAt,
            nextCheckAt: record.nextCheckAt,
            nextCheckAtMs: record.nextCheckAtMs,
            updatedAt: record.lastCheckedAt,
          }, { merge: true });
        }
        await batch.commit();
      }
    },
    { timeoutMs: 12_000, logEvent: "discord.nickname_check.member_state_write_failed" },
  );
}

async function deleteMemberCheckRecords(userIds: string[]) {
  if (!hasFirebaseProfileConfig() || !userIds.length) return;
  const db = getFirebaseAdminDb();
  const unique = Array.from(new Set(userIds.filter((userId) => /^\d{16,25}$/.test(userId))));
  if (!unique.length) return;
  await firebaseWrite(
    "settings",
    "discord-nickname-check-state:delete-missing",
    async () => {
      for (let index = 0; index < unique.length; index += 400) {
        const batch = db.batch();
        for (const userId of unique.slice(index, index + 400)) batch.delete(db.collection(MEMBER_STATE_COLLECTION).doc(userId));
        await batch.commit();
      }
    },
    { timeoutMs: 8_000, logEvent: "discord.nickname_check.missing_state_delete_failed" },
  );
}

async function deferFailedNicknameChecks(
  failures: Array<{ userId: string; error: string }>,
  delayMs = 60 * 60_000,
) {
  if (!hasFirebaseProfileConfig() || !failures.length) return;
  const db = getFirebaseAdminDb();
  const retryAtMs = Date.now() + Math.max(15 * 60_000, delayMs);
  const retryAt = new Date(retryAtMs).toISOString();
  const failedAt = new Date().toISOString();
  await firebaseWrite(
    "settings",
    "discord-nickname-check-state:retry",
    async () => {
      for (let index = 0; index < failures.length; index += 400) {
        const batch = db.batch();
        for (const failure of failures.slice(index, index + 400)) {
          batch.set(db.collection(MEMBER_STATE_COLLECTION).doc(failure.userId), {
            nextCheckAt: retryAt,
            nextCheckAtMs: retryAtMs,
            lastCheckError: failure.error.slice(0, 500),
            lastCheckErrorAt: failedAt,
            updatedAt: failedAt,
          }, { merge: true });
        }
        await batch.commit();
      }
    },
    { timeoutMs: 8_000, logEvent: "discord.nickname_check.retry_state_write_failed" },
  );
}

async function patchAutomationState(patch: Partial<NicknameWarningAutomationState>) {
  const previous = await getNicknameWarningAutomationState({ fresh: true });
  const nextState = normalizeState({ ...previous, ...patch });
  if (hasFirebaseProfileConfig()) {
    await firebaseWrite(
      "settings",
      "discord-nickname-warning-state:patch",
      () => getFirebaseAdminDb().collection(STATE_COLLECTION).doc(STATE_DOC_ID).set(nextState, { merge: true }),
      { timeoutMs: 4_000, logEvent: "discord.nickname_warning.state_write_failed" },
    );
  }
  return setStateCache(nextState);
}

async function persistFullNicknameCheckSnapshot(
  members: DiscordGuildMemberModerationItem[],
  policy: GuildNicknamePolicy,
  checkedAtMs = Date.now(),
) {
  const records = members.map((member) => buildMemberCheckRecord(member, policy, checkedAtMs));
  await writeMemberCheckRecords(records, { cleanupMissing: true });
  const trackedInvalid = records.filter((record) => record.checkStatus === "invalid").length;
  const trackedValid = records.length - trackedInvalid;
  const nextInvalidCheckAt = records
    .filter((record) => record.checkStatus === "invalid")
    .sort((a, b) => a.nextCheckAtMs - b.nextCheckAtMs)[0]?.nextCheckAt || null;
  await patchAutomationState({
    lastFullScanAt: new Date(checkedAtMs).toISOString(),
    lastFullScanTemplate: policy.template,
    trackedValid,
    trackedInvalid,
    nextInvalidCheckAt,
  });
  return { records, trackedValid, trackedInvalid, nextInvalidCheckAt };
}

type DueInvalidTarget = { userId: string; displayName: string; nextCheckAtMs: number; signature: string; lastNotifiedAt: string | null };

async function loadDueInvalidNicknameTargets(limit: number, now = Date.now()) {
  if (!hasFirebaseProfileConfig()) return { targets: [] as DueInvalidTarget[], dueTotal: 0, nextDueAt: null as string | null, trackedInvalid: 0 };
  const snapshot = await getFirebaseAdminDb()
    .collection(MEMBER_STATE_COLLECTION)
    .where("checkStatus", "==", "invalid")
    .limit(5000)
    .get()
    .catch(() => null);
  const docs: any[] = snapshot?.docs || [];
  const rows: DueInvalidTarget[] = docs.map((doc: any): DueInvalidTarget => {
    const data = doc.data() || {};
    return {
      userId: String(data.userId || doc.id),
      displayName: String(data.displayName || `Discord ${String(doc.id).slice(-6)}`).slice(0, 120),
      nextCheckAtMs: numberValue(data.nextCheckAtMs, 0),
      signature: String(data.signature || "").slice(0, 180),
      lastNotifiedAt: timestampToIso(data.lastNotifiedAt),
    };
  }).filter((row) => /^\d{16,25}$/.test(row.userId));
  rows.sort((a, b) => a.nextCheckAtMs - b.nextCheckAtMs || a.userId.localeCompare(b.userId));
  const allDue = rows.filter((row) => !row.nextCheckAtMs || row.nextCheckAtMs <= now);
  const due = allDue.slice(0, Math.max(1, limit));
  const earliest = rows[0]?.nextCheckAtMs || 0;
  return {
    targets: due,
    dueTotal: allDue.length,
    nextDueAt: earliest ? new Date(earliest).toISOString() : null,
    trackedInvalid: rows.length,
  };
}

function warningSignature(template: string, nickname: string | null) {
  return `${String(template || "").trim()}|${String(nickname || "<missing>").normalize("NFC").trim()}`.slice(0, 180);
}

type StoredWarningState = { signature: string; lastNotifiedAt: string | null };

function storedWarningOnCooldown(state: StoredWarningState | undefined, signature: string, cooldownHours: number, now = Date.now()) {
  if (!state || state.signature !== signature) return false;
  const lastMs = state.lastNotifiedAt ? Date.parse(state.lastNotifiedAt) : Number.NaN;
  return Number.isFinite(lastMs) && now - lastMs < Math.max(1, cooldownHours) * 60 * 60_000;
}

async function loadStoredWarningStates(userIds: Set<string>) {
  if (!hasFirebaseProfileConfig() || !userIds.size) return new Map<string, StoredWarningState>();
  const snapshot = await getFirebaseAdminDb().collection(MEMBER_STATE_COLLECTION).limit(5000).get().catch(() => null);
  if (!snapshot) return null;
  const states = new Map<string, StoredWarningState>();
  for (const doc of snapshot.docs || []) {
    if (!userIds.has(doc.id)) continue;
    const data = doc.data() || {};
    states.set(doc.id, {
      signature: String(data.signature || "").slice(0, 180),
      lastNotifiedAt: timestampToIso(data.lastNotifiedAt),
    });
  }
  return states;
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

export function buildNicknameWarningMessage(input: {
  nickname: string | null;
  template: string;
  suggested: string | null;
  testMode?: boolean;
}) {
  const profileUrl = `${dashboardPublicOrigin()}/profile`;
  const lines = [
    ...(input.testMode ? ["🧪 **Тест повідомлення — тільки для власника сервера**", ""] : []),
    "⚠️ **Mistblossom Vanguard — некоректний серверний нік**",
    "Твій серверний нік не відповідає правилам гільдії. Це попередження, ролі та доступи автоматично не змінюються.",
    "",
    `**Поточний нік:** ${input.nickname ? `\`${input.nickname}\`` : "не встановлено"}`,
    "**Допустимі формати:**",
    "`Імʼя [Мейн]`",
    "`Імʼя [Мейн, Альт1]`",
    "`Імʼя [Мейн, Альт1, Альт2]`",
    `**Глобальна структура:** \`${VALID_NICKNAME_STRUCTURES[2]}\` (альти опційні)`,
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

export async function sendNicknameWarningTestToOwner() {
  const policy = await getGuildNicknamePolicy({ bypassCache: true });
  const guild = await fetchDiscordGuildSnapshot();
  const ownerId = String(guild.ownerId || "").trim();
  if (!ownerId) throw new Error("Discord не повернув ID власника сервера.");

  const member = await fetchDiscordGuildMemberSnapshot(ownerId);
  const nickname = memberNickname(member) || null;
  const suggested = await suggestedNickname(ownerId, policy.template);
  const content = buildNicknameWarningMessage({
    nickname,
    template: policy.template,
    suggested: suggested || nicknameTemplateExample(policy.template),
    testMode: true,
  });
  const sent = await sendDiscordDirectMessage({ userId: ownerId, content });
  logDashboardEvent("info", "discord.nickname_warning.test_sent", undefined, {
    ownerId,
    channelId: sent.channelId,
    messageId: sent.messageId,
    nickname,
  }, { category: "action" });
  return { ownerId, channelId: sent.channelId, messageId: sent.messageId, nickname, contentLength: content.length };
}

async function deliverNicknameWarning(
  member: DiscordGuildMemberModerationItem,
  policy: GuildNicknamePolicy,
  input: { source: NicknameWarningSource; force?: boolean },
) {
  const nickname = memberNickname(member) || null;
  if (!invalidMember(member, policy.template)) {
    return { userId: member.userId, name: member.displayName, status: "corrected" as const, delivery: null, nickname };
  }

  const signature = warningSignature(policy.template, nickname);
  if (!input.force && await recentMemberWarning(member.userId, signature, policy.nicknameReminderCooldownHours)) {
    return { userId: member.userId, name: member.displayName, status: "cooldown" as const, delivery: null, nickname };
  }

  const suggested = await suggestedNickname(member.userId, policy.template);
  const content = buildNicknameWarningMessage({ nickname, template: policy.template, suggested });
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
      name: member.displayName,
      delivery: "dm",
      nickname,
    }, { category: "action" });
    return { userId: member.userId, name: member.displayName, status: "sent" as const, delivery: "dm" as const, nickname };
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
    name: member.displayName,
    delivery: "channel",
    nickname,
    fallbackReason: dmError,
    channelId: sent.channelId,
  }, { category: "action" });
  return { userId: member.userId, name: member.displayName, status: "sent" as const, delivery: "channel" as const, nickname };
}

export async function inspectNicknameWarnings(limitInput: unknown = 0) {
  const policy = await getGuildNicknamePolicy({ bypassCache: true });
  const raw = Number(limitInput);
  const fullScan = !Number.isFinite(raw) || raw <= 0;
  const limit = Number.isFinite(raw) && raw > 0 ? Math.min(50_000, Math.floor(raw)) : 50_000;
  const members = await fetchDiscordGuildMembers(limit);
  const checkedAtMs = Date.now();
  const invalid = members.filter((member) => invalidMember(member, policy.template));
  if (fullScan) await persistFullNicknameCheckSnapshot(members, policy, checkedAtMs);
  else await writeMemberCheckRecords(members.map((member) => buildMemberCheckRecord(member, policy, checkedAtMs)));
  return {
    template: policy.template,
    checked: members.length,
    fullScan,
    validTotal: members.length - invalid.length,
    invalidTotal: invalid.length,
    invalidRecheckHours: policy.nicknameInvalidRecheckHours,
    validRecheckHours: policy.nicknameValidRecheckHours,
    missingNicknameTotal: invalid.filter((member) => !memberNickname(member)).length,
    preview: invalid.slice(0, 100).map((member) => ({
      userId: member.userId,
      name: member.displayName,
      serverNickname: memberNickname(member) || null,
    })),
  };
}

export async function processFullNicknameSweep(input: {
  source?: NicknameWarningSource;
} = {}) {
  const source = input.source || "automatic";
  const startedAt = new Date().toISOString();
  const inspection = await inspectNicknameWarnings(0);
  const completedAt = new Date().toISOString();
  const summary = `Повний sweep: перевірено ${inspection.checked}; коректних ${inspection.validTotal}; некоректних ${inspection.invalidTotal}; без серверного ніку ${inspection.missingNicknameTotal}. Чергу перебудовано без масової розсилки; некоректні підуть у priority-перевірку кожні ${inspection.invalidRecheckHours} год.`;
  const run: NicknameWarningRun = {
    id: `${Date.now()}:${source}:full-sweep`,
    source,
    mode: "full",
    status: "success",
    startedAt,
    completedAt,
    checked: inspection.checked,
    invalid: inspection.invalidTotal,
    notified: 0,
    dm: 0,
    channel: 0,
    cooldownSkipped: 0,
    deferredByBatch: 0,
    correctedBeforeSend: 0,
    failed: 0,
    summary,
  };

  const previous = await getNicknameWarningAutomationState({ fresh: true });
  const nextState: NicknameWarningAutomationState = {
    ...previous,
    lastRunAt: completedAt,
    lastRunStatus: "success",
    lastChecked: inspection.checked,
    lastInvalid: inspection.invalidTotal,
    lastNotified: 0,
    lastDm: 0,
    lastChannel: 0,
    lastFailed: 0,
    lastError: null,
    trackedValid: inspection.validTotal,
    trackedInvalid: inspection.invalidTotal,
    recentRuns: [run, ...previous.recentRuns].slice(0, MAX_RECENT_RUNS),
  };

  if (hasFirebaseProfileConfig()) {
    await firebaseWrite(
      "settings",
      `discord-nickname-warning-state:${source}:full-sweep`,
      () => getFirebaseAdminDb().collection(STATE_COLLECTION).doc(STATE_DOC_ID).set(nextState, { merge: true }),
      { timeoutMs: 4_000, logEvent: "discord.nickname_warning.state_write_failed" },
    );
  }
  setStateCache(nextState);

  return {
    ...run,
    fullScan: true as const,
    template: inspection.template,
    validTotal: inspection.validTotal,
    invalidTotal: inspection.invalidTotal,
    missingNicknameTotal: inspection.missingNicknameTotal,
    invalidRecheckHours: inspection.invalidRecheckHours,
    validRecheckHours: inspection.validRecheckHours,
    preview: inspection.preview,
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
  const fullScan = !Number.isFinite(rawLimit) || rawLimit <= 0;
  const scanStartedAtMs = Date.now();
  const invalid = members.filter((member) => invalidMember(member, policy.template));
  if (fullScan) await persistFullNicknameCheckSnapshot(members, policy, scanStartedAtMs);
  else await writeMemberCheckRecords(members.map((member) => buildMemberCheckRecord(member, policy, scanStartedAtMs)));
  const startedAt = new Date(scanStartedAtMs).toISOString();

  let preCooldownSkipped = 0;
  let eligibleMembers = invalid;
  if (!input.force && invalid.length) {
    const userIds = new Set(invalid.map((member) => member.userId));
    const storedStates = await loadStoredWarningStates(userIds);
    const eligible: DiscordGuildMemberModerationItem[] = [];
    if (storedStates) {
      for (const member of invalid) {
        const signature = warningSignature(policy.template, memberNickname(member) || null);
        if (storedWarningOnCooldown(storedStates.get(member.userId), signature, policy.nicknameReminderCooldownHours)) preCooldownSkipped += 1;
        else eligible.push(member);
      }
    } else {
      const preflight = await mapConcurrentSettled(
        invalid,
        async (member) => {
          const signature = warningSignature(policy.template, memberNickname(member) || null);
          return { member, cooldown: await recentMemberWarning(member.userId, signature, policy.nicknameReminderCooldownHours) };
        },
        { profile: "io", concurrency: 8, min: 1, max: 12 },
      );
      for (const item of preflight.results) {
        if (!item.ok || !item.value.cooldown) eligible.push(item.ok ? item.value.member : item.item);
        else preCooldownSkipped += 1;
      }
    }
    eligibleMembers = eligible;
  }

  const targets = eligibleMembers.slice(0, Math.max(1, policy.nicknameReminderBatchLimit));
  const deferredByBatch = Math.max(0, eligibleMembers.length - targets.length);

  const { results, meta } = await mapConcurrentSettled(
    targets,
    async (member) => {
      const fresh = await fetchDiscordGuildMemberSnapshot(member.userId).catch(() => null);
      if (!fresh) throw new Error("Discord-учасника не вдалося перечитати перед попередженням.");
      return deliverNicknameWarning(fresh, policy, { ...input, force: true });
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
  if (ok.length) {
    await writeMemberCheckRecords(ok.map((result) => buildMemberCheckRecord({
      userId: result.value.userId,
      displayName: result.value.name,
      nick: result.value.nickname,
    }, policy)));
  }
  const queueAfter = await loadDueInvalidNicknameTargets(1);
  const summary = `Перевірено ${members.length}; некоректних ${invalid.length}; попереджено ${sent.length} (DM ${dm.length}, канал ${channel.length}); cooldown ${cooldownSkipped}; відкладено лімітом ${deferredByBatch}; виправили до відправки ${corrected.length}; помилок ${failed.length}.`;
  const status: NicknameWarningRunStatus = failed.length ? "warning" : "success";
  const completedAt = new Date().toISOString();
  const run: NicknameWarningRun = {
    id: `${Date.now()}:${input.source}`,
    source: input.source,
    mode: "full",
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
    ...previous,
    lastRunAt: completedAt,
    lastRunStatus: status,
    lastChecked: members.length,
    lastInvalid: invalid.length,
    lastNotified: sent.length,
    lastDm: dm.length,
    lastChannel: channel.length,
    lastFailed: failed.length,
    lastError: failed.length ? failed.slice(0, 3).map((item) => safeErrorMessage(item.error, "Discord warning failed")).join(" | ") : null,
    trackedInvalid: queueAfter.trackedInvalid,
    trackedValid: fullScan ? Math.max(0, members.length - queueAfter.trackedInvalid) : previous.trackedValid,
    nextInvalidCheckAt: queueAfter.nextDueAt,
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

export async function processPriorityNicknameWarnings(input: {
  source?: NicknameWarningSource;
  force?: boolean;
} = {}) {
  const source = input.source || "automatic";
  const policy = await getGuildNicknamePolicy({ bypassCache: true });
  const queue = await loadDueInvalidNicknameTargets(policy.nicknameReminderBatchLimit);
  if (!queue.targets.length) {
    await patchAutomationState({ nextInvalidCheckAt: queue.nextDueAt, trackedInvalid: queue.trackedInvalid });
    return {
      skipped: true as const,
      reason: "no_priority_due" as const,
      checked: 0,
      failed: 0,
      trackedInvalid: queue.trackedInvalid,
      nextInvalidCheckAt: queue.nextDueAt,
      dueTotal: queue.dueTotal,
    };
  }

  const startedAtMs = Date.now();
  const startedAt = new Date(startedAtMs).toISOString();
  const { results, meta } = await mapConcurrentSettled(
    queue.targets,
    async (target) => {
      const fresh = await fetchDiscordGuildMemberSnapshot(target.userId);
      if (missingMemberSnapshot(fresh)) {
        return {
          fresh: null,
          outcome: { userId: target.userId, name: target.displayName, status: "missing" as const, delivery: null, nickname: null },
        };
      }
      const nickname = memberNickname(fresh) || null;
      if (!invalidMember(fresh, policy.template)) {
        return {
          fresh,
          outcome: { userId: fresh.userId, name: fresh.displayName, status: "corrected" as const, delivery: null, nickname },
        };
      }

      const signature = warningSignature(policy.template, nickname);
      const storedCooldown = !input.force && storedWarningOnCooldown(target, signature, policy.nicknameReminderCooldownHours);
      if (storedCooldown) {
        return {
          fresh,
          outcome: { userId: fresh.userId, name: fresh.displayName, status: "cooldown" as const, delivery: null, nickname },
        };
      }

      const outcome = await deliverNicknameWarning(fresh, policy, { source, force: true });
      return { fresh, outcome };
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
  const checkedMembers = ok.filter((result) => result.value.fresh);
  const missing = ok.filter((result) => result.value.outcome.status === "missing");
  if (checkedMembers.length) {
    await writeMemberCheckRecords(checkedMembers.map((result) => buildMemberCheckRecord(result.value.fresh!, policy)));
  }
  if (missing.length) await deleteMemberCheckRecords(missing.map((result) => result.value.outcome.userId));
  if (failed.length) {
    await deferFailedNicknameChecks(failed.map((result) => ({
      userId: result.item.userId,
      error: safeErrorMessage(result.error, "Discord member recheck failed"),
    })));
  }

  const sent = ok.filter((result) => result.value.outcome.status === "sent");
  const dm = sent.filter((result) => result.value.outcome.delivery === "dm");
  const channel = sent.filter((result) => result.value.outcome.delivery === "channel");
  const cooldown = ok.filter((result) => result.value.outcome.status === "cooldown");
  const corrected = ok.filter((result) => result.value.outcome.status === "corrected");
  const stillInvalid = ok.filter((result) => result.value.outcome.status === "sent" || result.value.outcome.status === "cooldown");
  const deferredByBatch = Math.max(0, queue.dueTotal - queue.targets.length);
  const queueAfter = await loadDueInvalidNicknameTargets(1);
  const completedAt = new Date().toISOString();
  const status: NicknameWarningRunStatus = failed.length ? "warning" : "success";
  const summary = `Пріоритетно перевірено ${queue.targets.length} некоректних ніків; все ще некоректних ${stillInvalid.length}; виправлено ${corrected.length}; вийшли із сервера ${missing.length}; попереджено ${sent.length} (DM ${dm.length}, канал ${channel.length}); cooldown ${cooldown.length}; відкладено ${deferredByBatch}; помилок ${failed.length}.`;
  const run: NicknameWarningRun = {
    id: `${Date.now()}:${source}:priority`,
    source,
    mode: "priority",
    status,
    startedAt,
    completedAt,
    checked: queue.targets.length,
    invalid: stillInvalid.length,
    notified: sent.length,
    dm: dm.length,
    channel: channel.length,
    cooldownSkipped: cooldown.length,
    deferredByBatch,
    correctedBeforeSend: corrected.length,
    failed: failed.length,
    summary,
  };

  const previous = await getNicknameWarningAutomationState({ fresh: true });
  const nextState: NicknameWarningAutomationState = {
    ...previous,
    lastRunAt: completedAt,
    lastPriorityRunAt: completedAt,
    lastPriorityChecked: queue.targets.length,
    lastRunStatus: status,
    lastChecked: queue.targets.length,
    lastInvalid: stillInvalid.length,
    lastNotified: sent.length,
    lastDm: dm.length,
    lastChannel: channel.length,
    lastFailed: failed.length,
    lastError: failed.length ? failed.slice(0, 3).map((item) => safeErrorMessage(item.error, "Discord member recheck failed")).join(" | ") : null,
    trackedInvalid: queueAfter.trackedInvalid,
    trackedValid: previous.trackedValid + corrected.length,
    nextInvalidCheckAt: queueAfter.nextDueAt,
    recentRuns: [run, ...previous.recentRuns].slice(0, MAX_RECENT_RUNS),
  };

  if (hasFirebaseProfileConfig()) {
    await firebaseWrite(
      "settings",
      `discord-nickname-warning-state:${source}:priority`,
      () => getFirebaseAdminDb().collection(STATE_COLLECTION).doc(STATE_DOC_ID).set(nextState, { merge: true }),
      { timeoutMs: 4_000, logEvent: "discord.nickname_warning.state_write_failed" },
    );
  }
  setStateCache(nextState);

  return {
    ...run,
    skipped: false as const,
    template: policy.template,
    priority: true,
    trackedInvalid: queueAfter.trackedInvalid,
    nextInvalidCheckAt: queueAfter.nextDueAt,
    batchLimit: policy.nicknameReminderBatchLimit,
    concurrency: meta.concurrency,
    durationMs: meta.durationMs,
    sent: sent.slice(0, 100).map((item) => item.value.outcome),
    sentTotal: sent.length,
    missingNicknameTotal: stillInvalid.filter((item) => !item.value.outcome.nickname).length,
    errors: failed.slice(0, 100).map((item) => ({
      userId: item.item.userId,
      name: item.item.displayName,
      error: safeErrorMessage(item.error, "Discord member recheck failed"),
    })),
    errorsTotal: failed.length,
  };
}

