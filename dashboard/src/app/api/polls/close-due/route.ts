import { NextRequest, NextResponse } from "next/server";
import { closeDueRaidPolls } from "@/lib/raidPolls";
import { logDashboardEvent, noStoreHeaders, safeErrorMessage, verifyInternalBearerToken } from "@/lib/security";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

const INTERNAL_POLL_CRON_TOKENS = ["RAID_LIFECYCLE_SECRET", "CRON_SECRET", "INTERNAL_API_TOKEN", "WORKER_STATS_TOKEN", "INTERNAL_PROFILE_LOOKUP_TOKEN", "DISCORD_RULES_STATS_TOKEN"];

type PollCloseDueRouteGuard = {
  inFlight?: Promise<unknown>;
  lastStartedAt: number;
  lastResult?: Record<string, unknown>;
};

declare global {
  // eslint-disable-next-line no-var
  var __mistblossomRaidPollCloseDueRouteGuard: PollCloseDueRouteGuard | undefined;
}

function envFlag(names: string[], fallback = false) {
  for (const name of names) {
    const raw = process.env[name];
    if (raw === undefined || raw === null || raw === "") continue;
    return ["1", "true", "yes", "on"].includes(String(raw).trim().toLowerCase());
  }
  return fallback;
}

function pollCloseDueGuard() {
  const guard = globalThis.__mistblossomRaidPollCloseDueRouteGuard || { lastStartedAt: 0 };
  globalThis.__mistblossomRaidPollCloseDueRouteGuard = guard;
  return guard;
}

function pollCloseDueMinIntervalMs() {
  const eco = envFlag(["FIREBASE_ECO_MODE", "FIRESTORE_ECO_MODE", "DASHBOARD_ECO_MODE"], false);
  const fallback = eco ? 10 * 60_000 : 5 * 60_000;
  const value = Number(process.env.RAID_POLL_CLOSE_DUE_MIN_INTERVAL_MS || process.env.DASHBOARD_RAID_POLL_CLOSE_DUE_MIN_INTERVAL_MS || fallback);
  if (!Number.isFinite(value)) return fallback;
  return Math.max(60_000, Math.min(Math.floor(value), 60 * 60_000));
}

function wantsForceRun(request: NextRequest) {
  const url = new URL(request.url);
  return url.searchParams.get("force") === "1" || request.headers.get("x-force-lifecycle") === "1" || request.headers.get("x-force-poll-close-due") === "1";
}

async function run(request: NextRequest) {
  const auth = await verifyInternalBearerToken(request, INTERNAL_POLL_CRON_TOKENS, { minLength: 24 });
  if (!auth.ok) {
    logDashboardEvent("warn", "raid_polls.close_due.forbidden", request, { reason: auth.reason, envName: auth.envName || null });
    return NextResponse.json({ ok: false, error: "Forbidden" }, { status: 403, headers: noStoreHeaders() });
  }

  const guard = pollCloseDueGuard();
  const force = wantsForceRun(request);
  const minInterval = pollCloseDueMinIntervalMs();
  const now = Date.now();

  if (!force && guard.inFlight) {
    return NextResponse.json(
      { ok: true, skipped: true, reason: "in_flight", ...(guard.lastResult || {}) },
      { headers: noStoreHeaders({ "X-Mistblossom-Poll-Close-Due": "in-flight" }) },
    );
  }

  if (!force && guard.lastStartedAt && now - guard.lastStartedAt < minInterval) {
    return NextResponse.json(
      { ok: true, skipped: true, reason: "cooldown", cooldownMs: minInterval, ...(guard.lastResult || {}) },
      { headers: noStoreHeaders({ "X-Mistblossom-Poll-Close-Due": "cooldown" }) },
    );
  }

  try {
    guard.lastStartedAt = now;
    const promise = closeDueRaidPolls({ force });
    guard.inFlight = promise;
    const result = await promise;
    guard.lastResult = result as Record<string, unknown>;
    logDashboardEvent(result.failed ? "warn" : "info", "raid_polls.close_due", request, { ...result, cooldownMs: minInterval });
    return NextResponse.json({ ok: true, ...result }, { headers: noStoreHeaders() });
  } catch (error) {
    const message = safeErrorMessage(error);
    logDashboardEvent("warn", "raid_polls.close_due_degraded", request, { message });
    const result = {
      degraded: true,
      checked: 0,
      scanned: 0,
      closed: 0,
      repeatedChecked: 0,
      repeated: 0,
      deleted: 0,
      failed: 1,
      errors: [message],
    };
    guard.lastResult = result;
    return NextResponse.json({ ok: true, ...result }, { headers: noStoreHeaders() });
  } finally {
    pollCloseDueGuard().inFlight = undefined;
  }
}

export async function GET(request: NextRequest) {
  return run(request);
}

export async function POST(request: NextRequest) {
  return run(request);
}
