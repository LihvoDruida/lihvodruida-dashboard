import { createServer } from "node:http";
import { randomUUID } from "node:crypto";
import botPackage from "../package.json" with { type: "json" };
import { inspectDiscordSignature } from "./signature.mjs";
import { completeInteraction } from "./dashboardClient.mjs";
import { logger } from "./logger.mjs";
import { startDiscordGatewayBridge, discordGatewayHealth } from "./gateway.mjs";
import {
  INTERACTION_DOMAINS,
  interactionDomainFor,
  isRaidPollPromptKind,
  decodeRaidPollCustomId,
} from "@mistblossom/discord-contract";

/**
 * Бот Mistblossom Vanguard.
 *
 * Раніше цю роль виконував Cloudflare Worker. Тепер, коли все живе на власному
 * сервері, бот — окремий контейнер поруч із панеллю. Розділення дає три речі:
 * перезапуск панелі не рве відповіді Discord (у якого рівно 3 секунди на
 * підтвердження), логи бота не тонуть у логах сайту, і бот можна оновлювати
 * окремо від релізів панелі.
 *
 * Бот НЕ знає бізнес-логіки. Його робота: перевірити підпис, зрозуміти домен
 * дії, миттєво відповісти Discord «прийнято» і переслати запит у панель.
 * Бізнес-логіка лишається в панелі. Бот тримає лише транспорт: interaction ACK
 * і доставку завершеної interaction-відповіді. Бази даних у контейнері бота немає.
 */

const PORT = Number(process.env.PORT || 8080);
const HOST = process.env.HOST || "0.0.0.0";

/** Ліміт тіла запиту. Discord ніколи не шле більше кількох десятків кілобайт. */
const MAX_BODY_BYTES = 256 * 1024;

const InteractionType = {
  PING: 1,
  APPLICATION_COMMAND: 2,
  MESSAGE_COMPONENT: 3,
  MODAL_SUBMIT: 5,
};

const CallbackType = {
  PONG: 1,
  CHANNEL_MESSAGE: 4,
  DEFERRED_CHANNEL_MESSAGE: 5,
  DEFERRED_UPDATE_MESSAGE: 6,
};

const EPHEMERAL = 64;

function json(response, status, payload) {
  const body = JSON.stringify(payload);
  response.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "content-length": Buffer.byteLength(body),
    "cache-control": "no-store",
  });
  response.end(body);
}

async function readBody(request) {
  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    // Обриваємо ДО накопичення: інакше зловмисний клієнт може вичерпати
    // памʼять процесу ще до перевірки підпису.
    if (size > MAX_BODY_BYTES) throw new Error("payload_too_large");
    chunks.push(chunk);
  }
  return Buffer.concat(chunks).toString("utf8");
}

/**
 * Тип відкладеної відповіді.
 *
 * Це те місце, де колись зламався пульт голосування: дію, що відкриває пульт
 * із ПУБЛІЧНОГО повідомлення, помилково відправили шляхом «оновити
 * повідомлення» — і бот перезаписав би публічний embed приватним пультом на
 * очах у гільдії. Тому правило винесене в одну функцію з поясненням.
 */
function deferredResponseFor(interaction, customId) {
  const domain = interactionDomainFor(customId);
  const fromEphemeral = Boolean((interaction?.message?.flags || 0) & EPHEMERAL);

  if (domain === INTERACTION_DOMAINS.RAID_POLL) {
    const action = decodeRaidPollCustomId(customId, interaction?.data?.values);
    // Пульт відкривається з публічного повідомлення → потрібна НОВА
    // ефемерна відповідь, а не редагування наявної.
    if (action && isRaidPollPromptKind(action.kind) && !fromEphemeral) {
      return { type: CallbackType.DEFERRED_CHANNEL_MESSAGE, data: { flags: EPHEMERAL } };
    }
    return { type: CallbackType.DEFERRED_UPDATE_MESSAGE };
  }

  // Решта доменів редагує те повідомлення, з якого прийшли, якщо воно
  // ефемерне, і інакше створює приватну відповідь.
  return fromEphemeral
    ? { type: CallbackType.DEFERRED_UPDATE_MESSAGE }
    : { type: CallbackType.DEFERRED_CHANNEL_MESSAGE, data: { flags: EPHEMERAL } };
}

