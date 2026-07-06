import "server-only";

import { noStoreHeaders } from "@/lib/security";

export type RecruitmentGatewayAction =
  "status" | "start" | "reconnect" | "stop" | "backfill";

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
  messageCreateCount?: number;
  relayAttemptCount?: number;
};

function cleanBaseUrl(value: string) {
  const trimmed = String(value || "")
    .trim()
    .replace(/\/+$/, "");
  return trimmed;
}

function deriveWorkerBaseUrl() {
  const explicit = cleanBaseUrl(
    process.env.GUILD_APPLICATIONS_WORKER_URL ||
      process.env.NEXT_PUBLIC_GUILD_APPLICATIONS_WORKER_URL ||
      "",
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
      // ignore malformed fallback
    }
  }

  return "https://guild-applications.melles-android.workers.dev";
}

export function recruitmentGatewayControlEndpoint() {
  const explicit = String(
    process.env.DISCORD_RECRUITMENT_GATEWAY_ENDPOINT || "",
  ).trim();
  if (explicit) return explicit;
  return `${deriveWorkerBaseUrl()}/api/discord-recruitment-gateway`;
}

export function recruitmentGatewayControlToken() {
  return String(
    process.env.DISCORD_RECRUITMENT_ADVICE_SECRET ||
      process.env.WORKER_STATS_TOKEN ||
      process.env.DISCORD_RULES_STATS_TOKEN ||
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
        "Немає DISCORD_RECRUITMENT_ADVICE_SECRET / WORKER_STATS_TOKEN для виклику Worker.",
    };

  const url = new URL(recruitmentGatewayControlEndpoint());
  url.searchParams.set("action", action);

  const response = await fetch(url.toString(), {
    method: action === "status" ? "GET" : "POST",
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
    data.error = `Worker повернув HTTP ${response.status}`;
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
