import { randomUUID } from "node:crypto";
import { notifyDiscordMemberJoined } from "./dashboardClient.mjs";
import { logger } from "./logger.mjs";

const GATEWAY_URL = "wss://gateway.discord.gg/?v=10&encoding=json";
const INTENTS = (1 << 0) | (1 << 1); // GUILDS + GUILD_MEMBERS
const TOKEN = () => String(process.env.DISCORD_BOT_TOKEN || "").trim();
const GUILD_ID = () => String(process.env.DISCORD_GUILD_ID || "").trim();
const ENABLED = () => String(process.env.DISCORD_GATEWAY_ENABLED ?? "1").trim() !== "0";
const MAX_QUEUE = Math.max(32, Math.min(1000, Number(process.env.DISCORD_GATEWAY_MEMBER_QUEUE_MAX || 250)));
const WORKERS = Math.max(1, Math.min(4, Number(process.env.DISCORD_GATEWAY_MEMBER_WORKERS || 2)));

const state = {
  connected: false,
  ready: false,
  sessionId: null,
  resumeUrl: null,
  sequence: null,
  lastEventAt: null,
  lastMemberJoinAt: null,
  lastError: null,
  reconnects: 0,
  queue: new Map(),
  activeWorkers: 0,
};

let socket = null;
let heartbeatTimer = null;
let heartbeatAcked = true;
let reconnectTimer = null;
let stopped = false;

function cleanSnowflake(value) {
  const text = String(value || "").trim();
  return /^\d{16,25}$/.test(text) ? text : "";
}

function closeSocket(code = 4000, reason = "reconnect") {
  try { socket?.close(code, reason); } catch {}
  socket = null;
}

function clearHeartbeat() {
  if (heartbeatTimer) clearInterval(heartbeatTimer);
  heartbeatTimer = null;
}

function send(payload) {
  if (!socket || socket.readyState !== WebSocket.OPEN) return false;
  socket.send(JSON.stringify(payload));
  return true;
}

function heartbeat() {
  if (!heartbeatAcked) {
    logger.warn("Discord Gateway heartbeat ACK пропущено — перепідключення", { eventName: "bot.gateway.heartbeat_timeout" });
    closeSocket(4000, "heartbeat_timeout");
    return;
  }
  heartbeatAcked = false;
  send({ op: 1, d: state.sequence });
}

function identifyOrResume() {
  const token = TOKEN();
  if (state.sessionId && state.sequence !== null && state.resumeUrl) {
    send({ op: 6, d: { token, session_id: state.sessionId, seq: state.sequence } });
    return;
  }
  send({
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
  });
}

function scheduleReconnect(delayMs = 1500) {
  if (stopped || reconnectTimer) return;
  state.connected = false;
  state.ready = false;
  clearHeartbeat();
  reconnectTimer = setTimeout(() => {
    reconnectTimer = null;
    connect();
  }, Math.max(500, Math.min(30_000, delayMs)));
  reconnectTimer.unref?.();
}

function enqueueMemberJoin(payload) {
  const guildId = cleanSnowflake(payload?.guild_id);
  const userId = cleanSnowflake(payload?.user?.id);
  if (!guildId || guildId !== GUILD_ID() || !userId || payload?.user?.bot) return;

  const item = {
    guildId,
    userId,
    joinedAt: String(payload?.joined_at || "").trim() || null,
    eventId: `${userId}:${String(payload?.joined_at || "unknown")}`,
    queuedAt: Date.now(),
    attempts: 0,
  };
  state.lastMemberJoinAt = new Date().toISOString();

  if (!state.queue.has(userId) && state.queue.size >= MAX_QUEUE) {
    const oldest = [...state.queue.values()].sort((a, b) => a.queuedAt - b.queuedAt)[0];
    if (oldest) state.queue.delete(oldest.userId);
    logger.warn("Discord newcomer priority queue переповнена — видалено найстаріший hint", {
      eventName: "bot.gateway.member_queue_overflow",
      queueSize: state.queue.size,
      droppedUserId: oldest?.userId || null,
    });
  }
  state.queue.set(userId, item);
  logger.info("Новий Discord-учасник поставлений у пріоритетну onboarding-чергу", {
    eventName: "bot.gateway.member_join_queued",
    userId,
    joinedAt: item.joinedAt,
    queueSize: state.queue.size,
  });
  pumpQueue();
}

