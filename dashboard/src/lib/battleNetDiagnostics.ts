import { ApiHttpError } from "@/lib/apiHttp";

export type BattleNetCallbackStage = "profile_upsert" | "oauth_exchange" | "character_scan" | "conflict_check" | "save_sync";
export function battleNetFailureDiagnostic(error: unknown, stage: BattleNetCallbackStage, region: string) {
  let upstreamPath: string | null = null;
  let upstreamStatusCode: number | null = null;
  if (error instanceof ApiHttpError) {
    upstreamStatusCode = error.status;
    try {
      const url = new URL(error.url);
      if (/^(eu|us|kr|tw)\.(api\.blizzard\.com|battle\.net)$/.test(url.hostname)) upstreamPath = url.pathname.startsWith("/profile/wow/character/") ? "/profile/wow/character/:realm/:name" : url.pathname.slice(0, 160);
    } catch { /* A malformed URL never enters diagnostic metadata. */ }
  }
  const errorKind = upstreamStatusCode !== null ? "upstream_http" : error instanceof Error && /timeout|aborted/i.test(error.message) ? "timeout" : "local_or_unknown";
  const status = stage === "character_scan" && upstreamPath === "/profile/user/wow" && upstreamStatusCode === 404 ? "bnet_profile_unavailable"
    : stage === "character_scan" && upstreamPath === "/profile/user/wow" && upstreamStatusCode === 403 ? "bnet_access_denied"
    : errorKind === "timeout" || upstreamStatusCode === 429 || (upstreamStatusCode !== null && upstreamStatusCode >= 500) ? "bnet_unavailable" : "bnet_failed";
  return { stage, region, upstreamPath, upstreamStatusCode, errorKind, status,
    // Provider response bodies can echo OAuth material. Only safe structural evidence is logged.
    message: `Battle.net ${stage}: ${upstreamStatusCode !== null ? `HTTP ${upstreamStatusCode}` : errorKind}.` };
}
