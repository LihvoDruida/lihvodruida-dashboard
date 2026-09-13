import { NextRequest, NextResponse } from "next/server";

import { getSession } from "@/lib/auth";
import { recordAdminAudit } from "@/lib/accessGroups";
import { deleteDiscordApplicationMessage } from "@/lib/discord";
import { deleteGuildApplication, getIssue } from "@/lib/github";
import {
  checkRateLimit,
  forbiddenResponse,
  getClientIp,
  logDashboardEvent,
  noStoreHeaders,
  safeErrorMessage,
  unauthorizedResponse,
  verifyTrustedOrigin,
} from "@/lib/security";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function DELETE(request: NextRequest, context: { params: Promise<{ number: string }> }) {
  if (!verifyTrustedOrigin(request)) return forbiddenResponse("Недовірене джерело видалення заявки.");

  const session = await getSession();
  if (!session) return unauthorizedResponse();
  if (!session.isServerOwner) {
    logDashboardEvent("warn", "applications.delete.forbidden", request, { userId: session.id });
    return forbiddenResponse("Видаляти заявки може тільки власник Discord-сервера.");
  }

  const ip = getClientIp(request);
  const limit = checkRateLimit(`applications-delete:${session.id}:${ip}`, 12, 10 * 60 * 1000);
  if (!limit.ok) {
    return NextResponse.json({ error: "Забагато видалень. Зачекай кілька хвилин." }, { status: 429, headers: noStoreHeaders() });
  }

  const { number } = await context.params;
  const issueNumber = Number(number);
  if (!Number.isInteger(issueNumber) || issueNumber <= 0) {
    return NextResponse.json({ error: "Невірний номер заявки." }, { status: 400, headers: noStoreHeaders() });
  }

  try {
    const issue = await getIssue(issueNumber);
    const discord = await deleteDiscordApplicationMessage(issue);
    if (!discord.ok && !discord.skipped) {
      logDashboardEvent("warn", "applications.delete.discord_failed", request, { issueNumber, reason: discord.reason || null });
      return NextResponse.json({ error: "Discord-повідомлення не видалено. Заявку на сервері залишено, щоб не втратити зв’язок.", discord }, { status: 502, headers: noStoreHeaders() });
    }

    await deleteGuildApplication(issueNumber);
    logDashboardEvent("info", "applications.delete.success", request, { issueNumber, userId: session.id, discordDeleted: Boolean(discord.deleted), discordAlreadyMissing: Boolean(discord.alreadyMissing) });
    await recordAdminAudit("applications.delete", session, {
      status: "success",
      summary: `Заявку #${issueNumber} видалено із сервера${discord.deleted ? " та Discord" : discord.alreadyMissing ? "; Discord-повідомлення вже було відсутнє" : ""}.`,
      issueNumber,
      discord,
    }).catch(() => false);

    return NextResponse.json({ ok: true, issueNumber, discord }, { headers: noStoreHeaders() });
  } catch (error) {
    const message = safeErrorMessage(error, "Не вдалося видалити заявку.");
    logDashboardEvent("error", "applications.delete.failed", request, { issueNumber, userId: session.id, message });
    await recordAdminAudit("applications.delete_failed", session, {
      status: "error",
      summary: `Заявку #${issueNumber} не видалено. ${message}`,
      issueNumber,
      error: message,
    }).catch(() => false);
    return NextResponse.json({ error: message }, { status: 500, headers: noStoreHeaders() });
  }
}
