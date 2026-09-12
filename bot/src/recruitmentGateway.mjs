import { timingSafeEqual } from "node:crypto";
import { logger } from "./logger.mjs";

const DISCORD_API_BASE = "https://discord.com/api/v10";
const INTENTS = 1 | 512 | 32768; // Guilds + GuildMessages + MessageContent
const USER_AGENT = "MistblossomBot/2.0 recruitment-gateway";
const FATAL_CLOSE_CODES = new Set([4004, 4010, 4011, 4012, 4013, 4014]);
const NON_RESUMABLE_CLOSE_CODES = new Set([4007, 4009]); // invalid seq / session timed out

const state = {
  enabled: false,
  connected: false,
  readyState: null,
  startedAt: null,
  lastEventAt: null,
  lastHeartbeatSentAt: null,
  lastHeartbeatAckAt: null,
  seq: null,
  sessionId: null,
  resumeGatewayUrl: null,
  lastError: null,
  lastRelayAt: null,
  lastRelayStatus: null,
  lastRelaySummary: null,
  lastRelayedMessageId: null,
  lastRelayedChannelId: null,
  lastDispatchType: null,
  lastDispatchAt: null,
  lastMessageCreateAt: null,
  lastMessageDropAt: null,
  lastMessageDropReason: null,
  lastMessageDropSummary: null,
  lastMessageContentLength: null,
  lastMessageGuildId: null,
  lastMessageChannelId: null,
  lastMessageId: null,
  dispatchCount: 0,
  messageCreateCount: 0,
  relayAttemptCount: 0,
  lastMessageAuthorId: null,
  lastRelayAttemptAt: null,
  lastRelayError: null,
  lastDashboardResponseRawShort: null,
};

let socket = null;
let heartbeatTimer = null;
let reconnectTimer = null;
let reconnectAttempts = 0;
let messageQueue = Promise.resolve();
let explicitStop = false;

function nowIso() {
  return new Date().toISOString();
}

function env(name, fallback = "") {
  const value = String(process.env[name] ?? "").trim();
  return value || fallback;
}

function botToken() {
  return env("DISCORD_BOT_TOKEN");
}

function guildId() {
  return env("DISCORD_GUILD_ID");
}

function dashboardBaseUrl() {
  return env("DASHBOARD_INTERNAL_URL", env("DASHBOARD_URL", "http://dashboard:3000")).replace(/\/+$/, "");
}

function dashboardMessageEndpoint() {
  return env(
    "DASHBOARD_RECRUITMENT_ADVICE_MESSAGE_ENDPOINT",
    `${dashboardBaseUrl()}/api/discord/recruitment-advice/message`,
  );
}

function dashboardScanEndpoint() {
  return env(
    "DASHBOARD_RECRUITMENT_ADVICE_SCAN_ENDPOINT",
    `${dashboardBaseUrl()}/api/discord/recruitment-advice?limit=4`,
  );
}

function internalToken() {
  // One canonical service token prevents dashboard/bot env files from silently
  // drifting apart. The legacy advice secret remains a compatibility fallback.
  return env(
    "INTERNAL_API_TOKEN",
    env("DISCORD_RECRUITMENT_ADVICE_SECRET", env("WORKER_SHARED_SECRET")),
  );
}

function tokenMatches(left, right) {
  const a = Buffer.from(String(left || ""));
  const b = Buffer.from(String(right || ""));
  return a.length > 0 && a.length === b.length && timingSafeEqual(a, b);
}

export function authorizeRecruitmentControl(request) {
  const authorization = String(request?.headers?.authorization || "");
  const bearerMatch = authorization.match(/^Bearer\s+(.+)$/i);
  const supplied = String(bearerMatch?.[1] || request?.headers?.["x-worker-stats-token"] || "").trim();
  const candidates = [
    env("DISCORD_RECRUITMENT_ADVICE_SECRET"),
    env("INTERNAL_API_TOKEN"),
    env("WORKER_SHARED_SECRET"),
  ].filter(Boolean);
  return Boolean(supplied && candidates.some((candidate) => tokenMatches(supplied, candidate)));
}

function clearHeartbeat() {
  if (heartbeatTimer) clearInterval(heartbeatTimer);
  heartbeatTimer = null;
}

function clearReconnect() {
  if (reconnectTimer) clearTimeout(reconnectTimer);
  reconnectTimer = null;
}

