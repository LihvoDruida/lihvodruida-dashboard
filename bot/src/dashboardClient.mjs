import { logger } from "./logger.mjs";
import { validateInteractionComponents } from "@mistblossom/discord-contract";

/**
 * Клієнт до панелі й до Discord.
 *
 * Схема роботи, і чому вона саме така:
 *
 *   1. Бот миттєво відповідає Discord «прийнято, думаю» (deferred).
 *   2. Пересилає взаємодію в панель і чекає на відповідь скільки треба.
 *   3. Редагує ту саму відкладену відповідь готовим текстом і компонентами.
 *
 * Крок 3 обовʼязковий. Без нього людина бачить вічне «застосунок думає»:
 * Discord дає 3 секунди на ACK і 15 хвилин на результат, але результат
 * хтось має надіслати. Раніше це робив Cloudflare Worker — тепер бот.
 *
 * Токен бота тут НЕ потрібен: редагування відповіді на взаємодію
 * авторизується самим interaction token, який Discord прислав у запиті.
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
async function callDashboard({ rawBody, signature, timestamp, domain, interactionId }) {
  const token = INTERNAL_TOKEN();
  if (!token) throw new Error("INTERNAL_API_TOKEN не задано");

  const url = `${DASHBOARD_URL()}/api/discord/interactions`;
  let lastError = null;

  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt += 1) {
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

    if (attempt < MAX_ATTEMPTS - 1) {
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
    body: JSON.stringify(payload),
  }, DISCORD_TIMEOUT_MS);

  if (response.ok) return true;

  const text = await response.text().catch(() => "");
  throw new Error(`Discord відхилив відповідь ${response.status}: ${text.slice(0, 300)}`);
}

/**
 * Повний цикл: панель → Discord.
 *
 * Якщо щось падає, людина має побачити зрозумілий текст, а не вічне «думаю».
 * Тому будь-яка помилка все одно закінчується спробою написати, що сталося.
 */
export async function completeInteraction({ rawBody, signature, timestamp, interaction, domain }) {
  const interactionToken = String(interaction?.token || "");
  if (!interactionToken) throw new Error("У взаємодії немає token");

  try {
    const result = await callDashboard({
      rawBody,
      signature,
      timestamp,
      domain,
      interactionId: interaction?.id,
    });

    const payload = messagePayloadFrom(result);
    if (!payload) {
      logger.warn("Панель не повернула тіла відповіді", { domain });
      await patchOriginalResponse(interactionToken, {
        content: "⚠️ Панель не повернула відповіді. Спробуйте ще раз або відкрийте сайт.",
        components: [],
      });
      return;
    }

    // Перевіряємо набір компонентів ДО відправки. Дубль custom_id Discord
    // відхиляє помилкою 400, і колись це вбивало весь приватний пульт
    // голосування: людина бачила текст без жодної кнопки.
    if (payload.components) {
      const check = validateInteractionComponents(payload.components);
      if (!check.ok) {
        logger.error("Панель повернула некоректні компоненти", {
          domain,
          duplicates: check.duplicates,
          tooLong: check.tooLong,
          rows: check.rows,
        });
        // Краще показати текст без кнопок, ніж отримати 400 і не показати
        // взагалі нічого.
        delete payload.components;
      }
    }

    await patchOriginalResponse(interactionToken, payload);
    logger.debug("Взаємодію завершено", { domain });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    logger.error("Збій завершення взаємодії", { domain, error: message });
    await patchOriginalResponse(interactionToken, {
      content: "⚠️ Не вдалося обробити дію. Спробуйте ще раз за хвилину або відкрийте панель на сайті.",
      components: [],
    }).catch(() => null);
  }
}
