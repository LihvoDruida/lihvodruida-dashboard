import { getFirebaseAdminDb, hasFirebaseProfileConfig } from "@/lib/firebaseAdmin";
import { createStableProfileId } from "@/lib/profileIds";
import { firebaseWrite } from "@/lib/firebaseAccess";

const DASHBOARD_PROFILES_COLLECTION = "dashboardProfiles";
const PROFILE_CHARACTER_LINKS_COLLECTION = "dashboardProfileCharacterLinks";

export type DashboardProfileDeleteResult =
  | { deleted: number; profileIds: string[]; reason: "deleted" }
  | { deleted: 0; profileIds: string[]; reason: "invalid-discord-id" | "invalid-profile-id" | "firebase-not-configured" | "not-found" };

function clearProfileDerivedCaches() {
  (globalThis as typeof globalThis & { __mistblossomCharacterProfileLinksCache?: unknown }).__mistblossomCharacterProfileLinksCache = undefined;
}

function cleanProfileIds(profileIds: Iterable<unknown>) {
  return Array.from(new Set(Array.from(profileIds)
    .map((profileId) => String(profileId || "").trim())
    .filter((profileId) => /^id[a-f0-9]{16,40}$/.test(profileId))));
}

async function deleteProfileCharacterLinks(db: any, profileIds: string[]) {
  const refs = new Map<string, any>();
  for (const profileId of profileIds) {
    const snapshot = await db
      .collection(PROFILE_CHARACTER_LINKS_COLLECTION)
      .where("profileId", "==", profileId)
      .limit(500)
      .get()
      .catch(() => null);
    for (const doc of snapshot?.docs || []) refs.set(doc.id, doc.ref);
  }
  return Array.from(refs.values());
}

export async function deleteDashboardProfileById(profileId: string): Promise<boolean> {
  const result = await deleteDashboardProfilesByIds([profileId]);
  return result.deleted > 0;
}

export async function deleteDashboardProfilesByIds(profileIdsInput: Iterable<unknown>): Promise<DashboardProfileDeleteResult> {
  const profileIds = cleanProfileIds(profileIdsInput);
  if (!profileIds.length) return { deleted: 0, profileIds: [], reason: "invalid-profile-id" };
  if (!hasFirebaseProfileConfig()) {
    return { deleted: 0, profileIds: [], reason: "firebase-not-configured" };
  }

  const db = getFirebaseAdminDb();
  const refs = new Map<string, any>();
  for (const profileId of profileIds) {
    const ref = db.collection(DASHBOARD_PROFILES_COLLECTION).doc(profileId);
    const snapshot = await ref.get().catch(() => null);
    if (snapshot?.exists) refs.set(profileId, ref);
  }

  if (!refs.size) return { deleted: 0, profileIds, reason: "not-found" };

  await firebaseWrite(
    "profile",
    `profile:${Array.from(refs.keys()).join(",")}:delete`,
    async () => {
      const linkRefs = await deleteProfileCharacterLinks(db, Array.from(refs.keys()));
      const refsToDelete = [...Array.from(refs.values()), ...linkRefs];
      for (let index = 0; index < refsToDelete.length; index += 400) {
        const batch = db.batch();
        for (const ref of refsToDelete.slice(index, index + 400)) batch.delete(ref);
        await batch.commit();
      }
    },
    { timeoutMs: 8_000, logEvent: "profiles.delete_write_failed" },
  );
  clearProfileDerivedCaches();
  return { deleted: refs.size, profileIds: Array.from(refs.keys()), reason: "deleted" };
}

export async function deleteDashboardProfilesByDiscordUserId(discordUserId: string): Promise<DashboardProfileDeleteResult> {
  const cleanDiscordId = String(discordUserId || "").trim();
  if (!/^\d{16,25}$/.test(cleanDiscordId)) {
    return { deleted: 0, profileIds: [], reason: "invalid-discord-id" };
  }
  if (!hasFirebaseProfileConfig()) {
    return { deleted: 0, profileIds: [], reason: "firebase-not-configured" };
  }

  const db = getFirebaseAdminDb();
  const refs = new Map<string, any>();

  const stableProfileId = await createStableProfileId("discord", cleanDiscordId);
  const stableRef = db.collection(DASHBOARD_PROFILES_COLLECTION).doc(stableProfileId);
  const stableSnapshot = await stableRef.get().catch(() => null);
  if (stableSnapshot?.exists) refs.set(stableProfileId, stableRef);

  const byProviderUserId = await db.collection(DASHBOARD_PROFILES_COLLECTION)
    .where("providerUserId", "==", cleanDiscordId)
    .limit(50)
    .get()
    .catch(() => null);

  for (const doc of byProviderUserId?.docs || []) {
    const raw = doc.data() || {};
    if (raw.provider && raw.provider !== "discord") continue;
    refs.set(doc.id, doc.ref);
  }

  for (const field of ["discordId", "discordUserId"]) {
    const snapshot = await db.collection(DASHBOARD_PROFILES_COLLECTION)
      .where(field, "==", cleanDiscordId)
      .limit(20)
      .get()
      .catch(() => null);
    for (const doc of snapshot?.docs || []) refs.set(doc.id, doc.ref);
  }

  if (!refs.size) return { deleted: 0, profileIds: [], reason: "not-found" };

  await firebaseWrite(
    "profile",
    `profile:discord:${cleanDiscordId}:delete`,
    async () => {
      const profileIds = Array.from(refs.keys());
      const linkRefs = await deleteProfileCharacterLinks(db, profileIds);
      const refsToDelete = [...Array.from(refs.values()), ...linkRefs];
      for (let index = 0; index < refsToDelete.length; index += 400) {
        const batch = db.batch();
        for (const ref of refsToDelete.slice(index, index + 400)) batch.delete(ref);
        await batch.commit();
      }
    },
    { timeoutMs: 8_000, logEvent: "profiles.discord_delete_write_failed" },
  );
  clearProfileDerivedCaches();

  return { deleted: refs.size, profileIds: Array.from(refs.keys()), reason: "deleted" };
}