function safeClose(code = 1000, reason = "reconnect") {
  const current = socket;
  socket = null;
  if (!current) return;
  try {
    current.close(code, reason);
  } catch {
    // socket may already be closed
  }
}

async function discordFetch(pathname, init = {}) {
  const token = botToken();
  if (!token) throw new Error("DISCORD_BOT_TOKEN не задано");

  const timeoutMs = Math.max(1_000, Number(env("DISCORD_TIMEOUT_MS", "10000")) || 10_000);
  const response = await fetch(`${DISCORD_API_BASE}${pathname}`, {
    ...init,
    signal: init.signal || AbortSignal.timeout(timeoutMs),
    headers: {
      authorization: `Bot ${token}`,
      "user-agent": USER_AGENT,
      ...(init.headers || {}),
    },
  });
  const raw = await response.text().catch(() => "");
  let data = null;
  if (raw) {
    try { data = JSON.parse(raw); } catch { data = raw; }
  }
  if (!response.ok) {
    const detail = typeof data === "object" && data ? data.message : raw;
    throw new Error(`Discord API ${response.status}: ${detail || response.statusText}`);
  }
  return data;
}

async function sendTyping(channelId) {
  if (!channelId) return;
  await discordFetch(`/channels/${channelId}/typing`, { method: "POST" }).catch(() => null);
}

async function dashboardFetch(url, init = {}, timeoutOverrideMs = null) {
  const token = internalToken();
  if (!token) throw new Error("INTERNAL_API_TOKEN / DISCORD_RECRUITMENT_ADVICE_SECRET не задано");

  const configured = Math.max(1_000, Number(env("DASHBOARD_TIMEOUT_MS", "20000")) || 20_000);
  const timeoutMs = timeoutOverrideMs == null ? configured : Math.max(configured, Number(timeoutOverrideMs) || configured);
  const response = await fetch(url, {
    ...init,
    signal: init.signal || AbortSignal.timeout(timeoutMs),
    headers: {
      accept: "application/json",
      authorization: `Bearer ${token}`,
      "user-agent": USER_AGENT,
      ...(init.headers || {}),
    },
  });
  const raw = await response.text().catch(() => "");
  state.lastDashboardResponseRawShort = raw.slice(0, 500) || null;
  let data = null;
  if (raw) {
    try { data = JSON.parse(raw); } catch { data = null; }
  }
  if (!response.ok) {
    throw new Error(`Dashboard ${response.status}: ${data?.error || raw.slice(0, 240) || response.statusText}`);
  }
  return { data, status: response.status };
}

async function forwardMessageToDashboard(message) {
  state.relayAttemptCount += 1;
  state.lastRelayAttemptAt = nowIso();
  state.lastRelayedMessageId = String(message?.id || "") || null;
  state.lastRelayedChannelId = String(message?.channel_id || "") || null;

  try {
    const { data, status } = await dashboardFetch(dashboardMessageEndpoint(), {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        message: {
          ...message,
          source: "bot-gateway",
          receivedAt: nowIso(),
        },
      }),
    });
    state.lastRelayAt = nowIso();
    state.lastRelayStatus = status;
    state.lastRelayError = null;
    state.lastRelaySummary = data?.replied
      ? `Відповідь надіслано, reply=${data.replyMessageId || "—"}`
      : data?.matched
        ? `Повідомлення розпізнано, але пропущено: ${data.skipReason || data.skipped || "без причини"}`
        : `Оброблено: matched=${Boolean(data?.matched)}, replied=${Boolean(data?.replied)}`;
    return data;
  } catch (error) {
    const messageText = error instanceof Error ? error.message : String(error);
    state.lastRelayAt = nowIso();
    state.lastRelayStatus = "error";
    state.lastRelayError = messageText;
    state.lastRelaySummary = messageText.slice(0, 300);
    throw error;
  }
}

function dropMessage(reason, message, summary = "") {
  state.lastMessageDropAt = nowIso();
  state.lastMessageDropReason = reason;
  state.lastMessageDropSummary = summary || null;
  state.lastMessageId = String(message?.id || "") || null;
  state.lastMessageChannelId = String(message?.channel_id || "") || null;
  state.lastMessageGuildId = String(message?.guild_id || "") || null;
  state.lastMessageAuthorId = String(message?.author?.id || "") || null;
}

