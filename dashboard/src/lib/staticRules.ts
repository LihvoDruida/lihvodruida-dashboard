import "server-only";

import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import type { DashboardSession } from "@/lib/auth";
import { getFirebaseAdminDb } from "@/lib/firebaseAdmin";
import { addGuildMemberRoles, assertDiscordRolesManageable, fetchDiscordGuildMemberSnapshot, fetchDiscordGuildSnapshot, fetchDiscordGuildMembersCachedForUi, fetchDiscordRoleControlSnapshot, getDiscordGuildId, removeGuildMemberRoles } from "@/lib/discordAdmin";
import { isDashboardAdmin } from "@/lib/permissions";
import { DEFAULT_STATIC_RULES_MARKDOWN } from "@/lib/staticRulesDefault";

const SETTINGS = "staticRulesConfig";
const INVITES = "staticRulesInvites";
const CHALLENGES = "staticRulesChallenges";
const CHALLENGE_QUOTAS = "staticRulesChallengeQuotas";
const MEMBERS = "staticRulesMembers";
const HISTORY = "staticRulesAudit";
const DAY_MS = 24 * 60 * 60 * 1000;
const MAX_VIOLATIONS = 3;
const MAX_VIOLATION_DESCRIPTION = 128;
const CHALLENGE_MS = 10 * 60 * 1000;
const snowflake = (value: unknown) => /^\d{16,25}$/.test(String(value || "")) ? String(value) : "";
const digest = (value: string) => createHash("sha256").update(value).digest("hex");
const secret = (length = 32) => randomBytes(length).toString("base64url");
const nowIso = () => new Date().toISOString();
const db = () => getFirebaseAdminDb();

export type StaticSettings = { text: string; version: number; updatedAt: string | null; memberRoleId: string; managerRoleId: string };
export type StaticInvite = { id: string; createdAt: string; expiresAt: string; createdBy: string; revokedAt: string | null };
export type StaticViolation = { id: string; description: string; createdAt: string; createdBy: string };
export type StaticMember = { userId: string; name: string; status: "active" | "removed"; blocked: boolean; acceptedAt: string | null; version: number; removedAt: string | null; removedBy: string | null; violations?: StaticViolation[]; banUntil?: string | null; banReason?: string | null };
export const staticBanActive = (member: Pick<StaticMember, "banUntil"> | null | undefined, now = Date.now()) => Boolean(member?.banUntil && Date.parse(member.banUntil) > now);
function monthFromNow(now = new Date()) {
  const y = now.getUTCFullYear(), m = now.getUTCMonth(), d = now.getUTCDate();
  const lastDay = new Date(Date.UTC(y, m + 2, 0)).getUTCDate();
  return new Date(Date.UTC(y, m + 1, Math.min(d, lastDay), now.getUTCHours(), now.getUTCMinutes(), now.getUTCSeconds(), now.getUTCMilliseconds())).toISOString();
}
export type StaticChallenge = { inviteId: string; version: number; createdAt: string; expiresAt: string; status: "pending" | "processing" | "completed" | "failed"; verifierHash: string; userId?: string; message?: string };

export async function getStaticSettings(): Promise<StaticSettings> {
  const data = (await db().collection(SETTINGS).doc("main").get()).data() || {};
  return {
    // Use the supplied rules only before any editor has published custom content.
    // Never overwrite existing database rules on deployment.
    text: typeof data.text === "string" && data.text.trim() ? data.text : DEFAULT_STATIC_RULES_MARKDOWN,
    version: Math.max(1, Number(data.version || 1)),
    updatedAt: typeof data.updatedAt === "string" ? data.updatedAt : null,
    memberRoleId: snowflake(data.memberRoleId || process.env.STATIC_MEMBER_ROLE_ID),
    managerRoleId: snowflake(data.managerRoleId || process.env.STATIC_MANAGER_ROLE_ID),
  };
}

