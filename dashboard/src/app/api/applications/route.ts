import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { canManageApplications, canViewApplicationBattleTag, canViewApplications } from "@/lib/permissions";
import { listApplicationFilterOptions, listApplications, sanitizeApplicationsForMentorViewer } from "@/lib/github";
import { logDashboardEvent, noStoreHeaders, safeErrorMessage, unauthorizedResponse } from "@/lib/security";

export const runtime = "nodejs";

export const dynamic = "force-dynamic";
export const revalidate = 0;

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
    // Раніше для менторів (без доступу до чутливих полів) заявки бралися
    // з Cloudflare Worker, який ходив у GitHub і кешував відповідь. Тепер
    // панель читає GitHub напряму: зайвий стрибок і кеш прибрані, а
    // приховування чутливих полів робить sanitizeApplicationsForMentorViewer
    // нижче — тобто відповідь для ментора та сама, тільки без посередника.
    const [rawItems, filterOptions] = await Promise.all([
      listApplications(url.searchParams),
      listApplicationFilterOptions(),
    ]);
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
