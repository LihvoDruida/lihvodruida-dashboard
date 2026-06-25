import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { getIntegrationStatusSummary } from "@/lib/integrationStatus";
import { getDashboardApiSettings, type DashboardApiSettings } from "@/lib/dashboardApiSettings";
import { loadStoredGuildRosterData } from "@/lib/guildRoster";
import { canManageRaids, canViewGuildRoster, canViewRaidDirectory, isDashboardStaff } from "@/lib/permissions";
import { canViewProfile, getProfileById } from "@/lib/profiles";
import { getRaid, isRaidClosed, raidDisplayCapacity, raidLiveRevision, raidRosterCounts, raidTitle } from "@/lib/raids";
import { getRaidPoll, raidPollLiveRevision } from "@/lib/raidPolls";
import {
  assertRequestBodySize,
  checkRateLimit,
  forbiddenResponse,
  getClientIp,
  logDashboardEvent,
  noStoreHeaders,
  rateLimitResponse,
  unauthorizedResponse,
  verifyTrustedOrigin,
} from "@/lib/security";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

type BackgroundResourceKind = "integrations" | "guild-roster" | "profile-external" | "raid-snapshot" | "raid-poll-snapshot";

type BackgroundResourceRequest = {
  key?: unknown;
  kind?: unknown;
  id?: unknown;
  profileId?: unknown;
  raidId?: unknown;
  minSpacingSeconds?: unknown;
};

const MIN_BACKGROUND_REFRESH_SECONDS = 10 * 60;
const MAX_RESOURCES_PER_REQUEST = 3;

function cleanText(value: unknown, maxLength = 180) {
  return String(value || "").trim().slice(0, Math.max(0, maxLength));
}

function cleanKind(value: unknown): BackgroundResourceKind | null {
  const kind = cleanText(value, 40);
  if (kind === "integrations" || kind === "guild-roster" || kind === "profile-external" || kind === "raid-snapshot" || kind === "raid-poll-snapshot") return kind;
  return null;
}

function requestedSpacingSeconds(value: unknown, fallbackSeconds = MIN_BACKGROUND_REFRESH_SECONDS, minSeconds = MIN_BACKGROUND_REFRESH_SECONDS) {
  const number = Number(value);
  const fallback = Math.max(minSeconds, Math.min(Math.floor(fallbackSeconds), 24 * 60 * 60));
  if (!Number.isFinite(number)) return fallback;
  return Math.max(minSeconds, Math.min(Math.floor(number), 24 * 60 * 60));
}

function resourceKey(resource: BackgroundResourceRequest, index: number) {
  return cleanText(resource.key, 220) || `${cleanKind(resource.kind) || "unknown"}:${index}`;
}

function publicProfilePayload(profile: Awaited<ReturnType<typeof getProfileById>>) {
  if (!profile) return null;
  return {
    updatedAt: profile.updatedAt || null,
    battlenet: profile.battlenet || null,
    characters: profile.characters,
  };
}

async function resolveIntegrationStatus() {
  return getIntegrationStatusSummary();
}

async function resolveGuildRoster() {
  const roster = await loadStoredGuildRosterData({ bypassCache: false });
  return {
    memberCount: roster.members.length,
    updatedAt: roster.stats.updatedAt,
    source: roster.source,
    error: roster.error || null,
  };
}

async function resolveRaidSnapshot(resource: BackgroundResourceRequest, session: Awaited<ReturnType<typeof getSession>>) {
  const raidId = cleanText(resource.raidId || resource.id, 160);
  if (!raidId) return { ok: false, error: "raid_id_required" };

  const raid = await getRaid(raidId);
  const canManage = canManageRaids(session);
  if (!raid || (raid.status !== "published" && raid.status !== "closed" && !canManage)) {
    return { ok: false, error: "raid_not_found" };
  }

  const counts = raidRosterCounts(raid);
  return {
    ok: true,
    id: raid.id,
    title: raidTitle(raid),
    status: raid.status,
    closed: isRaidClosed(raid),
    revision: raidLiveRevision(raid),
    updatedAt: raid.updatedAt || null,
    roster: counts.roster,
    capacity: raidDisplayCapacity(raid),
    late: counts.late,
    skipped: counts.skipped,
  };
}

async function resolveRaidPollSnapshot(resource: BackgroundResourceRequest, session: Awaited<ReturnType<typeof getSession>>) {
  const pollId = cleanText(resource.raidId || resource.id, 160);
  if (!pollId) return { ok: false, error: "poll_id_required" };
  if (!canViewRaidDirectory(session)) return { ok: false, error: "forbidden" };

  const poll = await getRaidPoll(pollId, { closeDue: false });
  const canManage = canManageRaids(session);
  if (!poll || (poll.status !== "open" && !canManage)) {
    return { ok: false, error: "poll_not_found" };
  }

  return {
    ok: true,
    id: poll.id,
    status: poll.status,
    revision: raidPollLiveRevision(poll),
    updatedAt: poll.updatedAt || null,
    closesAtMs: poll.closesAtMs || null,
    votes: poll.votes.length,
  };
}