export async function staticPermission(session: DashboardSession | null) {
  if (!session || session.impersonatedBy || session.provider !== "discord" || !snowflake(session.id)) return { view: false, edit: false, admin: false };
  // Require a fresh authoritative guild membership read, not only a session claim.
  const [member, guild, settings] = await Promise.all([
    fetchDiscordGuildMemberSnapshot(session.id), fetchDiscordGuildSnapshot(), getStaticSettings(),
  ]);
  if (!member.joinedAt) return { view: false, edit: false, admin: false };
  const owner = guild.ownerId === session.id;
  // If roles changed since session issuance, do not keep elevated session privileges.
  const rolesCurrent = (session.discordRoleIds || []).every((role) => member.roleIds.includes(role));
  const admin = owner || (Boolean(session.discordRoleIds?.length) && rolesCurrent && isDashboardAdmin(session));
  const manager = Boolean(settings.managerRoleId && member.roleIds.includes(settings.managerRoleId));
  return { view: true, edit: admin || manager, admin };
}

export async function saveStaticSettings(input: { text?: string; memberRoleId?: string; managerRoleId?: string }, actorId: string, settingsOnly = false) {
  const original = await getStaticSettings();
  const memberRoleId = input.memberRoleId === undefined ? original.memberRoleId : snowflake(input.memberRoleId);
  const managerRoleId = input.managerRoleId === undefined ? original.managerRoleId : snowflake(input.managerRoleId);
  if (input.memberRoleId !== undefined || input.managerRoleId !== undefined) {
    if (!settingsOnly) throw new Error("Налаштування ролей доступне лише адміністратору.");
    if (original.memberRoleId && original.memberRoleId !== memberRoleId) {
      const members = await db().collection(MEMBERS).limit(1).where("status", "==", "active").get();
      if (members.docs.length) throw new Error("Роль Статика не можна змінити, поки є активні підписанти. Спершу перенеси учасників контрольовано.");
    }
    if (!memberRoleId || !managerRoleId || memberRoleId === managerRoleId) throw new Error("Вибери дві різні дійсні Discord-ролі.");
    await assertDiscordRolesManageable([memberRoleId]);
    const roles = await fetchDiscordRoleControlSnapshot();
    if (roles.error || !roles.roles.some((role) => role.id === managerRoleId)) throw new Error("Роль відповідального РЛ не знайдена на Discord-сервері.");
  }
  const text = input.text === undefined ? original.text : input.text.trim().slice(0, 20_000);
  if (input.text !== undefined && text.length < 20) throw new Error("Правила повинні містити щонайменше 20 символів.");
  const changed = input.text !== undefined && text !== original.text;
  const version = original.version + (changed ? 1 : 0);
  const updatedAt = nowIso();
  await db().collection(SETTINGS).doc("main").set({ text, version, memberRoleId, managerRoleId, updatedAt });
  await staticAudit("settings.changed", actorId, { version, changed });
  return { text, version, memberRoleId, managerRoleId, updatedAt };
}

export async function staticAudit(kind: string, actor: string, details: Record<string, unknown> = {}) {
  await db().collection(HISTORY).doc(`${Date.now()}-${secret(8)}`).set({ kind, actor, details, createdAt: nowIso() });
}

export async function createStaticInvite(actorId: string) {
  const token = secret();
  const id = digest(token);
  const invite: StaticInvite = { id, createdAt: nowIso(), expiresAt: new Date(Date.now() + DAY_MS).toISOString(), createdBy: actorId, revokedAt: null };
  await db().collection(INVITES).doc(id).set(invite);
  await staticAudit("invite.created", actorId, { inviteId: id, expiresAt: invite.expiresAt });
  return { ...invite, token };
}

export async function getStaticInvite(token: string): Promise<StaticInvite | null> {
  if (!/^[a-zA-Z0-9_-]{40,90}$/.test(token)) return null;
  const data = (await db().collection(INVITES).doc(digest(token)).get()).data();
  if (!data) return null;
  return data as StaticInvite;
}

