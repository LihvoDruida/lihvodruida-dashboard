import { hasSiteBridgeToken } from "@/lib/siteBridgeAuth";
import { NextRequest, NextResponse } from "next/server";
import { publicSiteCommunities } from "@/lib/siteCommunities";
import { logDashboardEvent, safeErrorMessage } from "@/lib/security";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

const headers = { "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff" };

/** Communities block of the public site's home page; only the site (bridge token) may read it. */
export async function GET(request: NextRequest) {
  if (!hasSiteBridgeToken(request)) return NextResponse.json({ error: "unauthorized" }, { status: 401, headers });
  try {
    return NextResponse.json(await publicSiteCommunities(), { headers });
  } catch (error) {
    logDashboardEvent("warn", "public_site.communities.failed", request, { message: safeErrorMessage(error) });
    return NextResponse.json({ error: "communities_unavailable" }, { status: 503, headers });
  }
}
