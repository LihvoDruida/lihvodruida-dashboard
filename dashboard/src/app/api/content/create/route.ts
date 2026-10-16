import { NextRequest } from "next/server";
import {contentJson,readContentForm} from "@/lib/contentApi";
import {ContentMutationError,type ContentKind,type ContentStatus} from "@/lib/content";
import { getSession } from "@/lib/auth";
import { recordAdminAudit } from "@/lib/accessGroups";
import { canManageSiteContent } from "@/lib/permissions";
import { resolveAuthorIdentity } from "@/lib/authorIdentity";
import { createSiteContent, isContentKind } from "@/lib/content";
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
    return forbiddenResponse("Недовірене джерело створення контенту.");
  }

  logDashboardEvent("info", "content.create.attempt", request);

  const tooLarge = assertRequestBodySize(request, 10 * 1024 * 1024);
  if (tooLarge) return tooLarge;

  const session = await getSession();
  if (!session || !canManageSiteContent(session)) {
    logDashboardEvent("warn", "content.create.unauthorized", request);
    return unauthorizedResponse("Недостатньо прав для керування матеріалами.");
  }

  const ip = getClientIp(request);
  const limit = checkRateLimit(`content-create:${session.id}:${ip}`, 12, 10 * 60 * 1000);
  if (!limit.ok) {
    logDashboardEvent("warn", "content.create.rate_limited", request, { userId: session.id, resetAt: limit.resetAt });
    if(wantsJsonResponse(request))return contentJson({error:'Забагато спроб. Зачекай кілька хвилин.',code:'rate_limited'},429);
    return redirectTo(request, `/content?error=${encodeURIComponent("Забагато спроб створення матеріалів. Зачекай кілька хвилин.")}`);
  }

  let form:FormData|undefined;let kind='';
  try {
    form=await readContentForm(request,10*1024*1024);kind=String(form.get('kind')||'');
    if(!isContentKind(kind))throw new ContentMutationError('Оберіть новину або гайд.','invalid_kind');
    const imageValue = form.get("image");
    const result = await createSiteContent({
      kind:kind as ContentKind,
      requestId:String(form.get("requestId")||""),
      status:(form.has('status')?String(form.get('status')):undefined) as ContentStatus|undefined,
      date:String(form.get("date")||""),
      title: String(form.get("title") || ""),
      description: String(form.get("description") || ""),
      body: String(form.get("body") || ""),
      categories: String(form.get("categories") || ""),
      tags: String(form.get("tags") || ""),
      slug: String(form.get("slug") || ""),
      image: imageValue instanceof File ? imageValue : null,
      author: String(form.get("author") || (await resolveAuthorIdentity(session)).primaryName || session.name),
      user: session });

    logDashboardEvent("info", result.duplicate?"content.create.replayed":"content.create.success", request, { path: result.path, userId: session.id });
    if(!result.duplicate)await recordAdminAudit("content.create", session, {
      status: "success",
      summary: `Контент створено: ${result.path}.`,
      path: result.path,
      kind,
      title: String(form.get("title") || "").slice(0, 140) }).catch((auditError) => {
      logDashboardEvent("warn", "content.create.audit_failed", request, { path: result.path, message: auditError instanceof Error ? auditError.message : String(auditError || "unknown") });
    });
    if(wantsJsonResponse(request))return contentJson(result);
    return redirectTo(request, `/content?published=${encodeURIComponent(result.path)}`);
  } catch (error) {
    const message = error instanceof ContentMutationError?safeErrorMessage(error):'Сховище контенту тимчасово недоступне. Зміни залишилися у формі — повтори збереження пізніше.';
    logDashboardEvent("error", "content.create.failed", request, { message });
    await recordAdminAudit("content.create_failed", session, {
      status: "error",
      summary: `Контент не створено: ${message}`,
      kind,
      path: String(form?.get("path") || ""),
      title: String(form?.get("title") || "").slice(0, 140),
      error: error instanceof Error ? error.message : String(error || "") }).catch(() => false);
    if(wantsJsonResponse(request))return contentJson({error:message,code:error instanceof ContentMutationError?error.code:'storage_unavailable'},error instanceof ContentMutationError?error.status:503);
    return redirectTo(request, `/content?error=${encodeURIComponent(message)}`);
  }
}
