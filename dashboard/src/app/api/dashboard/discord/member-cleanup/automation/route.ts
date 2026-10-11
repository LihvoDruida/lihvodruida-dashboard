import { NextRequest, NextResponse } from "next/server";
import { runDiscordMemberCleanup } from "@/lib/discordMemberCleanup";
import { logDashboardEvent, noStoreHeaders, safeErrorMessage, unauthorizedResponse, verifyInternalBearerToken } from "@/lib/security";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;
export const maxDuration = 55;
export async function POST(request: NextRequest) {
  const auth = await verifyInternalBearerToken(request, ["CRON_SECRET", "INTERNAL_API_TOKEN"], { minLength: 24 });
  if (!auth.ok) return unauthorizedResponse("Forbidden");
  try {
    const result = await runDiscordMemberCleanup({ source: "automatic" });
    if (result.checked || result.kicked || result.failed) logDashboardEvent(result.failed ? "warn" : "info", "discord.member_cleanup.automation_completed", request, result, { category: "action" });
    return NextResponse.json({ ok: true, result }, { headers: noStoreHeaders() });
  } catch (error) {
    const message = safeErrorMessage(error, "Автоматичне очищення Discord не виконано.");
    logDashboardEvent("error", "discord.member_cleanup.automation_failed", request, { message }, { category: "action" });
    return NextResponse.json({ ok: false, error: message }, { status: 503, headers: noStoreHeaders() });
  }
}