function enqueueMessage(message) {
  messageQueue = messageQueue
    .then(async () => {
      await sendTyping(message.channel_id);
      const result = await forwardMessageToDashboard(message);
      logger.info("Recruitment message processed", {
        channelId: message.channel_id,
        messageId: message.id,
        matched: Boolean(result?.matched),
        replied: Boolean(result?.replied),
        skipped: result?.skipped || result?.skipReason || null,
      });
    })
    .catch((error) => {
      logger.warn("Recruitment message processing failed", {
        error: error instanceof Error ? error.message : String(error),
      });
    });
}

function handleDispatch(eventType, data) {
  state.lastDispatchType = String(eventType || "") || null;
  state.lastDispatchAt = nowIso();
  state.dispatchCount += 1;

  if (eventType === "READY") {
    reconnectAttempts = 0;
    state.sessionId = String(data?.session_id || "") || null;
    state.resumeGatewayUrl = String(data?.resume_gateway_url || "") || null;
    state.lastError = null;
    logger.info("Discord Gateway ready", { user: data?.user?.username || data?.user?.id || "bot" });
    return;
  }
  if (eventType === "RESUMED") {
    reconnectAttempts = 0;
    state.lastError = null;
    logger.info("Discord Gateway resumed");
    return;
  }
  if (eventType !== "MESSAGE_CREATE") return;

  state.messageCreateCount += 1;
  state.lastMessageCreateAt = nowIso();
  state.lastMessageContentLength = typeof data?.content === "string" ? data.content.length : 0;
  state.lastMessageGuildId = String(data?.guild_id || "") || null;
  state.lastMessageChannelId = String(data?.channel_id || "") || null;
  state.lastMessageId = String(data?.id || "") || null;
  state.lastMessageAuthorId = String(data?.author?.id || "") || null;

  const configuredGuildId = guildId();
  if (configuredGuildId && String(data?.guild_id || "") !== configuredGuildId) {
    dropMessage("wrong_guild", data, `Очікувався guild ${configuredGuildId}`);
    return;
  }
  if (!data?.id || !data?.channel_id) {
    dropMessage("missing_ids", data);
    return;
  }
  if (data?.author?.bot) {
    dropMessage("bot_author", data);
    return;
  }
  if (data?.webhook_id) {
    dropMessage("webhook_message", data);
    return;
  }

  state.lastMessageDropReason = null;
  state.lastMessageDropSummary = null;
  enqueueMessage(data);
}

function heartbeat() {
  if (!socket || socket.readyState !== WebSocket.OPEN) return;
  state.lastHeartbeatSentAt = nowIso();
  socket.send(JSON.stringify({ op: 1, d: state.seq }));
}

function identifyOrResume() {
  const token = botToken();
  if (!socket || socket.readyState !== WebSocket.OPEN || !token) return;

  if (state.sessionId && state.seq !== null) {
    socket.send(JSON.stringify({
      op: 6,
      d: { token, session_id: state.sessionId, seq: state.seq },
    }));
    return;
  }

  socket.send(JSON.stringify({
    op: 2,
    d: {
      token,
      intents: INTENTS,
      properties: {
        os: process.platform,
        browser: "mistblossom-bot",
        device: "mistblossom-bot",
      },
    },
  }));
}

async function gatewayUrl() {
  if (state.resumeGatewayUrl && state.sessionId) {
    return `${state.resumeGatewayUrl.replace(/\/+$/, "")}/?v=10&encoding=json`;
  }
  const data = await discordFetch("/gateway/bot");
  if (!data?.url) throw new Error("Discord Gateway URL відсутній у відповіді");
  return `${String(data.url).replace(/\/+$/, "")}/?v=10&encoding=json`;
}

function scheduleReconnect(reason, delayOverride = null) {
  if (!state.enabled || explicitStop) return;
  clearHeartbeat();
  clearReconnect();
  safeClose(1000, "reconnect");
  state.connected = false;
  state.readyState = null;
  state.lastError = String(reason || "gateway reconnect");

  const delay = delayOverride ?? Math.min(60_000, 1_000 * (2 ** Math.min(reconnectAttempts, 6)));
  reconnectAttempts += 1;
  reconnectTimer = setTimeout(() => {
    reconnectTimer = null;
    connect().catch((error) => scheduleReconnect(error instanceof Error ? error.message : String(error)));
  }, delay);
  reconnectTimer.unref?.();
  logger.warn("Discord Gateway reconnect scheduled", { delayMs: delay, reason: state.lastError });
}

