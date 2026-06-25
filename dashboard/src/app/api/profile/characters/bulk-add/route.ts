import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { addProfileCharacters, getProfileBattleNetCandidates, removeProfileBattleNetCandidates } from "@/lib/profiles";
import { characterAddStatusFromError } from "@/lib/profileCharacterStatus";
import { assertRequestBodySize, checkRateLimit, forbiddenResponse, getClientIp, logDashboardEvent, rateLimitResponse, safeErrorMessage, verifyTrustedOrigin } from "@/lib/security";
import { normalizeCharacterKey } from "@/lib/wowCharacters";
import { profileActionReturnTo, redirectToProfileAction } from "@/lib/profileActionRedirects";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

function redirectToProfile(request: NextRequest, profileId: string, status: string, returnTo?: string) {
  return redirectToProfileAction(request, profileId, "characterStatus", status, returnTo, `/profile/${profileId}`);
}

function cleanKeys(values: FormDataEntryValue[]) {
  return Array.from(new Set(values.map((value) => normalizeCharacterKey(value)).filter(Boolean)));
}

function statusForNoop(result: Awaited<ReturnType<typeof addProfileCharacters>>) {
  const reasons = Object.values(result.skippedReasons || {});
  if (!result.validRequested) return "characters_bulk_no_verified";
  if (reasons.length && reasons.every((reason) => reason === "duplicate")) return "characters_bulk_all_duplicates";
  return "characters_bulk_noop";
}

export async function POST(request: NextRequest) {
  if (!verifyTrustedOrigin(request)) return forbiddenResponse();

  const tooLarge = assertRequestBodySize(request, 128 * 1024);
  if (tooLarge) return tooLarge;

  const session = await getSession();
  if (!session?.profileId) return NextResponse.redirect(new URL("/login", request.url), 303);

  const ip = getClientIp(request);
  const limit = checkRateLimit(`profile-character-bulk-add:${session.profileId}:${ip}`, 20, 10 * 60 * 1000);
  if (!limit.ok) return rateLimitResponse(limit.resetAt);

  const form = await request.formData();
  const returnTo = profileActionReturnTo(form, session.profileId, `/profile/${session.profileId}`);
  const mode = String(form.get("mode") || "selected");
  const selectedKeys = cleanKeys(form.getAll("characterKeys"));
  const storedCandidates = await getProfileBattleNetCandidates(session.profileId).catch(() => []);
  const candidatesByKey = new Map<string, (typeof storedCandidates)[number]>();
  for (const candidate of storedCandidates) {
    const key = normalizeCharacterKey(candidate.key);
    if (key && !candidatesByKey.has(key)) candidatesByKey.set(key, candidate);
  }
  const availableCandidateCharacters = Array.from(candidatesByKey.values());

  if (!availableCandidateCharacters.length) {
    logDashboardEvent("warn", "profile.character.bulk_missing_reauth", request, { profileId: session.profileId, mode });
    return redirectToProfile(request, session.profileId, "character_reauth_required", returnTo);
  }

  const selectedSet = new Set(selectedKeys);
  const candidates = mode === "all"
    ? availableCandidateCharacters
    : availableCandidateCharacters.filter((candidate) => selectedSet.has(normalizeCharacterKey(candidate.key)));

  if (!candidates.length) {
    logDashboardEvent("warn", "profile.character.bulk_empty", request, { profileId: session.profileId, mode, selected: selectedKeys.length });
    return redirectToProfile(request, session.profileId, "characters_bulk_empty", returnTo);
  }

  try {
    const result = await addProfileCharacters(session.profileId, candidates);
    logDashboardEvent("info", "profile.character.bulk_added", request, {
      profileId: session.profileId,
      mode,
      requested: candidates.length,
      validRequested: result.validRequested,
      added: result.added,
      skipped: result.skipped,
      skippedReasons: result.skippedReasons,
    });

    if (result.added <= 0) {
      return redirectToProfile(request, session.profileId, statusForNoop(result));
    }

    const response = redirectToProfile(request, session.profileId, result.skipped > 0 ? "characters_added_partial" : result.added > 1 ? "characters_added" : "character_added", returnTo);
    await removeProfileBattleNetCandidates(session.profileId, result.addedKeys).catch((cleanupError) => {
      logDashboardEvent("warn", "profile.character.bulk_candidate_cleanup_failed", request, { profileId: session.profileId, added: result.addedKeys.length, message: safeErrorMessage(cleanupError) });
    });
    return response;
  } catch (error) {
    const status = characterAddStatusFromError(error);
    logDashboardEvent("warn", "profile.character.bulk_failed", request, { profileId: session.profileId, mode, status, message: safeErrorMessage(error) });
    return redirectToProfile(request, session.profileId, status === "character_add_not_guild" ? "characters_bulk_no_verified" : status, returnTo);
  }
}
