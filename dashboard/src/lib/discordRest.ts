import { createHash } from "node:crypto";
const API_BASE = "https://discord.com/api/v10";
const MAX_WAIT_MS = 20_000;
type Permit = { active: number; waiters: Array<() => void> };
type ClientState = { routes: Map<string, string>; cooldowns: Map<string, number>; locks: Map<string, Permit>; global: Permit; globalUntil: number; nextStartAt: number; invalidToken: boolean };
declare global {
  // eslint-disable-next-line no-var
  var __mistblossomDiscordRestClients: Map<string, ClientState> | undefined;
}
export class DiscordRestError extends Error {
  constructor(message: string, public readonly status: number, public readonly retryAfterMs = 0) { super(message); this.name = "DiscordRestError"; }
}
export function discordCredentialKey(token: string) { return createHash("sha256").update(token).digest("hex").slice(0, 20); }
function stateFor(token: string) {
  const clients = globalThis.__mistblossomDiscordRestClients ||= new Map();
  const key = discordCredentialKey(token);
  let state = clients.get(key);
  if (!state) {
    for (const [oldKey, old] of clients) {
      if (clients.size < 4) break;
      if (!old.global.active && !old.global.waiters.length) clients.delete(oldKey);
    }
    state = { routes: new Map(), cooldowns: new Map(), locks: new Map(), global: { active: 0, waiters: [] }, globalUntil: 0, nextStartAt: 0, invalidToken: false };
    clients.set(key, state);
  }
  return state;
}
/** Discord's bucket hash excludes the channel/guild/webhook major parameter. */
export function discordRouteIdentity(path: string, method: string) {
  const pathname = path.split("?")[0];
  const parts = pathname.split("/");
  const major = /^(channels|guilds|webhooks)$/.test(parts[1]) ? `${parts[1]}:${parts[2]}` : "none";
  const normalized = parts.map((part, index) => index === 2 && major !== "none" ? ":major" : /^\d{16,25}$/.test(part) ? ":id" : part).join("/");
  return { major, route: `${method}:${normalized}:${major}` };
}
function wait(ms: number, signal: AbortSignal) {
  return new Promise<void>((resolve, reject) => {
    if (signal.aborted) { reject(signal.reason); return; }
    const abort = () => { clearTimeout(timer); reject(signal.reason); };
    const timer = setTimeout(() => { signal.removeEventListener("abort", abort); resolve(); }, ms);
    signal.addEventListener("abort", abort, { once: true });
  });
}
async function acquire(permit: Permit, limit: number, signal: AbortSignal) {
  if (signal.aborted) throw signal.reason;
  if (permit.active >= limit) {
    if (permit.waiters.length >= 128) throw new DiscordRestError("Discord API 429: черга запитів заповнена; повтори задачу пізніше.", 429, 10_000);
    await new Promise<void>((resolve, reject) => {
      const ready = () => { signal.removeEventListener("abort", abort); resolve(); };
      const abort = () => { const index = permit.waiters.indexOf(ready); if (index >= 0) permit.waiters.splice(index, 1); reject(signal.reason); };
      permit.waiters.push(ready); signal.addEventListener("abort", abort, { once: true });
    });
  } else permit.active += 1;
  return () => { const next = permit.waiters.shift(); if (next) next(); else permit.active -= 1; };
}
function prune(state: ClientState) {
  for (const [key, until] of state.cooldowns) if (until <= Date.now()) state.cooldowns.delete(key);
  for (const [key, permit] of state.locks) if (!permit.active && !permit.waiters.length) state.locks.delete(key);
  for (const [route, bucket] of state.routes) {
    if (state.routes.size <= 512) break;
    if (!state.cooldowns.has(bucket) && !state.locks.has(bucket)) state.routes.delete(route);
  }
}
function cooldown(state: ClientState, key: string, delay: number) { state.cooldowns.set(key, Math.max(state.cooldowns.get(key) || 0, Date.now() + delay)); }
function observeDiscordRateLimit(state: ClientState, response: Response, route: string, major: string) {
  const hash = response.headers.get("x-ratelimit-bucket");
  const key = hash ? `bucket:${hash}:${major}` : route;
  if (hash) { state.routes.set(route, key); const existing = state.cooldowns.get(route); if (existing) cooldown(state, key, existing - Date.now()); }
  const remaining = response.headers.get("x-ratelimit-remaining");
  const resetAfterSeconds = Number(response.headers.get("x-ratelimit-reset-after"));
  if (remaining !== null && Number(remaining) === 0 && Number.isFinite(resetAfterSeconds) && resetAfterSeconds > 0) cooldown(state, key, Math.ceil(resetAfterSeconds * 1000) + 75);
  return key;
}
async function waitForCooldown(state: ClientState, key: string, signal: AbortSignal) {
  for (;;) {
    if (state.invalidToken) throw new DiscordRestError("Discord API 401: токен бота відхилено. Онови DISCORD_BOT_TOKEN та перезапусти сервіс.", 401);
    const routeUntil = state.cooldowns.get(key) || 0;
    const globalUntil = state.globalUntil;
    const delay = Math.max(routeUntil, globalUntil) - Date.now();
    if (delay <= 0) return;
    if (delay > MAX_WAIT_MS) throw new DiscordRestError(`Discord API 429: запити призупинено ще на ${Math.ceil(delay / 1000)} с.`, 429, delay);
    await wait(delay, signal);
  }
}
export async function discordRestRequest<T>(path: string, init: RequestInit, options: {
  token: string; retryNever?: boolean; deduplicatedMessage?: boolean; timeoutMs: number;
  /** Runs after all queue/rate-limit waits, immediately before dispatch. Must fail closed. */
  beforeSend?: () => Promise<void>;
  onDispatch?: () => void;
  onFailure?: (status: number, detail: string, attempt: number) => void;
}): Promise<T> {
  if (!path.startsWith("/") || path.startsWith("//")) throw new Error("Discord API path невалідний.");
  const method = String(init.method || "GET").toUpperCase();
  const safeReplay = ["GET", "HEAD", "OPTIONS", "PUT"].includes(method) || options.deduplicatedMessage === true;
  const attempts = options.retryNever ? 1 : 4;
  const state = stateFor(options.token);
  const { route, major } = discordRouteIdentity(path, method);
  const deadline = AbortSignal.timeout(45_000);
  const signal = init.signal ? AbortSignal.any([deadline, init.signal]) : deadline;
  prune(state);
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    let key = state.routes.get(route) || route;
    let releaseRoute: (() => void) | undefined;
    let releaseGlobal: (() => void) | undefined;
    let retryDelay = 0;
    try {
      for (;;) {
        const permit = state.locks.get(key) || { active: 0, waiters: [] };
        state.locks.set(key, permit);
        releaseRoute = await acquire(permit, 1, signal);
        const learnedKey = state.routes.get(route) || route;
        if (learnedKey === key) break;
        releaseRoute(); releaseRoute = undefined; key = learnedKey;
      }
      await waitForCooldown(state, key, signal);
      const concurrency = Math.max(1, Math.min(8, Math.floor(Number(process.env.DISCORD_REST_CONCURRENCY) || 4)));
      releaseGlobal = await acquire(state.global, concurrency, signal);
      await waitForCooldown(state, key, signal);
      // Conservative local pacing leaves room for the Gateway companion process.
      const startAt = Math.max(Date.now(), state.nextStartAt);
      state.nextStartAt = startAt + 25;
      if (startAt > Date.now()) await wait(startAt - Date.now(), signal);
      await waitForCooldown(state, key, signal);
      const requestSignal = AbortSignal.any([signal, AbortSignal.timeout(options.timeoutMs)]);
      requestSignal.throwIfAborted();
      await options.beforeSend?.();
      requestSignal.throwIfAborted();
      options.onDispatch?.();
      const response = await fetch(`${API_BASE}${path}`, { ...init, cache: "no-store", signal: requestSignal });
      if (response.status === 401) state.invalidToken = true;
      key = observeDiscordRateLimit(state, response, route, major);
      const raw = response.status === 204 ? "" : await response.text();
      let json: any = null; try { json = raw ? JSON.parse(raw) : null; } catch { /* preserve non-JSON error text */ }
      if (response.ok) return (response.status === 204 ? undefined : json ?? raw) as T;
      const detail = String(json?.message || raw || "невідома помилка").slice(0, 220);
      options.onFailure?.(response.status, detail, attempt + 1);
      if (response.status === 401) state.invalidToken = true;
      if (response.status === 429) {
        const seconds = Number(json?.retry_after ?? response.headers.get("retry-after") ?? response.headers.get("x-ratelimit-reset-after"));
        retryDelay = Number.isFinite(seconds) && seconds > 0 ? Math.ceil(seconds * 1000) + 75 : 1000;
        cooldown(state, key, retryDelay);
        if (json?.global === true || response.headers.get("x-ratelimit-global") === "true" || response.headers.get("x-ratelimit-scope") === "global") state.globalUntil = Math.max(state.globalUntil, Date.now() + retryDelay);
      } else if (safeReplay && [408, 500, 502, 503, 504].includes(response.status)) retryDelay = 500 * (2 ** attempt);
      if (!retryDelay || options.retryNever || attempt === attempts - 1 || retryDelay > MAX_WAIT_MS) throw new DiscordRestError(`Discord API ${response.status}: ${detail}`, response.status, retryDelay);
    } catch (error) {
      if (error instanceof DiscordRestError || signal.aborted || options.retryNever || !safeReplay || attempt === attempts - 1) throw error;
      if (!/AbortError|TimeoutError|ECONNRESET|ETIMEDOUT|fetch failed|network/i.test(`${(error as Error)?.name} ${(error as Error)?.message}`)) throw error;
      retryDelay = 500 * (2 ** attempt);
    } finally { releaseGlobal?.(); releaseRoute?.(); }
    if (retryDelay) await wait(retryDelay, signal);
  }
  throw new DiscordRestError("Discord API 429: ліміт повторів вичерпано.", 429);
}
