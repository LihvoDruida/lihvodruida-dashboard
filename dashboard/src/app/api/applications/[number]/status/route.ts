import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { recordAdminAudit } from "@/lib/accessGroups";
import { resolveAuthorIdentity } from "@/lib/authorIdentity";
import { ApplicationStatus } from "@/lib/github";
import { moderateApplication } from "@/lib/moderation";
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

export async function POST(
  request: NextRequest,
  context: { params: Promise<{ number: string }> }
) {
  if (!verifyTrustedOrigin(request)) {
    return forbiddenResponse("Недовірене джерело зміни статусу.");
  }

  logDashboardEvent("info", "applications.status.attempt", request);

  const tooLarge = assertRequestBodySize(request, 4096);
  if (tooLarge) return tooLarge;

  const session = await getSession();
  if (!session || !canManageApplications(session)) {
    logDashboardEvent("warn", "applications.status.unauthorized", request);
    return unauthorizedResponse();
  }

  const ip = getClientIp(request);
  const limit = checkRateLimit(`moderation:${session.id}:${ip}`, 30, 60 * 1000);
  if (!limit.ok) {
    logDashboardEvent("warn", "applications.status.rate_limited", request, { userId: session.id, resetAt: limit.resetAt });
    return NextResponse.json(
      { error: "Забагато змін статусу. Зачекай хвилину." },
      { status: 429, headers: noStoreHeaders({ "Retry-After": String(Math.ceil((limit.resetAt - Date.now()) / 1000)) }) }
    );
  }

  const { number } = await context.params;
  const issueNumber = Number(number);
  if (!Number.isInteger(issueNumber) || issueNumber <= 0) {
    logDashboardEvent("warn", "applications.status.invalid_issue", request, { issueNumber: number });
    return NextResponse.json({ error: "Невірний номер заявки." }, { status: 400, headers: noStoreHeaders() });
  }

  const body = await request.json().catch(() => ({}));
  const status = String(body.status || "") as ApplicationStatus;

  if (status !== "accepted" && status !== "declined") {
    logDashboardEvent("warn", "applications.status.unsupported_status", request, { issueNumber, status });
    return NextResponse.json({ error: "Невідомий статус заявки" }, { status: 400, headers: noStoreHeaders() });
  }

  try {
    const moderatorName = (await resolveAuthorIdentity(session)).primaryName;
    const result = await moderateApplication({
      issueNumber,
      status,
      moderator: `${moderatorName} (${hierarchyTitle(session.role)})`,
      source: "dashboard",
    });

    const resultRecord = result as Record<string, unknown>;
    const discordResult = resultRecord.discord && typeof resultRecord.discord === "object" && !Array.isArray(resultRecord.discord)
      ? resultRecord.discord as Record<string, unknown>
      : null;

    logDashboardEvent("info", "applications.status.success", request, { issueNumber, status, userId: session.id });
    await recordAdminAudit("applications.status.update", session, {
      status: "success",
      summary: `Заявка #${issueNumber}: статус змінено на ${status}.`,
      issueNumber,
      applicationStatus: status,
      source: "dashboard",
      discordUpdated: Boolean(resultRecord.discordUpdated || discordResult?.ok),
    }).catch((auditError) => {
      logDashboardEvent("warn", "applications.status.audit_failed", request, { issueNumber, status, message: auditError instanceof Error ? auditError.message : String(auditError || "unknown") });
    });
    return NextResponse.json(result, { headers: noStoreHeaders() });
  } catch (error) {
    const message = safeErrorMessage(error);
    logDashboardEvent("error", "applications.status.failed", request, { issueNumber, status, message });
    await recordAdminAudit("applications.status.update_failed", session, {
      status: "error",
      summary: `Заявка #${issueNumber}: статус не змінено. ${message}`,
      issueNumber,
      applicationStatus: status,
      error: error instanceof Error ? error.message : String(error || ""),
    }).catch(() => false);
    return NextResponse.json(
      { error: safeErrorMessage(error, "Не вдалося змінити статус заявки.") },
      { status: 500, headers: noStoreHeaders() }
    );
  }
}
