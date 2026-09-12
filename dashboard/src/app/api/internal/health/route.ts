import { NextRequest, NextResponse } from "next/server";
import { documentStoreMode } from "@/lib/firebaseAdmin";
import { noStoreHeaders, verifyInternalBearerToken } from "@/lib/security";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function GET(request: NextRequest) {
  const auth = await verifyInternalBearerToken(request, ["INTERNAL_API_TOKEN"], { minLength: 24 });
  if (!auth.ok) {
    return NextResponse.json(
      { ok: false, error: "unauthorized", reason: auth.reason },
      { status: 401, headers: noStoreHeaders() },
    );
  }

  return NextResponse.json(
    {
      ok: true,
      service: "dashboard",
      documentStore: documentStoreMode(),
      uptimeSeconds: Math.round(process.uptime()),
    },
    { headers: noStoreHeaders() },
  );
}
