import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { canManageRaids } from "@/lib/permissions";
import { recordAdminAudit } from "@/lib/accessGroups";
import { readPublicationStatus } from "@/lib/publicationStatusServer";
import { readPublicationSyncInput } from "@/lib/publicationSyncInput";
import { DiscordPublicationPendingError } from "@/lib/discordPublication";
import { resyncRaidDiscord } from "@/lib/raids";
import { assertRequestBodySize, verifyTrustedOrigin, noStoreHeaders, logDashboardEvent, safeErrorMessage } from "@/lib/security";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;
type Context = { params: Promise<{ raidId: string }> };
const reply = (body: unknown, status = 200) => NextResponse.json(body, { status, headers: noStoreHeaders() });

export async function GET(_request: NextRequest, context: Context) {
  const user = await getSession();
  if (!user || !canManageRaids(user)) return reply({ ok: false, error: "Доступ заборонено." }, 403);
  const { raidId } = await context.params;
  if (!/^[A-Za-z0-9_-]{8,80}$/.test(raidId)) return reply({ ok: false, error: "Некоректний ID." }, 400);
  const publication = await readPublicationStatus("raid", raidId);
  return publication ? reply({ ok: true, publication }) : reply({ ok: false, error: "Запис не знайдено." }, 404);
}

export async function POST(request: NextRequest, context: Context) {
  const user = await getSession();
  if (!user || !canManageRaids(user)) return reply({ ok: false, error: "Доступ заборонено." }, 403);
  if (!verifyTrustedOrigin(request)) return reply({ ok: false, error: "Недовірене джерело запиту." }, 403);
  const tooLarge = assertRequestBodySize(request, 2048);
  if (tooLarge) return tooLarge;
  const { raidId } = await context.params;
  if (!/^[A-Za-z0-9_-]{8,80}$/.test(raidId)) return reply({ ok: false, error: "Некоректний ID." }, 400);
  let messageUrl: string;
  try { messageUrl = await readPublicationSyncInput(request); }
  catch { return reply({ ok: false, error: "Некоректний запит або посилання Discord." }, 400); }
  try {
    const result = await resyncRaidDiscord(raidId, messageUrl);
    const warning = result.cleanupWarning || result.scheduledEvent.error || null;
    logDashboardEvent(warning ? "warn" : "info", "raids.discord_resync", request, { raidId, actorId: user.id, warning });
    await recordAdminAudit("raids.discord_resync", user, { status: warning ? "error" : "success", summary: warning || "Синхронізацію збереженої публікації виконано.", raidId }).catch(() => false);
    return reply({ ok: true, messageUrl: result.messageUrl, warning, publication: await readPublicationStatus("raid", raidId) });
  } catch (error) {
    const pending = error instanceof DiscordPublicationPendingError;
    logDashboardEvent("warn", "raids.discord_resync_failed", request, { raidId, actorId: user.id, message: safeErrorMessage(error) });
    return reply({ ok: false, error: safeErrorMessage(error), publication: await readPublicationStatus("raid", raidId) }, pending ? 409 : 400);
  }
}
