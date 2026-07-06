#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import process from "node:process";

const DISCORD_API_BASE = "https://discord.com/api/v10";
const INTENTS = 1 | 512 | 32768; // Guilds + GuildMessages + MessageContent
const USER_AGENT = "MistblossomRecruitmentAdvisor/1.0";

let heartbeatTimer = null;
let lastSequence = null;
let socket = null;
let reconnectAttempts = 0;
let stopping = false;
let queue = Promise.resolve();

function log(level, message, meta = {}) {
  const payload = Object.keys(meta).length ? ` ${JSON.stringify(meta)}` : "";
  console.log(`[${new Date().toISOString()}] [${level}] ${message}${payload}`);
}

function loadEnvFile(filePath) {
  if (!fs.existsSync(filePath)) return;
  const raw = fs.readFileSync(filePath, "utf8");
  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const match = trimmed.match(/^([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/);
    if (!match) continue;
    const [, key, value] = match;
    if (process.env[key] !== undefined) continue;
    let clean = value.trim();
    if ((clean.startsWith('"') && clean.endsWith('"')) || (clean.startsWith("'") && clean.endsWith("'"))) {
      clean = clean.slice(1, -1);
    }
    process.env[key] = clean.replace(/\\n/g, "\n");
  }
}

function loadLocalEnv() {
  const root = process.cwd();
  loadEnvFile(path.join(root, ".env.local"));
  loadEnvFile(path.join(root, ".env"));
}

function requireEnv(...names) {
  for (const name of names) {
    const value = String(process.env[name] || "").trim();
    if (value) return value;
  }
  throw new Error(`Missing required env: ${names.join(" or ")}`);
}

function optionalEnv(...names) {
  for (const name of names) {
    const value = String(process.env[name] || "").trim();
    if (value) return value;
  }
  return "";
}

function dashboardEndpoint() {
  const base = requireEnv("DISCORD_RECRUITMENT_ADVICE_DASHBOARD_URL", "DASHBOARD_URL", "NEXT_PUBLIC_DASHBOARD_URL").replace(/\/+$/, "");
  return `${base}/api/discord/recruitment-advice/message`;
}

function botToken() {
  return requireEnv("DISCORD_BOT_TOKEN");
}

function dashboardSecret() {
  return requireEnv("DISCORD_RECRUITMENT_ADVICE_SECRET", "CRON_SECRET", "INTERNAL_API_TOKEN", "WORKER_STATS_TOKEN");
}

async function discordFetch(pathname, init = {}) {
  const response = await fetch(`${DISCORD_API_BASE}${pathname}`, {
    ...init,
    headers: {
      authorization: `Bot ${botToken()}`,
      "user-agent": USER_AGENT,
      ...(init.headers || {}),
    },
  });

  const text = await response.text().catch(() => "");
  const data = text ? JSON.parse(text) : null;
  if (!response.ok) {
    throw new Error(`Discord API ${response.status}: ${data?.message || text || response.statusText}`);
  }
  return data;
}

async function sendTyping(channelId) {
  if (!channelId) return;
  await discordFetch(`/channels/${channelId}/typing`, { method: "POST" }).catch(() => null);
}

async function forwardMessageToDashboard(message) {
  const endpoint = dashboardEndpoint();
  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      authorization: `Bearer ${dashboardSecret()}`,
      "content-type": "application/json",
      "user-agent": USER_AGENT,
    },
    body: JSON.stringify({ message }),
  });

  const text = await response.text().catch(() => "");
  const data = text ? JSON.parse(text) : null;
  if (!response.ok) {
    throw new Error(`Dashboard ${response.status}: ${data?.error || text || response.statusText}`);
  }
  return data;
}

