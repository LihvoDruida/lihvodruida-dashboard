import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { canViewAdminLogs } from "@/lib/permissions";
import { listStructuredLogsExportPage, type StructuredLogExportCursor } from "@/lib/structuredLogs";
import { noStoreHeaders } from "@/lib/security";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

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
  const scope = url.searchParams.get("scope") === "all" ? "all" : "filtered";
  const hours = scope === "all" ? 72 : intParam(url.searchParams.get("hours"), 24, 1, 72);
  const filters = {
    hours,
    category: scope === "all" ? "" : String(url.searchParams.get("category") || "").trim(),
    level: scope === "all" ? "" : String(url.searchParams.get("level") || "").trim(),
    search: scope === "all" ? "" : String(url.searchParams.get("q") || "").trim().slice(0, 120),
  };
  const exportedAt = new Date().toISOString();
  const encoder = new TextEncoder();

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      let cursor: StructuredLogExportCursor | null = null;
      let first = true;
      let count = 0;
      try {
        controller.enqueue(encoder.encode(`${JSON.stringify({
          schema: "mistblossom.system-logs.v1",
          exportedAt,
          scope,
          retentionDays: 3,
          filters: scope === "all" ? null : filters,
        }).replace(/}$/, ",\"logs\":[")}\n`));

        do {
          const page = await listStructuredLogsExportPage({
            pageSize: 1000,
            sinceHours: filters.hours,
            category: filters.category || null,
            level: filters.level || null,
            search: filters.search || null,
            cursor,
          });
          for (const item of page.items) {
            const prefix = first ? "" : ",\n";
            controller.enqueue(encoder.encode(`${prefix}${JSON.stringify(item)}`));
            first = false;
            count += 1;
          }
          cursor = page.nextCursor;
        } while (cursor);

        controller.enqueue(encoder.encode(`\n],\"count\":${count}}\n`));
        controller.close();
      } catch (error) {
        controller.error(error);
      }
    },
  });

  const stamp = exportedAt.slice(0, 10);
  const suffix = scope === "all" ? "full-3days" : "filtered";
  return new NextResponse(stream, {
    status: 200,
    headers: {
      ...noStoreHeaders(),
      "Content-Type": "application/json; charset=utf-8",
      "Content-Disposition": `attachment; filename="mistblossom-logs-${suffix}-${stamp}.json"`,
      "X-Content-Type-Options": "nosniff",
    },
  });
}
