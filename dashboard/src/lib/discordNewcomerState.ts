import "server-only";

import { getFirebaseAdminDb, hasFirebaseProfileConfig } from "@/lib/firebaseAdmin";
import { timestampToIso } from "@/lib/values";

export const DISCORD_NEWCOMER_MEMBER_COLLECTION = "discordNewcomerOnboardingMembers";

function cleanSnowflake(value: unknown) {
  const text = String(value || "").trim();
  return /^\d{16,25}$/.test(text) ? text : "";
}

export async function loadDiscordNewcomerRulesAccepted(userIdsInput: unknown[]) {
  const result = new Map<string, string | null>();
  if (!hasFirebaseProfileConfig()) return result;
  const userIds = Array.from(new Set(userIdsInput.map(cleanSnowflake).filter(Boolean)));
  const db = getFirebaseAdminDb();
  for (let index = 0; index < userIds.length; index += 250) {
    const refs = userIds.slice(index, index + 250).map((id) => db.collection(DISCORD_NEWCOMER_MEMBER_COLLECTION).doc(id));
    const snapshots = await db.getAll(...refs);
    for (const snapshot of snapshots as any[]) {
      if (!snapshot?.exists) continue;
      const id = cleanSnowflake(snapshot.id);
      if (!id) continue;
      result.set(id, timestampToIso(snapshot.data()?.rulesAcceptedAt));
    }
  }
  return result;
}

export async function discordNewcomerRulesAccepted(userIdInput: unknown) {
  const userId = cleanSnowflake(userIdInput);
  if (!userId) return false;
  const map = await loadDiscordNewcomerRulesAccepted([userId]);
  return Boolean(map.get(userId));
}
