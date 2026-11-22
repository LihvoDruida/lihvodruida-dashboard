import "server-only";

import { fetchDiscordGuildSnapshot } from "@/lib/discordAdmin";
import { getProfileByDiscordUserId, type ProfileCharacter } from "@/lib/profiles";
import { orderProfileCharacters } from "@/lib/profileCharacterOrder";
import { characterEdition } from "@/lib/wowEdition";

/** Public card of one of the server owner's characters, as shown on the public site. */
export type PublicOwnerCharacter = {
  name: string;
  isMain: boolean;
  edition: "retail" | "forever";
  className: string | null;
  specName: string | null;
  raceName: string | null;
  realm: string;
  region: string;
  level: number | null;
  itemLevel: number | null;
  /** Retail only: Raider.IO does not cover WoW Forever. */
  rio: number | null;
  avatarUrl: string | null;
  link: string;
};

export type PublicOwnerSnapshot = {
  schema: "mistblossom.public-owner.v1";
  generated_at: string;
  updated_at: string | null;
  characters: PublicOwnerCharacter[];
};

const OWNER_ID_TTL_MS = 60 * 60_000;
const SNAPSHOT_TTL_MS = 60_000;
const MAX_PUBLIC_CHARACTERS = 12;
let ownerCache: { id: string | null; at: number } | null = null;
let snapshotCache: { value: PublicOwnerSnapshot; at: number } | null = null;

async function ownerDiscordId() {
  const override = String(process.env.PUBLIC_SITE_OWNER_DISCORD_ID || "").trim();
  if (/^\d{16,25}$/.test(override)) return override;
  if (ownerCache && Date.now() - ownerCache.at < OWNER_ID_TTL_MS) return ownerCache.id;
  const guild = await fetchDiscordGuildSnapshot();
  ownerCache = { id: guild.ownerId || null, at: Date.now() };
  return ownerCache.id;
}

function httpsUrl(value?: string | null) {
  const text = String(value || "").trim();
  return /^https:\/\/[^\s"'<>]+$/.test(text) ? text.slice(0, 500) : null;
}

function publicCharacter(character: ProfileCharacter): PublicOwnerCharacter {
  const edition = characterEdition(character);
  const score = character.raiderIo?.currentScore;
  const rio = edition === "retail" && typeof score === "number" && score > 0 ? Math.round(score) : null;
  const link = edition === "retail"
    ? httpsUrl(character.raiderIo?.profileUrl) || httpsUrl(character.profileUrl) || ""
    : httpsUrl(character.profileUrl) || "";
  return {
    name: character.name,
    isMain: Boolean(character.isMain),
    edition,
    className: character.className || null,
    specName: character.activeSpecName || null,
    raceName: character.raceName || null,
    realm: edition === "forever" ? "WoW Forever" : character.realmName || character.realmSlug,
    region: character.region,
    level: typeof character.level === "number" ? character.level : null,
    itemLevel: typeof character.itemLevel === "number" ? Math.round(character.itemLevel) : null,
    rio,
    avatarUrl: httpsUrl(character.avatarUrl),
    link,
  };
}

/**
 * Characters of the Discord server owner in their saved order (main first) for the
 * public site's "behind the scenes" block. Only public game data leaves the panel.
 */
export async function buildPublicOwnerSnapshot(): Promise<PublicOwnerSnapshot> {
  if (snapshotCache && Date.now() - snapshotCache.at < SNAPSHOT_TTL_MS) return snapshotCache.value;
  const ownerId = await ownerDiscordId();
  const profile = ownerId ? await getProfileByDiscordUserId(ownerId) : null;
  const characters = profile
    ? orderProfileCharacters(profile.characters, profile.characterOrder, profile.mainCharacterKey).slice(0, MAX_PUBLIC_CHARACTERS).map(publicCharacter)
    : [];
  const value: PublicOwnerSnapshot = {
    schema: "mistblossom.public-owner.v1",
    generated_at: new Date().toISOString(),
    updated_at: profile?.battlenet?.lastCharacterRefreshAt || profile?.battlenet?.lastSyncAt || profile?.updatedAt || null,
    characters,
  };
  snapshotCache = { value, at: Date.now() };
  return value;
}

/** Called after the owner reorders characters so the site sees it on the next poll. */
export function invalidatePublicOwnerSnapshot() {
  snapshotCache = null;
}
