import "server-only";

/** Evaluate time-sensitive cache metadata on the server, before presenting it. */
export function isGuildRosterCacheFresh(updatedAt: string | null | undefined, now = Date.now()) {
  const updatedMs = Date.parse(updatedAt || "");
  return !Number.isFinite(updatedMs) || now - updatedMs < 72 * 60 * 60_000;
}
