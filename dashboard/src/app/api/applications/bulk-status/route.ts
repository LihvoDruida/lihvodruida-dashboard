import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { recordAdminAudit } from "@/lib/accessGroups";
import { resolveAuthorIdentity } from "@/lib/authorIdentity";
import { ApplicationStatus, normalizeStatus } from "@/lib/github";
import { moderateApplications } from "@/lib/moderation";
import { canManageApplications, hierarchyTitle } from "@/lib/permissions";
import {
  assertRequestBodySize,
  checkRateLimit,
  forbiddenResponse,
  getClientIp,
  logDashboardEvent,
  noStoreHeaders,
  safeErrorMessage,
  unauthorizedResponse,
  verifyTrustedOrigin,
} from "@/lib/security";

export const runtime = "nodejs";

export const dynamic = "force-dynamic";
export const revalidate = 0;

type BulkStatusInput = {
  issueNumbers?: unknown;
  status?: unknown;
  items?: unknown;
};

function cleanStatus(value: unknown): ApplicationStatus | null {
  const status = normalizeStatus(String(value || ""));
  return status === "accepted" || status === "declined" ? status : null;
}

function cleanIssueNumber(value: unknown) {
  const issueNumber = Number(value);
  return Number.isInteger(issueNumber) && issueNumber > 0 ? issueNumber : null;
}

function parseBulkItems(body: BulkStatusInput) {
  const sharedStatus = cleanStatus(body.status);

  if (Array.isArray(body.items)) {
    return body.items
      .map((raw) => {
        if (!raw || typeof raw !== "object") return null;
        const item = raw as Record<string, unknown>;
        const issueNumber = cleanIssueNumber(item.issueNumber ?? item.number);
        const status = cleanStatus(item.status) || sharedStatus;
        return issueNumber && status ? { issueNumber, status } : null;
      })
      .filter(Boolean) as Array<{ issueNumber: number; status: ApplicationStatus }>;
  }

  if (Array.isArray(body.issueNumbers) && sharedStatus) {
    return body.issueNumbers
      .map(cleanIssueNumber)
      .filter(Boolean)
      .map((issueNumber) => ({ issueNumber: issueNumber as number, status: sharedStatus }));
  }

  return [];
}

export async function POST(request: NextRequest) {
  if (!verifyTrustedOrigin(request)) {
    return forbiddenResponse("Недовірене джерело запиту.");
  }

  const tooLarge = assertRequestBodySize(request, 24 * 1024);
  if (tooLarge) return tooLarge;

  const session = await getSession();
  if (!session || !canManageApplications(session)) {
    logDashboardEvent("warn", "applications.bulk_status.unauthorized", request);
    return unauthorizedResponse();
  }

  const ip = getClientIp(request);
  const limit = checkRateLimit(`bulk-moderation:${session.id}:${ip}`, 8, 10 * 60 * 1000);
  if (!limit.ok) {
    logDashboardEvent("warn", "applications.bulk_status.rate_limited", request, { userId: session.id, resetAt: limit.resetAt });
    return NextResponse.json(
      { error: "Забагато змін статусу. Зачекай кілька хвилин." },
      { status: 429, headers: noStoreHeaders({ "Retry-After": String(Math.ceil((limit.resetAt - Date.now()) / 1000)) }) },
    );
  }

  const body = await request.json().catch(() => ({} as BulkStatusInput));
  const items = parseBulkItems(body).slice(0, 50);

  if (!items.length) {
    return NextResponse.json({ error: "Вибери заявки й потрібний статус." }, { status: 400, headers: noStoreHeaders() });
  }

  try {
    logDashboardEvent("info", "applications.bulk_status.attempt", request, { userId: session.id, count: items.length });
    const moderatorName = (await resolveAuthorIdentity(session)).primaryName;

    const result = await moderateApplications({
      items,
      moderator: `${moderatorName} (${hierarchyTitle(session.role)})`,
      source: "dashboard",
    });

    logDashboardEvent("info", "applications.bulk_status.success", request, {
      userId: session.id,
      total: result.total,
      succeeded: result.succeeded,
      failed: result.failed,
      concurrency: result.concurrency,
      durationMs: result.durationMs,
    });

    await recordAdminAudit("applications.bulk_status.update", session, {
      status: result.failed ? "warning" : "success",
      summary: `Масово оновлено заявки: успішно ${result.succeeded}/${result.total}, помилок ${result.failed}.`,
      total: result.total,
      changed: result.succeeded,
      failed: result.failed,
      concurrency: result.concurrency,
      durationMs: result.durationMs,
      items: items.slice(0, 50),
      issueNumbers: items.map((item) => item.issueNumber),
    }).catch((auditError) => {
      logDashboardEvent("warn", "applications.bulk_status.audit_failed", request, { message: auditError instanceof Error ? auditError.message : String(auditError || "unknown") });
    });

    return NextResponse.json(result, { headers: noStoreHeaders() });
  } catch (error) {
    const message = safeErrorMessage(error);
    logDashboardEvent("error", "applications.bulk_status.failed", request, { userId: session.id, message });
    await recordAdminAudit("applications.bulk_status.update_failed", session, {
      status: "error",
      summary: `Масову зміну статусів не виконано: ${message}`,
      error: error instanceof Error ? error.message : String(error || ""),
      itemCount: items.length,
      issueNumbers: items.map((item) => item.issueNumber),
    }).catch(() => false);
    return NextResponse.json(
      { error: safeErrorMessage(error, "Масову зміну статусів не виконано.") },
      { status: 500, headers: noStoreHeaders() },
    );
  }
}
