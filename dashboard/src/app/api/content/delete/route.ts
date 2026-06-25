import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { recordAdminAudit } from "@/lib/accessGroups";
import { canManageSiteContent } from "@/lib/permissions";
import { deleteRepoFile, isManagedContentPath } from "@/lib/content";
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

function redirectTo(request: NextRequest, path: string) {
  const response = NextResponse.redirect(new URL(path, request.url), 303);
  for (const [key, value] of Object.entries(noStoreHeaders())) response.headers.set(key, value);
  return response;
}

export async function POST(request: NextRequest) {
  if (!verifyTrustedOrigin(request)) {
    return forbiddenResponse("Недовірене джерело видалення контенту.");
  }

  logDashboardEvent("info", "content.delete.attempt", request);

  const tooLarge = assertRequestBodySize(request, 4096);
  if (tooLarge) return tooLarge;

  const session = await getSession();
  if (!session || !canManageSiteContent(session)) {
    logDashboardEvent("warn", "content.delete.unauthorized", request);
    return unauthorizedResponse("Недостатньо прав для керування матеріалами.");
  }

  const ip = getClientIp(request);
  const limit = checkRateLimit(`content-delete:${session.id}:${ip}`, 8, 10 * 60 * 1000);
  if (!limit.ok) {
    logDashboardEvent("warn", "content.delete.rate_limited", request, { userId: session.id, resetAt: limit.resetAt });
    return redirectTo(request, `/content?error=${encodeURIComponent("Забагато видалень. Зачекай кілька хвилин.")}`);
  }

  const form = await request.formData();
  const path = String(form.get("path") || "").trim();

  try {
    if (!isManagedContentPath(path)) {
      throw new Error("Можна видаляти тільки матеріали новин або гайдів.");
    }

    await deleteRepoFile(path, `content: delete ${path} by ${session.name}`);
    logDashboardEvent("info", "content.delete.success", request, { path, userId: session.id });
    await recordAdminAudit("content.delete", session, {
      status: "success",
      summary: `Контент видалено: ${path}.`,
      path,
      changed: 1,
    }).catch((auditError) => {
      logDashboardEvent("warn", "content.delete.audit_failed", request, { path, message: auditError instanceof Error ? auditError.message : String(auditError || "unknown") });
    });
    return redirectTo(request, `/content?deleted=${encodeURIComponent(path)}`);
  } catch (error) {
    const message = safeErrorMessage(error, "Не вдалося видалити матеріал.");
    logDashboardEvent("error", "content.delete.failed", request, { message });
    await recordAdminAudit("content.delete_failed", session, {
      status: "error",
      summary: `Контент не видалено: ${message}`,
      path,
      error: error instanceof Error ? error.message : String(error || ""),
    }).catch(() => false);
    return redirectTo(request, `/content?error=${encodeURIComponent(message)}`);
  }
}
