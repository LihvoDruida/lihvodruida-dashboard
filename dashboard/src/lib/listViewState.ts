import { guildRosterViewParams } from "@/lib/guildRosterViewState";

export type ListKind = "profiles" | "applications" | "raids" | "polls" | "guild";
export const LIST_MEMORY_TTL = 24 * 60 * 60 * 1000;
export type ListPosition = { url: string; row: string; next: string; previous: string; offset: number; scroll: number; at: number; opened: boolean };
export type SavedListView = { name: string; url: string };
export type ListMemory = { version: 1; at: number; last: string; positions: ListPosition[]; views: SavedListView[] };

function clean(value: string | null, limit: number) {
  return String(value || "").normalize("NFC").replace(/[\u0000-\u001f\u007f]/g, " ").trim().slice(0, limit);
}

// Only locally generated list URLs can be restored. This is not an access check:
// directory cursors and every record remain authorized by their server routes.
export function listViewUrl(kind: ListKind, input: string, includeCursor = true): string | null {
  if (typeof input !== "string" || input.length > 4096 || !input.startsWith(`/${kind}`)) return null;
  const url = new URL(input, "https://list.invalid");
  if (url.origin !== "https://list.invalid" || url.pathname !== `/${kind}`) return null;
  if (kind === "guild") {
    const query = guildRosterViewParams(url.searchParams, includeCursor).toString();
    return `/guild${query ? `?${query}` : ""}`;
  }
  const params = new URLSearchParams();
  const q = clean(url.searchParams.get("q"), kind === "profiles" ? 120 : 160);
  if (q) params.set("q", q);
  if (kind === "profiles") {
    for (const [key, allowed] of [["link", ["linked", "unlinked"]], ["role", ["admin", "moderator", "mentor", "member"]], ["sort", ["name", "characters"]]] as const) {
      const value = url.searchParams.get(key);
      if (value && (allowed as readonly string[]).includes(value)) params.set(key, value);
    }
    const cursor = url.searchParams.get("cursor");
    if (includeCursor && cursor && /^[\w-]{1,1800}$/.test(cursor)) params.set("cursor", cursor);
  } else if (kind === "applications") {
    const status = url.searchParams.get("status");
    if (status && ["review", "accepted", "declined"].includes(status)) params.set("status", status);
    const className = clean(url.searchParams.get("class"), 80);
    if (className && className !== "all") params.set("class", className);
    if (url.searchParams.get("sort") === "updated") params.set("sort", "updated");
  }
  if (kind === "raids") {
    const state = url.searchParams.get("state");
    if (state && ["active", "draft", "closed"].includes(state)) params.set("state", state);
    const count = Number(url.searchParams.get("archive"));
    if (includeCursor && Number.isFinite(count) && count > 6) params.set("archive", String(Math.min(120, Math.floor(count))));
  }
  if (kind === "polls") {
    const tab = url.searchParams.get("tab");
    if (tab && ["all", "scheduled", "open", "paused", "closed"].includes(tab)) params.set("tab", tab);
  }
  const query = params.toString();
  return `/${kind}${query ? `?${query}` : ""}`;
}

export function listEntryId(kind: ListKind, value: string | number): string {
  // Encode every code point rather than stripping/truncating to avoid collisions.
  return `${kind}-entry-${Array.from(String(value)).map(char => char.codePointAt(0)!.toString(16)).join("-")}`;
}

export function listMemoryKey(kind: ListKind, scope: string) {
  return `mistblossom:list-view:v1:${kind}:${scope}`;
}

export function emptyListMemory(kind: ListKind, now = Date.now()): ListMemory {
  return { version: 1, at: now, last: `/${kind}`, positions: [], views: [] };
}

export function parseListMemory(kind: ListKind, raw: string | null, now = Date.now()): ListMemory {
  if (raw === null) return emptyListMemory(kind, now);
  if (raw.length > 65536) throw new Error("Invalid list memory");
  const value = JSON.parse(raw);
  if (!value || value.version !== 1 || !Number.isFinite(value.at) || value.at > now + 60000 || !Array.isArray(value.positions) || !Array.isArray(value.views)) throw new Error("Invalid list memory");
  if (now - value.at > LIST_MEMORY_TTL) return emptyListMemory(kind, now);
  const last = listViewUrl(kind, value.last);
  if (!last) throw new Error("Invalid list URL");
  const positions: ListPosition[] = [];
  for (const item of value.positions.slice(0, 8)) {
    const url = listViewUrl(kind, item?.url);
    if (!url || !Number.isFinite(item.at) || item.at > now + 60000 || now - item.at > LIST_MEMORY_TTL || !Number.isFinite(item.offset) || !Number.isFinite(item.scroll)) continue;
    const row = (input: unknown) => typeof input === "string" && new RegExp(`^${kind}-entry-[a-f0-9-]{1,1024}$`).test(input) ? input : "";
    positions.push({ url, row: row(item.row), next: row(item.next), previous: row(item.previous), offset: Math.max(-10000, Math.min(10000, item.offset)), scroll: Math.max(0, Math.min(10000000, item.scroll)), at: item.at, opened: item.opened === true });
  }
  const views: SavedListView[] = [];
  for (const item of value.views.slice(0, 5)) {
    const url = listViewUrl(kind, item?.url, false);
    const name = typeof item?.name === "string" ? clean(item.name, 40) : "";
    if (url && name && !views.some(view => view.name === name)) views.push({ name, url });
  }
  return { version: 1, at: value.at, last, positions, views };
}

export function rememberListPosition(memory: ListMemory, position: ListPosition): ListMemory {
  return { ...memory, at: position.at, last: position.url, positions: [position, ...memory.positions.filter(item => item.url !== position.url)].slice(0, 8) };
}

export function listReturnUrl(kind: ListKind, memory: ListMemory): string {
  const url = listViewUrl(kind, memory.last) || `/${kind}`;
  const position = memory.positions.find(item => item.url === url);
  return `${url}${position?.row ? `#${position.row}` : ""}`;
}
