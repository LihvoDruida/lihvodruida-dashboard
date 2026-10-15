import "server-only";
import { createHash } from "node:crypto";
import {
  getDocumentDb,
  hasDocumentDbConfig,
} from "@/lib/documentDb";
import { FieldValue } from "@/lib/db/documentValues";
import {
  assertNoProfileCharacterConflicts,
  getMainCharacter,
  invalidateProfileIdentityCaches,
  normalizeProfile,
  type DashboardProfile,
  type ProfileCharacter,
} from "@/lib/profiles";
import { normalizeCharacterKey } from "@/lib/wowCharacters";
import { resolveWowCharacterRole } from "@/lib/wowRoles";
import type {
  CharacterSetupChoice,
  CharacterSetupReceipt,
  CharacterSetupRequest,
  CharacterSetupState,
} from "@/lib/profileCharacterSetupSchema";

const hash = (value: unknown) =>
  createHash("sha256").update(JSON.stringify(value)).digest("hex");
export class ProfileCharacterSetupError extends Error {
  constructor(
    message: string,
    public readonly status = 400,
  ) {
    super(message);
  }
}
function refFor(profileId: string) {
  if (!/^id[a-f0-9]{16,40}$/.test(profileId))
    throw new ProfileCharacterSetupError("Некоректний профіль.");
  if (!hasDocumentDbConfig())
    throw new ProfileCharacterSetupError("Профілі тимчасово недоступні.", 503);
  return getDocumentDb().collection("dashboardProfiles").doc(profileId);
}
function choice(character: ProfileCharacter): CharacterSetupChoice {
  return {
    key: character.key,
    name: character.name,
    realm: character.realmName || character.realmSlug || "Реалм —",
    className: character.className || "Клас невідомий",
    spec: character.activeSpecName || "",
    role: resolveWowCharacterRole(character),
    guild: Boolean(character.verifiedGuild),
  };
}
function revision(profile: DashboardProfile, data: Record<string, unknown>) {
  const ordered = (items: ProfileCharacter[]) =>
    items.map(choice).sort((a, b) => a.key.localeCompare(b.key));
  return hash([
    data.characterSetupRevision || null,
    profile.provider,
    profile.providerUserId,
    ordered(profile.characters),
    getMainCharacter(profile)?.key || "",
    profile.raidRolePreference?.characterKey || null,
    profile.raidRolePreference?.role || null,
    ordered(profile.battlenet?.candidateCharacters || []),
    profile.battlenet?.candidateExpiresAt || null,
  ]);
}
function view(
  profileId: string,
  data: Record<string, unknown>,
): CharacterSetupState {
  const profile = normalizeProfile(profileId, data);
  const main = getMainCharacter(profile)?.key || "";
  const added = new Set(profile.characters.map((c) => c.key));
  const receipt = data.characterSetupReceipt as
    (CharacterSetupReceipt & { requestHash: string }) | undefined;
  return {
    revision: revision(profile, data),
    characters: profile.characters.map(choice),
    candidates: (profile.battlenet?.candidateCharacters || [])
      .filter((c) => !added.has(c.key))
      .map(choice),
    expiresAt: profile.battlenet?.candidateExpiresAt || null,
    mainCharacterKey: main,
    raidRole:
      profile.raidRolePreference?.characterKey === main
        ? profile.raidRolePreference.role || "auto"
        : "auto",
    receipt: receipt
      ? {
          operationId: receipt.operationId,
          revision: receipt.revision,
          addedKeys: receipt.addedKeys,
          duplicateKeys: receipt.duplicateKeys,
          mainCharacterKey: receipt.mainCharacterKey,
          raidRole: receipt.raidRole,
        }
      : null,
  };
}
function request(input: Record<string, unknown>): CharacterSetupRequest {
  if (
    typeof input.operationId !== "string" ||
    !/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(
      input.operationId,
    )
  )
    throw new ProfileCharacterSetupError("Некоректна операція.");
  if (
    typeof input.expectedRevision !== "string" ||
    !/^[a-f0-9]{64}$/.test(input.expectedRevision)
  )
    throw new ProfileCharacterSetupError("Спочатку онови стан профілю.", 428);
  if (
    !Array.isArray(input.characterKeys) ||
    input.characterKeys.length > 200 ||
    input.characterKeys.some(
      (key) =>
        typeof key !== "string" ||
        key.length > 160 ||
        !normalizeCharacterKey(key),
    )
  )
    throw new ProfileCharacterSetupError("Некоректний список персонажів.");
  const main =
    typeof input.mainCharacterKey === "string" &&
    input.mainCharacterKey.length <= 160
      ? normalizeCharacterKey(input.mainCharacterKey)
      : "";
  if (!main)
    throw new ProfileCharacterSetupError("Вибери мейна перед збереженням.");
  if (
    typeof input.raidRole !== "string" ||
    !["auto", "tank", "healer", "dps"].includes(input.raidRole)
  )
    throw new ProfileCharacterSetupError("Вибери коректну рейдову роль.");
  return {
    operationId: input.operationId,
    expectedRevision: input.expectedRevision,
    characterKeys: Array.from(
      new Set(input.characterKeys.map(normalizeCharacterKey)),
    ).sort(),
    mainCharacterKey: main,
    raidRole: input.raidRole as CharacterSetupRequest["raidRole"],
  };
}
export async function getProfileCharacterSetupState(profileId: string) {
  const snapshot = await refFor(profileId).get();
  if (!snapshot.exists)
    throw new ProfileCharacterSetupError("Профіль не знайдено.", 404);
  return view(profileId, snapshot.data() || {});
}
export async function saveProfileCharacterSetup(
  profileId: string,
  input: Record<string, unknown>,
) {
  const wanted = request(input),
    ref = refFor(profileId),
    requestHash = hash(wanted);
  const prior = await ref.get();
  if (!prior.exists)
    throw new ProfileCharacterSetupError("Профіль не знайдено.", 404);
  const data: Record<string, any> = prior.data() || {};
  // Exact replays are read-only, including after candidates have been consumed.
  if (data.characterSetupReceipt?.operationId === wanted.operationId) {
    if (data.characterSetupReceipt.requestHash !== requestHash)
      throw new ProfileCharacterSetupError(
        "Дані цієї операції змінилися.",
        409,
      );
    return view(profileId, data);
  }
  const before = normalizeProfile(profileId, data);
  if (revision(before, data) !== wanted.expectedRevision)
    throw new ProfileCharacterSetupError(
      "Профіль або список Battle.net змінився. Онови стан і перевір вибір.",
      409,
    );
  const candidates = new Map(
    (before.battlenet?.candidateCharacters || []).map((c) => [c.key, c]),
  );
  const existing = new Set(before.characters.map((c) => c.key));
  const selected = wanted.characterKeys
    .filter((key) => !existing.has(key))
    .map((key) => {
      const candidate = candidates.get(key);
      if (!candidate)
        throw new ProfileCharacterSetupError(
          "Список Battle.net застарів або персонаж не підтверджений. Онови список.",
          410,
        );
      return candidate;
    });
  if (
    !existing.has(wanted.mainCharacterKey) &&
    !selected.some((character) => character.key === wanted.mainCharacterKey)
  )
    throw new ProfileCharacterSetupError(
      "Мейн має бути вже доданим або вибраним у цьому списку.",
    );
  // Preserve the existing cross-profile ownership policy; no external API is called.
  if (selected.length) {
    try {
      await assertNoProfileCharacterConflicts(profileId, selected);
    } catch (error) {
      if ((error as Error)?.name === "ProfileCharacterConflictError")
        throw new ProfileCharacterSetupError(
          "Один із вибраних персонажів уже привʼязаний до іншого профілю. Перевір вибір.",
          409,
        );
      throw error;
    }
  }
  const state = await getDocumentDb().runTransaction(
    async (transaction: any) => {
      const snapshot = await transaction.get(ref);
      if (!snapshot.exists)
        throw new ProfileCharacterSetupError("Профіль не знайдено.", 404);
      const raw = snapshot.data() || {};
      if (raw.characterSetupReceipt?.operationId === wanted.operationId) {
        if (raw.characterSetupReceipt.requestHash !== requestHash)
          throw new ProfileCharacterSetupError(
            "Дані цієї операції змінилися.",
            409,
          );
        return view(profileId, raw);
      }
      const profile = normalizeProfile(profileId, raw);
      if (revision(profile, raw) !== wanted.expectedRevision)
        throw new ProfileCharacterSetupError(
          "Профіль або список Battle.net змінився. Онови стан і перевір вибір.",
          409,
        );
      const available = new Map(
        (profile.battlenet?.candidateCharacters || []).map((c) => [c.key, c]),
      );
      const nextCharacters = [...profile.characters],
        keys = new Set(nextCharacters.map((c) => c.key));
      // Attempt-local results: a retried transaction cannot inflate counts.
      const addedKeys: string[] = [],
        duplicateKeys: string[] = [],
        now = new Date().toISOString();
      for (const key of wanted.characterKeys) {
        if (keys.has(key)) {
          duplicateKeys.push(key);
          continue;
        }
        const candidate = available.get(key);
        if (!candidate)
          throw new ProfileCharacterSetupError(
            "Список Battle.net застарів. Онови список перед збереженням.",
            410,
          );
        nextCharacters.push({
          ...candidate,
          addedAt: now,
          lastSeenAt: candidate.lastSeenAt || now,
        });
        keys.add(key);
        addedKeys.push(key);
      }
      if (!keys.has(wanted.mainCharacterKey))
        throw new ProfileCharacterSetupError(
          "Мейн має бути вже доданим або вибраним у цьому списку.",
        );
      const remaining = (profile.battlenet?.candidateCharacters || []).filter(
        (c) => !wanted.characterKeys.includes(c.key),
      );
      const raidRolePreference =
        wanted.raidRole === "auto"
          ? null
          : {
              characterKey: wanted.mainCharacterKey,
              role: wanted.raidRole,
              updatedAt: now,
            };
      const nextRaw = {
        ...raw,
        characters: nextCharacters,
        mainCharacterKey: wanted.mainCharacterKey,
        nicknameCharacterKeys: (profile.nicknameCharacterKeys || [])
          .filter((key) => key !== wanted.mainCharacterKey && keys.has(key))
          .slice(0, 2),
        raidRolePreference,
        characterSetupRevision: wanted.operationId,
        battlenet: {
          ...(raw.battlenet || {}),
          candidateCharacters: remaining,
          candidateSavedAt: remaining.length
            ? raw.battlenet?.candidateSavedAt
            : null,
          candidateExpiresAt: remaining.length
            ? raw.battlenet?.candidateExpiresAt
            : null,
        },
      };
      const next = view(profileId, nextRaw);
      const receipt = {
        operationId: wanted.operationId,
        requestHash,
        revision: next.revision,
        addedKeys,
        duplicateKeys,
        mainCharacterKey: wanted.mainCharacterKey,
        raidRole: wanted.raidRole,
      };
      transaction.set(
        ref,
        {
          characters: nextCharacters,
          mainCharacterKey: nextRaw.mainCharacterKey,
          nicknameCharacterKeys: nextRaw.nicknameCharacterKeys,
          raidRolePreference: raidRolePreference || FieldValue.delete(),
          characterSetupRevision: wanted.operationId,
          characterSetupReceipt: receipt,
          battlenet: {
            candidateCharacters: remaining.length
              ? remaining
              : FieldValue.delete(),
            candidateSavedAt: remaining.length
              ? raw.battlenet?.candidateSavedAt
              : FieldValue.delete(),
            candidateExpiresAt: remaining.length
              ? raw.battlenet?.candidateExpiresAt
              : FieldValue.delete(),
          },
          updatedAt: FieldValue.serverTimestamp(),
        },
        { merge: true },
      );
      return { ...next, receipt };
    },
  );
  invalidateProfileIdentityCaches(profileId);
  return state;
}
