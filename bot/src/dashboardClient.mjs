import { logger } from "./logger.mjs";
import { validateInteractionComponents } from "@mistblossom/discord-contract";

/**
 * Клієнт до панелі й до Discord.
 *
 * Delivery pipeline:
 *   1. Verify Ed25519 and atomically persist the signed receipt in the dashboard.
 *   2. ACK the interaction only after durable persistence completes.
 *   3. A recoverable worker dispatches the receipt to the existing signed
 *      interaction handler and stores the result in the shared outbox.
 *   4. The outbox worker edits the original Discord response.
 *
 * The receipt must reach the dashboard within Discord's three-second ACK
 * deadline. Once accepted, the worker and outbox survive bot restarts.
 *
 * Для редагування interaction-відповіді bot token не потрібен: Discord
 * авторизує її interaction token-ом. Водночас сам bot container тепер має
 * DISCORD_BOT_TOKEN окремо для Gateway bridge (GUILD_MEMBER_ADD).
 */

const DASHBOARD_URL = () => String(process.env.DASHBOARD_INTERNAL_URL || "http://dashboard:3000").replace(/\/+$/, "");
const INTERNAL_TOKEN = () => String(process.env.INTERNAL_API_TOKEN || "").trim();
const APPLICATION_ID = () => String(process.env.DISCORD_APPLICATION_ID || "").trim();
const DISCORD_API = "https://discord.com/api/v10";

const DASHBOARD_TIMEOUT_MS = Number(process.env.DASHBOARD_TIMEOUT_MS || 20_000);
const DISCORD_TIMEOUT_MS = Number(process.env.DISCORD_TIMEOUT_MS || 10_000);
const MAX_ATTEMPTS = 3;

function retryDelayMs(attempt) {
  return Math.min(4000, 300 * Math.pow(2, attempt)) + Math.floor(Math.random() * 150);
}

async function fetchWithTimeout(url, options, timeoutMs) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Пересилає взаємодію в панель і повертає її відповідь.
 *
 * Заголовки підпису Discord передаються далі навмисно: панель перевіряє
 * підпис самостійно. Якби вона просто довіряла боту, будь-хто з доступом до
 * внутрішньої мережі міг би надсилати підроблені взаємодії.
 */
