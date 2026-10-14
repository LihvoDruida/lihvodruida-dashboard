import dashboardPackage from "../../../../../../../package.json";
import { NextRequest, NextResponse } from "next/server";
import { processProfileNicknameSyncQueue } from "@/lib/profileNicknameSync";
import {
  noStoreHeaders,
  unauthorizedResponse,
  verifyInternalBearerToken,
} from "@/lib/security";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;
export const maxDuration = 55;
export async function GET(request: NextRequest) {
  const auth = await verifyInternalBearerToken(request, ["CRON_SECRET", "INTERNAL_API_TOKEN"], { minLength: 24 });
  if (!auth.ok) return unauthorizedResponse("Forbidden");
  return NextResponse.json({ ok: true, mode: "read-only", route: "profile-nicknames", dashboardVersion: dashboardPackage.version }, { headers: noStoreHeaders() });
}
export async function POST(request: NextRequest) {
  const auth = await verifyInternalBearerToken(
    request,
    ["CRON_SECRET", "INTERNAL_API_TOKEN"],
    { minLength: 24 },
  );
  if (!auth.ok) return unauthorizedResponse("Forbidden");
  try {
    return NextResponse.json(
      { ok: true, result: await processProfileNicknameSyncQueue() },
      { headers: noStoreHeaders() },
    );
  } catch {
    return NextResponse.json(
      { ok: false, error: "Черга синхронізації тимчасово недоступна." },
      { status: 503, headers: noStoreHeaders() },
    );
  }
}
