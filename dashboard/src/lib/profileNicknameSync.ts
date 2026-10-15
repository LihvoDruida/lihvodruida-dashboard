import "server-only";
import { createHash, randomUUID } from "node:crypto";
import {
  getDocumentDb,
  hasDocumentDbConfig,
} from "@/lib/documentDb";
import { FieldValue } from "@/lib/db/documentValues";
import {
  buildProfileDiscordNicknamePlan,
  normalizeProfile,
  normalizeProfilePreferredName,
  invalidateProfileIdentityCaches,
} from "@/lib/profiles";
import { discordApi, getDiscordGuildId } from "@/lib/discordAdmin";
import { DEFAULT_NICKNAME_TEMPLATE } from "@/lib/guildNicknamePolicy";

const JOBS = "profileNicknameSyncJobs";
const LEASE_MS = 120_000;
const ID = /^id[a-f0-9]{16,40}$/;
const UUID =
  /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;
export type NicknameSyncState =
  | "queued"
  | "running"
  | "retry"
  | "synced"
  | "uncertain"
  | "blocked"
  | "owner"
  | "not_discord";
type Job = {
  operationId: string;
  requestHash: string;
  profileId: string;
  guildId: string;
  profileRevision: string;
  state: NicknameSyncState;
  reason: string | null;
  nickname: string | null;
  truncated: boolean;
  attempts: number;
  dueAtMs: number | null;
  sourceName: string | null;
  sourceCharacters: string[];
  lease: string | null;
  leaseUntilMs: number;
  dispatched: boolean;
  updatedAt: string;
};
export type ProfileIdentityState = {
  preferredName: string;
  revision: string;
  nicknamePreview: string | null;
  sync: Pick<
    Job,
    | "operationId"
    | "profileRevision"
    | "state"
    | "reason"
    | "nickname"
    | "truncated"
    | "attempts"
    | "dueAtMs"
    | "updatedAt"
  > | null;
};
export class ProfileIdentityError extends Error {
  constructor(
    message: string,
    public readonly status = 400,
  ) {
    super(message);
  }
}
const hash = (value: unknown) =>
  createHash("sha256").update(JSON.stringify(value)).digest("hex");
function revision(data: Record<string, unknown>) {
  return hash([
    normalizeProfilePreferredName(data.preferredName),
    data.identityRevision || null,
    data.provider || "discord",
    data.providerUserId || "",
  ]);
}
function refs(profileId: string) {
  if (!ID.test(profileId))
    throw new ProfileIdentityError("Некоректний профіль.");
  if (!hasDocumentDbConfig())
    throw new ProfileIdentityError("Профілі тимчасово недоступні.", 503);
  const db = getDocumentDb();
  return {
    db,
    profile: db.collection("dashboardProfiles").doc(profileId),
    job: db.collection(JOBS).doc(profileId),
  };
}
function view(
  profileId: string,
  data: Record<string, unknown>,
  job: Job | null,
): ProfileIdentityState {
  const {
    operationId,
    state,
    reason,
    nickname,
    truncated,
    attempts,
    dueAtMs,
    updatedAt,
    profileRevision,
  } = job || {};
  return {
    preferredName: normalizeProfilePreferredName(data.preferredName),
    revision: revision(data),
    nicknamePreview: buildProfileDiscordNicknamePlan(
      normalizeProfile(profileId, data),
      DEFAULT_NICKNAME_TEMPLATE,
    ).value,
    sync: job
      ? ({
          operationId,
          profileRevision,
          state: profileRevision === revision(data) ? state : "blocked",
          reason:
            profileRevision === revision(data) ? reason : "profile_changed",
          nickname,
          truncated,
          attempts,
          dueAtMs,
          updatedAt,
        } as NonNullable<ProfileIdentityState["sync"]>)
      : null,
  };
}
export async function getProfileIdentityState(profileId: string) {
  const { db, profile, job } = refs(profileId);
  return db.runTransaction(async (tx) => {
    const p = await tx.get(profile),
      j = await tx.get(job);
    if (!p.exists)
      throw new ProfileIdentityError("Профіль більше не існує.", 404);
    return view(profileId, p.data() || {}, j.exists ? (j.data() as Job) : null);
  });
}
/** One explicit confirmation: the name and durable intent commit together. No Discord in a SQL transaction. */
export async function saveProfileIdentity(
  profileId: string,
  input: {
    preferredName: unknown;
    expectedRevision: unknown;
    operationId: unknown;
  },
) {
  if (
    typeof input.expectedRevision !== "string" ||
    !/^[a-f0-9]{64}$/.test(input.expectedRevision)
  )
    throw new ProfileIdentityError("Онови профіль перед збереженням.", 428);
  if (typeof input.operationId !== "string" || !UUID.test(input.operationId))
    throw new ProfileIdentityError("Некоректний ідентифікатор дії.");
  if (
    typeof input.preferredName !== "string" ||
    Array.from(input.preferredName.trim()).length > 32
  )
    throw new ProfileIdentityError("Імʼя: від 2 до 32 символів.");
  const name = normalizeProfilePreferredName(input.preferredName);
  if (Array.from(name).length < 2)
    throw new ProfileIdentityError("Імʼя: від 2 до 32 символів.");
  const { db, profile, job } = refs(profileId),
    requestHash = hash([name, input.expectedRevision]);
  const result = await db.runTransaction(async (tx) => {
    const p = await tx.get(profile),
      j = await tx.get(job);
    if (!p.exists)
      throw new ProfileIdentityError("Профіль більше не існує.", 404);
    const data = p.data() || {},
      previous = j.exists ? (j.data() as Job) : null;
    if (previous && previous.operationId === input.operationId) {
      if (previous.requestHash !== requestHash)
        throw new ProfileIdentityError(
          "Цей ідентифікатор уже належить іншій дії.",
          409,
        );
      return view(profileId, data, previous);
    }
    if (revision(data) !== input.expectedRevision)
      throw new ProfileIdentityError(
        "Імʼя змінилось в іншій вкладці. Перевір актуальне значення.",
        409,
      );
    if (previous?.lease && previous.leaseUntilMs > Date.now())
      throw new ProfileIdentityError(
        "Синхронізація ще працює. Дочекайся її результату.",
        409,
      );
    const nextData = {
      ...data,
      preferredName: name,
      identityRevision: randomUUID(),
    };
    const pModel = normalizeProfile(profileId, nextData),
      plan = buildProfileDiscordNicknamePlan(pModel);
    const discord =
      pModel.provider === "discord" &&
      /^\d{16,25}$/.test(pModel.providerUserId);
    const guildId = getDiscordGuildId();
    const next: Job = {
      operationId: input.operationId as string,
      requestHash,
      profileId,
      guildId,
      profileRevision: revision(nextData),
      state: !discord ? "not_discord" : !guildId ? "blocked" : "queued",
      reason: !discord ? "not_discord" : !guildId ? "configuration" : null,
      nickname: plan.value,
      truncated: plan.truncated,
      attempts: 0,
      dueAtMs: discord && guildId ? Date.now() : null,
      sourceName: plan.baseName,
      sourceCharacters: plan.characterNames,
      lease: null,
      leaseUntilMs: 0,
      dispatched: false,
      updatedAt: new Date().toISOString(),
    };
    tx.update(profile, {
      preferredName: name,
      identityRevision: nextData.identityRevision,
      updatedAt: FieldValue.serverTimestamp(),
    });
    tx.set(job, next);
    return view(profileId, nextData, next);
  });
  invalidateProfileIdentityCaches(profileId);
  return result;
}