async function callDashboard({ rawBody, signature, timestamp, domain, interactionId, maxAttempts = MAX_ATTEMPTS }) {
  const token = INTERNAL_TOKEN();
  if (!token) throw new Error("INTERNAL_API_TOKEN не задано");

  const url = `${DASHBOARD_URL()}/api/discord/interactions`;
  let lastError = null;

  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    try {
      const response = await fetchWithTimeout(url, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${token}`,
          "x-signature-ed25519": signature,
          "x-signature-timestamp": timestamp,
          "x-mistblossom-source": "bot",
          "x-mistblossom-domain": String(domain || "unknown"),
          "x-interaction-id": String(interactionId || ""),
        },
        body: rawBody,
      }, DASHBOARD_TIMEOUT_MS);

      if (response.ok) return await response.json().catch(() => null);

      // 4xx означає, що панель нас зрозуміла і відмовила. Повторювати
      // безглуздо — це лише подвоїть побічні ефекти на її боці.
      if (response.status >= 400 && response.status < 500) {
        const text = await response.text().catch(() => "");
        throw new Error(`Панель відповіла ${response.status}: ${text.slice(0, 200)}`);
      }
      lastError = new Error(`Панель відповіла ${response.status}`);
    } catch (error) {
      if (error instanceof Error && /^Панель відповіла 4/.test(error.message)) throw error;
      lastError = error;
    }

    if (attempt < maxAttempts - 1) {
      await new Promise((resolve) => setTimeout(resolve, retryDelayMs(attempt)));
    }
  }

  throw lastError instanceof Error ? lastError : new Error("Панель недоступна");
}

/**
 * Панель відповідає у форматі interaction callback (`{ type, data }`), бо
 * історично її відповідь ішла прямо в Discord. Нам потрібне саме тіло
 * повідомлення.
 */
function messagePayloadFrom(result) {
  if (!result || typeof result !== "object") return null;
  const data = result.data && typeof result.data === "object" ? result.data : result;
  const payload = {};
  if (typeof data.content === "string") payload.content = data.content.slice(0, 2000);
  if (Array.isArray(data.embeds)) payload.embeds = data.embeds.slice(0, 10);
  if (Array.isArray(data.components)) payload.components = data.components.slice(0, 5);
  return Object.keys(payload).length ? payload : null;
}

async function patchOriginalResponse(interactionToken, payload) {
  const applicationId = APPLICATION_ID();
  if (!applicationId) throw new Error("DISCORD_APPLICATION_ID не задано");

  const url = `${DISCORD_API}/webhooks/${applicationId}/${interactionToken}/messages/@original`;
  const response = await fetchWithTimeout(url, {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ ...payload, allowed_mentions: { parse: [] } }),
  }, DISCORD_TIMEOUT_MS);

  if (response.ok) return true;

  const text = await response.text().catch(() => "");
  throw new Error(`Discord відхилив відповідь ${response.status}: ${text.slice(0, 300)}`);
}

const INGRESS_ENDPOINT = "/api/internal/discord/interaction-ingress";
let ingressDraining = false;

// The ACK is returned only after durable persistence; keep well below Discord's
// three-second deadline. A failed persistence never schedules the action.
export async function enqueueVerifiedInteraction({ rawBody, signature, timestamp, interaction, domain }) {
  const response = await fetchWithTimeout(`${DASHBOARD_URL()}${INGRESS_ENDPOINT}`, {
    method: "POST",
    headers: { ...outboxHeaders(), "content-type": "application/json" },
    body: JSON.stringify({ id: String(interaction?.id || ""), rawBody, signature, timestamp, domain: String(domain || "unknown") }),
  }, 1_800);
  if (!response.ok) throw new Error(`Discord ingress HTTP ${response.status}`);
  const data = await response.json();
  if (!data?.ok) throw new Error("Discord ingress did not confirm persistence");
  return data;
}

// Reuse the dashboard's existing signed Discord route. Its shared outbox claim
// ensures that an uncertain delivery response cannot replay the business action.
export async function drainInteractionIngress() {
  if (ingressDraining) return;
  ingressDraining = true;
  try {
    const response = await fetchWithTimeout(`${DASHBOARD_URL()}${INGRESS_ENDPOINT}`, {
      headers: outboxHeaders(),
    }, DASHBOARD_TIMEOUT_MS);
    if (!response.ok) throw new Error(`ingress fetch HTTP ${response.status}`);
    const data = await response.json();
    for (const job of Array.isArray(data?.jobs) ? data.jobs.slice(0, 10) : []) {
      if (!/^\d{16,25}$/.test(String(job?.id || "")) || !job.leaseId) continue;
      let success = false;
      let permanent = false;
      try {
        await callDashboard({
          rawBody: job.rawBody, signature: job.signature, timestamp: job.timestamp,
          domain: job.domain, interactionId: job.id, maxAttempts: 1,
        });
        success = true;
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        permanent = /Панель відповіла 4(00|01|03|04|13):/.test(message);
        logger.warn("Discord ingress dispatch failed", { interactionId: job.id, permanent, error: message.slice(0, 160) });
      }
      try {
        const ack = await fetchWithTimeout(`${DASHBOARD_URL()}${INGRESS_ENDPOINT}`, {
          method: "PATCH",
          headers: { ...outboxHeaders(), "content-type": "application/json" },
          body: JSON.stringify({ id: job.id, leaseId: job.leaseId, success, permanent }),
        }, DASHBOARD_TIMEOUT_MS);
        if (!ack.ok) throw new Error(`ingress settlement HTTP ${ack.status}`);
      } catch (error) {
        logger.warn("Discord ingress settlement failed", { interactionId: job.id, error: error instanceof Error ? error.message : String(error) });
      }
    }
  } catch (error) {
    logger.warn("Discord ingress poll deferred", { error: error instanceof Error ? error.message : String(error) });
  } finally {
    ingressDraining = false;
  }
}

export function startInteractionIngressWorker() {
  const interval = setInterval(() => { void drainInteractionIngress(); }, 3_000);
  interval.unref?.();
  void drainInteractionIngress();
  return () => clearInterval(interval);
}

const OUTBOX_ENDPOINT = "/api/internal/discord/interaction-deliveries";
let outboxDraining = false;

function outboxHeaders() {
  const token = INTERNAL_TOKEN();
  if (!token) throw new Error("INTERNAL_API_TOKEN не задано");
  return {
    authorization: `Bearer ${token}`,
    "x-mistblossom-source": "bot",
    "cache-control": "no-store",
  };
}

// The route is only reachable inside the Compose network and authenticates the
// bot. Interaction tokens never appear in logs, paths or query strings.
async function acknowledgeDelivery(job, success, permanent = false) {
  const response = await fetchWithTimeout(`${DASHBOARD_URL()}${OUTBOX_ENDPOINT}`, {
    method: "POST",
    headers: { ...outboxHeaders(), "content-type": "application/json" },
    body: JSON.stringify({ id: job.id, leaseId: job.leaseId, success, permanent }),
  }, DASHBOARD_TIMEOUT_MS);
  if (!response.ok) throw new Error(`outbox ack HTTP ${response.status}`);
}

export async function drainInteractionOutbox() {
  if (outboxDraining) return;
  outboxDraining = true;
  try {
    const response = await fetchWithTimeout(`${DASHBOARD_URL()}${OUTBOX_ENDPOINT}`, {
      method: "GET",
      headers: outboxHeaders(),
    }, DASHBOARD_TIMEOUT_MS);
    if (!response.ok) throw new Error(`outbox fetch HTTP ${response.status}`);
    const body = await response.json();
    for (const job of Array.isArray(body?.jobs) ? body.jobs.slice(0, 10) : []) {
      if (!/^\d{16,25}$/.test(String(job?.id || "")) || !job?.leaseId || !job?.interactionToken) continue;
      let payload = messagePayloadFrom(job.result) || {
        content: "⚠️ Відповідь не надійшла. Перевірте стан дії на сайті.",
        components: [],
      };
      if (payload.components) {
        const valid = validateInteractionComponents(payload.components);
        if (!valid.ok) payload = { ...payload, components: [] };
      }
      let success = false;
      let permanent = false;
      try {
        await patchOriginalResponse(job.interactionToken, payload);
        success = true;
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        // Invalid/expired interaction webhook tokens cannot be repaired by
        // retrying. Retry rate limits, network failures and Discord 5xx only.
        permanent = /Discord відхилив відповідь (400|401|403|404):/.test(message);
        logger.warn("Discord outbox delivery failed", { interactionId: job.id, permanent, error: message.slice(0, 160) });
      }
      try {
        await acknowledgeDelivery(job, success, permanent);
      } catch (error) {
        // The lease expires and another worker safely retries. PATCH of
        // @original replaces the same message and is naturally idempotent.
        logger.warn("Discord outbox settlement unavailable", { interactionId: job.id, error: error instanceof Error ? error.message : String(error) });
      }
    }
  } catch (error) {
    logger.warn("Discord outbox poll deferred", { error: error instanceof Error ? error.message : String(error) });
  } finally {
    outboxDraining = false;
  }
}

export function startInteractionOutboxWorker() {
  const interval = setInterval(() => { void drainInteractionOutbox(); }, 5_000);
  interval.unref?.();
  void drainInteractionOutbox();
  return () => clearInterval(interval);
}

export async function notifyDiscordMemberJoined(event) {
  const token = INTERNAL_TOKEN();
  if (!token) throw new Error("INTERNAL_API_TOKEN не задано");
  const url = `${DASHBOARD_URL()}/api/internal/discord/member-joined`;
  const payload = {
    guildId: String(event?.guildId || "").trim(),
    userId: String(event?.userId || "").trim(),
    joinedAt: String(event?.joinedAt || "").trim() || null,
    eventId: String(event?.eventId || "").trim() || null,
    source: "discord_gateway",
  };

  let lastError = null;
  for (let attempt = 0; attempt < 5; attempt += 1) {
    try {
      const response = await fetchWithTimeout(url, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${token}`,
          "x-mistblossom-source": "bot-gateway",
        },
        body: JSON.stringify(payload),
      }, Math.max(8_000, DASHBOARD_TIMEOUT_MS));

      const body = await response.json().catch(() => null);
      if (response.ok && !body?.retry) return body;
      if (response.status === 202 || response.status === 409 || body?.retry) {
        lastError = new Error(body?.reason || body?.error || `dashboard_retry_${response.status}`);
      } else if (response.status >= 400 && response.status < 500) {
        throw new Error(`Панель відхилила member-joined ${response.status}: ${JSON.stringify(body || {}).slice(0, 220)}`);
      } else {
        lastError = new Error(`Панель member-joined відповіла ${response.status}`);
      }
    } catch (error) {
      if (error instanceof Error && /відхилила member-joined 4/.test(error.message)) throw error;
      lastError = error;
    }

    if (attempt < 4) {
      const delay = Math.min(8_000, 500 * (2 ** attempt)) + Math.floor(Math.random() * 250);
      await new Promise((resolve) => setTimeout(resolve, delay));
    }
  }
  throw lastError instanceof Error ? lastError : new Error("member-joined не доставлено в панель");
}


