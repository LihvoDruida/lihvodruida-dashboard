import { createHash } from "node:crypto";

/** One logical welcome per membership; a rejoin gets a new nonce. */
export function discordMembershipMessageNonce(member: { guildId: string; userId: string; joinedAt?: string | null }, purpose: "welcome-dm" | "welcome-card") {
  if (!member.joinedAt || !Number.isFinite(Date.parse(member.joinedAt))) return undefined;
  return createHash("sha256").update(`${purpose}:${member.guildId}:${member.userId}:${new Date(member.joinedAt).toISOString()}`).digest("hex").slice(0, 24);
}