export function inviteActive(invite: StaticInvite | null) {
  return Boolean(invite && !invite.revokedAt && Date.parse(invite.expiresAt) > Date.now());
}

export async function revokeStaticInvite(id: string, actorId: string) {
  if (!/^[a-f0-9]{64}$/.test(id)) throw new Error("Некоректний ідентифікатор.");
  const ref = db().collection(INVITES).doc(id);
  const snap = await ref.get();
  if (!snap.exists) throw new Error("Посилання не знайдено.");
  await ref.update({ revokedAt: nowIso() });
  await staticAudit("invite.revoked", actorId, { inviteId: id });
}

export async function listStaticState() {
  const [invites, members, events, settings] = await Promise.all([
    db().collection(INVITES).limit(150).get(),
    db().collection(MEMBERS).limit(1000).get(),
    db().collection(HISTORY).limit(200).get(),
    getStaticSettings(),
  ]);
  return {
    settings,
    invites: invites.docs.map((doc) => doc.data() as StaticInvite).sort((a, b) => b.createdAt.localeCompare(a.createdAt)),
    members: members.docs.map((doc) => doc.data() as StaticMember).sort((a, b) => (b.acceptedAt || "").localeCompare(a.acceptedAt || "")),
    audit: events.docs.map((doc) => {
      const data = doc.data() ?? {};
      return { id: doc.id, ...data, createdAt: String(data.createdAt || "") };
    }).sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, 60),
  };
}

export async function listStaticOverview() {
  const [invites, memberDocs, settings] = await Promise.all([
    db().collection(INVITES).limit(150).get(),
    db().collection(MEMBERS).limit(1000).get(),
    getStaticSettings(),
  ]);
  // Discord is the source of truth for nickname/avatar/role; never infer a role
  // from an old acceptance record. Fail closed to stored data on outage.
  const discord = await fetchDiscordGuildMembersCachedForUi(60_000).catch(() => null);
  const identities = new Map((discord || []).map(member => [member.userId, member]));
  return {
    settings,
    invites: invites.docs.map(doc => doc.data() as StaticInvite).sort((a, b) => b.createdAt.localeCompare(a.createdAt)),
    members: memberDocs.docs.map(doc => {
      const record = doc.data() as StaticMember;
      const guildMember = identities.get(record.userId);
      return { ...record, name: guildMember?.displayName || record.name, discord: guildMember
        ? { avatarUrl: guildMember.avatarUrl, username: guildMember.username, nick: guildMember.nick, roleIds: guildMember.roleIds, joinedAt: guildMember.joinedAt }
        : null };
    }).sort((a, b) => (b.acceptedAt || "").localeCompare(a.acceptedAt || "")),
    discordSynced: discord !== null,
  };
}

export async function listStaticDiscipline() {
  const members = (await db().collection(MEMBERS).limit(1000).get()).docs
    .map(doc => doc.data() as StaticMember)
    .filter(member => (member.violations?.length || 0) > 0 || staticBanActive(member));
  const discord = await fetchDiscordGuildMembersCachedForUi(60_000).catch(() => null);
  const identities = new Map((discord || []).map(member => [member.userId, member]));
  return members.map(member => ({ ...member,
    name: identities.get(member.userId)?.displayName || member.name,
    avatarUrl: identities.get(member.userId)?.avatarUrl || null,
    violations: member.violations || [],
    banned: staticBanActive(member),
  })).sort((a, b) => Number(b.banned) - Number(a.banned) || (b.violations.at(-1)?.createdAt || "").localeCompare(a.violations.at(-1)?.createdAt || ""));
}

