import { NextRequest, NextResponse } from "next/server";
import { createStaticChallenge, getStaticInvite, getStaticSettings, inviteActive, StaticChallengeRateLimitError } from "@/lib/staticRules";
import { assertRequestBodySize, checkRateLimit, getClientIp, noStoreHeaders, verifyTrustedOrigin } from "@/lib/security";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;
const headers = () => noStoreHeaders();

export async function GET(request: NextRequest) {
  const token = request.nextUrl.searchParams.get("t") || "";
  try {
    const invite = await getStaticInvite(token);
    if (!inviteActive(invite)) return NextResponse.json({ ok: false, error: "Посилання недійсне або спливло." }, { status: 410, headers: headers() });
    const settings = await getStaticSettings();
    return NextResponse.json({ ok: true, text: settings.text, version: settings.version, expiresAt: invite!.expiresAt, ready: Boolean(settings.memberRoleId && settings.text) }, { headers: headers() });
  } catch {
    return NextResponse.json({ ok: false, error: "Не вдалося завантажити правила." }, { status: 503, headers: headers() });
  }
}

export async function POST(request: NextRequest) {
  const size = assertRequestBodySize(request, 2048);
  if (size) return size;
  if (!verifyTrustedOrigin(request)) return NextResponse.json({ ok: false, error: "Неприпустиме джерело запиту." }, { status: 403, headers: headers() });
  const ip = getClientIp(request);
  if (!checkRateLimit(`static-challenge:${ip}`, 8, 15 * 60_000).ok) return NextResponse.json({ ok: false, error: "Надто багато спроб. Зачекай." }, { status: 429, headers: headers() });
  const body = await request.json().catch(() => ({}));
  if (body?.agree !== true || typeof body?.token !== "string") return NextResponse.json({ ok: false, error: "Потрібне підтвердження згоди." }, { status: 400, headers: headers() });
  try {
    const challenge = await createStaticChallenge(body.token, ip);
    return NextResponse.json({ ok: true, ...challenge }, { headers: headers() });
  } catch (error) {
    if (error instanceof StaticChallengeRateLimitError) return NextResponse.json({ ok: false, error: error.message }, { status: 429, headers: noStoreHeaders({ "Retry-After": "900" }) });
    return NextResponse.json({ ok: false, error: error instanceof Error ? error.message : "Недійсний токен." }, { status: 400, headers: headers() });
  }
}
