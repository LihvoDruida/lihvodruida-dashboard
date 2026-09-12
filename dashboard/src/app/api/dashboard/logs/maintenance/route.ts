import { NextRequest, NextResponse } from "next/server";
import { maintainStructuredLogs, recordStructuredLog } from "@/lib/structuredLogs";
import { noStoreHeaders, verifyInternalBearerToken } from "@/lib/security";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

const TOKENS = ["CRON_SECRET", "INTERNAL_API_TOKEN"];

export async function POST(request: NextRequest) {
  const auth = await verifyInternalBearerToken(request, TOKENS);
  if (!auth.ok) return NextResponse.json({ ok: false, error: auth.reason }, { status: 401, headers: noStoreHeaders() });

  const result = await maintainStructuredLogs();
  if (result.ok && result.deleted > 0) {
    void recordStructuredLog({
      category: "system",
      level: "info",
      source: "cron",
      event: "logging.retention.cleanup",
      message: `Очищено ${result.deleted} старих/надлишкових записів журналу.`,
      details: result,
    });
  }
  return NextResponse.json(result, { headers: noStoreHeaders() });
}
