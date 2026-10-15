import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import {
  getProfileCharacterSetupState,
  saveProfileCharacterSetup,
  ProfileCharacterSetupError,
} from "@/lib/profileCharacterSetup";
import {
  assertRequestBodySize,
  checkRateLimit,
  getClientIp,
  logDashboardEvent,
  noStoreHeaders,
  verifyTrustedOrigin,
} from "@/lib/security";
import { diagnosticErrorSummary } from "@/lib/logPrivacy";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;
const reply = (body: unknown, status = 200) =>
  NextResponse.json(body, { status, headers: noStoreHeaders() });
const MAX_BODY = 40 * 1024;
async function readBody(request: NextRequest) {
  if (
    !request.headers
      .get("content-type")
      ?.toLowerCase()
      .startsWith("application/json")
  )
    throw new ProfileCharacterSetupError("Потрібен JSON-запит.", 415);
  const reader = request.body?.getReader();
  if (!reader) throw new ProfileCharacterSetupError("Порожній запит.");
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const item = await reader.read();
      if (item.done) break;
      size += item.value.byteLength;
      if (size > MAX_BODY) {
        await reader.cancel();
        throw new ProfileCharacterSetupError("Запит завеликий.", 413);
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
    throw new ProfileCharacterSetupError("Некоректний JSON.");
  }
}
function failure(error: unknown, request: NextRequest | undefined, startedAt: number, phase: "read" | "write") {
  const statusCode = error instanceof ProfileCharacterSetupError ? error.status : 503;
  try { logDashboardEvent(statusCode >= 500 ? "error" : "warn", "profile.characters.failed", request, {
    phase, outcome: statusCode === 409 ? "conflict" : statusCode < 500 ? "rejected" : "unconfirmed",
    statusCode, durationMs: Math.max(0, Date.now() - startedAt), resourceType: "profile", ...diagnosticErrorSummary(error),
  }, { category: "action" }); } catch { /* Diagnostics do not change the response. */ }
  return error instanceof ProfileCharacterSetupError
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
export async function GET(request?: NextRequest) {
  const startedAt = Date.now();
  const session = await getSession();
  if (!session?.profileId || session.impersonatedBy)
    return reply(
      { ok: false, error: "Потрібен власний профіль." },
      session ? 403 : 401,
    );
  try {
    return reply({
      ok: true,
      setup: await getProfileCharacterSetupState(session.profileId),
    });
  } catch (error) {
    return failure(error, request, startedAt, "read");
  }
}
export async function POST(request: NextRequest) {
  const startedAt = Date.now();
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
    `profile-character-setup:${session.profileId}:${getClientIp(request)}`,
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
    const setup = await saveProfileCharacterSetup(
      session.profileId,
      await readBody(request),
    );
    try {
      logDashboardEvent("info", "profile.characters.setup_saved", request, {
        profileId: session.profileId,
        phase: "commit", outcome: "committed", statusCode: 200, durationMs: Math.max(0, Date.now() - startedAt), resourceType: "profile", resourceId: session.profileId,
        operationId: setup.receipt?.operationId,
        added: setup.receipt?.addedKeys.length,
        duplicates: setup.receipt?.duplicateKeys.length,
      });
    } catch {
      /* committed receipt is authoritative */
    }
    return reply({ ok: true, setup });
  } catch (error) {
    return failure(error, request, startedAt, "write");
  }
}
