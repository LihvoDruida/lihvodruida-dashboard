import { NextRequest, NextResponse } from "next/server";
import { noStoreHeaders, verifyInternalBearerToken } from "@/lib/security";
import { leaseInteractionDeliveries, settleInteractionDelivery } from "@/lib/discordInteractionOutbox";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

async function authorized(request: NextRequest) {
  const auth = await verifyInternalBearerToken(request, ["INTERNAL_API_TOKEN"], { minLength: 24 });
  return auth.ok && request.headers.get("x-mistblossom-source") === "bot";
}

export async function GET(request: NextRequest) {
  if (!await authorized(request)) return NextResponse.json({ error: "unauthorized" }, { status: 401, headers: noStoreHeaders() });
  try {
    const jobs = await leaseInteractionDeliveries(10);
    return NextResponse.json({ jobs }, { headers: noStoreHeaders() });
  } catch {
    return NextResponse.json({ error: "outbox_unavailable" }, { status: 503, headers: noStoreHeaders() });
  }
}

export async function POST(request: NextRequest) {
  if (!await authorized(request)) return NextResponse.json({ error: "unauthorized" }, { status: 401, headers: noStoreHeaders() });
  const length = Number(request.headers.get("content-length") || 0);
  if (length > 2048) return NextResponse.json({ error: "too_large" }, { status: 413, headers: noStoreHeaders() });
  let input: Record<string, unknown>;
  try {
    const raw = await request.text();
    if (Buffer.byteLength(raw, "utf8") > 2048) throw new Error("too large");
    input = JSON.parse(raw);
  } catch {
    return NextResponse.json({ error: "invalid_body" }, { status: 400, headers: noStoreHeaders() });
  }
  if (typeof input.id !== "string" || typeof input.leaseId !== "string" || typeof input.success !== "boolean" || (input.permanent !== undefined && typeof input.permanent !== "boolean")) {
    return NextResponse.json({ error: "invalid_body" }, { status: 400, headers: noStoreHeaders() });
  }
  try {
    const settled = await settleInteractionDelivery(input.id, input.leaseId, input.success, input.permanent === true);
    return NextResponse.json({ ok: settled }, { status: settled ? 200 : 409, headers: noStoreHeaders() });
  } catch {
    return NextResponse.json({ error: "outbox_unavailable" }, { status: 503, headers: noStoreHeaders() });
  }
}
