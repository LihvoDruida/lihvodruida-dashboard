import { NextRequest, NextResponse } from "next/server";
import { verifyDiscordInteractionSignature } from "@/lib/discordAdmin";
import { enqueueInteractionIngress, leaseInteractionIngress, settleInteractionIngress } from "@/lib/discordInteractionIngress";
import { noStoreHeaders, verifyInternalBearerToken } from "@/lib/security";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;
const HEADERS = noStoreHeaders();
async function authorized(request: NextRequest) {
  const auth = await verifyInternalBearerToken(request, ["INTERNAL_API_TOKEN"], { minLength: 24 });
  return auth.ok && request.headers.get("x-mistblossom-source") === "bot";
}
function fail(code: string, status: number) { return NextResponse.json({ error: code }, { status, headers: HEADERS }); }
async function body(request: NextRequest, maxBytes = 350_000): Promise<Record<string, unknown>> {
  if (Number(request.headers.get("content-length") || 0) > maxBytes) throw new Error("body too large");
  if (!request.body) throw new Error("empty body");
  const reader = request.body.getReader();
  const chunks: Buffer[] = [];
  let received = 0;
  while (true) {
    const part = await reader.read();
    if (part.done) break;
    const chunk = Buffer.from(part.value);
    received += chunk.length;
    if (received > maxBytes) {
      await reader.cancel().catch(() => null);
      throw new Error("body too large");
    }
    chunks.push(chunk);
  }
  const result: unknown = JSON.parse(Buffer.concat(chunks).toString("utf8"));
  if (!result || typeof result !== "object" || Array.isArray(result)) throw new Error("invalid body");
  return result as Record<string, unknown>;
}
export async function POST(request: NextRequest) {
  if (!await authorized(request)) return fail("unauthorized", 401);
  let payload: Record<string, unknown>;
  try { payload = await body(request); } catch { return fail("invalid_body", 400); }
  if (typeof payload.id !== "string" || typeof payload.rawBody !== "string" || typeof payload.signature !== "string" || typeof payload.timestamp !== "string" || typeof payload.domain !== "string") return fail("invalid_body", 400);
  // Verify the original Discord signature in the dashboard as well as the bot.
  try {
    const verified = await verifyDiscordInteractionSignature(new Request("http://localhost", {
      headers: { "x-signature-ed25519": payload.signature, "x-signature-timestamp": payload.timestamp },
    }), payload.rawBody);
    if (!verified) return fail("invalid_signature", 401);
  } catch { return fail("invalid_signature", 401); }
  try {
    const result = await enqueueInteractionIngress({
      id: payload.id, rawBody: payload.rawBody, signature: payload.signature,
      timestamp: payload.timestamp, domain: payload.domain,
    });
    return NextResponse.json({ ok: true, ...result }, { headers: HEADERS });
  } catch (error) {
    if (error instanceof Error && /^(invalid|expired|interaction id reused)/.test(error.message)) return fail("invalid_envelope", 400);
    return fail("ingress_unavailable", 503);
  }
}
export async function GET(request: NextRequest) {
  if (!await authorized(request)) return fail("unauthorized", 401);
  try { return NextResponse.json({ jobs: await leaseInteractionIngress(1) }, { headers: HEADERS }); }
  catch { return fail("ingress_unavailable", 503); }
}
export async function PATCH(request: NextRequest) {
  if (!await authorized(request)) return fail("unauthorized", 401);
  let payload: Record<string, unknown>;
  try { payload = await body(request, 2048); } catch { return fail("invalid_body", 400); }
  if (typeof payload.id !== "string" || typeof payload.leaseId !== "string" || typeof payload.success !== "boolean" || (payload.permanent !== undefined && typeof payload.permanent !== "boolean")) return fail("invalid_body", 400);
  try {
    const ok = await settleInteractionIngress(payload.id, payload.leaseId, payload.success, payload.permanent === true);
    return NextResponse.json({ ok }, { status: ok ? 200 : 409, headers: HEADERS });
  } catch { return fail("ingress_unavailable", 503); }
}