async function resolveProfileExternal(resource: BackgroundResourceRequest, session: NonNullable<Awaited<ReturnType<typeof getSession>>>, settings: DashboardApiSettings) {
  const profileId = cleanText(resource.profileId || resource.id, 160);
  if (!profileId) return { ok: false, error: "profile_id_required" };

  const profile = await getProfileById(profileId);
  if (!profile || !canViewProfile(session, profileId, profile)) {
    return { ok: false, error: "profile_not_found" };
  }

  const minSpacingSeconds = requestedSpacingSeconds(resource.minSpacingSeconds, settings.profileViewRefreshMinSeconds, settings.profileViewRefreshMinSeconds);
  // Background polling must never perform expensive external API refreshes or
  // Firestore writes. Full profile refresh is handled by the explicit
  // /api/profile/[profileId]/refresh-external-data route and admin actions.
  void minSpacingSeconds;
  return {
    ok: true,
    profileId,
    refreshed: 0,
    failed: 0,
    skipped: profile.characters.length,
    locked: false,
    throttled: true,
    checkedAt: new Date().toISOString(),
    profile: publicProfilePayload(profile),
  };
}

async function resolveResource(resource: BackgroundResourceRequest, session: NonNullable<Awaited<ReturnType<typeof getSession>>>, settings: DashboardApiSettings) {
  const kind = cleanKind(resource.kind);
  if (!kind) return { ok: false, error: "unsupported_resource" };

  if (kind === "integrations") {
    if (!isDashboardStaff(session)) return { ok: false, error: "forbidden" };
    return { ok: true, data: await resolveIntegrationStatus() };
  }

  if (kind === "guild-roster") {
    if (!canViewGuildRoster(session)) return { ok: false, error: "forbidden" };
    return { ok: true, data: await resolveGuildRoster() };
  }

  if (kind === "raid-snapshot") {
    return { ok: true, data: await resolveRaidSnapshot(resource, session) };
  }

  if (kind === "raid-poll-snapshot") {
    return { ok: true, data: await resolveRaidPollSnapshot(resource, session) };
  }

  if (kind === "profile-external") {
    return { ok: true, data: await resolveProfileExternal(resource, session, settings) };
  }

  return { ok: false, error: "unsupported_resource" };
}

export async function POST(request: NextRequest) {
  if (!verifyTrustedOrigin(request)) return forbiddenResponse();

  const tooLarge = assertRequestBodySize(request, 16 * 1024);
  if (tooLarge) return tooLarge;

  const session = await getSession();
  if (!session) return unauthorizedResponse();

  const ip = getClientIp(request);
  const rateLimit = Number(process.env.DASHBOARD_BACKGROUND_API_RATE_LIMIT || 20);
  const limit = checkRateLimit(`background-api:${session.profileId || session.id}:${ip}`, Number.isFinite(rateLimit) ? Math.max(5, Math.min(Math.floor(rateLimit), 60)) : 20, 10 * 60 * 1000);
  if (!limit.ok) return rateLimitResponse(limit.resetAt);

  const settings = await getDashboardApiSettings();
  const body = await request.json().catch(() => null) as { resources?: BackgroundResourceRequest[]; resource?: BackgroundResourceRequest } | null;
  const requested = Array.isArray(body?.resources) ? body.resources : body?.resource ? [body.resource] : [];
  const resources = requested.slice(0, MAX_RESOURCES_PER_REQUEST);

  if (!resources.length) {
    return NextResponse.json({ ok: false, error: "resources_required" }, { status: 400, headers: noStoreHeaders() });
  }

  const startedAt = Date.now();
  const results = [];
  for (let index = 0; index < resources.length; index += 1) {
    const resource = resources[index];
    const key = resourceKey(resource, index);
    try {
      const result = await resolveResource(resource, session, settings);
      results.push({ key, ...result });
    } catch (error) {
      results.push({ key, ok: false, error: error instanceof Error ? error.message : "resource_failed" });
    }
    if (Date.now() - startedAt > 4_000) break;
  }

  logDashboardEvent("debug", "background_api.refresh", request, {
    profileId: session.profileId || null,
    resources: results.length,
    ok: results.filter((item) => item.ok).length,
    durationMs: Date.now() - startedAt,
  });

  return NextResponse.json({
    ok: true,
    checkedAt: new Date().toISOString(),
    resources: results,
  }, { headers: noStoreHeaders() });
}