async function handleInteraction(interaction, rawBody, signature, timestamp) {
  if (interaction.type === InteractionType.PING) {
    return { type: CallbackType.PONG };
  }

  const customId = String(interaction?.data?.custom_id || "");
  const domain = interactionDomainFor(customId);

  if (interaction.type === InteractionType.MESSAGE_COMPONENT && !domain) {
    logger.warn("Невідомий custom_id", { customId: customId.slice(0, 60) });
    return {
      type: CallbackType.CHANNEL_MESSAGE,
      data: {
        flags: EPHEMERAL,
        content: "⚠️ Ця кнопка більше не обслуговується. Оновіть повідомлення або відкрийте панель на сайті.",
      },
    };
  }

  const deferred = deferredResponseFor(interaction, customId);

  // Робота йде ПІСЛЯ того, як Discord отримав підтвердження: у нього рівно
  // 3 секунди, а панель може думати довше (транзакція + запис у базу).
  // setImmediate, а не await: відповідь має піти зараз.
  setImmediate(() => {
    completeInteraction({ rawBody, signature, timestamp, interaction, domain }).catch((error) => {
      logger.error("Взаємодію не завершено", {
        domain,
        customId: customId.slice(0, 60),
        error: error instanceof Error ? error.message : String(error),
      });
    });
  });

  return deferred;
}

/**
 * Шляхи живості. `/health` — наша власна конвенція, як у панелі; `/healthz` —
 * те, чого за замовчуванням чекають healthcheck Docker і більшість
 * оркестраторів. Підтримуємо обидва, бо розбіжність між конфігом і кодом
 * тут проявляється не помилкою, а тихо непіднятим контейнером.
 */
const HEALTH_PATHS = new Set(["/health", "/healthz"]);

/**
 * Шляхи взаємодій.
 *
 * Назовні nginx віддає `/discord/interactions` — саме його вписують у Discord
 * Developer Portal як Interactions Endpoint URL. Короткий `/interactions`
 * лишається для прямих внутрішніх викликів і локальної розробки, коли nginx
 * попереду немає.
 */
const INTERACTION_PATHS = ["/discord/interactions", "/interactions"];

function requestPath(request) {
  return String(request.url || "/").split("?")[0];
}

function headerValue(request, name, max = 240) {
  const value = request.headers[String(name || "").toLowerCase()];
  const text = Array.isArray(value) ? value[0] : value;
  return String(text || "").trim().slice(0, max);
}

function requestIp(request) {
  // Nginx overwrites CF-Connecting-IP/X-Real-IP with the trusted real client IP.
  // The bot port is not published to the host, so a browser cannot bypass this
  // proxy normalization from the public internet.
  const fromProxy = headerValue(request, "cf-connecting-ip", 80)
    || headerValue(request, "x-real-ip", 80);
  if (fromProxy) return fromProxy;
  return String(request.socket?.remoteAddress || "unknown").replace(/^::ffff:/, "").slice(0, 80);
}

function requestDiagnosticContext(request, path, extra = {}) {
  const contentLengthRaw = headerValue(request, "content-length", 32);
  const contentLength = /^\d+$/.test(contentLengthRaw) ? Number(contentLengthRaw) : null;
  return {
    requestId: randomUUID(),
    method: String(request.method || "POST").slice(0, 12),
    path: String(path || "/").slice(0, 500),
    ip: requestIp(request),
    host: headerValue(request, "host", 180),
    userAgent: headerValue(request, "user-agent", 240) || "unknown",
    contentType: headerValue(request, "content-type", 120) || null,
    contentLength,
    cfRay: headerValue(request, "cf-ray", 120) || null,
    trustedProxy: headerValue(request, "x-mistblossom-trusted-proxy", 16) || null,
    ...extra,
  };
}

