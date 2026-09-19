/**
 * Structured bot logger.
 *
 * stdout/stderr remains the immediate Docker diagnostic stream, while a small
 * fire-and-forget sink forwards bounded structured events to the dashboard's
 * PostgreSQL log store. The sink never delays Discord ACKs and never mirrors
 * ordinary bot logs to Discord; only the dashboard Security category may do so.
 */

const LEVELS = { debug: 10, info: 20, warn: 30, error: 40 };
const MIN_LEVEL = LEVELS[String(process.env.LOG_LEVEL || "info").toLowerCase()] || LEVELS.info;
const SINK_LEVEL = LEVELS[String(process.env.BOT_LOG_SINK_LEVEL || "info").toLowerCase()] || LEVELS.info;
const MAX_PENDING = 48;
let pending = 0;

function sinkUrl() {
  const base = String(process.env.DASHBOARD_INTERNAL_URL || process.env.DASHBOARD_URL || "").replace(/\/+$/, "");
  return base ? `${base}/api/dashboard/logs/ingest` : "";
}


function safeString(value, max = 1500) {
  return String(value ?? "")
    .replace(/Bot\s+[A-Za-z0-9._~+\/-]+/gi, "Bot [redacted]")
    .replace(/Bearer\s+[A-Za-z0-9._~+\/-]+/gi, "Bearer [redacted]")
    .replace(/(postgres(?:ql)?:\/\/[^:\s/]+:)[^@\s/]+(@)/gi, "$1[redacted]$2")
    .replace(/(token|secret|password|client_secret)=([^&\s]+)/gi, "$1=[redacted]")
    .replace(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g, "[email]")
    .slice(0, max);
}

function securityLike(message) {
  return /signature|підпис|unauthor|неавториз|forbidden|заблок|відхилен|security|rate.?limit/i.test(String(message || ""));
}

function safeValue(value, depth = 0) {
  if (value == null || typeof value === "number" || typeof value === "boolean") return value;
  if (typeof value === "string") return safeString(value, depth === 0 ? 700 : 400);
  if (depth >= 4) return "[max-depth]";
  if (Array.isArray(value)) return value.slice(0, 24).map((item) => safeValue(item, depth + 1));
  if (typeof value === "object") {
    const out = {};
    for (const [key, child] of Object.entries(value).slice(0, 32)) {
      if (/token|secret|password|authorization|cookie|signature|raw.?body|stack|private.?key/i.test(key)) out[key] = "[redacted]";
      else out[key] = safeValue(child, depth + 1);
    }
    return out;
  }
  return safeString(value, 300);
}

function safeContext(context) {
  if (!context || typeof context !== "object" || Array.isArray(context)) return {};
  return safeValue(context, 0);
}

function forward(level, message, context) {
  if ((LEVELS[level] || LEVELS.info) < SINK_LEVEL) return;
  const url = sinkUrl();
  const token = String(process.env.INTERNAL_API_TOKEN || "").trim();
  if (!url || !token || pending >= MAX_PENDING) return;

  const clean = safeContext(context);
  const category = securityLike(message) || clean.category === "security" ? "security" : "discord";
  const requestedEvent = typeof clean.eventName === "string" ? clean.eventName.trim() : "";
  const event = /^[a-z0-9_.:-]{3,180}$/i.test(requestedEvent)
    ? requestedEvent
    : `bot.${category}.runtime`;
  const details = { ...clean };
  delete details.eventName;
  delete details.category;
  for (const key of ["requestId", "method", "path", "statusCode", "durationMs", "ip"]) delete details[key];

  pending += 1;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 2500);
  fetch(url, {
    method: "POST",
    headers: {
      authorization: `Bearer ${token}`,
      "content-type": "application/json",
      "x-mistblossom-source": "bot",
    },
    body: JSON.stringify({
      source: "bot",
      level: level === "warn" ? "warning" : level,
      category,
      event,
      message: safeString(message, 1500),
      requestId: typeof clean.requestId === "string" ? clean.requestId : undefined,
      method: typeof clean.method === "string" ? clean.method : undefined,
      path: typeof clean.path === "string" ? clean.path : undefined,
      statusCode: typeof clean.statusCode === "number" ? clean.statusCode : undefined,
      durationMs: typeof clean.durationMs === "number" ? clean.durationMs : undefined,
      ip: typeof clean.ip === "string" ? clean.ip : undefined,
      details,
    }),
    signal: controller.signal,
  }).catch(() => null).finally(() => {
    clearTimeout(timer);
    pending = Math.max(0, pending - 1);
  });
}

function emit(level, message, context) {
  if (LEVELS[level] < MIN_LEVEL) return;
  const clean = safeContext(context);
  const line = {
    ts: new Date().toISOString(),
    level,
    service: "mistblossom-bot",
    message: safeString(message, 1500),
    ...(Object.keys(clean).length ? { context: clean } : {}),
  };
  const target = level === "error" || level === "warn" ? process.stderr : process.stdout;
  target.write(`${JSON.stringify(line)}\n`);
  forward(level, message, clean);
}

export const logger = {
  debug: (message, context) => emit("debug", message, context),
  info: (message, context) => emit("info", message, context),
  warn: (message, context) => emit("warn", message, context),
  error: (message, context) => emit("error", message, context),
};