export async function addStaticViolation(userId: string, descriptionInput: string, actorId: string) {
  if (!snowflake(userId)) throw new Error("Недійсний Discord ID.");
  const description = descriptionInput.trim();
  if (!description || description.length > MAX_VIOLATION_DESCRIPTION) throw new Error("Причина порушення має містити від 1 до 128 символів.");
  const ref = db().collection(MEMBERS).doc(userId);
  const result = await db().runTransaction(async tx => {
    const previous = (await tx.get(ref)).data() as StaticMember | undefined;
    if (!previous) throw new Error("Учасника не знайдено в реєстрі Статика.");
    const current = previous.violations || [];
    if (staticBanActive(previous)) throw new Error("Бан уже активний. Можна зняти порушення.");
    if (current.length >= MAX_VIOLATIONS) throw new Error("Три порушення вже зафіксовано. Зніми одне перед додаванням нового.");
    const violation = { id: secret(10), description, createdAt: nowIso(), createdBy: actorId };
    const violations = [...current, violation];
    const banned = violations.length === MAX_VIOLATIONS;
    const banUntil = banned ? monthFromNow() : null;
    tx.set(ref, { ...previous, violations, banUntil, banReason: banned ? "three_violations" : null,
      status: banned ? "removed" : previous.status,
      removedAt: banned ? nowIso() : previous.removedAt,
      removedBy: banned ? actorId : previous.removedBy,
    });
    return { banned, banUntil, violation };
  });
  await staticAudit("violation.added", actorId, { userId, description, violationId: result.violation.id, count: result.banned ? 3 : null });
  if (result.banned) {
    await staticAudit("member.banned", actorId, { userId, banUntil: result.banUntil });
    // Persist the ban before the Discord call. If Discord fails, gateway + hourly
    // reconciliation revoke any unauthorized manual role grants.
    try { await enforceStaticMemberRole(userId); }
    catch (error) {
      await staticAudit("role.enforcement_pending", "system", { userId, reason: "Discord unavailable" }).catch(() => null);
      return { ...result, warning: "Бан збережено, але Discord тимчасово недоступний. Бот повторить зняття ролі." };
    }
  }
  return result;
}

export async function removeStaticViolation(userId: string, violationId: string, actorId: string) {
  if (!snowflake(userId) || !/^[a-zA-Z0-9_-]{10,30}$/.test(violationId)) throw new Error("Недійсний учасник або запис.");
  const ref = db().collection(MEMBERS).doc(userId);
  await db().runTransaction(async tx => {
    const previous = (await tx.get(ref)).data() as StaticMember | undefined;
    if (!previous) throw new Error("Учасника не знайдено.");
    const violations = (previous.violations || []).filter(v => v.id !== violationId);
    if (violations.length === (previous.violations || []).length) throw new Error("Порушення не знайдено.");
    tx.update(ref, { violations, banUntil: null, banReason: null });
  });
  await staticAudit("violation.removed", actorId, { userId, violationId });
  // Revoking a strike lifts the timed ban, but never grants a role automatically.
}

export async function enforceStaticMemberRole(userIdInput: string) {
  const userId = snowflake(userIdInput);
  if (!userId) return { checked: 0, revoked: 0 };
  const settings = await getStaticSettings();
  if (!settings.memberRoleId) return { checked: 0, revoked: 0 };
  const record = (await db().collection(MEMBERS).doc(userId).get()).data() as StaticMember | undefined;
  if (!record || (!record.blocked && !staticBanActive(record))) return { checked: 1, revoked: 0 };
  const actual = await fetchDiscordGuildMemberSnapshot(userId).catch(error => {
    if (String(error).includes("404")) return null;
    throw error;
  });
  if (!actual?.roleIds.includes(settings.memberRoleId)) return { checked: 1, revoked: 0 };
  await removeGuildMemberRoles({ guildId: getDiscordGuildId(), userId, roleIds: [settings.memberRoleId], reason: `Static role forbidden: blocked or banned` });
  await staticAudit("role.enforced", "system", { userId, banUntil: record.banUntil || null });
  return { checked: 1, revoked: 1 };
}

