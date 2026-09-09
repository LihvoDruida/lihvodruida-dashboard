/**
 * Структуровані логи одним рядком JSON.
 * Docker збирає stdout, тому формат має читатись і людиною, і `jq`.
 */

const LEVELS = { debug: 10, info: 20, warn: 30, error: 40 };
const MIN_LEVEL = LEVELS[String(process.env.LOG_LEVEL || "info").toLowerCase()] || LEVELS.info;

function emit(level, message, context) {
  if (LEVELS[level] < MIN_LEVEL) return;
  const line = {
    ts: new Date().toISOString(),
    level,
    service: "mistblossom-bot",
    message,
    ...(context && Object.keys(context).length ? { context } : {}),
  };
  const target = level === "error" || level === "warn" ? process.stderr : process.stdout;
  target.write(`${JSON.stringify(line)}\n`);
}

export const logger = {
  debug: (message, context) => emit("debug", message, context),
  info: (message, context) => emit("info", message, context),
  warn: (message, context) => emit("warn", message, context),
  error: (message, context) => emit("error", message, context),
};
