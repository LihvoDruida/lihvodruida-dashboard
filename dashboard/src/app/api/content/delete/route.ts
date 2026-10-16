import { NextRequest } from "next/server";
import {contentJson,readContentForm} from "@/lib/contentApi";
import {ContentMutationError} from "@/lib/content";
import { getSession } from "@/lib/auth";
import { recordAdminAudit } from "@/lib/accessGroups";
import { canManageSiteContent } from "@/lib/permissions";
import { deleteSiteContent, isManagedContentPath } from "@/lib/content";
import { redirectTo, wantsJsonResponse } from "@/lib/apiRoute";
import {
  assertRequestBodySize,
  checkRateLimit,
  forbiddenResponse,
  getClientIp,
  logDashboardEvent,
  safeErrorMessage,
  unauthorizedResponse,
  verifyTrustedOrigin } from "@/lib/security";

export const runtime = "nodejs";

export const dynamic = "force-dynamic";
export const revalidate = 0;

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
    if(wantsJsonResponse(request))return contentJson({error:'Забагато спроб. Зачекай кілька хвилин.',code:'rate_limited'},429);
    return redirectTo(request, `/content?error=${encodeURIComponent("Забагато видалень. Зачекай кілька хвилин.")}`);
  }

  let form:FormData|undefined;let path='';
  try {
    form=await readContentForm(request,4096);path=String(form.get('path')||'').trim();
    if (!isManagedContentPath(path)) {
      throw new Error("Можна видаляти тільки матеріали новин або гайдів.");
    }

    await deleteSiteContent(path,String(form.get("revision") || ""));
    logDashboardEvent("info", "content.delete.success", request, { path, userId: session.id });
    await recordAdminAudit("content.delete", session, {
      status: "success",
      summary: `Контент видалено: ${path}.`,
      path,
      changed: 1 }).catch((auditError) => {
      logDashboardEvent("warn", "content.delete.audit_failed", request, { path, message: auditError instanceof Error ? auditError.message : String(auditError || "unknown") });
    });
    if(wantsJsonResponse(request))return contentJson({ok:true,path});
    return redirectTo(request, `/content?deleted=${encodeURIComponent(path)}`);
  } catch (error) {
    const message = error instanceof ContentMutationError?safeErrorMessage(error):'Сховище контенту тимчасово недоступне. Зміни залишилися у формі — повтори збереження пізніше.';
    logDashboardEvent("error", "content.delete.failed", request, { message });
    await recordAdminAudit("content.delete_failed", session, {
      status: "error",
      summary: `Контент не видалено: ${message}`,
      path,
      error: error instanceof Error ? error.message : String(error || "") }).catch(() => false);
    if(wantsJsonResponse(request))return contentJson({error:message,code:error instanceof ContentMutationError?error.code:'storage_unavailable'},error instanceof ContentMutationError?error.status:503);
    return redirectTo(request, `/content?error=${encodeURIComponent(message)}`);
  }
}
