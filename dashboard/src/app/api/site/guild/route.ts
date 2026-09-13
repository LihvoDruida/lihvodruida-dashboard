import { NextRequest, NextResponse } from "next/server";
import { buildPublicGuildSnapshot, publicSiteCorsHeaders } from "@/lib/publicSiteBridge";
import { checkRateLimit, getClientIp, logDashboardEvent, safeErrorMessage } from "@/lib/security";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function OPTIONS(request: NextRequest) {
  return new NextResponse(null, { status: 204, headers: publicSiteCorsHeaders(request, "GET, OPTIONS") });
}

export async function GET(request: NextRequest) {
  const ip = getClientIp(request);
  const limit = checkRateLimit(`public-site:guild:get:${ip}`, 120, 60 * 1000);
  if (!limit.ok) {
    return NextResponse.json({ error: "Забагато запитів." }, { status: 429, headers: publicSiteCorsHeaders(request, "GET, OPTIONS") });
  }

  try {
    const payload = await buildPublicGuildSnapshot();
    return NextResponse.json(payload, { headers: { ...publicSiteCorsHeaders(request, "GET, OPTIONS"), "Cache-Control": "public, max-age=30, stale-while-revalidate=120" } });
  } catch (error) {
    logDashboardEvent("error", "public_site.guild_snapshot.failed", request, { message: safeErrorMessage(error) });
    return NextResponse.json({ error: "Публічні дані гільдії тимчасово недоступні." }, { status: 503, headers: publicSiteCorsHeaders(request, "GET, OPTIONS") });
  }
}
