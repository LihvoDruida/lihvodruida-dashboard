import "server-only";

import { FieldValue } from "firebase-admin/firestore";
import { NextRequest, NextResponse } from "next/server";
import { getFirebaseAdminDb, hasFirebaseProfileConfig } from "@/lib/firebaseAdmin";
import type { DashboardSession } from "@/lib/auth";
import { logDashboardEvent, noStoreHeaders } from "@/lib/security";
import { resilientRead } from "@/lib/runtimeResilience";
import { firebaseWrite } from "@/lib/firebaseAccess";

const SETTINGS_COLLECTION = "dashboardSettings";
const GEO_ACCESS_DOC_ID = "geoAccessPolicy";

const POLICY_CACHE_TTL_MS = Math.max(60_000, Math.min(30 * 60_000, Number(process.env.GEO_ACCESS_POLICY_CACHE_TTL_MS || 10 * 60_000)));
const POLICY_ERROR_LOG_TTL_MS = 5 * 60_000;

declare global {
  // eslint-disable-next-line no-var
  var __mistblossomGeoAccessPolicyCache: { policy: GeoAccessPolicy; cachedAt: number } | undefined;
  // eslint-disable-next-line no-var
  var __mistblossomGeoAccessPolicyErrorLoggedAt: number | undefined;
}

function geoPolicyCacheFresh() {
  const cached = globalThis.__mistblossomGeoAccessPolicyCache;
  return Boolean(cached && Date.now() - cached.cachedAt < POLICY_CACHE_TTL_MS);
}

function setGeoPolicyCache(policy: GeoAccessPolicy) {
  globalThis.__mistblossomGeoAccessPolicyCache = { policy, cachedAt: Date.now() };
  return policy;
}

function logGeoPolicyReadFailureOnce(error: unknown) {
  const now = Date.now();
  const last = globalThis.__mistblossomGeoAccessPolicyErrorLoggedAt || 0;
  if (now - last < POLICY_ERROR_LOG_TTL_MS) return;
  globalThis.__mistblossomGeoAccessPolicyErrorLoggedAt = now;
  logDashboardEvent("warn", "geo_access.policy_read_failed", undefined, { message: error instanceof Error ? error.message : String(error || "unknown") });
}

const DEFAULT_BLOCKED_COUNTRIES = ["RU", "BY"];

const COUNTRY_CODE_ALIASES: Record<string, string> = {
  RU: "RU",
  RUS: "RU",
  "643": "RU",
  RUSSIA: "RU",
  RUSSIANFEDERATION: "RU",
  "РОСІЯ": "RU",
  "РОССИЯ": "RU",
  "РФ": "RU",
  BY: "BY",
  BLR: "BY",
  "112": "BY",
  BELARUS: "BY",
  BELARUSREPUBLIC: "BY",
  "БІЛОРУСЬ": "BY",
  "БЕЛАРУСЬ": "BY",
  UA: "UA",
  UKR: "UA",
  "804": "UA",
  UKRAINE: "UA",
  "УКРАЇНА": "UA",
  "УКРАИНА": "UA",
};

export type GeoAccessTarget = "applications" | "auth";

export type GeoAccessPolicy = {
  enabled: boolean;
  blockApplications: boolean;
  blockAuth: boolean;
  blockUnknownCountries: boolean;
  blockedCountries: string[];
  updatedAt?: string | null;
  updatedBy?: string | null;
};

export type GeoAccessDecision = {
  blocked: boolean;
  country: string;
  countryLabel: string;
  reason: "disabled" | "target_disabled" | "blocked_country" | "unknown_country" | "allowed";
  policy: GeoAccessPolicy;
};

function envFlag(name: string, fallback: boolean) {
  const raw = process.env[name];
  if (raw === undefined || raw === null || raw === "") return fallback;
  return /^(1|true|yes|on)$/i.test(String(raw).trim());
}

function timestampToIso(value: unknown) {
  if (!value) return null;
  if (typeof value === "string") return value;
  const maybeTimestamp = value as { toDate?: () => Date } | null;
  if (maybeTimestamp && typeof maybeTimestamp.toDate === "function") return maybeTimestamp.toDate().toISOString();
  return null;
}

function splitCountryTokens(value: unknown) {
  if (Array.isArray(value)) return value.map((item) => String(item || "").trim()).filter(Boolean);
  return String(value || "").split(/[\s,;|]+/g).map((item) => item.trim()).filter(Boolean);
}

