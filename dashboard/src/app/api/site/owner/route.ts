import { hasSiteBridgeToken } from "@/lib/siteBridgeAuth";
import { NextRequest, NextResponse } from "next/server";
import { buildPublicOwnerSnapshot } from "@/lib/publicSiteOwner";
import { logDashboardEvent, safeErrorMessage } from "@/lib/security";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

const headers = { "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff" };

/** Server-owner characters for the public site; only the site (bridge token) may read it. */
export async function GET(request: NextRequest) {
  if (!hasSiteBridgeToken(request)) return NextResponse.json({ error: "unauthorized" }, { status: 401, headers });
  try {
    return NextResponse.json(await buildPublicOwnerSnapshot(), { headers });
  } catch (error) {
    logDashboardEvent("warn", "public_site.owner_snapshot.failed", request, { message: safeErrorMessage(error) });
    return NextResponse.json({ error: "owner_unavailable" }, { status: 503, headers });
  }
}
