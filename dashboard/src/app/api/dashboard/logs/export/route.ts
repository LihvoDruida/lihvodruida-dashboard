import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { canViewAdminLogs } from "@/lib/permissions";
import { listStructuredLogs } from "@/lib/structuredLogs";
import { noStoreHeaders } from "@/lib/security";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const session = await getSession();
  if (!session || !canViewAdminLogs(session)) {
    return NextResponse.json({ ok: false, error: "forbidden" }, { status: session ? 403 : 401, headers: noStoreHeaders() });
  }
  const hours = Math.max(1, Math.min(72, Number(request.nextUrl.searchParams.get("hours") || 24)));
  const items = await listStructuredLogs({
    limit: 500,
    sinceHours: hours,
    category: request.nextUrl.searchParams.get("category"),
    level: request.nextUrl.searchParams.get("level"),
    search: request.nextUrl.searchParams.get("q"),
  });
  const body = items.map((item) => JSON.stringify(item)).join("\n") + (items.length ? "\n" : "");
  return new NextResponse(body, {
    status: 200,
    headers: {
      ...noStoreHeaders(),
      "Content-Type": "application/x-ndjson; charset=utf-8",
      "Content-Disposition": `attachment; filename="mistblossom-logs-${new Date().toISOString().slice(0,10)}.jsonl"`,
    },
  });
}
