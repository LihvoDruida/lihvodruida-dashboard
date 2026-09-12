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

function securityLike(message) {
  return /signature|підпис|unauthor|неавториз|forbidden|заблок|відхилен|security|rate.?limit/i.test(String(message || ""));
}

function safeContext(context) {
  if (!context || typeof context !== "object" || Array.isArray(context)) return {};
  const out = {};
  for (const [key, value] of Object.entries(context).slice(0, 32)) {
    if (/token|secret|password|authorization|cookie|signature|raw.?body|stack/i.test(key)) out[key] = "[redacted]";
    else if (typeof value === "string") out[key] = value.slice(0, 700);
    else if (typeof value === "number" || typeof value === "boolean" || value == null) out[key] = value;
    else {
      try { out[key] = JSON.parse(JSON.stringify(value)); } catch { out[key] = String(value).slice(0, 300); }
    }
  }
  return out;
}

function forward(level, message, context) {
  if ((LEVELS[level] || LEVELS.info) < SINK_LEVEL) return;
  const url = sinkUrl();
  const token = String(process.env.INTERNAL_API_TOKEN || "").trim();
  if (!url || !token || pending >= MAX_PENDING) return;

  pending += 1;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 2500);
  const category = securityLike(message) ? "security" : "discord";
  fetch(url, {
    method: "POST",
    headers: {
      authorization: `Bearer ${token}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      source: "bot",
      level: level === "warn" ? "warning" : level,
      category,
      event: `bot.${category}.runtime`,
      message: String(message || "").slice(0, 1500),
      details: safeContext(context),
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
    message,
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