function enqueueMessage(message) {
  queue = queue
    .then(async () => {
      await sendTyping(message.channel_id);
      const result = await forwardMessageToDashboard(message);
      if (result?.replied) {
        log("info", "recruitment advice replied", { channelId: message.channel_id, messageId: message.id, replyMessageId: result.replyMessageId || null });
      } else if (result?.matched) {
        log("info", "recruitment advice matched but skipped", { channelId: message.channel_id, messageId: message.id, skipped: result.skipped, error: result.error || null });
      }
    })
    .catch((error) => {
      log("warn", "message processing failed", { message: error instanceof Error ? error.message : String(error) });
    });
}

async function gatewayUrl() {
  const data = await discordFetch("/gateway/bot");
  if (!data?.url) throw new Error("Discord gateway URL is missing");
  return `${data.url}?v=10&encoding=json`;
}

function identify() {
  socket?.send(JSON.stringify({
    op: 2,
    d: {
      token: botToken(),
      intents: INTENTS,
      properties: {
        os: process.platform,
        browser: "mistblossom-recruitment-advisor",
        device: "mistblossom-recruitment-advisor",
      },
    },
  }));
}

function heartbeat() {
  if (!socket || socket.readyState !== WebSocket.OPEN) return;
  socket.send(JSON.stringify({ op: 1, d: lastSequence }));
}

function scheduleReconnect(reason) {
  if (stopping) return;
  if (heartbeatTimer) clearInterval(heartbeatTimer);
  heartbeatTimer = null;
  try { socket?.close(); } catch {}
  socket = null;

  const delay = Math.min(60000, 1000 * Math.pow(2, Math.min(reconnectAttempts, 6)));
  reconnectAttempts += 1;
  log("warn", "gateway reconnect scheduled", { delayMs: delay, reason });
  setTimeout(() => connect().catch((error) => scheduleReconnect(error.message)), delay);
}

function handleDispatch(eventType, data) {
  if (eventType === "READY") {
    reconnectAttempts = 0;
    log("info", "gateway ready", { user: data?.user?.username || data?.user?.id || "bot" });
    return;
  }

  if (eventType !== "MESSAGE_CREATE") return;

  const guildId = optionalEnv("DISCORD_GUILD_ID");
  if (guildId && String(data?.guild_id || "") !== guildId) return;
  if (!data?.id || !data?.channel_id || data?.author?.bot || data?.webhook_id) return;

  enqueueMessage(data);
}

async function connect() {
  const url = await gatewayUrl();
  socket = new WebSocket(url);

  socket.addEventListener("open", () => {
    log("info", "gateway socket opened");
  });

  socket.addEventListener("message", (event) => {
    let packet;
    try {
      packet = JSON.parse(String(event.data));
    } catch {
      return;
    }

    if (packet.s !== null && packet.s !== undefined) lastSequence = packet.s;

    if (packet.op === 10) {
      const interval = Number(packet.d?.heartbeat_interval || 45000);
      if (heartbeatTimer) clearInterval(heartbeatTimer);
      heartbeatTimer = setInterval(heartbeat, interval);
      heartbeat();
      identify();
      return;
    }

    if (packet.op === 11) return;
    if (packet.op === 7) return scheduleReconnect("discord requested reconnect");
    if (packet.op === 9) return scheduleReconnect("invalid session");
    if (packet.op === 0) handleDispatch(packet.t, packet.d);
  });

  socket.addEventListener("close", (event) => {
    scheduleReconnect(`socket closed ${event.code || "unknown"}`);
  });

  socket.addEventListener("error", () => {
    scheduleReconnect("socket error");
  });
}

function stop() {
  stopping = true;
  if (heartbeatTimer) clearInterval(heartbeatTimer);
  heartbeatTimer = null;
  try { socket?.close(1000, "shutdown"); } catch {}
  log("info", "stopped");
  process.exit(0);
}

process.on("SIGINT", stop);
process.on("SIGTERM", stop);

loadLocalEnv();

connect().catch((error) => {
  log("error", "gateway startup failed", { message: error instanceof Error ? error.message : String(error) });
  process.exit(1);
});
