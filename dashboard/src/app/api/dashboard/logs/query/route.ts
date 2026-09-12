import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { canViewAdminLogs } from "@/lib/permissions";
import { getStructuredLogOverview, listStructuredLogs } from "@/lib/structuredLogs";
import { getStructuredLogSettings } from "@/lib/logSettings";
import { noStoreHeaders } from "@/lib/security";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

function intParam(value: string | null, fallback: number, min: number, max: number) {
  const n = Number(value);
  return Number.isFinite(n) ? Math.max(min, Math.min(max, Math.floor(n))) : fallback;
}

export async function GET(request: NextRequest) {
  const session = await getSession();
  if (!session || !canViewAdminLogs(session)) {
    return NextResponse.json({ ok: false, error: "forbidden" }, { status: session ? 403 : 401, headers: noStoreHeaders() });
  }

  const url = request.nextUrl;
  const hours = intParam(url.searchParams.get("hours"), 24, 1, 72);
  const limit = intParam(url.searchParams.get("limit"), 100, 20, 500);
  const [items, overview, settings] = await Promise.all([
    listStructuredLogs({
      limit,
      sinceHours: hours,
      category: url.searchParams.get("category"),
      level: url.searchParams.get("level"),
      search: url.searchParams.get("q"),
      before: url.searchParams.get("before"),
    }),
    getStructuredLogOverview(hours),
    getStructuredLogSettings(),
  ]);

  return NextResponse.json({ ok: true, items, overview, settings, now: new Date().toISOString() }, { headers: noStoreHeaders() });
}
