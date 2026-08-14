import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { canManageApplications, canViewApplicationBattleTag, canViewApplications } from "@/lib/permissions";
import { listApplicationFilterOptions, listApplications, sanitizeApplicationsForMentorViewer } from "@/lib/github";
import { logDashboardEvent, noStoreHeaders, safeErrorMessage, unauthorizedResponse } from "@/lib/security";

export const runtime = "nodejs";

export const dynamic = "force-dynamic";
export const revalidate = 0;

function workerApplicationsEndpoint() {
  const raw = String(
    process.env.GUILD_APPLICATIONS_WORKER_URL ||
    process.env.NEXT_PUBLIC_GUILD_APPLICATIONS_WORKER_URL ||
    process.env.DISCORD_INTERACTIONS_ENDPOINT ||
    "",
  ).trim();
  if (!raw) return "";
  try {
    const url = new URL(raw);
    url.pathname = "/api/guild-applications";
    url.search = "";
    url.hash = "";
    return url.toString();
  } catch {
    return "";
  }
}

function workerApplicationsHeaders(): HeadersInit {
  const token = String(process.env.PUBLIC_API_CACHE_TOKEN || process.env.DISCORD_RULES_STATS_TOKEN || process.env.WORKER_STATS_TOKEN || process.env.INTERNAL_PROFILE_LOOKUP_TOKEN || "").trim();
  return {
    accept: "application/json",
    ...(token ? { authorization: `Bearer ${token}`, "x-worker-stats-token": token } : {}),
  };
}

async function listApplicationsFromWorker(searchParams: URLSearchParams) {
  const endpoint = workerApplicationsEndpoint();
  if (!endpoint) return null;
  const url = new URL(endpoint);
  for (const [key, value] of searchParams.entries()) url.searchParams.set(key, value);
  if (!url.searchParams.has("limit")) url.searchParams.set("limit", "100");
  const response = await fetch(url.toString(), { headers: workerApplicationsHeaders(), cache: "no-store" });
  const payload = await response.json().catch(() => null) as { items?: unknown[] } | null;
  if (!response.ok || !Array.isArray(payload?.items)) return null;
  return payload.items as Awaited<ReturnType<typeof listApplications>>;
}

export async function GET(request: NextRequest) {
  const session = await getSession();
  if (!canViewApplications(session)) {
    logDashboardEvent("warn", "applications.list.unauthorized", request);
    return unauthorizedResponse();
  }

  logDashboardEvent("debug", "applications.list.attempt", request, { userId: session?.id, role: session?.role });

  try {
    const url = new URL(request.url);
    const canSeeSensitiveFields = canViewApplicationBattleTag(session);
    const workerItems = canSeeSensitiveFields ? null : await listApplicationsFromWorker(url.searchParams).catch(() => null);
    const [rawItems, filterOptions] = workerItems
      ? [workerItems, { classes: Array.from(new Set(workerItems.map((item) => String(item.class_name || "").trim()).filter(Boolean))).sort((a, b) => a.localeCompare(b, "uk")), total: workerItems.length }]
      : await Promise.all([listApplications(url.searchParams), listApplicationFilterOptions()]);
    const items = canSeeSensitiveFields ? rawItems : sanitizeApplicationsForMentorViewer(rawItems);
    const counts = {
      all: items.length,
      review: items.filter((item) => item.status_key === "review").length,
      accepted: items.filter((item) => item.status_key === "accepted").length,
      declined: items.filter((item) => item.status_key === "declined").length,
    };

    logDashboardEvent("debug", "applications.list.success", request, { count: items.length, userId: session?.id });
    return NextResponse.json({ items, counts, classOptions: filterOptions.classes, access: { role: session?.role || null, canManageApplications: canManageApplications(session), canViewBattleTag: canSeeSensitiveFields, canViewSensitiveFields: canSeeSensitiveFields } }, { headers: noStoreHeaders() });
  } catch (error) {
    logDashboardEvent("error", "applications.list.failed", request, { message: safeErrorMessage(error) });
    return NextResponse.json(
      { error: safeErrorMessage(error, "Не вдалося завантажити заявки.") },
      { status: 500, headers: noStoreHeaders() }
    );
  }
}
