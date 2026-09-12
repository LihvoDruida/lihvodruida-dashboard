import { NextRequest, NextResponse } from "next/server";

import { recordStructuredLog, type StructuredLogCategory, type StructuredLogLevel } from "@/lib/structuredLogs";
import { assertRequestBodySize, noStoreHeaders, verifyInternalBearerToken } from "@/lib/security";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

const TOKENS = ["INTERNAL_API_TOKEN", "CRON_SECRET"];
const CATEGORIES = new Set<StructuredLogCategory>(["security", "api", "action", "auth", "discord", "database", "integration", "system"]);
const LEVELS = new Set<StructuredLogLevel>(["debug", "info", "success", "warning", "error"]);

function cleanText(value: unknown, max = 500) {
  const text = String(value ?? "").trim();
  return text ? text.slice(0, max) : null;
}

function cleanRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function level(value: unknown): StructuredLogLevel {
  const text = String(value ?? "").trim().toLowerCase();
  if (text === "warn") return "warning";
  return LEVELS.has(text as StructuredLogLevel) ? text as StructuredLogLevel : "info";
}

function category(value: unknown, message: string | null): StructuredLogCategory {
  const explicit = String(value ?? "").trim().toLowerCase();
  if (CATEGORIES.has(explicit as StructuredLogCategory)) return explicit as StructuredLogCategory;
  const text = String(message || "").toLowerCase();
  if (/signature|підпис|unauthor|неавториз|forbidden|заблок|відхилен|security|rate.?limit/.test(text)) return "security";
  if (/postgres|database|баз[аи]|storage/.test(text)) return "database";
  if (/gateway|discord|interaction|взаємод/.test(text)) return "discord";
  return "system";
}

export async function POST(request: NextRequest) {
  const auth = await verifyInternalBearerToken(request, TOKENS);
  if (!auth.ok) {
    return NextResponse.json({ ok: false, error: auth.reason }, { status: 401, headers: noStoreHeaders() });
  }
  const tooLarge = assertRequestBodySize(request, 24 * 1024);
  if (tooLarge) return tooLarge;

  let body: Record<string, unknown>;
  try {
    body = cleanRecord(await request.json());
  } catch {
    return NextResponse.json({ ok: false, error: "invalid_json" }, { status: 400, headers: noStoreHeaders() });
  }

  const message = cleanText(body.message, 1500);
  const details = cleanRecord(body.details || body.context);
  const sourceRaw = String(body.source || "system").toLowerCase();
  const source = sourceRaw === "bot" || sourceRaw === "cron" ? sourceRaw : "system";
  const logLevel = level(body.level);
  const logCategory = category(body.category, message);

  const ok = await recordStructuredLog({
    source,
    level: logLevel,
    category: logCategory,
    event: cleanText(body.event, 180) || `${source}.runtime`,
    message,
    requestId: cleanText(body.requestId, 120),
    method: cleanText(body.method, 12),
    path: cleanText(body.path, 500),
    statusCode: typeof body.statusCode === "number" ? body.statusCode : undefined,
    durationMs: typeof body.durationMs === "number" ? body.durationMs : undefined,
    resourceType: cleanText(body.resourceType, 100),
    resourceId: cleanText(body.resourceId, 160),
    actorId: cleanText(body.actorId, 120),
    actorName: cleanText(body.actorName, 160),
    ip: cleanText(body.ip, 80),
    details,
  });

  return NextResponse.json({ ok }, { status: ok ? 202 : 503, headers: noStoreHeaders() });
}