export async function sweepStaticForbiddenRoles() {
  // Paginate by doc id: a guild larger than 1000 members must not skip bans.
  // Store-agnostic cursor: __name__ ordering accepts the last document ID
  // both in the PostgreSQL adapter and in Firestore.
  let cursorId: string | undefined;
  let checked = 0, revoked = 0, failed = 0;
  for (let page = 0; page < 50; page++) {
    let query = db().collection(MEMBERS).orderBy("__name__").limit(250);
    if (cursorId !== undefined) query = query.startAfter(cursorId);
    const snap = await query.get();
    if (!snap.docs.length) break;
    cursorId = snap.docs[snap.docs.length - 1].id;
    for (const doc of snap.docs) {
      const member = doc.data() as StaticMember;
      if (!member.blocked && !staticBanActive(member)) continue;
      try {
        const result = await enforceStaticMemberRole(member.userId);
        checked += result.checked; revoked += result.revoked;
      } catch { failed++ } // Next hour retries failures without clearing bans.
    }
    if (snap.docs.length < 250) break;
  }
  return { checked, revoked, failed };
}

export async function listStaticAudit(limit = 250) {
  const safeLimit = Math.max(1, Math.min(250, Math.floor(limit)));
  const snapshot = await db().collection(HISTORY).orderBy("createdAt", "desc").limit(safeLimit).get();
  return snapshot.docs.map((doc) => {
    const data = doc.data() ?? {};
    return {
      id: doc.id,
      kind: String(data.kind || "unknown"),
      actor: String(data.actor || ""),
      createdAt: String(data.createdAt || ""),
      details: data.details && typeof data.details === "object" && !Array.isArray(data.details)
        ? data.details as Record<string, unknown>
        : {},
    };
  });
}

/** Transactional, multi-instance admission control for a shared 24h invite.
 * The client's trusted IP is salted with a nonpublic invite hash before
 * storage, so the database never stores visitor IPs in this collection.
 */
export class StaticChallengeRateLimitError extends Error {
  constructor() {
    super("Забагато спроб за цим запрошенням. Спробуй через 15 хвилин.");
    this.name = "StaticChallengeRateLimitError";
  }
}

export async function claimStaticChallengeQuota(inviteId: string, ip: string, now = Date.now()): Promise<boolean> {
  const refs = [
    { id: digest(`ip:${inviteId}:${ip}`), max: 16 },
    { id: digest(`invite:${inviteId}`), max: 300 },
  ];
  const expiresAt = new Date(now + 15 * 60 * 1000).toISOString();
  return db().runTransaction(async tx => {
    const quotaDocs = refs.map(item => db().collection(CHALLENGE_QUOTAS).doc(item.id));
    const snapshots = await Promise.all(quotaDocs.map(ref => tx.get(ref)));
    const data = snapshots.map(snap => snap.data() as { count?: number; expiresAt?: string } | undefined);
    const counts = data.map((entry, index) => entry && Date.parse(entry.expiresAt || "") > now
      ? Math.max(0, Number(entry.count || 0)) : 0);
    if (counts.some((count, index) => count >= refs[index].max)) return false;
    quotaDocs.forEach((ref, index) => tx.set(ref, {
      count: counts[index] + 1,
      expiresAt: counts[index] === 0 ? expiresAt : data[index]?.expiresAt,
    }));
    return true;
  });
}

export async function pruneStaticChallengeQuotas(limit = 250): Promise<number> {
  const cutoff = nowIso();
  const expired = await db().collection(CHALLENGE_QUOTAS).where("expiresAt", "<=", cutoff).limit(Math.min(500, Math.max(1, limit))).get();
  let removed = 0;
  for (const snapshot of expired.docs) {
    // The quota may have been renewed after the initial scan. Re-read under a
    // transaction; never erase a live counter belonging to a new window.
    if (await db().runTransaction(async tx => {
      const latest = (await tx.get(snapshot.ref)).data() as { expiresAt?: string } | undefined;
      if (!latest || !latest.expiresAt || latest.expiresAt > cutoff) return false;
      tx.delete(snapshot.ref);
      return true;
    })) removed++;
  }
  return removed;
}

