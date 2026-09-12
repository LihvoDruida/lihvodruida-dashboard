import "server-only";

import { noStoreHeaders } from "@/lib/security";

export type RecruitmentGatewayAction =
  "status" | "start" | "reconnect" | "stop" | "test-relay" | "manual-scan";

export type RecruitmentGatewayStatus = {
  ok: boolean;
  enabled?: boolean;
  connected?: boolean;
  readyState?: number | null;
  startedAt?: string | null;
  lastEventAt?: string | null;
  lastHeartbeatSentAt?: string | null;
  lastHeartbeatAckAt?: string | null;
  seq?: number | null;
  sessionId?: boolean;
  resumeGatewayUrl?: boolean;
  lastError?: string;
  error?: string;
  backfill?: unknown;
  lastRelayAt?: string | null;
  lastRelayStatus?: number | string | null;
  lastRelaySummary?: string | null;
  lastRelayedMessageId?: string | null;
  lastRelayedChannelId?: string | null;
  lastDispatchType?: string | null;
  lastDispatchAt?: string | null;
  lastMessageCreateAt?: string | null;
  lastMessageDropAt?: string | null;
  lastMessageDropReason?: string | null;
  lastMessageDropSummary?: string | null;
  lastMessageContentLength?: number | null;
  lastMessageGuildId?: string | null;
  lastMessageChannelId?: string | null;
  lastMessageId?: string | null;
  dispatchCount?: number;
  messageCreateCount?: number;
  relayAttemptCount?: number;
  lastMessageAuthorId?: string | null;
  lastRelayAttemptAt?: string | null;
  lastRelayError?: string | null;
  lastDashboardResponseRawShort?: string | null;
  hint?: string | null;
};

function cleanBaseUrl(value: string) {
  const trimmed = String(value || "")
    .trim()
    .replace(/\/+$/, "");
  return trimmed;
}

/**
 * Базова адреса сервісу бота.
 *
 * Раніше тут був Cloudflare Worker; тепер рекрутинговий gateway живе в
 * нашому контейнері `bot`, тож за замовчуванням ходимо туди внутрішньою
 * мережею. Публічний URL між нашими ж сервісами не потрібен: трафік не має
 * виходити назовні й повертатись через nginx.
 */
function deriveBotBaseUrl() {
  const explicit = cleanBaseUrl(
    process.env.BOT_INTERNAL_URL
      || process.env.DISCORD_BOT_SERVICE_URL
      || "",
  );
  if (explicit) return explicit;

  const interactionEndpoint = String(
    process.env.DISCORD_INTERACTIONS_ENDPOINT || "",
  ).trim();
  if (interactionEndpoint) {
    try {
      const url = new URL(interactionEndpoint);
      return `${url.protocol}//${url.host}`;
    } catch {
      // некоректний URL у налаштуваннях — падаємо на типове імʼя сервісу
    }
  }

  return "http://bot:8080";
}

export function recruitmentGatewayControlEndpoint() {
  const explicit = String(
    process.env.DISCORD_RECRUITMENT_GATEWAY_ENDPOINT || "",
  ).trim();
  if (explicit) return explicit;
  return `${deriveBotBaseUrl()}/discord/recruitment-gateway`;
}

export function recruitmentGatewayControlToken() {
  return String(
    process.env.INTERNAL_API_TOKEN ||
      process.env.DISCORD_RECRUITMENT_ADVICE_SECRET ||
      process.env.INTERNAL_PROFILE_LOOKUP_TOKEN ||
      process.env.CRON_SECRET ||
      "",
  ).trim();
}

export async function callRecruitmentGatewayControl(
  action: RecruitmentGatewayAction,
): Promise<RecruitmentGatewayStatus> {
  const token = recruitmentGatewayControlToken();
  if (!token)
    return {
      ok: false,
      error:
        "Немає DISCORD_RECRUITMENT_ADVICE_SECRET / INTERNAL_API_TOKEN для виклику бота.",
    };

  const url = new URL(recruitmentGatewayControlEndpoint());
  url.searchParams.set("action", action);

  const timeoutMs = action === "manual-scan"
    ? 75_000
    : action === "test-relay"
      ? 45_000
      : 8_000;

  const response = await fetch(url.toString(), {
    method: action === "status" ? "GET" : "POST",
    signal: AbortSignal.timeout(timeoutMs),
    headers: {
      accept: "application/json",
      authorization: `Bearer ${token}`,
      "x-worker-stats-token": token,
    },
    cache: "no-store",
  });
  const raw = await response.text().catch(() => "");
  let data: RecruitmentGatewayStatus;
  try {
    data = raw ? JSON.parse(raw) : { ok: response.ok };
  } catch {
    data = {
      ok: response.ok,
      error: raw.slice(0, 500) || `HTTP ${response.status}`,
    };
  }
  if (!response.ok && !data.error)
    data.error = `Bot повернув HTTP ${response.status}`;
  return data;
}

export async function safeRecruitmentGatewayStatus(): Promise<RecruitmentGatewayStatus> {
  try {
    return await callRecruitmentGatewayControl("status");
  } catch (error) {
    return {
      ok: false,
      error:
        error instanceof Error ? error.message : String(error || "unknown"),
    };
  }
}

export function recruitmentGatewayNoStoreHeaders() {
  return noStoreHeaders();
}
