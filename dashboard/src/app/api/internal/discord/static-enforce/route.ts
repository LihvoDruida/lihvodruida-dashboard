import { NextRequest, NextResponse } from "next/server";
import { enforceStaticMemberRole, sweepStaticForbiddenRoles } from "@/lib/staticRules";
import { getDiscordGuildId } from "@/lib/discordAdmin";
import { assertRequestBodySize, noStoreHeaders, verifyInternalBearerToken } from "@/lib/security";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function POST(request: NextRequest) {
  const limit = assertRequestBodySize(request, 2048);
  if (limit) return limit;
  const auth = await verifyInternalBearerToken(request, ["INTERNAL_API_TOKEN"], { minLength: 24 });
  if (!auth.ok) return NextResponse.json({ ok: false }, { status: 403, headers: noStoreHeaders() });
  const body = await request.json().catch(() => ({}));
  if (String(body.guildId || "") !== getDiscordGuildId()) return NextResponse.json({ ok: false }, { status: 403, headers: noStoreHeaders() });
  try {
    const result = body.sweep === true
      ? await sweepStaticForbiddenRoles()
      : await enforceStaticMemberRole(String(body.userId || ""));
    return NextResponse.json({ ok: true, ...result }, { headers: noStoreHeaders() });
  } catch {
    return NextResponse.json({ ok: false, error: "Перевірка ролей тимчасово недоступна." }, { status: 503, headers: noStoreHeaders() });
  }
}