export async function createStaticChallenge(token: string, clientIp = "unknown") {
  const invite = await getStaticInvite(token);
  if (!inviteActive(invite) || !invite) throw new Error("Посилання завершило дію або відкликане.");
  if (!await claimStaticChallengeQuota(invite.id, clientIp)) throw new StaticChallengeRateLimitError();
  const settings = await getStaticSettings();
  if (!settings.memberRoleId || !settings.text) throw new Error("Правила або роль Статика ще не налаштовані.");
  const code = randomBytes(9).toString("hex").toUpperCase();
  const verifier = secret();
  const createdAt = nowIso();
  const expiresAt = new Date(Math.min(Date.now() + CHALLENGE_MS, Date.parse(invite.expiresAt))).toISOString();
  const data: StaticChallenge = { inviteId: invite.id, version: settings.version, createdAt, expiresAt, status: "pending", verifierHash: digest(verifier) };
  await db().collection(CHALLENGES).doc(digest(code)).set(data);
  return { code, verifier, expiresAt };
}

export async function staticChallengeStatus(code: string, verifier: string) {
  if (!/^[0-9A-F]{18}$/.test(code) || !/^[a-zA-Z0-9_-]{40,90}$/.test(verifier)) return null;
  const doc = (await db().collection(CHALLENGES).doc(digest(code)).get()).data() as StaticChallenge | undefined;
  if (!doc || !safeHashEqual(doc.verifierHash, digest(verifier))) return null;
  return { status: doc.status, expiresAt: doc.expiresAt, message: doc.message || null, userId: doc.status === "completed" ? doc.userId : undefined };
}

function safeHashEqual(left: string, right: string) {
  if (!/^[a-f0-9]{64}$/.test(left) || !/^[a-f0-9]{64}$/.test(right)) return false;
  return timingSafeEqual(Buffer.from(left, "hex"), Buffer.from(right, "hex"));
}

