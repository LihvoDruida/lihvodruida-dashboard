/**
 * Game edition of a character: Retail or World of Warcraft: Forever.
 * Forever characters have no realm (names are unique per region as
 * "First Surname"), so they are stored with the reserved realm slug
 * `forever`; that keeps keys stable and old records readable.
 * Pure module: safe for client components.
 */
export type WowEdition = "retail" | "forever";

export const FOREVER_REALM_SLUG = "forever";

export const WOW_EDITION_LABEL: Record<WowEdition, string> = { retail: "Retail", forever: "Forever" };

export function characterEdition(character: { edition?: unknown; realmSlug?: unknown } | null | undefined): WowEdition {
  return character?.edition === "forever" || character?.realmSlug === FOREVER_REALM_SLUG ? "forever" : "retail";
}

export function isForeverCharacter(character: { edition?: unknown; realmSlug?: unknown } | null | undefined) {
  return characterEdition(character) === "forever";
}