async function connect() {
  if (!state.enabled || explicitStop) return getRecruitmentGatewayStatus();
  const token = botToken();
  if (!token) {
    state.enabled = false;
    state.lastError = "DISCORD_BOT_TOKEN не задано — Gateway не може підключитися.";
    return getRecruitmentGatewayStatus();
  }
  if (socket && (socket.readyState === WebSocket.OPEN || socket.readyState === WebSocket.CONNECTING)) {
    return getRecruitmentGatewayStatus();
  }

  clearReconnect();
  const url = await gatewayUrl();
  state.lastError = null;
  const ws = new WebSocket(url);
  socket = ws;
  state.readyState = ws.readyState;

  ws.addEventListener("open", () => {
    if (socket !== ws) return;
    state.connected = true;
    state.readyState = ws.readyState;
    state.lastEventAt = nowIso();
    logger.info("Discord Gateway socket opened");
  });

  ws.addEventListener("message", (event) => {
    if (socket !== ws) return;
    state.lastEventAt = nowIso();
    let packet;
    try { packet = JSON.parse(String(event.data)); } catch { return; }
    if (packet.s !== null && packet.s !== undefined) state.seq = Number(packet.s);

    if (packet.op === 10) {
      const interval = Math.max(5_000, Number(packet.d?.heartbeat_interval || 45_000));
      clearHeartbeat();
      heartbeatTimer = setInterval(heartbeat, interval);
      heartbeatTimer.unref?.();
      heartbeat();
      identifyOrResume();
      return;
    }
    if (packet.op === 11) {
      state.lastHeartbeatAckAt = nowIso();
      return;
    }
    if (packet.op === 7) {
      scheduleReconnect("Discord requested reconnect", 500);
      return;
    }
    if (packet.op === 9) {
      const resumable = Boolean(packet.d);
      if (!resumable) {
        state.sessionId = null;
        state.resumeGatewayUrl = null;
        state.seq = null;
      }
      scheduleReconnect("Discord invalid session", 1_000 + Math.floor(Math.random() * 4_000));
      return;
    }
    if (packet.op === 0) handleDispatch(packet.t, packet.d);
  });

  ws.addEventListener("close", (event) => {
    if (socket !== ws) return;
    socket = null;
    clearHeartbeat();
    state.connected = false;
    state.readyState = event?.target?.readyState ?? WebSocket.CLOSED;
    state.lastEventAt = nowIso();
    const code = Number(event?.code || 0);
    const reason = String(event?.reason || "");
    if (!state.enabled || explicitStop) return;
    if (FATAL_CLOSE_CODES.has(code)) {
      state.enabled = false;
      state.lastError = `Discord Gateway закрито фатально (${code}${reason ? `: ${reason}` : ""}). Перевір token/intents.`;
      logger.error("Discord Gateway fatal close", { code, reason });
      return;
    }
    if (NON_RESUMABLE_CLOSE_CODES.has(code)) {
      state.sessionId = null;
      state.resumeGatewayUrl = null;
      state.seq = null;
    }
    scheduleReconnect(`socket closed ${code || "unknown"}${reason ? `: ${reason}` : ""}`);
  });

  ws.addEventListener("error", () => {
    if (socket !== ws) return;
    state.lastError = "Discord Gateway socket error";
  });

  return getRecruitmentGatewayStatus();
}

export function getRecruitmentGatewayStatus() {
  return {
    ok: !state.lastError,
    enabled: state.enabled,
    connected: state.connected,
    readyState: socket?.readyState ?? state.readyState,
    startedAt: state.startedAt,
    lastEventAt: state.lastEventAt,
    lastHeartbeatSentAt: state.lastHeartbeatSentAt,
    lastHeartbeatAckAt: state.lastHeartbeatAckAt,
    seq: state.seq,
    sessionId: Boolean(state.sessionId),
    resumeGatewayUrl: Boolean(state.resumeGatewayUrl),
    lastError: state.lastError,
    lastRelayAt: state.lastRelayAt,
    lastRelayStatus: state.lastRelayStatus,
    lastRelaySummary: state.lastRelaySummary,
    lastRelayedMessageId: state.lastRelayedMessageId,
    lastRelayedChannelId: state.lastRelayedChannelId,
    lastDispatchType: state.lastDispatchType,
    lastDispatchAt: state.lastDispatchAt,
    lastMessageCreateAt: state.lastMessageCreateAt,
    lastMessageDropAt: state.lastMessageDropAt,
    lastMessageDropReason: state.lastMessageDropReason,
    lastMessageDropSummary: state.lastMessageDropSummary,
    lastMessageContentLength: state.lastMessageContentLength,
    lastMessageGuildId: state.lastMessageGuildId,
    lastMessageChannelId: state.lastMessageChannelId,
    lastMessageId: state.lastMessageId,
    dispatchCount: state.dispatchCount,
    messageCreateCount: state.messageCreateCount,
    relayAttemptCount: state.relayAttemptCount,
    lastMessageAuthorId: state.lastMessageAuthorId,
    lastRelayAttemptAt: state.lastRelayAttemptAt,
    lastRelayError: state.lastRelayError,
    lastDashboardResponseRawShort: state.lastDashboardResponseRawShort,
    hint: botToken() ? null : "Додай DISCORD_BOT_TOKEN у bot/.env.production.",
  };
}

