import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { canManageDiscordMembers } from "@/lib/permissions";
import { auditDiscordAdmin, requireDiscordAdmin } from "@/lib/dashboardDiscordRoute";
import { getDiscordCleanupOverview, listDiscordCleanupMembers, pauseDiscordCleanup, runDiscordMemberCleanup, saveDiscordCleanupSettings } from "@/lib/discordMemberCleanup";
import { logDashboardEvent, noStoreHeaders, safeErrorMessage } from "@/lib/security";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;
export const maxDuration = 55;
export async function GET(request: NextRequest) {
  const session = await getSession();
  if (!session || !canManageDiscordMembers(session)) return NextResponse.json({ ok: false, error: "Немає доступу." }, { status: session ? 403 : 401, headers: noStoreHeaders() });
  try {
    const tab = request.nextUrl.searchParams.get("tab") || "candidates";
    if (!["candidates", "kicked", "uncertain"].includes(tab)) throw new Error("Невідома вкладка.");
    const [overview, page] = await Promise.all([getDiscordCleanupOverview(), listDiscordCleanupMembers(tab as "candidates" | "kicked" | "uncertain", request.nextUrl.searchParams.get("cursor"), request.nextUrl.searchParams.get("scanId"))]);
    return NextResponse.json({ ok: true, ...overview, page }, { headers: noStoreHeaders() });
  } catch (error) {
    return NextResponse.json({ ok: false, error: safeErrorMessage(error, "Список тимчасово недоступний.") }, { status: 503, headers: noStoreHeaders() });
  }
}
export async function POST(request: NextRequest) {
  const guard = await requireDiscordAdmin(request, "member-cleanup", 4096);
  if ("error" in guard) return guard.error;
  try {
    const body = await request.json();
    if (body.action === "settings" || body.action === "pause") {
      if (!guard.session.isServerOwner) return NextResponse.json({ ok: false, error: "Автоматичне виключення може налаштовувати лише власник сервера." }, { status: 403, headers: noStoreHeaders() });
      const settings = body.action === "pause" ? await pauseDiscordCleanup(guard.session.id) : await saveDiscordCleanupSettings({ enabled: body.enabled, roleId: body.roleId, period: body.period }, guard.session.id);
      await auditDiscordAdmin("discord.member_cleanup.settings", guard.session, { status: "success", enabled: settings.enabled, roleId: settings.roleId, period: settings.period, summary: `Автоматичне виключення ${settings.enabled ? "увімкнено" : "призупинено"}.` });
      const overview = await getDiscordCleanupOverview();
      return NextResponse.json({ ok: true, settings, execution: overview.execution }, { headers: noStoreHeaders() });
    }
    if (body.action !== "scan") throw new Error("Невідома дія.");
    const result = await runDiscordMemberCleanup({ source: "manual", inspectOnly: true });
    await auditDiscordAdmin("discord.member_cleanup.inspect", guard.session, { ...result, status: result.failed ? "warning" : "success", summary: "Ручна перевірка списку Discord-учасників." });
    return NextResponse.json({ ok: true, result }, { headers: noStoreHeaders() });
  } catch (error) {
    const text = safeErrorMessage(error, "Дію не виконано.");
    logDashboardEvent("warn", "discord.member_cleanup.admin_failed", request, { message: text }, { category: "action" });
    return NextResponse.json({ ok: false, error: text }, { status: 400, headers: noStoreHeaders() });
  }
}