export async function notifyDiscordNicknameObserved(event) {
  const token = INTERNAL_TOKEN();
  if (!token) throw new Error("INTERNAL_API_TOKEN не задано");
  const url = `${DASHBOARD_URL()}/api/internal/discord/member-nickname`;
  const payload = {
    guildId: String(event?.guildId || "").trim(),
    userId: String(event?.userId || "").trim(),
    nickname: event?.nickname === null || event?.nickname === undefined ? null : String(event.nickname).slice(0, 64),
    eventId: String(event?.eventId || "").trim() || null,
    source: "discord_gateway",
  };

  let lastError = null;
  for (let attempt = 0; attempt < 4; attempt += 1) {
    try {
      const response = await fetchWithTimeout(url, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${token}`,
          "x-mistblossom-source": "bot-gateway",
        },
        body: JSON.stringify(payload),
      }, Math.max(8_000, DASHBOARD_TIMEOUT_MS));

      const body = await response.json().catch(() => null);
      if (response.ok) return body;
      if (response.status >= 400 && response.status < 500) {
        throw new Error(`Панель відхилила member-nickname ${response.status}: ${JSON.stringify(body || {}).slice(0, 220)}`);
      }
      lastError = new Error(body?.error || `Панель member-nickname відповіла ${response.status}`);
    } catch (error) {
      if (error instanceof Error && /відхилила member-nickname 4/.test(error.message)) throw error;
      lastError = error;
    }
    if (attempt < 3) {
      const delay = Math.min(6_000, 400 * (2 ** attempt)) + Math.floor(Math.random() * 180);
      await new Promise((resolve) => setTimeout(resolve, delay));
    }
  }
  throw lastError instanceof Error ? lastError : new Error("member-nickname не доставлено в панель");
}

/** Verified Discord DM -> trusted internal dashboard; no website login is involved. */
export async function confirmStaticRulesFromDm({ code, userId, guildId }) {
  const token = INTERNAL_TOKEN();
  if (!token) throw new Error("INTERNAL_API_TOKEN не задано");
  const result = await fetchWithTimeout(`${DASHBOARD_URL()}/api/internal/discord/static-confirm`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${token}`, "x-mistblossom-source": "bot-gateway" },
    body: JSON.stringify({ code, userId, guildId }),
  }, Math.max(8_000, DASHBOARD_TIMEOUT_MS));
  if (!result.ok) throw new Error(`Static confirm: dashboard HTTP ${result.status}`);
  return result.json();
}


/** Reconcile forbidden static roles after member events and periodically. */
export async function enforceStaticRoles({ guildId, userId = "", sweep = false }) {
  const token = INTERNAL_TOKEN();
  if (!token) throw new Error("INTERNAL_API_TOKEN не задано");
  const result = await fetchWithTimeout(`${DASHBOARD_URL()}/api/internal/discord/static-enforce`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${token}`, "x-mistblossom-source": "bot-gateway" },
    body: JSON.stringify({ guildId, userId, sweep }),
  }, sweep ? 120_000 : Math.max(8_000, DASHBOARD_TIMEOUT_MS));
  if (!result.ok) throw new Error(`Static enforcement: dashboard HTTP ${result.status}`);
  return result.json();
}
