const DEFAULT_TTL_MS = 6 * 60_000;
const DEFAULT_MAX_ENTRIES = 4096;

const seen = new Map();

function prune(now, maxEntries) {
  for (const [key, expiresAt] of seen) {
    if (expiresAt <= now) seen.delete(key);
  }
  while (seen.size > maxEntries) {
    const first = seen.keys().next().value;
    if (!first) break;
    seen.delete(first);
  }
}

/**
 * Claims a verified Discord interaction id for this process.
 * Returns false when the same signed interaction was already observed inside
 * Discord's timestamp acceptance window. The cache is deliberately bounded.
 */
export function claimDiscordInteractionId(
  interactionId,
  now = Date.now(),
  ttlMs = DEFAULT_TTL_MS,
  maxEntries = DEFAULT_MAX_ENTRIES,
) {
  const id = String(interactionId || "").trim();
  if (!/^\d{16,25}$/.test(id)) return false;
  prune(now, Math.max(128, Math.min(20_000, Number(maxEntries) || DEFAULT_MAX_ENTRIES)));
  const existing = seen.get(id);
  if (existing && existing > now) return false;
  const boundedTtl = Math.max(60_000, Math.min(15 * 60_000, Number(ttlMs) || DEFAULT_TTL_MS));
  seen.set(id, now + boundedTtl);
  prune(now, Math.max(128, Math.min(20_000, Number(maxEntries) || DEFAULT_MAX_ENTRIES)));
  return true;
}

export function clearDiscordInteractionReplayCacheForTests() {
  seen.clear();
}

export function discordInteractionReplayCacheSize() {
  prune(Date.now(), DEFAULT_MAX_ENTRIES);
  return seen.size;
}
