import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { canManageRaids } from "@/lib/permissions";
import { recordAdminAudit } from "@/lib/accessGroups";
import { readPublicationStatus } from "@/lib/publicationStatusServer";
import { readPublicationSyncInput } from "@/lib/publicationSyncInput";
import { DiscordPublicationPendingError } from "@/lib/discordPublication";
import { resyncRaidDiscord } from "@/lib/raids";
import { assertRequestBodySize, verifyTrustedOrigin, noStoreHeaders, logDashboardEvent, safeErrorMessage } from "@/lib/security";

import { diagnosticErrorSummary } from "@/lib/logPrivacy";

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
  const startedAt = Date.now();
  const report = (level: "info" | "warn" | "error", event: string, details: Record<string, unknown>) => {
    try { logDashboardEvent(level, event, request, { resourceType: "raid", durationMs: Math.max(0, Date.now() - startedAt), ...details }, { category: "discord" }); } catch { /* Published state is authoritative. */ }
  };
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
    report(warning ? "warn" : "info", "raids.discord_resync", { resourceId: raidId, raidId, actorId: user.id, phase: "sync", outcome: warning ? "partial" : "completed", statusCode: 200, ...(warning ? { nextAction: "check_publication" } : {}) });
    await recordAdminAudit("raids.discord_resync", user, { status: warning ? "error" : "success", summary: warning || "Синхронізацію збереженої публікації виконано.", raidId }).catch(() => false);
    return reply({ ok: true, messageUrl: result.messageUrl, warning, publication: await readPublicationStatus("raid", raidId) });
  } catch (error) {
    const pending = error instanceof DiscordPublicationPendingError;
    report(pending ? "warn" : "error", "raids.discord_resync_failed", { resourceId: raidId, raidId, actorId: user.id, phase: "sync", outcome: pending ? "pending" : "unconfirmed", statusCode: pending ? 409 : 400, nextAction: "read_saved_status", ...diagnosticErrorSummary(error) });
    return reply({ ok: false, error: safeErrorMessage(error), publication: await readPublicationStatus("raid", raidId) }, pending ? 409 : 400);
  }
}
