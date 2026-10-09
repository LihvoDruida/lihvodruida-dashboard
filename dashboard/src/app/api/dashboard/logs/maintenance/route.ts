import { NextRequest, NextResponse } from "next/server";
import { maintainStructuredLogs, recordStructuredLog } from "@/lib/structuredLogs";
import { noStoreHeaders, verifyInternalBearerToken } from "@/lib/security";
import { pruneInteractionOutbox } from "@/lib/discordInteractionOutbox";
import { pruneInteractionIngress } from "@/lib/discordInteractionIngress";
import { pruneRevokedSessions } from "@/lib/sessionRevocation";
import { pruneStaticChallengeQuotas } from "@/lib/staticRules";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

const TOKENS = ["CRON_SECRET", "INTERNAL_API_TOKEN"];

export async function POST(request: NextRequest) {
  const auth = await verifyInternalBearerToken(request, TOKENS);
  if (!auth.ok) return NextResponse.json({ ok: false, error: auth.reason }, { status: 401, headers: noStoreHeaders() });

  const result = await maintainStructuredLogs();
  // Security retention is best-effort; never prevent ordinary log maintenance.
  // The claims stay authoritative until their signed timestamp window closes.
  const [replay, sessions, challenges, ingress] = await Promise.allSettled([
    pruneInteractionOutbox(), pruneRevokedSessions(), pruneStaticChallengeQuotas(), pruneInteractionIngress(),
  ]);
  const securityRetention = {
    replayDeleted: replay.status === "fulfilled" ? replay.value : 0,
    sessionsDeleted: sessions.status === "fulfilled" ? sessions.value : 0,
    challengeQuotasDeleted: challenges.status === "fulfilled" ? challenges.value : 0,
    ingressDeleted: ingress.status === "fulfilled" ? ingress.value : 0,
    failed: Number(replay.status === "rejected") + Number(sessions.status === "rejected") + Number(challenges.status === "rejected") + Number(ingress.status === "rejected"),
  };
  if (result.ok && result.deleted > 0) {
    void recordStructuredLog({
      category: "system",
      level: "info",
      source: "cron",
      event: "logging.retention.cleanup",
      message: `Очищено ${result.deleted} старих/надлишкових записів журналу.`,
      details: result,
    });
  }
  return NextResponse.json({ ...result, securityRetention }, { headers: noStoreHeaders() });
}
