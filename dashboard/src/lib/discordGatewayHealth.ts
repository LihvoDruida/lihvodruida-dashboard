import "server-only";

export type DiscordGatewayHealth = {
  reachable: boolean;
  enabled: boolean;
  configured: boolean;
  connected: boolean;
  ready: boolean;
  queueSize: number;
  activeWorkers: number;
  lastEventAt: string | null;
  lastMemberJoinAt: string | null;
  lastError: string | null;
};

const FALLBACK: DiscordGatewayHealth = {
  reachable: false,
  enabled: false,
  configured: false,
  connected: false,
  ready: false,
  queueSize: 0,
  activeWorkers: 0,
  lastEventAt: null,
  lastMemberJoinAt: null,
  lastError: "bot health unavailable",
};

export async function getDiscordGatewayHealth(): Promise<DiscordGatewayHealth> {
  const url = String(process.env.BOT_INTERNAL_HEALTH_URL || "http://bot:8080/healthz").trim();
  try {
    const response = await fetch(url, {
      cache: "no-store",
      signal: AbortSignal.timeout(1_500),
      headers: { "x-mistblossom-source": "dashboard-welcome" },
    });
    if (!response.ok) return { ...FALLBACK, lastError: `bot health HTTP ${response.status}` };
    const body = await response.json().catch(() => null) as any;
    const gateway = body?.gateway && typeof body.gateway === "object" ? body.gateway : {};
    return {
      reachable: true,
      enabled: Boolean(gateway.enabled),
      configured: Boolean(gateway.configured),
      connected: Boolean(gateway.connected),
      ready: Boolean(gateway.ready),
      queueSize: Number.isFinite(Number(gateway.queueSize)) ? Math.max(0, Number(gateway.queueSize)) : 0,
      activeWorkers: Number.isFinite(Number(gateway.activeWorkers)) ? Math.max(0, Number(gateway.activeWorkers)) : 0,
      lastEventAt: typeof gateway.lastEventAt === "string" ? gateway.lastEventAt : null,
      lastMemberJoinAt: typeof gateway.lastMemberJoinAt === "string" ? gateway.lastMemberJoinAt : null,
      lastError: typeof gateway.lastError === "string" && gateway.lastError ? gateway.lastError : null,
    };
  } catch (error) {
    return {
      ...FALLBACK,
      lastError: error instanceof Error ? error.message : String(error || "bot health unavailable"),
    };
  }
}