const server = createServer(async (request, response) => {
  const path = requestPath(request);

  if (request.method === "GET" && HEALTH_PATHS.has(path)) {
    return json(response, 200, {
      ok: true,
      service: "mistblossom-bot",
      version: String(botPackage.version || "unknown"),
      uptimeSeconds: Math.round(process.uptime()),
      gateway: discordGatewayHealth(),
    });
  }

  const isInteraction = INTERACTION_PATHS.some(
    (prefix) => path === prefix || path.startsWith(`${prefix}/`),
  );
  if (request.method !== "POST" || !isInteraction) {
    return json(response, 404, { error: "not_found" });
  }

  let rawBody = "";
  try {
    rawBody = await readBody(request);
  } catch {
    logger.warn("Відхилено Discord interaction: тіло запиту завелике", requestDiagnosticContext(request, path, {
      eventName: "bot.security.discord_payload_too_large",
      category: "security",
      statusCode: 413,
      reason: "payload_too_large",
      maxBodyBytes: MAX_BODY_BYTES,
    }));
    return json(response, 413, { error: "payload_too_large" });
  }

  // Підпис перевіряється ДО розбору JSON: непідписаний запит не має
  // потрапляти навіть у JSON.parse.
  const signature = String(request.headers["x-signature-ed25519"] || "");
  const timestamp = String(request.headers["x-signature-timestamp"] || "");
  const verification = inspectDiscordSignature(rawBody, signature, timestamp);
  if (!verification.ok) {
    logger.warn("Відхилено Discord interaction: підпис не пройшов перевірку", requestDiagnosticContext(request, path, {
      eventName: "bot.security.invalid_discord_signature",
      category: "security",
      statusCode: 401,
      reason: verification.reason,
      publicKeyConfigured: verification.publicKeyConfigured,
      publicKeyValid: verification.publicKeyValid,
      ed25519Present: verification.ed25519Present,
      ed25519Length: verification.ed25519Length,
      ed25519FormatValid: verification.ed25519FormatValid,
      timestampPresent: verification.timestampPresent,
      timestampNumeric: verification.timestampNumeric,
      timestampAgeSec: verification.timestampAgeSec,
      timestampSkewSec: verification.timestampSkewSec,
      bodyBytes: verification.bodyBytes,
    }));
    return json(response, 401, { error: "invalid_signature" });
  }

  let interaction;
  try {
    interaction = JSON.parse(rawBody);
  } catch {
    logger.warn("Відхилено Discord interaction: після валідного підпису отримано некоректний JSON", requestDiagnosticContext(request, path, {
      eventName: "bot.discord.invalid_json",
      category: "discord",
      statusCode: 400,
      reason: "invalid_json",
      bodyBytes: Buffer.byteLength(rawBody, "utf8"),
    }));
    return json(response, 400, { error: "invalid_json" });
  }

  try {
    const payload = await handleInteraction(interaction, rawBody, signature, timestamp);
    return json(response, 200, payload);
  } catch (error) {
    logger.error("Збій обробки взаємодії", {
      error: error instanceof Error ? error.message : String(error),
    });
    return json(response, 200, {
      type: CallbackType.CHANNEL_MESSAGE,
      data: { flags: EPHEMERAL, content: "⚠️ Сталася помилка. Спробуйте ще раз за хвилину." },
    });
  }
});

const stopGateway = startDiscordGatewayBridge();

server.listen(PORT, HOST, () => {
  logger.info("Бот слухає", { host: HOST, port: PORT });
});

// Без цього Docker чекав би 10 секунд таймауту на кожен рестарт.
for (const signal of ["SIGTERM", "SIGINT"]) {
  process.once(signal, () => {
    logger.info("Зупинка", { signal });
    try { stopGateway?.(); } catch {}
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(0), 5000).unref();
  });
}
