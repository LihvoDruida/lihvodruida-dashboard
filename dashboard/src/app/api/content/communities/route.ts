import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { canManageSiteContent } from "@/lib/permissions";
import { ContentMutationError, saveSiteContentImage } from "@/lib/content";
import { CommunityValidationError, SiteCommunitiesConflictError, saveSiteCommunities } from "@/lib/siteCommunities";
import { COMMUNITY_LIMITS } from "@/lib/siteCommunityModel";
import { assertRequestBodySize, checkRateLimit, forbiddenResponse, getClientIp, logDashboardEvent, safeErrorMessage, unauthorizedResponse, verifyTrustedOrigin } from "@/lib/security";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

const json = (body: unknown, status = 200) => NextResponse.json(body, { status, headers: { "Cache-Control": "no-store" } });

/**
 * Saves the public site's Communities block. Multipart: `payload` = JSON {items, revision};
 * optional `logo-<index>` files replace that community's logo.
 */
export async function POST(request: NextRequest) {
  if (!verifyTrustedOrigin(request)) return forbiddenResponse("Недовірене джерело.");
  const tooLarge = assertRequestBodySize(request, 20 * 1024 * 1024);
  if (tooLarge) return tooLarge;
  const session = await getSession();
  if (!session || !canManageSiteContent(session)) return unauthorizedResponse("Недостатньо прав для керування сайтом.");
  const limit = checkRateLimit(`content-communities:${session.id}:${getClientIp(request)}`, 20, 10 * 60 * 1000);
  if (!limit.ok) return json({ error: "Забагато спроб. Зачекай кілька хвилин." }, 429);

  try {
    const form = await request.formData();
    const payload = JSON.parse(String(form.get("payload") || "{}")) as { items?: unknown; revision?: unknown };
    const items = Array.isArray(payload.items) ? payload.items.slice(0, COMMUNITY_LIMITS.items + 1) : null;
    const revision = Number(payload.revision);
    if (!items || !Number.isSafeInteger(revision) || revision < 0) return json({ error: "Некоректні дані форми. Онови сторінку." }, 400);
    for (let index = 0; index < items.length; index += 1) {
      const file = form.get(`logo-${index}`);
      if (file instanceof File && file.size) {
        const logo = await saveSiteContentImage(file);
        if (logo && items[index] && typeof items[index] === "object") (items[index] as Record<string, unknown>).logo = logo;
      }
    }
    const state = await saveSiteCommunities(items, revision, session.name || session.login || session.id);
    logDashboardEvent("info", "content.communities.saved", request, { userId: session.id, count: state.items.length, revision: state.revision });
    return json({ ok: true, state });
  } catch (error) {
    if (error instanceof SiteCommunitiesConflictError) return json({ error: error.message, code: "conflict" }, 409);
    if (error instanceof CommunityValidationError) return json({ error: error.message, code: "invalid" }, 400);
    if (error instanceof ContentMutationError) return json({ error: error.message, code: error.code }, error.status);
    if (error instanceof SyntaxError) return json({ error: "Некоректні дані форми. Онови сторінку." }, 400);
    logDashboardEvent("error", "content.communities.failed", request, { userId: session.id, message: safeErrorMessage(error) });
    return json({ error: "Не вдалося зберегти спільноти. Повтори пізніше." }, 503);
  }
}
