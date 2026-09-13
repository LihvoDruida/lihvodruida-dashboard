import { NextRequest, NextResponse } from "next/server";
import {
  createGuildApplication,
  filterStoredApplications,
  listStoredApplications,
  sanitizeApplicationForPublicSite,
  sanitizeApplicationsForPublicSite,
  setApplicationDiscordMessageRef,
  type CreateGuildApplicationInput,
} from "@/lib/github";
import { notifyDiscordNewApplication } from "@/lib/discord";
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

const CHARACTER_RE = /^\p{L}{2,12}$/u;
const REALM_RE = /^\p{Script=Latin}[\p{Script=Latin}\p{N} '’.()\-]{1,31}$/u;
const BATTLETAG_RE = /^\p{L}[\p{L}\p{N}]{2,11}#\d{4,6}$/u;
const DISCORD_RE = /^[a-z0-9._]{2,32}$/;
const VALID_FACTIONS = new Set(["Alliance", "Horde"]);
const VALID_CLASSES = new Set(["Warrior", "Paladin", "Hunter", "Rogue", "Priest", "Death Knight", "Shaman", "Mage", "Warlock", "Monk", "Druid", "Demon Hunter", "Evoker"]);

function json(request: NextRequest, payload: unknown, status = 200) {
  return NextResponse.json(payload, { status, headers: publicSiteCorsHeaders(request) });
}

function clean(value: unknown, max = 240) {
  return String(value || "").normalize("NFC").replace(/\s+/g, " ").trim().slice(0, max);
}

function validateApplication(body: Record<string, unknown>): { ok: true; value: CreateGuildApplicationInput } | { ok: false; error: string } {
  const characterName = clean(body.characterName, 32);
  const realm = clean(body.realm, 48);
  const faction = clean(body.faction, 16);
  const className = clean(body.className, 32);
  const discord = clean(body.discord, 40).toLowerCase();
  const battleTag = clean(body.battleTag, 48);
  const availability = clean(body.availability, 1200);
  const sourceCreator = clean(body.sourceCreator, 80);
  const sourcePlatform = clean(body.sourcePlatform, 80);
  const sourceOther = clean(body.sourceOther, 160);
  const source = clean(body.source, 240);
  const website = clean(body.website, 200);

  if (website) return { ok: false, error: "Заявку відхилено." };
  if (!CHARACTER_RE.test(characterName)) return { ok: false, error: "Ім’я персонажа має містити лише літери, 2–12 символів." };
  if (!REALM_RE.test(realm)) return { ok: false, error: "Некоректна назва реалму." };
  if (!VALID_FACTIONS.has(faction)) return { ok: false, error: "Обери фракцію." };
  if (!VALID_CLASSES.has(className)) return { ok: false, error: "Обери клас персонажа." };
  if (!DISCORD_RE.test(discord)) return { ok: false, error: "Некоректний Discord username." };
  if (battleTag && !BATTLETAG_RE.test(battleTag)) return { ok: false, error: "BattleTag має бути у форматі Name#12345." };
  if (faction === "Horde" && !battleTag) return { ok: false, error: "Для Horde BattleTag є обов’язковим." };
  if (availability.length < 10) return { ok: false, error: "Опиши, коли зазвичай граєш, хоча б кількома словами." };
  if (!source && !sourceCreator && !sourceOther) return { ok: false, error: "Вкажи, звідки дізнався про гільдію." };

  return {
    ok: true,
    value: {
      characterName,
      realm,
      region: clean(body.region, 8).toLowerCase() || "eu",
      faction,
      className,
      discord,
      battleTag,
      sourceCreator,
      sourcePlatform,
      sourceOther,
      source,
      availability,
    },
  };
}

export async function OPTIONS(request: NextRequest) {
  if (!isAllowedPublicSiteOrigin(request)) return json(request, { error: "Origin not allowed" }, 403);
  return new NextResponse(null, { status: 204, headers: publicSiteCorsHeaders(request) });
}

export async function GET(request: NextRequest) {
  const ip = getClientIp(request);
  const limit = checkRateLimit(`public-site:applications:get:${ip}`, 120, 60 * 1000);
  if (!limit.ok) return json(request, { error: "Забагато запитів. Спробуй трохи пізніше." }, 429);

  try {
    const url = new URL(request.url);
    const requestedLimit = Math.max(1, Math.min(Number(url.searchParams.get("limit") || 50), 100));
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
    logDashboardEvent("error", "public_site.applications.list_failed", request, { message: safeErrorMessage(error) });
    return json(request, { error: "Не вдалося отримати список заявок." }, 500);
  }
}

export async function POST(request: NextRequest) {
  if (!isAllowedPublicSiteOrigin(request)) {
    logDashboardEvent("warn", "public_site.applications.origin_rejected", request);
    return json(request, { error: "Недозволене джерело заявки." }, 403);
  }

  const tooLarge = assertRequestBodySize(request, 16 * 1024);
  if (tooLarge) return json(request, { error: "Запит завеликий." }, 413);

  const ip = getClientIp(request);
  const burst = checkRateLimit(`public-site:applications:post:${ip}`, 4, 10 * 60 * 1000);
  const hourly = checkRateLimit(`public-site:applications:post-hour:${ip}`, 10, 60 * 60 * 1000);
  if (!burst.ok || !hourly.ok) {
    logDashboardEvent("warn", "public_site.applications.rate_limited", request, { ip });
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
      const discord = await notifyDiscordNewApplication({
        issueNumber: item.number,
        trackingNumber: item.tracking_number,
        characterName: item.character_name || validated.value.characterName,
        realm: item.realm || validated.value.realm,
        region: item.region || validated.value.region,
        faction: item.faction || validated.value.faction,
        className: item.class_name || validated.value.className,
        discord: validated.value.discord,
        battleTag: validated.value.battleTag,
        source: item.source || validated.value.source,
        availability: item.availability || validated.value.availability,
      });
      if (discord.ok && discord.channel_id && discord.message_id) {
        await setApplicationDiscordMessageRef(item.number, { channel_id: discord.channel_id, message_id: discord.message_id }).catch(() => false);
        logDashboardEvent("info", "public_site.applications.discord_notified", request, { number: item.number, channelId: discord.channel_id, messageId: discord.message_id });
      } else {
        logDashboardEvent("warn", "public_site.applications.discord_notify_failed", request, {
          number: item.number,
          skipped: Boolean(discord.skipped),
          reason: discord.reason || discord.error || "unknown",
        });
      }
    }

    logDashboardEvent("info", "public_site.applications.created", request, {
      number: item.number,
      duplicate: result.duplicate,
      character: item.character_name,
    });
    const publicItem = sanitizeApplicationForPublicSite(item);
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
    logDashboardEvent("error", "public_site.applications.create_failed", request, { message: safeErrorMessage(error) });
    return json(request, { error: "Не вдалося створити заявку. Спробуй ще раз трохи пізніше." }, 500);
  }
}