/** At most one PATCH. A crashed/dispatched operation is reconciled by GET, never silently replayed. */
export async function runProfileNicknameSync(profileId: string) {
  const { db, profile, job } = refs(profileId),
    token = randomUUID();
  const claimed = await db.runTransaction(async (tx) => {
    const j = await tx.get(job),
      p = await tx.get(profile);
    if (!j.exists) return null;
    const current = j.data() as Job;
    if (
      current.dueAtMs === null ||
      current.dueAtMs > Date.now() ||
      current.leaseUntilMs > Date.now()
    )
      return null;
    if (
      !p.exists ||
      revision(p.data() || {}) !== current.profileRevision ||
      current.guildId !== getDiscordGuildId()
    ) {
      tx.update(job, {
        state: "blocked",
        reason: !p.exists ? "profile_missing" : "profile_changed",
        dueAtMs: null,
        lease: null,
        leaseUntilMs: 0,
      });
      return null;
    }
    const next = {
      ...current,
      state: "running" as const,
      lease: token,
      leaseUntilMs: Date.now() + LEASE_MS,
      dueAtMs: Date.now() + LEASE_MS,
      attempts: current.attempts + 1,
      updatedAt: new Date().toISOString(),
    };
    tx.set(job, next);
    return { job: next, data: p.data() || {} };
  });
  if (!claimed) return { processed: false };
  const current = claimed.job,
    model = normalizeProfile(profileId, claimed.data),
    computedPlan = buildProfileDiscordNicknamePlan(model);
  const plan = current.dispatched
    ? {
        ...computedPlan,
        value: current.nickname,
        baseName: current.sourceName,
        characterNames: current.sourceCharacters,
        truncated: current.truncated,
      }
    : computedPlan;
  let dispatched = current.dispatched,
    stage = "read";
  const finish = async (
    state: NicknameSyncState,
    reason: string | null,
    dueAtMs: number | null = null,
  ) => {
    await db.runTransaction(async (tx) => {
      const j = await tx.get(job),
        p = await tx.get(profile);
      if (!j.exists || (j.data() as Job).lease !== token) return;
      const changed =
        !p.exists || revision(p.data() || {}) !== current.profileRevision;
      const applied = state === "synced" && !changed;
      tx.update(job, {
        state: changed ? "blocked" : state,
        reason: changed ? "profile_changed" : reason,
        dueAtMs: changed ? null : dueAtMs,
        lease: null,
        leaseUntilMs: 0,
        dispatched,
        nickname: plan.value,
        truncated: plan.truncated,
        updatedAt: new Date().toISOString(),
      });
      if (applied)
        tx.update(profile, {
          discordNickname: {
            value: plan.value,
            syncedAt: FieldValue.serverTimestamp(),
            sourcePreferredName: plan.baseName,
            sourceCharacters: plan.characterNames,
          },
          updatedAt: FieldValue.serverTimestamp(),
        });
    });
    invalidateProfileIdentityCaches(profileId);
  };
  try {
    if (!plan.value) {
      await finish("blocked", "name_missing");
      return { processed: true };
    }
    const guild = await discordApi<{ owner_id: string }>(
      `/guilds/${current.guildId}`,
      { signal: AbortSignal.timeout(12_000) },
    );
    if (guild.owner_id === model.providerUserId) {
      await finish("owner", "owner");
      return { processed: true };
    }
    const member = await discordApi<{ nick: string | null }>(
      `/guilds/${current.guildId}/members/${model.providerUserId}`,
      { signal: AbortSignal.timeout(12_000) },
    );
    if ((member.nick || "") === plan.value) {
      await finish("synced", null);
      return { processed: true };
    }
    if (dispatched) {
      await finish("uncertain", "unconfirmed");
      return { processed: true };
    }
    stage = "patch";
    await discordApi(
      `/guilds/${current.guildId}/members/${model.providerUserId}`,
      {
        method: "PATCH",
        body: JSON.stringify({ nick: plan.value }),
        retry: "never",
        signal: AbortSignal.timeout(20_000),
        auditReason: `Mistblossom profile nickname sync: ${profileId}`,
        beforeSend: async () => {
          await db.runTransaction(async (tx) => {
            const j = await tx.get(job),
              p = await tx.get(profile);
            if (
              !j.exists ||
              !p.exists ||
              (j.data() as Job).lease !== token ||
              (j.data() as Job).leaseUntilMs <= Date.now() ||
              revision(p.data() || {}) !== current.profileRevision ||
              getDiscordGuildId() !== current.guildId
            )
              throw new ProfileIdentityError("Профіль змінився.", 409);
            const fresh = buildProfileDiscordNicknamePlan(
              normalizeProfile(profileId, p.data() || {}),
            );
            if (fresh.value !== plan.value)
              throw new ProfileIdentityError("Персонажі змінились.", 409);
            tx.update(job, {
              dispatched: true,
              nickname: plan.value,
              truncated: plan.truncated,
              sourceName: plan.baseName,
              sourceCharacters: plan.characterNames,
            });
          });
          dispatched = true;
        },
      },
    );
    await finish("synced", null);
  } catch (error) {
    const status = Number((error as { status?: number })?.status || 0);
    if (error instanceof ProfileIdentityError)
      await finish("blocked", "profile_changed");
    else if (dispatched && stage === "read")
      await finish(
        "uncertain",
        "unavailable",
        current.attempts < 5
          ? Date.now() + 60_000 * 2 ** Math.min(4, current.attempts - 1)
          : null,
      );
    else if ([400, 401, 403, 404].includes(status))
      await finish(
        "blocked",
        status === 403
          ? "hierarchy"
          : status === 404
            ? "member_missing"
            : status === 401
              ? "configuration"
              : "invalid_nickname",
      );
    else if (stage === "patch" && dispatched && status !== 429)
      await finish("uncertain", "unconfirmed", Date.now() + 60_000);
    else if (current.attempts >= 5)
      await finish(dispatched ? "uncertain" : "blocked", "unavailable");
    else {
      if (status === 429) dispatched = false; // A received 429 explicitly refused the PATCH.
      const delay = Math.max(
        60_000 * 2 ** Math.min(4, current.attempts - 1),
        Number((error as { retryAfterMs?: number })?.retryAfterMs || 0),
      );
      await finish("retry", "unavailable", Date.now() + delay);
    }
  }
  return { processed: true };
}
export async function processProfileNicknameSyncQueue() {
  if (!hasDocumentDbConfig())
    throw new ProfileIdentityError("Профілі тимчасово недоступні.", 503);
  const due = await getDocumentDb()
    .collection(JOBS)
    .where("dueAtMs", "<=", Date.now())
    .orderBy("dueAtMs")
    .limit(3)
    .get();
  let processed = 0;
  // Keep the HTTP worker bounded; another cron tick continues the remaining jobs.
  const deadline = Date.now() + 45_000;
  for (const item of due.docs) {
    if (Date.now() >= deadline) break;
    if ((await runProfileNicknameSync(item.id)).processed) processed++;
  }
  return { processed, found: due.size };
}

export async function requestProfileNicknameReconciliation(
  profileId: string,
  operationId: unknown,
) {
  const { db, job } = refs(profileId);
  await db.runTransaction(async (tx) => {
    const j = await tx.get(job);
    if (!j.exists || (j.data() as Job).operationId !== operationId)
      throw new ProfileIdentityError("Ця дія вже змінилась. Онови стан.", 409);
    const current = j.data() as Job;
    if (current.state !== "uncertain" || current.leaseUntilMs > Date.now())
      return;
    tx.update(job, { dueAtMs: Date.now(), dispatched: true });
  });
  return getProfileIdentityState(profileId);
}