export function normalizeCountryCode(value: unknown) {
  const raw = String(value || "").trim().toUpperCase();
  if (!raw) return "";

  const compact = raw.replace(/[._-]+/g, "").replace(/\s+/g, "");
  if (COUNTRY_CODE_ALIASES[compact]) return COUNTRY_CODE_ALIASES[compact];

  const digits = compact.replace(/\D/g, "");
  if (digits && COUNTRY_CODE_ALIASES[digits]) return COUNTRY_CODE_ALIASES[digits];

  const letters = compact.replace(/[^A-Z]/g, "");
  if (COUNTRY_CODE_ALIASES[letters]) return COUNTRY_CODE_ALIASES[letters];
  if (/^[A-Z]{2}$/.test(letters)) return letters;

  return "";
}

export function invalidCountryCodeTokens(value: unknown) {
  return splitCountryTokens(value).filter((token) => !normalizeCountryCode(token)).slice(0, 12);
}

export function parseBlockedCountries(value: unknown, fallback = DEFAULT_BLOCKED_COUNTRIES) {
  const hasExplicitValue = Array.isArray(value) || (value !== undefined && value !== null && String(value).trim() !== "");
  const items = splitCountryTokens(value);
  const normalized = Array.from(new Set(items.map(normalizeCountryCode).filter(Boolean)));
  if (normalized.length) return normalized.slice(0, 64);
  return hasExplicitValue ? [] : [...fallback];
}

function defaultGeoAccessPolicy(): GeoAccessPolicy {
  return {
    enabled: envFlag("GEO_ACCESS_BLOCK_ENABLED", true),
    blockApplications: envFlag("GEO_ACCESS_BLOCK_APPLICATIONS", true),
    blockAuth: envFlag("GEO_ACCESS_BLOCK_AUTH", true),
    blockUnknownCountries: envFlag("GEO_ACCESS_BLOCK_UNKNOWN_COUNTRIES", false),
    blockedCountries: parseBlockedCountries(process.env.GEO_ACCESS_BLOCKED_COUNTRIES || process.env.BLOCKED_COUNTRIES, DEFAULT_BLOCKED_COUNTRIES),
    updatedAt: null,
    updatedBy: null,
  };
}

function normalizePolicyData(data?: Record<string, unknown> | null): GeoAccessPolicy {
  const fallback = defaultGeoAccessPolicy();
  return {
    enabled: typeof data?.enabled === "boolean" ? data.enabled : fallback.enabled,
    blockApplications: typeof data?.blockApplications === "boolean" ? data.blockApplications : fallback.blockApplications,
    blockAuth: typeof data?.blockAuth === "boolean" ? data.blockAuth : fallback.blockAuth,
    blockUnknownCountries: typeof data?.blockUnknownCountries === "boolean" ? data.blockUnknownCountries : fallback.blockUnknownCountries,
    blockedCountries: parseBlockedCountries(data?.blockedCountries, fallback.blockedCountries),
    updatedAt: timestampToIso(data?.updatedAt),
    updatedBy: typeof data?.updatedBy === "string" ? data.updatedBy : null,
  };
}

export async function getGeoAccessPolicy(options: { bypassCache?: boolean } = {}): Promise<GeoAccessPolicy> {
  if (!options.bypassCache && geoPolicyCacheFresh()) {
    return globalThis.__mistblossomGeoAccessPolicyCache!.policy;
  }
  if (!hasFirebaseProfileConfig()) return setGeoPolicyCache(defaultGeoAccessPolicy());

  const policy = await resilientRead(
    "getGeoAccessPolicy",
    async () => {
      const snapshot = await getFirebaseAdminDb()
        .collection(SETTINGS_COLLECTION)
        .doc(GEO_ACCESS_DOC_ID)
        .get();
      return snapshot.exists
        ? normalizePolicyData(snapshot.data() || null)
        : globalThis.__mistblossomGeoAccessPolicyCache?.policy || defaultGeoAccessPolicy();
    },
    {
      ttlMs: POLICY_CACHE_TTL_MS,
      timeoutMs: 2_000,
      circuitKey: "firebase-geo-policy-read",
      circuitTtlMs: 90_000,
      bypassCache: Boolean(options.bypassCache),
      fallback: () => globalThis.__mistblossomGeoAccessPolicyCache?.policy || defaultGeoAccessPolicy(),
      logEvent: "geo_access.policy_read_failed",
    },
  );
  return setGeoPolicyCache(policy);
}

