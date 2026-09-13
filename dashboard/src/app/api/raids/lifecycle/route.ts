import { NextRequest, NextResponse } from "next/server";
import { syncRaidLifecycleBatch } from "@/lib/raids";
import {
  logDashboardEvent,
  noStoreHeaders,
  safeErrorMessage,
  unauthorizedResponse,
  verifyInternalBearerToken,
} from "@/lib/security";
import { envFlag, integerParam } from "@/lib/apiRoute";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const revalidate = 0;

declare global {
  // eslint-disable-next-line no-var
  var __mistblossomRaidLifecycleRouteGuard:
    | { inFlight?: Promise<unknown>; lastStartedAt: number; lastResult?: Record<string, unknown> }
    | undefined;
}

function lifecycleGuard() {
  const guard = globalThis.__mistblossomRaidLifecycleRouteGuard || { lastStartedAt: 0 };
  globalThis.__mistblossomRaidLifecycleRouteGuard = guard;
  return guard;
}

function lifecycleMinIntervalMs() {
  const eco = envFlag(["FIREBASE_ECO_MODE", "FIRESTORE_ECO_MODE", "DASHBOARD_ECO_MODE"], false);
  // Lifecycle runs once per minute so 15-minute reminders and exact
  // registration deadlines are not delayed by a 5–10 minute polling window.
  const fallback = eco ? 60_000 : 45_000;
  const value = Number(process.env.RAID_LIFECYCLE_MIN_INTERVAL_MS || process.env.DASHBOARD_RAID_LIFECYCLE_MIN_INTERVAL_MS || fallback);
  if (!Number.isFinite(value)) return fallback;
  return Math.max(30_000, Math.min(Math.floor(value), 60 * 60_000));
}

function lifecycleDefaultLimit() {
  return envFlag(["FIREBASE_ECO_MODE", "FIRESTORE_ECO_MODE", "DASHBOARD_ECO_MODE"], false) ? 20 : 40;
}

function wantsForceRun(request: NextRequest) {
  const url = new URL(request.url);
  return url.searchParams.get("force") === "1" || request.headers.get("x-force-lifecycle") === "1";
}

function wantsFullSweep(request: NextRequest) {
  const url = new URL(request.url);
  return url.searchParams.get("sweep") === "1" || request.headers.get("x-lifecycle-sweep") === "1";
}

export async function GET(request: NextRequest) {
  const token = await verifyInternalBearerToken(request, [
    "RAID_LIFECYCLE_SECRET",
    "CRON_SECRET",
    "INTERNAL_API_TOKEN",
    "INTERNAL_PROFILE_LOOKUP_TOKEN",
  ], { minLength: 24 });
  if (!token.ok) {
    logDashboardEvent("warn", "raids.lifecycle.forbidden", request, { reason: token.reason, envName: token.envName || null, statusCode: 401 });
    return unauthorizedResponse();
  }

  const guard = lifecycleGuard();
  const force = wantsForceRun(request);
  const minInterval = lifecycleMinIntervalMs();
  const now = Date.now();

  if (!force && guard.inFlight) {
    return NextResponse.json(
      { ok: true, skipped: true, reason: "in_flight", ...(guard.lastResult || {}) },
      { headers: noStoreHeaders({ "X-Mistblossom-Lifecycle": "in-flight" }) },
    );
  }

  if (!force && guard.lastStartedAt && now - guard.lastStartedAt < minInterval) {
    return NextResponse.json(
      { ok: true, skipped: true, reason: "cooldown", cooldownMs: minInterval, ...(guard.lastResult || {}) },
      { headers: noStoreHeaders({ "X-Mistblossom-Lifecycle": "cooldown" }) },
    );
  }

  try {
    const url = new URL(request.url);
    const limit = integerParam(url.searchParams.get("limit"), lifecycleDefaultLimit(), 1, 50);
    guard.lastStartedAt = now;
    const fullSweep = wantsFullSweep(request);
    const promise = syncRaidLifecycleBatch(limit, { fullSweep });
    guard.inFlight = promise;
    const result = await promise;
    guard.lastResult = result as Record<string, unknown>;
    logDashboardEvent("info", "raids.lifecycle.cron", request, { ...result, cooldownMs: minInterval });
    return NextResponse.json({ ok: true, ...result }, { headers: noStoreHeaders() });
  } catch (error) {
    const message = safeErrorMessage(error);
    logDashboardEvent("warn", "raids.lifecycle.cron_failed", request, { message });
    return NextResponse.json({ ok: false, error: message }, { status: 500, headers: noStoreHeaders() });
  } finally {
    const guard = lifecycleGuard();
    guard.inFlight = undefined;
  }
}

export async function POST(request: NextRequest) {
  return GET(request);
}
