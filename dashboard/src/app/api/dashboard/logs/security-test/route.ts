import { randomUUID } from "crypto";
import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { canManageGroups } from "@/lib/permissions";
import { mirrorSecurityLogToDiscordDetailed } from "@/lib/securityLogDiscord";
import { recordStructuredLog } from "@/lib/structuredLogs";
import { getClientIp, noStoreHeaders, verifyTrustedOrigin } from "@/lib/security";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  if (!verifyTrustedOrigin(request)) {
    return NextResponse.json({ ok: false, error: "untrusted_origin", message: "Недовірене джерело запиту." }, { status: 403, headers: noStoreHeaders() });
  }
  const session = await getSession();
  if (!session || !canManageGroups(session)) {
    return NextResponse.json({ ok: false, error: "forbidden", message: "Немає доступу." }, { status: session ? 403 : 401, headers: noStoreHeaders() });
  }

  const id = randomUUID();
  const now = new Date().toISOString();
  const result = await mirrorSecurityLogToDiscordDetailed({
    id,
    createdAt: now,
    level: "warning",
    event: "security.discord_mirror.test",
    message: "Тест Security mirror із панелі Mistblossom. Якщо ти бачиш це повідомлення — канал і права бота налаштовані правильно.",
    actorName: session.name || session.login || session.id,
    method: "POST",
    path: "/api/dashboard/logs/security-test",
    ip: getClientIp(request),
    details: { source: "dashboard-settings", test: true },
  }, { bypassDedupe: true });

  void recordStructuredLog({
    level: result.ok ? "success" : "warning",
    category: "action",
    source: "dashboard",
    event: "logging.security_mirror.test",
    message: result.ok ? "Security mirror test delivered to Discord." : `Security mirror test failed: ${result.reason || "unknown"}`,
    actorId: session.id,
    actorName: session.name || session.login || session.id,
    method: "POST",
    path: "/api/dashboard/logs/security-test",
    statusCode: result.ok ? 200 : result.status || 400,
    ip: getClientIp(request),
    details: { ok: result.ok, status: result.status || null, reason: result.reason || null, channelId: result.channelId || null },
  });

  if (!result.ok) {
    const messages: Record<string, string> = {
      security_mirror_disabled: "Спочатку увімкни дублювання Security у Discord і збережи налаштування.",
      security_channel_missing: "Вкажи Discord channel ID для Security-журналу.",
      discord_bot_token_missing: "У dashboard-контейнері немає DISCORD_BOT_TOKEN.",
      below_min_level: "Тестова подія нижча за вибраний мінімальний рівень.",
    };
    return NextResponse.json({
      ok: false,
      message: messages[result.reason || ""] || `Discord не прийняв тестове повідомлення${result.status ? ` (HTTP ${result.status})` : ""}.`,
      reason: result.reason || "discord_mirror_failed",
      status: result.status || null,
    }, { status: 400, headers: noStoreHeaders() });
  }

  return NextResponse.json({ ok: true, message: "Тестове Security-повідомлення надіслано в Discord.", channelId: result.channelId }, { headers: noStoreHeaders() });
}
