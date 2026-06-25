import { NextResponse } from "next/server";

import { getDashboardApiSettings } from "@/lib/dashboardApiSettings";
import { logDashboardEvent } from "@/lib/security";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 300;

function publicCacheHeaders() {
  return {
    "Cache-Control": "private, max-age=300, stale-while-revalidate=600",
  };
}

function publicSettings(settings: Awaited<ReturnType<typeof getDashboardApiSettings>>) {
  return {
    backgroundRefreshMinSeconds: settings.backgroundRefreshMinSeconds,
    profileViewRefreshMinSeconds: settings.profileViewRefreshMinSeconds,
    profileExternalRefreshMinSeconds: settings.profileExternalRefreshMinSeconds,
    source: settings.source,
    updatedAt: settings.updatedAt || null,
  };
}

export async function GET() {
  try {
    const settings = await getDashboardApiSettings();
    return NextResponse.json({ ok: true, settings: publicSettings(settings) }, { headers: publicCacheHeaders() });
  } catch (error) {
    logDashboardEvent("warn", "background_api.settings_public_read_failed", undefined, {
      message: error instanceof Error ? error.message : String(error || "unknown"),
    });
    return NextResponse.json(
      {
        ok: true,
        settings: {
          backgroundRefreshMinSeconds: 600,
          profileViewRefreshMinSeconds: 600,
          profileExternalRefreshMinSeconds: 1800,
          source: "defaults",
          updatedAt: null,
        },
      },
      { headers: publicCacheHeaders() },
    );
  }
}
