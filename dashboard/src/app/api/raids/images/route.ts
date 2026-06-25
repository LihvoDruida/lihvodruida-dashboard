import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { canManageRaids } from "@/lib/permissions";
import { listRaidImageAssets } from "@/lib/raidImages";
import { logDashboardEvent, noStoreHeaders, safeErrorMessage } from "@/lib/security";

export const revalidate = 0;

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const user = await getSession();
  if (!user || !canManageRaids(user)) {
    return NextResponse.json({ ok: false, error: "forbidden", images: [] }, { status: 403, headers: noStoreHeaders() });
  }

  try {
    const images = await listRaidImageAssets();
    return NextResponse.json({ ok: true, images }, { headers: noStoreHeaders() });
  } catch (error) {
    logDashboardEvent("error", "raids.images.list.failed", request, {
      actorId: user.id,
      actorRole: user.role,
      message: safeErrorMessage(error),
    });
    return NextResponse.json({ ok: false, error: safeErrorMessage(error), images: [] }, { status: 500, headers: noStoreHeaders() });
  }
}