async function processQueueItem(item) {
  try {
    item.attempts += 1;
    const result = await notifyDiscordMemberJoined(item);
    logger.info("Пріоритетний onboarding нового Discord-учасника передано панелі", {
      eventName: "bot.gateway.member_join_processed",
      userId: item.userId,
      joinedAt: item.joinedAt,
      attempts: item.attempts,
      result: result?.result || null,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    state.lastError = message;
    if (item.attempts < 8) {
      item.queuedAt = Date.now() + Math.min(30_000, 1000 * (2 ** (item.attempts - 1)));
      state.queue.set(item.userId, item);
      setTimeout(pumpQueue, Math.min(30_000, 1000 * (2 ** (item.attempts - 1)))).unref?.();
      logger.warn("Пріоритетний onboarding буде повторено", {
        eventName: "bot.gateway.member_join_retry",
        userId: item.userId,
        attempts: item.attempts,
        error: message,
      });
      return;
    }
    logger.error("Пріоритетний onboarding не доставлено після повторів", {
      eventName: "bot.gateway.member_join_failed",
      userId: item.userId,
      attempts: item.attempts,
      error: message,
    });
  }
}

function nextQueueItem() {
  const now = Date.now();
  const ready = [...state.queue.values()]
    .filter((item) => item.queuedAt <= now)
    .sort((a, b) => {
      const aJoined = Date.parse(a.joinedAt || "") || a.queuedAt;
      const bJoined = Date.parse(b.joinedAt || "") || b.queuedAt;
      return bJoined - aJoined; // newest first
    });
  const item = ready[0];
  if (!item) return null;
  state.queue.delete(item.userId);
  return item;
}

function pumpQueue() {
  while (state.activeWorkers < WORKERS) {
    const item = nextQueueItem();
    if (!item) break;
    state.activeWorkers += 1;
    processQueueItem(item)
      .catch(() => null)
      .finally(() => {
        state.activeWorkers -= 1;
        setImmediate(pumpQueue);
      });
  }
}

function handleDispatch(packet) {
  state.lastEventAt = new Date().toISOString();
  if (packet.t === "READY") {
    state.sessionId = String(packet.d?.session_id || "") || null;
    state.resumeUrl = String(packet.d?.resume_gateway_url || "") || null;
    state.ready = true;
    state.lastError = null;
    logger.info("Discord Gateway готовий", {
      eventName: "bot.gateway.ready",
      guildId: GUILD_ID(),
      sessionId: state.sessionId ? "configured" : "missing",
    });
    return;
  }
  if (packet.t === "RESUMED") {
    state.ready = true;
    state.lastError = null;
    logger.info("Discord Gateway session відновлена", { eventName: "bot.gateway.resumed" });
    return;
  }
  if (packet.t === "GUILD_MEMBER_ADD") enqueueMemberJoin(packet.d);
}

function connect() {
  if (stopped || !ENABLED()) return;
  if (!TOKEN() || !GUILD_ID()) {
    state.lastError = "DISCORD_BOT_TOKEN або DISCORD_GUILD_ID не налаштований у bot container";
    logger.warn("Discord Gateway вимкнений: бракує токена/гільдії; лишається cron fallback", {
      eventName: "bot.gateway.config_missing",
      tokenConfigured: Boolean(TOKEN()),
      guildConfigured: Boolean(GUILD_ID()),
    });
    return;
  }
  if (typeof WebSocket !== "function") {
    state.lastError = "Global WebSocket unavailable in current Node runtime";
    logger.error("Discord Gateway недоступний у цьому Node runtime", { eventName: "bot.gateway.websocket_missing" });
    return;
  }

  const target = state.resumeUrl ? `${state.resumeUrl.replace(/\/+$/, "")}/?v=10&encoding=json` : GATEWAY_URL;
  socket = new WebSocket(target);

  socket.addEventListener("open", () => {
    state.connected = true;
    state.reconnects += 1;
  });

  socket.addEventListener("message", (event) => {
    let packet;
    try { packet = JSON.parse(String(event.data || "{}")); } catch { return; }
    if (typeof packet.s === "number") state.sequence = packet.s;

    if (packet.op === 10) {
      const interval = Math.max(10_000, Number(packet.d?.heartbeat_interval || 45_000));
      clearHeartbeat();
      heartbeatAcked = true;
      setTimeout(() => {
        if (!socket || socket.readyState !== WebSocket.OPEN) return;
        heartbeat();
        heartbeatTimer = setInterval(heartbeat, interval);
        heartbeatTimer.unref?.();
      }, Math.floor(Math.random() * Math.min(interval, 5_000))).unref?.();
      identifyOrResume();
      return;
    }
    if (packet.op === 11) {
      heartbeatAcked = true;
      return;
    }
    if (packet.op === 1) {
      heartbeatAcked = true;
      send({ op: 1, d: state.sequence });
      return;
    }
    if (packet.op === 7) {
      closeSocket(4000, "server_reconnect");
      return;
    }
    if (packet.op === 9) {
      const resumable = Boolean(packet.d);
      if (!resumable) {
        state.sessionId = null;
        state.resumeUrl = null;
        state.sequence = null;
      }
      closeSocket(4000, "invalid_session");
      scheduleReconnect(1000 + Math.floor(Math.random() * 3000));
      return;
    }
    if (packet.op === 0) handleDispatch(packet);
  });

  socket.addEventListener("close", (event) => {
    state.connected = false;
    state.ready = false;
    clearHeartbeat();
    const code = Number(event.code || 0);
    const reason = String(event.reason || "");
    if ([4004, 4010, 4011, 4013, 4014].includes(code)) {
      state.lastError = `Discord Gateway fatal close ${code}: ${reason}`;
      logger.error("Discord Gateway закритий без автоматичного retry", {
        eventName: "bot.gateway.fatal_close",
        code,
        reason,
        hint: code === 4014 ? "Увімкни Server Members Intent у Discord Developer Portal." : null,
      });
      return;
    }
    scheduleReconnect(Math.min(30_000, 1000 + state.reconnects * 500));
  });

  socket.addEventListener("error", () => {
    state.lastError = "Discord Gateway socket error";
  });
}

export function startDiscordGatewayBridge() {
  stopped = false;
  connect();
  return () => {
    stopped = true;
    if (reconnectTimer) clearTimeout(reconnectTimer);
    clearHeartbeat();
    closeSocket(1000, "shutdown");
  };
}

export function discordGatewayHealth() {
  return {
    enabled: ENABLED(),
    configured: Boolean(TOKEN() && GUILD_ID()),
    connected: state.connected,
    ready: state.ready,
    queueSize: state.queue.size,
    activeWorkers: state.activeWorkers,
    lastEventAt: state.lastEventAt,
    lastMemberJoinAt: state.lastMemberJoinAt,
    lastError: state.lastError,
  };
}
