import { NextRequest, NextResponse } from "next/server";
import { staticChallengeStatus } from "@/lib/staticRules";
import { checkRateLimit, getClientIp, noStoreHeaders } from "@/lib/security";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function GET(request: NextRequest) {
  const ip = getClientIp(request);
  if (!checkRateLimit(`static-status:${ip}`, 180, 15 * 60_000).ok) return NextResponse.json({ ok: false }, { status: 429, headers: noStoreHeaders() });
  try {
    const status = await staticChallengeStatus(request.nextUrl.searchParams.get("code") || "", request.nextUrl.searchParams.get("v") || "");
    return NextResponse.json(status ? { ok: true, ...status } : { ok: false }, { status: status ? 200 : 404, headers: noStoreHeaders() });
  } catch { return NextResponse.json({ ok: false }, { status: 503, headers: noStoreHeaders() }); }
}
