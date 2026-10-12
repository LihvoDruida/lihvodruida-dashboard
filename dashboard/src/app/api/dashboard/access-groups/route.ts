import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import {
  AccessGroupError,
  applyAccessGroupToSession,
  canManageGroups,
  deleteAccessGroup,
  listAccessGroupsForManagement,
  recordAdminAudit,
  upsertAccessGroup,
} from "@/lib/accessGroups";
import {
  assertRequestBodySize,
  checkRateLimit,
  getClientIp,
  logDashboardEvent,
  noStoreHeaders,
  verifyTrustedOrigin,
} from "@/lib/security";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;
const MAX_BODY = 8192;
function reply(data: unknown, status = 200) {
  return NextResponse.json(data, { status, headers: noStoreHeaders() });
}
async function boundedJson(request: NextRequest) {
  if (
    !request.headers
      .get("content-type")
      ?.toLowerCase()
      .startsWith("application/json")
  )
    throw new AccessGroupError("Потрібен JSON-запит.", 415);
  const reader = request.body?.getReader();
  if (!reader) throw new AccessGroupError("Порожній запит.");
  let size = 0;
  const chunks: Uint8Array[] = [];
  try {
    while (true) {
      const next = await reader.read();
      if (next.done) break;
      size += next.value.byteLength;
      if (size > MAX_BODY) {
        await reader.cancel();
        throw new AccessGroupError("Запит завеликий.", 413);
      }
      chunks.push(next.value);
    }
  } finally {
    reader.releaseLock();
  }
  try {
    const body = JSON.parse(Buffer.concat(chunks).toString("utf8"));
    if (!body || typeof body !== "object" || Array.isArray(body))
      throw new Error();
    return body;
  } catch {
    throw new AccessGroupError("Некоректний JSON.");
  }
}
export async function GET() {
  const session = await getSession();
  if (!session || !canManageGroups(session))
    return reply({ ok: false, error: "Немає доступу." }, session ? 403 : 401);
  try {
    const groups = await listAccessGroupsForManagement();
    if (!session.isServerOwner) {
      const ownGroup = groups.find((group) => group.id === session.groupId);
      if (
        !ownGroup ||
        !canManageGroups(applyAccessGroupToSession(session, ownGroup))
      )
        return reply(
          { ok: false, error: "Право керування групами вже змінено." },
          403,
        );
    }
    return reply({ ok: true, groups });
  } catch {
    return reply(
      { ok: false, error: "Актуальні групи тимчасово недоступні." },
      503,
    );
  }
}
export async function POST(request: NextRequest) {
  if (!verifyTrustedOrigin(request))
    return reply({ ok: false, error: "Недовірене джерело запиту." }, 403);
  const tooLarge = assertRequestBodySize(request, MAX_BODY);
  if (tooLarge) return tooLarge;
  const session = await getSession();
  if (!session || !canManageGroups(session))
    return reply({ ok: false, error: "Немає доступу." }, session ? 403 : 401);
  if (
    !checkRateLimit(
      `access-groups:${session.provider}:${session.id}:${getClientIp(request)}`,
      30,
      600_000,
    ).ok
  )
    return reply({ ok: false, error: "Забагато змін. Спробуй пізніше." }, 429);
  try {
    const body = await boundedJson(request);
    let group, deletedId;
    if (body.action === "save") group = await upsertAccessGroup(body, session);
    else if (body.action === "delete") {
      deletedId = String(body.currentId || "");
      await deleteAccessGroup(deletedId, session, body.expectedRevision);
    } else throw new AccessGroupError("Невідома дія.");
    // An unavailable audit must not misreport a committed mutation as failed.
    await recordAdminAudit(
      group ? "access_group.upsert" : "access_group.delete",
      session,
      {
        status: "success",
        summary: group
          ? `Збережено групу: ${group.name} (${group.id}).`
          : `Видалено групу: ${deletedId}.`,
        groupId: group?.id || deletedId,
        mutationId: group?.lastMutationId || null,
        permissionCount: group?.permissions.length,
        assignmentMigration: group?.assignmentMigration || null,
      },
    ).catch((error) =>
      logDashboardEvent("warn", "access_groups.audit_failed", request, {
        message: error instanceof Error ? error.message : "audit unavailable",
      }),
    );
    return reply({ ok: true, ...(group ? { group } : { deletedId }) });
  } catch (error) {
    if (error instanceof AccessGroupError)
      return reply({ ok: false, error: error.message }, error.status);
    logDashboardEvent("warn", "access_groups.write_failed", request, {
      message: error instanceof Error ? error.message : "storage unavailable",
    });
    return reply(
      {
        ok: false,
        error:
          "Не вдалося підтвердити зміну. Онови список; чернетка збережена.",
      },
      503,
    );
  }
}
