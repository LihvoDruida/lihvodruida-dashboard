import "server-only";
import { getSessionUser } from "@/lib/auth";
import { redirect } from "next/navigation";
import { canManageApplications, canViewApplicationBattleTag, canViewApplications } from "@/lib/permissions";
import { listApplicationFilterOptions, listApplications, sanitizeApplicationsForMentorViewer } from "@/lib/applicationsStore";
import { getOwnProfilePath } from "@/lib/profiles";
import { listViewUrl } from "@/lib/listViewState";

export async function loadApplicationWorkspace({searchParams}: {searchParams: Promise<Record<string, string | undefined>>}) {
  const user = await getSessionUser();
  if (!user) { redirect("/login"); throw new Error("Login required"); }
  const mayViewApplications = canViewApplications(user);
  const mayManageApplications = canManageApplications(user);
  const mayViewSensitiveApplications = canViewApplicationBattleTag(user);
  if (!mayViewApplications) redirect(await getOwnProfilePath(user));
  const params = await searchParams;
  const urlParams = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) if (value) urlParams.set(key, value);
  const currentUrl = listViewUrl("applications", `/applications?${urlParams}`) || "/applications";
  const listParams = new URLSearchParams(currentUrl.split("?")[1] || "");
  const [listResult, optionResult] = await Promise.all([
    listApplications(listParams).then(items => ({items, unavailable: false})).catch(() => ({items: [], unavailable: true})),
    listApplicationFilterOptions().then(options => ({options, unavailable: false})).catch(() => ({options: {classes: [] as string[]}, unavailable: true})),
  ]);
  const rawItems = listResult.items;
  const filterOptions = optionResult.options;
  const unavailable = listResult.unavailable;
  const filtersUnavailable = optionResult.unavailable;
  const items = mayViewSensitiveApplications ? rawItems : sanitizeApplicationsForMentorViewer(rawItems);
  const counts = {
    all: items.length,
    review: items.filter((item) => item.status_key === "review").length,
    accepted: items.filter((item) => item.status_key === "accepted").length,
    declined: items.filter((item) => item.status_key === "declined").length
  };
  const classOptions = filterOptions.classes;

  const newestReview = items.find((item) => item.status_key === "review");
  return { user, params, currentUrl, listParams, items, counts, classOptions, newestReview, mayManageApplications, mayViewSensitiveApplications, unavailable, filtersUnavailable };
}
export type ApplicationWorkspaceModel = Awaited<ReturnType<typeof loadApplicationWorkspace>>;