export async function startRecruitmentGateway() {
  explicitStop = false;
  state.enabled = true;
  state.startedAt = state.startedAt || nowIso();
  state.lastError = null;
  return connect();
}

export async function reconnectRecruitmentGateway() {
  explicitStop = false;
  state.enabled = true;
  state.startedAt = state.startedAt || nowIso();
  clearHeartbeat();
  clearReconnect();
  safeClose(1000, "manual reconnect");
  state.connected = false;
  await new Promise((resolve) => setTimeout(resolve, 50));
  return connect();
}

export function stopRecruitmentGateway() {
  explicitStop = true;
  state.enabled = false;
  clearHeartbeat();
  clearReconnect();
  safeClose(1000, "manual stop");
  state.connected = false;
  state.readyState = WebSocket.CLOSED;
  state.lastError = null;
  return getRecruitmentGatewayStatus();
}

async function runDashboardScan({ dryRun }) {
  const url = new URL(dashboardScanEndpoint());
  url.searchParams.set("force", "1");
  if (dryRun) url.searchParams.set("dryRun", "1");
  // Backfill can legitimately take longer than an interaction relay because it
  // reads several Discord pages and evaluates multiple messages.
  const { data, status } = await dashboardFetch(url.toString(), { method: "GET" }, 60_000);
  state.lastRelayAt = nowIso();
  state.lastRelayStatus = status;
  state.lastRelayError = null;
  state.lastRelaySummary = `scan: scanned=${data?.scanned || 0}, matched=${data?.matched || 0}, replied=${data?.replied || 0}, errors=${Array.isArray(data?.errors) ? data.errors.length : 0}`;
  return data;
}

export async function testRecruitmentRelay() {
  try {
    const data = await runDashboardScan({ dryRun: true });
    return { ...getRecruitmentGatewayStatus(), ok: true, backfill: data };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    state.lastRelayAt = nowIso();
    state.lastRelayStatus = "error";
    state.lastRelayError = message;
    state.lastRelaySummary = message.slice(0, 300);
    return { ...getRecruitmentGatewayStatus(), ok: false, error: message };
  }
}

export async function manualRecruitmentScan() {
  try {
    const data = await runDashboardScan({ dryRun: false });
    return { ...getRecruitmentGatewayStatus(), ok: Boolean(data?.ok ?? true), backfill: data };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    state.lastRelayAt = nowIso();
    state.lastRelayStatus = "error";
    state.lastRelayError = message;
    state.lastRelaySummary = message.slice(0, 300);
    return { ...getRecruitmentGatewayStatus(), ok: false, error: message };
  }
}

export async function handleRecruitmentGatewayControl(action) {
  switch (String(action || "status").trim().toLowerCase()) {
    case "status": return getRecruitmentGatewayStatus();
    case "start": return startRecruitmentGateway();
    case "reconnect": return reconnectRecruitmentGateway();
    case "stop": return stopRecruitmentGateway();
    case "test-relay": return testRecruitmentRelay();
    case "manual-scan": return manualRecruitmentScan();
    default: return { ...getRecruitmentGatewayStatus(), ok: false, error: `Unknown action: ${action}` };
  }
}

export function shouldAutoStartRecruitmentGateway() {
  const raw = env("DISCORD_RECRUITMENT_GATEWAY_ENABLED", "1").toLowerCase();
  return Boolean(botToken()) && !["0", "false", "no", "off"].includes(raw);
}

export function shutdownRecruitmentGateway() {
  explicitStop = true;
  state.enabled = false;
  clearHeartbeat();
  clearReconnect();
  safeClose(1000, "shutdown");
  state.connected = false;
}
