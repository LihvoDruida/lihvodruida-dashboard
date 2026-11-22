import { stableTextCompare } from "@/lib/stableUiText";

/** Upper bound for a stored order: a profile never keeps more characters than this. */
export const MAX_CHARACTER_ORDER = 60;

type OrderableCharacter = { key: string; name: string; isMain?: boolean; verifiedGuild?: boolean };

/**
 * One order for every place that lists a profile's characters (panel and public site):
 * the main always comes first, then the owner's saved order. Characters missing from the
 * saved order (added later) follow it, sorted the way the panel always did:
 * guild characters first, then by name.
 */
export function orderProfileCharacters<T extends OrderableCharacter>(characters: readonly T[], order?: readonly string[] | null, mainKey?: string | null): T[] {
  const rank = new Map<string, number>();
  (order || []).forEach((key, index) => { if (!rank.has(key)) rank.set(key, index); });
  const isMain = (item: T) => (mainKey ? item.key === mainKey : Boolean(item.isMain));
  return [...characters].sort((a, b) => {
    const mainA = isMain(a), mainB = isMain(b);
    if (mainA !== mainB) return mainA ? -1 : 1;
    const rankA = rank.get(a.key), rankB = rank.get(b.key);
    if (rankA !== undefined || rankB !== undefined) {
      if (rankA === undefined) return 1;
      if (rankB === undefined) return -1;
      if (rankA !== rankB) return rankA - rankB;
    }
    if (Boolean(a.verifiedGuild) !== Boolean(b.verifiedGuild)) return a.verifiedGuild ? -1 : 1;
    return stableTextCompare(a.name, b.name);
  });
}

/**
 * Cleans a submitted order against the profile's real characters: unknown and duplicate
 * keys are dropped, the main is left out (it is always first anyway).
 */
export function cleanCharacterOrder(value: unknown, knownKeys: readonly string[], mainKey?: string | null): string[] {
  if (!Array.isArray(value)) return [];
  const known = new Set(knownKeys);
  const seen = new Set<string>();
  const result: string[] = [];
  for (const raw of value) {
    const key = typeof raw === "string" ? raw.trim() : "";
    if (!key || key === mainKey || !known.has(key) || seen.has(key)) continue;
    seen.add(key);
    result.push(key);
    if (result.length >= MAX_CHARACTER_ORDER) break;
  }
  return result;
}
