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
    const jobs = await leaseInteractionDeliveries(1);
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
    if (!request.body) throw new Error("empty body");
    const reader = request.body.getReader();
    const chunks: Uint8Array[] = [];
    let size = 0;
    while (true) {
      const part = await reader.read();
      if (part.done) break;
      size += part.value.byteLength;
      if (size > 2048) {
        await reader.cancel().catch(() => null);
        throw new Error("too large");
      }
      chunks.push(part.value);
    }
    const parsed: unknown = JSON.parse(Buffer.concat(chunks).toString("utf8"));
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("invalid object");
    input = parsed as Record<string, unknown>;
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
