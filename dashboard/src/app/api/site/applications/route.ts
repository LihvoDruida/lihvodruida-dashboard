import {normalizeApplication,validateApplication as validatePublicApplication} from '@/lib/applicationContract';
import {hasSiteBridgeToken,siteBridgeClientIp} from '@/lib/siteBridgeAuth';
import { after, NextRequest, NextResponse } from "next/server";
import {
  createGuildApplication,
  filterStoredApplications,
  listStoredApplications,
  sanitizeApplicationForPublicSite,
  sanitizeApplicationsForPublicSite,
  type CreateGuildApplicationInput,
} from "@/lib/applicationsStore";
import { processApplicationDelivery } from "@/lib/applicationDelivery";
import {
  assertRequestBodySize,
  checkRateLimit,
  getClientIp,
  logDashboardEvent,
  safeErrorMessage,
} from "@/lib/security";
import { isAllowedPublicSiteOrigin, publicSiteCorsHeaders } from "@/lib/publicSiteBridge";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

function recordApplicationEvent(...args: Parameters<typeof logDashboardEvent>) {
  try { logDashboardEvent(...args); } catch { /* Logging cannot change a persisted application receipt. */ }
}

function json(request: NextRequest, payload: unknown, status = 200) {
  return NextResponse.json(payload, { status, headers: publicSiteCorsHeaders(request) });
}

function validateApplication(body:Record<string,unknown>):{ok:true;value:CreateGuildApplicationInput}|{ok:false;error:string}{
 const error=validatePublicApplication(body);if(error)return {ok:false,error};
 const value=normalizeApplication(body);
 return {ok:true,value:{characterName:value.characterName,realm:value.realm,region:value.region,faction:value.faction,className:value.className,discord:value.discord,battleTag:value.battleTag,sourceCreator:value.sourceCreator,sourcePlatform:value.sourcePlatform,sourceOther:value.sourceOther,source:value.source,availability:value.availability}};
}

export async function OPTIONS(request: NextRequest) {
  if (!isAllowedPublicSiteOrigin(request)) return json(request, { error: "Origin not allowed" }, 403);
  return new NextResponse(null, { status: 204, headers: publicSiteCorsHeaders(request) });
}

export async function GET(request: NextRequest) {
  const ip = hasSiteBridgeToken(request) ? siteBridgeClientIp(request) : getClientIp(request);
  const limit = hasSiteBridgeToken(request) ? {ok:true} : checkRateLimit(`public-site:applications:get:${ip}`, 120, 60 * 1000);
  if (!limit.ok) return json(request, { error: "Забагато запитів. Спробуй трохи пізніше." }, 429);

  try {
    const url = new URL(request.url);
    const rawLimit = Number(url.searchParams.get("limit") || 50);
    const requestedLimit = Number.isFinite(rawLimit) ? Math.max(1, Math.min(Math.floor(rawLimit), 100)) : 50;
    const stored = await listStoredApplications();
    const items = sanitizeApplicationsForPublicSite(filterStoredApplications(stored, url.searchParams).slice(0, requestedLimit));
    const all = sanitizeApplicationsForPublicSite(stored);
    const counts = {
      all: all.length,
      review: all.filter((item) => item.status_key === "review").length,
      accepted: all.filter((item) => item.status_key === "accepted").length,
      declined: all.filter((item) => item.status_key === "declined").length,
    };
    return json(request, { schema: "mistblossom.public-applications.v1", items, counts, updated_at: new Date().toISOString() });
  } catch (error) {
    recordApplicationEvent("error", "public_site.applications.list_failed", request, { message: safeErrorMessage(error) });
    return json(request, { error: "Не вдалося отримати список заявок." }, 500);
  }
}

export async function POST(request: NextRequest) {
  if (!hasSiteBridgeToken(request) || !isAllowedPublicSiteOrigin(request)) {
    recordApplicationEvent("warn", "public_site.applications.origin_rejected", request);
    return json(request, { error: "Недозволене джерело заявки." }, 403);
  }

  const tooLarge = assertRequestBodySize(request, 16 * 1024);
  if (tooLarge) return json(request, { error: "Запит завеликий." }, 413);

  const ip = hasSiteBridgeToken(request) ? siteBridgeClientIp(request) : getClientIp(request);
  const burst = checkRateLimit(`public-site:applications:post:${ip}`, 4, 10 * 60 * 1000);
  const hourly = checkRateLimit(`public-site:applications:post-hour:${ip}`, 10, 60 * 60 * 1000);
  if (!burst.ok || !hourly.ok) {
    recordApplicationEvent("warn", "public_site.applications.rate_limited", request, { ip });
    return json(request, { error: "Забагато заявок з цієї адреси. Спробуй пізніше." }, 429);
  }

  const rawBody = await request.text().catch(() => "");
  if (Buffer.byteLength(rawBody, "utf8") > 16 * 1024) return json(request, { error: "Запит завеликий." }, 413);
  const body = (() => { try { return JSON.parse(rawBody); } catch { return null; } })();
  if (!body || typeof body !== "object" || Array.isArray(body)) return json(request, { error: "Некоректне тіло запиту." }, 400);
  const validated = validateApplication(body as Record<string, unknown>);
  if (!validated.ok) return json(request, { error: validated.error }, 400);

  try {
    const result = await createGuildApplication(validated.value);
    const item = result.item;

    if (!result.duplicate) {
      // The database commit is the receipt boundary. Discord must not delay or
      // turn a successful submission into an HTTP error after it was persisted.
      after(async () => {
        try {
          await processApplicationDelivery(item.number);
        } catch (error) {
          recordApplicationEvent("warn", "public_site.applications.discord_notify_failed", request, {
            number: item.number, message: safeErrorMessage(error),
          });
        }
      });
    }

    recordApplicationEvent("info", "public_site.applications.created", request, {
      number: item.number,
      duplicate: result.duplicate,
      character: item.character_name,
    });
    const publicItem = sanitizeApplicationForPublicSite(item, { includeTracking: true });
    return json(request, {
      ok: true,
      duplicate: result.duplicate,
      application_number: publicItem.number,
      number: publicItem.number,
      tracking_number: publicItem.tracking_number,
      status_key: publicItem.status_key,
      status_text: publicItem.status_text,
    }, result.duplicate ? 200 : 201);
  } catch (error) {
    recordApplicationEvent("error", "public_site.applications.create_failed", request, { message: safeErrorMessage(error) });
    return json(request, { error: "Не вдалося створити заявку. Спробуй ще раз трохи пізніше." }, 500);
  }
}