export async function setGeoAccessPolicy(input: {
  enabled?: unknown;
  blockApplications?: unknown;
  blockAuth?: unknown;
  blockUnknownCountries?: unknown;
  blockedCountries?: unknown;
}, actor?: DashboardSession | null) {
  if (!hasFirebaseProfileConfig()) throw new Error("Firebase не налаштований для збереження геообмежень.");

  const invalidCountries = invalidCountryCodeTokens(input.blockedCountries);
  if (invalidCountries.length) {
    throw new Error(`Некоректні ISO-коди країн: ${invalidCountries.join(", ")}. Використовуй Alpha-2 на кшталт RU, BY або підтримані aliases: RUS/643, BLR/112.`);
  }

  const nextPolicy = normalizePolicyData({
    enabled: input.enabled === "on" || input.enabled === "1" || input.enabled === true,
    blockApplications: input.blockApplications === "on" || input.blockApplications === "1" || input.blockApplications === true,
    blockAuth: input.blockAuth === "on" || input.blockAuth === "1" || input.blockAuth === true,
    blockUnknownCountries: input.blockUnknownCountries === "on" || input.blockUnknownCountries === "1" || input.blockUnknownCountries === true,
    blockedCountries: parseBlockedCountries(input.blockedCountries, []),
  });

  await firebaseWrite(
    "settings",
    "geo-access-policy:save",
    () => getFirebaseAdminDb().collection(SETTINGS_COLLECTION).doc(GEO_ACCESS_DOC_ID).set({
      enabled: nextPolicy.enabled,
      blockApplications: nextPolicy.blockApplications,
      blockAuth: nextPolicy.blockAuth,
      blockUnknownCountries: nextPolicy.blockUnknownCountries,
      blockedCountries: nextPolicy.blockedCountries,
      updatedAt: FieldValue.serverTimestamp(),
      updatedBy: actor?.name || actor?.login || actor?.id || null,
    }, { merge: true }),
    { timeoutMs: 3_000, logEvent: "geo_access.policy_write_failed" },
  );

  return setGeoPolicyCache({
    ...nextPolicy,
    updatedAt: new Date().toISOString(),
    updatedBy: actor?.name || actor?.login || actor?.id || null,
  });
}

export function getRequestCountryCode(request: Request | NextRequest) {
  const headerCountry =
    request.headers.get("cf-ipcountry") ||
    request.headers.get("x-vercel-ip-country") ||
    request.headers.get("cloudfront-viewer-country") ||
    "";
  const country = normalizeCountryCode(headerCountry);
  if (country && country !== "XX" && country !== "T1") return country;
  return "";
}

export function countryLabel(country: string) {
  const normalized = normalizeCountryCode(country);
  if (!normalized) return "невідома країна";
  const labels: Record<string, string> = {
    RU: "RU · Росія",
    BY: "BY · Білорусь",
    UA: "UA · Україна",
  };
  return labels[normalized] || normalized;
}

export function evaluateGeoAccess(policy: GeoAccessPolicy, country: string, target: GeoAccessTarget): GeoAccessDecision {
  const normalizedCountry = normalizeCountryCode(country);
  if (!policy.enabled) return { blocked: false, country: normalizedCountry, countryLabel: countryLabel(normalizedCountry), reason: "disabled", policy };
  if (target === "applications" && !policy.blockApplications) return { blocked: false, country: normalizedCountry, countryLabel: countryLabel(normalizedCountry), reason: "target_disabled", policy };
  if (target === "auth" && !policy.blockAuth) return { blocked: false, country: normalizedCountry, countryLabel: countryLabel(normalizedCountry), reason: "target_disabled", policy };
  if (!normalizedCountry) {
    return {
      blocked: Boolean(policy.blockUnknownCountries),
      country: "",
      countryLabel: countryLabel(""),
      reason: policy.blockUnknownCountries ? "unknown_country" : "allowed",
      policy,
    };
  }
  const blocked = new Set(policy.blockedCountries.map(normalizeCountryCode).filter(Boolean)).has(normalizedCountry);
  return {
    blocked,
    country: normalizedCountry,
    countryLabel: countryLabel(normalizedCountry),
    reason: blocked ? "blocked_country" : "allowed",
    policy,
  };
}

export async function checkGeoAccess(request: Request | NextRequest, target: GeoAccessTarget) {
  const policy = await getGeoAccessPolicy();
  return evaluateGeoAccess(policy, getRequestCountryCode(request), target);
}

export function geoAccessDeniedResponse(request: NextRequest, decision: GeoAccessDecision, error = "geo_blocked") {
  const url = new URL(request.url);
  const acceptsJson = String(request.headers.get("accept") || "").toLowerCase().includes("application/json") || String(request.headers.get("x-dashboard-action") || "").toLowerCase() === "live";
  const message = "Доступ із цієї країни зараз обмежено правилами спільноти.";

  logDashboardEvent("warn", "geo_access.blocked", request, {
    country: decision.country || null,
    target: url.pathname,
    reason: decision.reason,
    blockedCountries: decision.policy.blockedCountries,
  });

  if (acceptsJson || request.method !== "GET") {
    return NextResponse.json({ ok: false, error, message }, { status: 403, headers: noStoreHeaders() });
  }

  const response = NextResponse.redirect(new URL(`/login?error=${encodeURIComponent(error)}`, url.origin), 303);
  for (const [key, value] of Object.entries(noStoreHeaders())) response.headers.set(key, value);
  return response;
}
