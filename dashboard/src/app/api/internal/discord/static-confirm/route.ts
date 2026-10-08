import { NextRequest, NextResponse } from "next/server";
import { confirmStaticChallenge } from "@/lib/staticRules";
import { assertRequestBodySize, noStoreHeaders, verifyInternalBearerToken } from "@/lib/security";
import { getDiscordGuildId } from "@/lib/discordAdmin";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function POST(request: NextRequest) {
  const tooLarge = assertRequestBodySize(request, 2048);
  if (tooLarge) return tooLarge;
  const auth = await verifyInternalBearerToken(request, ["INTERNAL_API_TOKEN"], { minLength: 24 });
  if (!auth.ok) return NextResponse.json({ ok: false }, { status: 403, headers: noStoreHeaders() });
  const body = await request.json().catch(() => ({}));
  if (body?.guildId && body.guildId !== getDiscordGuildId()) return NextResponse.json({ ok: false, message: "Wrong guild" }, { status: 403, headers: noStoreHeaders() });
  try {
    const result = await confirmStaticChallenge(String(body?.code || ""), String(body?.userId || ""));
    return NextResponse.json(result, { headers: noStoreHeaders() });
  } catch {
    return NextResponse.json({ ok: false, message: "Не вдалося обробити підтвердження. Спробуй пізніше." }, { status: 503, headers: noStoreHeaders() });
  }
}
