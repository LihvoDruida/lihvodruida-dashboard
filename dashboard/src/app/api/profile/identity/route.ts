import { after, NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import {
  getProfileIdentityState,
  ProfileIdentityError,
  requestProfileNicknameReconciliation,
  runProfileNicknameSync,
  saveProfileIdentity,
} from "@/lib/profileNicknameSync";
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
export const maxDuration = 60;
const reply = (body: unknown, status = 200) =>
  NextResponse.json(body, { status, headers: noStoreHeaders() });
const MAX_BODY = 2048;
async function readBody(request: NextRequest) {
  if (
    !request.headers
      .get("content-type")
      ?.toLowerCase()
      .startsWith("application/json")
  )
    throw new ProfileIdentityError("Потрібен JSON-запит.", 415);
  const reader = request.body?.getReader();
  if (!reader) throw new ProfileIdentityError("Порожній запит.");
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const item = await reader.read();
      if (item.done) break;
      size += item.value.byteLength;
      if (size > MAX_BODY) {
        await reader.cancel();
        throw new ProfileIdentityError("Запит завеликий.", 413);
      }
      chunks.push(item.value);
    }
  } finally {
    reader.releaseLock();
  }
  try {
    const data = JSON.parse(Buffer.concat(chunks).toString("utf8"));
    if (!data || typeof data !== "object" || Array.isArray(data)) throw Error();
    return data;
  } catch {
    throw new ProfileIdentityError("Некоректний JSON.");
  }
}
function failure(error: unknown) {
  return error instanceof ProfileIdentityError
    ? reply({ ok: false, error: error.message }, error.status)
    : reply(
        {
          ok: false,
          error:
            "Профіль тимчасово недоступний. Введені дані залишаються у формі.",
        },
        503,
      );
}
export async function GET() {
  const session = await getSession();
  if (!session?.profileId || session.impersonatedBy)
    return reply(
      { ok: false, error: "Потрібен власний профіль." },
      session ? 403 : 401,
    );
  try {
    return reply({
      ok: true,
      identity: await getProfileIdentityState(session.profileId),
    });
  } catch (error) {
    return failure(error);
  }
}
export async function POST(request: NextRequest) {
  if (!verifyTrustedOrigin(request))
    return reply({ ok: false, error: "Недовірене джерело запиту." }, 403);
  const size = assertRequestBodySize(request, MAX_BODY);
  if (size) return size;
  const session = await getSession();
  if (!session?.profileId || session.impersonatedBy)
    return reply(
      { ok: false, error: "Потрібен власний профіль." },
      session ? 403 : 401,
    );
  const limit = checkRateLimit(
    `profile-identity:${session.profileId}:${getClientIp(request)}`,
    20,
    10 * 60_000,
  );
  if (!limit.ok)
    return reply(
      {
        ok: false,
        error: "Забагато спроб. Зачекай перед наступним збереженням.",
      },
      429,
    );
  try {
    const data = await readBody(request);
    if (data.action !== "save" && data.action !== "reconcile")
      throw new ProfileIdentityError("Невідома дія.");
    const identity =
      data.action === "save"
        ? await saveProfileIdentity(session.profileId, data)
        : await requestProfileNicknameReconciliation(
            session.profileId,
            data.operationId,
          );
    if (identity.sync?.dueAtMs !== null && identity.sync) {
      const profileId = session.profileId;
      try {
        after(async () => {
          try {
            await runProfileNicknameSync(profileId);
          } catch {
            logDashboardEvent(
              "warn",
              "profile.identity.worker_deferred",
              undefined,
              { profileId },
            );
          }
        });
      } catch {
        /* Cron resumes the already committed intent if after() is unavailable. */
      }
    }
    // Logging failure cannot turn an already committed name into a reported failed save.
    try {
      logDashboardEvent("info", "profile.identity.accepted", request, {
        profileId: session.profileId,
        operationId: identity.sync?.operationId,
        action: data.action,
        state: identity.sync?.state,
      });
    } catch {
      /* durable queue remains authoritative */
    }
    return reply({ ok: true, identity }, 202);
  } catch (error) {
    return failure(error);
  }
}
