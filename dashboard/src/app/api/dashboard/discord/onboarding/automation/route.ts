import { NextRequest, NextResponse } from "next/server";

import { runDiscordNewcomerOnboarding } from "@/lib/discordNewcomerOnboarding";
import { logDashboardEvent, noStoreHeaders, safeErrorMessage, unauthorizedResponse, verifyInternalBearerToken } from "@/lib/security";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;
export const maxDuration = 55;

const TOKENS = ["CRON_SECRET", "INTERNAL_API_TOKEN", "RAID_LIFECYCLE_SECRET"];

declare global {
  // eslint-disable-next-line no-var
  var __mistblossomDiscordNewcomerOnboardingInFlight: boolean | undefined;
}

export async function POST(request: NextRequest) {
  const auth = await verifyInternalBearerToken(request, TOKENS, { minLength: 24 });
  if (!auth.ok) {
    logDashboardEvent("warn", "discord.newcomer_onboarding.automation_forbidden", request, {
      reason: auth.reason,
      envName: auth.envName || null,
      statusCode: 401,
    }, { category: "security" });
    return unauthorizedResponse("Forbidden");
  }

  if (globalThis.__mistblossomDiscordNewcomerOnboardingInFlight) {
    return NextResponse.json({ ok: true, skipped: true, reason: "in_flight" }, { headers: noStoreHeaders() });
  }

  globalThis.__mistblossomDiscordNewcomerOnboardingInFlight = true;
  try {
    const result = await runDiscordNewcomerOnboarding();
    if (result.initialized || result.newcomers || result.failed) {
      logDashboardEvent(result.failed ? "warn" : "info", "discord.newcomer_onboarding.automation_completed", request, result, { category: "action" });
    }
    return NextResponse.json({ ok: true, result }, { headers: noStoreHeaders() });
  } catch (error) {
    const message = safeErrorMessage(error, "Onboarding нових Discord-учасників не виконано.");
    logDashboardEvent("error", "discord.newcomer_onboarding.automation_failed", request, { message }, { category: "action" });
    return NextResponse.json({ ok: false, error: message }, { status: 500, headers: noStoreHeaders() });
  } finally {
    globalThis.__mistblossomDiscordNewcomerOnboardingInFlight = false;
  }
}
