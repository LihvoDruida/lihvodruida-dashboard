import "server-only";

import { NextRequest, NextResponse } from "next/server";
import { noStoreHeaders } from "@/lib/security";
import { safeDashboardReturnPath } from "@/lib/dashboardRedirects";

function cleanProfileId(value: unknown) {
  const profileId = String(value || "").trim();
  return /^id[a-f0-9]{16,40}$/.test(profileId) ? profileId : "";
}

export function profileActionReturnTo(
  form: FormData,
  profileIdInput: string,
  fallbackPath?: string,
) {
  const profileId = cleanProfileId(profileIdInput);
  if (!profileId) return "/profile";
  return safeDashboardReturnPath(form.get("returnTo"), {
    scope: "profile-action",
    profileId,
    fallback: fallbackPath || `/profile/${profileId}`,
  });
}

export function redirectToProfileAction(
  request: NextRequest,
  profileIdInput: string,
  statusKey: string,
  status: string,
  returnTo?: string,
  fallbackPath?: string,
) {
  const profileId = cleanProfileId(profileIdInput);
  const targetPath = profileId
    ? safeDashboardReturnPath(returnTo, {
        scope: "profile-action",
        profileId,
        fallback: fallbackPath || `/profile/${profileId}`,
      })
    : "/profile";
  const url = new URL(targetPath, request.url);
  if (statusKey && status) url.searchParams.set(statusKey, status);
  const response = NextResponse.redirect(url, 303);
  for (const [key, value] of Object.entries(noStoreHeaders()))
    response.headers.set(key, value);
  return response;
}
