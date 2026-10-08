import "server-only";

import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import type { DashboardSession } from "@/lib/auth";
import { getFirebaseAdminDb } from "@/lib/firebaseAdmin";
import { addGuildMemberRoles, assertDiscordRolesManageable, fetchDiscordGuildMemberSnapshot, fetchDiscordGuildSnapshot, fetchDiscordRoleControlSnapshot, getDiscordGuildId, removeGuildMemberRoles } from "@/lib/discordAdmin";
import { isDashboardAdmin } from "@/lib/permissions";

const SETTINGS = "staticRulesConfig";
const INVITES = "staticRulesInvites";
const CHALLENGES = "staticRulesChallenges";
const MEMBERS = "staticRulesMembers";
const HISTORY = "staticRulesAudit";
const DAY_MS = 24 * 60 * 60 * 1000;
const CHALLENGE_MS = 10 * 60 * 1000;
const snowflake = (value: unknown) => /^\d{16,25}$/.test(String(value || "")) ? String(value) : "";
const digest = (value: string) => createHash("sha256").update(value).digest("hex");
const secret = (length = 32) => randomBytes(length).toString("base64url");
const nowIso = () => new Date().toISOString();
const db = () => getFirebaseAdminDb();

export type StaticSettings = { text: string; version: number; updatedAt: string | null; memberRoleId: string; managerRoleId: string };
export type StaticInvite = { id: string; createdAt: string; expiresAt: string; createdBy: string; revokedAt: string | null };
export type StaticMember = { userId: string; name: string; status: "active" | "removed"; blocked: boolean; acceptedAt: string | null; version: number; removedAt: string | null; removedBy: string | null };
export type StaticChallenge = { inviteId: string; version: number; createdAt: string; expiresAt: string; status: "pending" | "processing" | "completed" | "failed"; verifierHash: string; userId?: string; message?: string };

export async function getStaticSettings(): Promise<StaticSettings> {
  const data = (await db().collection(SETTINGS).doc("main").get()).data() || {};
  return {
    text: String(data.text || ""),
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

export async function createStaticChallenge(token: string) {
  const invite = await getStaticInvite(token);
  if (!inviteActive(invite) || !invite) throw new Error("Посилання завершило дію або відкликане.");
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
  if (previous?.blocked) return { ok: false, message: "Доступ до Статика відкликано. Звернись до РЛ." };
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
    if (!inviteActive(freshInvite.data() as StaticInvite | null) || (freshMember.data() as StaticMember | undefined)?.blocked) throw new Error("Запрошення або доступ відкликано.");
    await addGuildMemberRoles({ guildId: getDiscordGuildId(), userId, roleIds: [settings.memberRoleId], reason: `Static rules v${settings.version} accepted via DM` });
    const acceptedAt = nowIso();
    const membership = db().collection(MEMBERS).doc(userId);
    const stored = await db().runTransaction(async (tx) => {
      const latest = (await tx.get(membership)).data() as StaticMember | undefined;
      if (latest?.blocked) return false;
      tx.set(membership, { userId, name: member.displayName, status: "active", blocked: false, version: settings.version, acceptedAt, removedAt: null, removedBy: null });
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
  await ref.set({ userId, name: prev?.name || userId, status: "removed", blocked: true, version: prev?.version || 0, acceptedAt: prev?.acceptedAt || null, removedAt: nowIso(), removedBy: actorId });
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