export async function confirmStaticChallenge(codeInput: string, userIdInput: string) {
  const code = codeInput.toUpperCase().trim();
  const userId = snowflake(userIdInput);
  if (!/^[0-9A-F]{18}$/.test(code) || !userId) return { ok: false, message: "Невірний код Статика." };
  const ref = db().collection(CHALLENGES).doc(digest(code));
  const raw = (await ref.get()).data() as StaticChallenge | undefined;
  if (!raw || Date.parse(raw.expiresAt) <= Date.now()) return { ok: false, message: "Код відсутній або завершив дію." };
  if (raw.status === "completed") return { ok: raw.userId === userId, message: raw.userId === userId ? "Підтвердження вже завершено." : "Цей код уже використано." };
  if (raw.userId && raw.userId !== userId) return { ok: false, message: "Цей код уже привʼязаний до іншого Discord-акаунта." };
  if (raw.status === "processing") return { ok: false, message: "Запит уже обробляється. Зачекай." };
  const inviteDoc = (await db().collection(INVITES).doc(raw.inviteId).get()).data() as StaticInvite | undefined;
  if (!inviteActive(inviteDoc || null)) return { ok: false, message: "Запрошення вже недійсне." };
  const settings = await getStaticSettings();
  if (!settings.memberRoleId || !settings.text || settings.version !== raw.version) return { ok: false, message: "Правила змінилися. Відкрий посилання та погодься повторно." };
  const member = await fetchDiscordGuildMemberSnapshot(userId).catch(() => null);
  if (!member?.joinedAt) return { ok: false, message: "Роль видається лише учасникам Discord-сервера." };
  const previous = (await db().collection(MEMBERS).doc(userId).get()).data() as StaticMember | undefined;
  if (previous?.blocked || staticBanActive(previous)) return { ok: false, message: staticBanActive(previous) ? `Вступ заблоковано до ${previous?.banUntil}. Три порушення.` : "Доступ до Статика відкликано. Звернись до РЛ." };
  await assertDiscordRolesManageable([settings.memberRoleId]);
  // Claim the challenge atomically so two DM confirmations cannot grant two different accounts.
  const claimed = await db().runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    const current = snap.data() as StaticChallenge | undefined;
    if (!current || (current.status !== "pending" && current.status !== "failed") || (current.userId && current.userId !== userId) || Date.parse(current.expiresAt) <= Date.now()) return false;
    tx.update(ref, { status: "processing", userId, message: "Видаємо роль…" });
    return true;
  });
  if (!claimed) return { ok: false, message: "Код уже використовується." };
  try {
    // Recheck revocation immediately before Discord mutation.
    const [freshInvite, freshMember] = await Promise.all([
      db().collection(INVITES).doc(raw.inviteId).get(), db().collection(MEMBERS).doc(userId).get(),
    ]);
    if (!inviteActive(freshInvite.data() as StaticInvite | null) || (freshMember.data() as StaticMember | undefined)?.blocked || staticBanActive(freshMember.data() as StaticMember | undefined)) throw new Error("Запрошення або доступ відкликано.");
    await addGuildMemberRoles({ guildId: getDiscordGuildId(), userId, roleIds: [settings.memberRoleId], reason: `Static rules v${settings.version} accepted via DM` });
    const acceptedAt = nowIso();
    const membership = db().collection(MEMBERS).doc(userId);
    const stored = await db().runTransaction(async (tx) => {
      const latest = (await tx.get(membership)).data() as StaticMember | undefined;
      if (latest?.blocked || staticBanActive(latest)) return false;
      // Strikes remain visible until a completed timed suspension and re-acceptance.
      const finishedBan = Boolean(latest?.banUntil && !staticBanActive(latest));
      tx.set(membership, { ...latest, userId, name: member.displayName, status: "active", blocked: false, version: settings.version, acceptedAt, removedAt: null, removedBy: null, violations: finishedBan ? [] : (latest?.violations || []), banUntil: null, banReason: null });
      return true;
    });
    if (!stored) {
      await removeGuildMemberRoles({ guildId: getDiscordGuildId(), userId, roleIds: [settings.memberRoleId], reason: "Static membership revoked during acceptance" });
      throw new Error("РЛ відкликав доступ до Статика.");
    }
    await ref.update({ status: "completed", userId, message: "Роль Статик видана." });
    await staticAudit("member.accepted", userId, { version: settings.version, inviteId: raw.inviteId }).catch(() => null);
    return { ok: true, message: "Правила Статика прийнято. Роль успішно видана!" };
  } catch (error) {
    await ref.update({ status: "failed", message: "Не вдалося видати роль. Повтори код або звернись до РЛ." });
    return { ok: false, message: error instanceof Error ? `Не вдалося завершити: ${error.message}` : "Помилка видачі ролі." };
  }
}

export async function removeStaticMember(userId: string, actorId: string) {
  if (!snowflake(userId)) throw new Error("Недійсний Discord ID.");
  const settings = await getStaticSettings();
  if (!settings.memberRoleId) throw new Error("Роль Статика не налаштовано.");
  // Persist the block first: re-acceptance is denied even if Discord temporarily fails.
  const ref = db().collection(MEMBERS).doc(userId);
  const prev = (await ref.get()).data() as StaticMember | undefined;
  await ref.set({ ...prev, userId, name: prev?.name || userId, status: "removed", blocked: true, version: prev?.version || 0, acceptedAt: prev?.acceptedAt || null, removedAt: nowIso(), removedBy: actorId });
  await staticAudit("member.removed", actorId, { userId });
  await removeGuildMemberRoles({ guildId: getDiscordGuildId(), userId, roleIds: [settings.memberRoleId], reason: `Removed from static by ${actorId}` });
}

export async function unblockStaticMember(userId: string, actorId: string) {
  if (!snowflake(userId)) throw new Error("Недійсний Discord ID.");
  const ref = db().collection(MEMBERS).doc(userId);
  const doc = await ref.get();
  if (!doc.exists) throw new Error("Учасника не знайдено.");
  await ref.update({ blocked: false });
  await staticAudit("member.unblocked", actorId, { userId });
}
