import "server-only";
import { getFirebaseAdminDb } from "@/lib/firebaseAdmin";

export const DISCORD_NOTIFICATION_PREFERENCES = "discordNotificationPreferences";
export type RaidReminderPreference = { enabled: boolean; revision: number };

export function raidReminderPreference(data?: Record<string, unknown> | null): RaidReminderPreference {
  return { enabled: data?.raidReminderDmEnabled !== false, revision: Number.isSafeInteger(data?.revision) ? Number(data?.revision) : 0 };
}

export async function getRaidReminderPreference(discordId: string): Promise<RaidReminderPreference> {
  if (!/^\d{16,25}$/.test(discordId)) throw new Error("Некоректний Discord ID.");
  const snapshot = await getFirebaseAdminDb().collection(DISCORD_NOTIFICATION_PREFERENCES).doc(discordId).get();
  return raidReminderPreference(snapshot.data());
}

// Reads precede every transaction write, for PostgreSQL and Firestore alike.
// The returned closure joins the caller's signup transaction: a preference can
// never be acknowledged without the corresponding durable signup commit.
export async function prepareRaidReminderPreferenceWrite(
  transaction: any, discordId: string, enabled: boolean, profileId?: string | null, expectedRevision?: number,
) {
  if (!/^\d{16,25}$/.test(discordId) || typeof enabled !== "boolean") throw new Error("Некоректне налаштування нагадування.");
  const db = getFirebaseAdminDb();
  const ref = db.collection(DISCORD_NOTIFICATION_PREFERENCES).doc(discordId);
  const snapshot = await transaction.get(ref);
  const current = raidReminderPreference(snapshot.data());
  if (expectedRevision !== undefined && current.revision !== expectedRevision) throw new Error("Налаштування нагадування вже змінилося. Відкрий меню рейду ще раз.");
  const linkedProfileId = profileId || String(snapshot.data()?.profileId || "");
  const profileRef = /^id[a-f0-9]{16,40}$/.test(linkedProfileId) ? db.collection("dashboardProfiles").doc(linkedProfileId) : null;
  const profile = profileRef ? await transaction.get(profileRef) : null;
  const ownProfile = profile?.exists && profile.data()?.provider === "discord" && profile.data()?.providerUserId === discordId;
  const revision = current.revision + (!snapshot.exists || current.enabled !== enabled ? 1 : 0);
  return () => {
    transaction.set(ref, { discordId, ...(ownProfile ? { profileId: linkedProfileId } : {}), raidReminderDmEnabled: enabled, revision, updatedAt: new Date().toISOString() }, { merge: true });
    if (profileRef && ownProfile) transaction.set(profileRef, { raidReminderDmEnabled: enabled }, { merge: true });
  };
}

export async function setRaidReminderPreference(discordId: string, enabled: boolean, profileId?: string | null) {
  await getFirebaseAdminDb().runTransaction(async (transaction) => {
    const write = await prepareRaidReminderPreferenceWrite(transaction, discordId, enabled, profileId);
    write();
  });
  return { enabled };
}
