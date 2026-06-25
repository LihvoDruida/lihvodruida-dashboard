import "server-only";

export type DashboardReturnScope =
  | "discord-auth"
  | "battlenet-auth"
  | "profile-action";

type SafeDashboardReturnPathOptions = {
  scope: DashboardReturnScope;
  fallback?: string;
  profileId?: string | null;
};

const LOCAL_DASHBOARD_ORIGIN = "https://dashboard.local";

function cleanProfileId(value: unknown) {
  const profileId = String(value || "").trim();
  return /^id[a-f0-9]{16,40}$/.test(profileId) ? profileId : "";
}

function normalizeLocalPath(value: unknown) {
  const path = String(value || "").trim();
  if (!path || path.length > 1500) return "";
  if (!path.startsWith("/") || path.startsWith("//")) return "";

  try {
    const url = new URL(path, LOCAL_DASHBOARD_ORIGIN);
    if (url.origin !== LOCAL_DASHBOARD_ORIGIN) return "";
    return `${url.pathname}${url.search}${url.hash}`;
  } catch {
    return "";
  }
}

function pathAllowed(path: string, options: SafeDashboardReturnPathOptions) {
  try {
    const url = new URL(path, LOCAL_DASHBOARD_ORIGIN);
    const pathname = url.pathname;

    if (options.scope === "discord-auth") {
      return (
        pathname === "/" ||
        /^\/(?:raids|profile|rules\/accept)(?:\/|$)/.test(pathname)
      );
    }

    if (options.scope === "battlenet-auth") {
      return (
        pathname === "/" ||
        /^\/(?:profile|rules\/accept)(?:\/|$)/.test(pathname)
      );
    }

    if (options.scope === "profile-action") {
      const profileId = cleanProfileId(options.profileId);
      if (!profileId) return false;
      return (
        pathname === `/profile/${profileId}` ||
        pathname === `/profile/${profileId}/settings` ||
        pathname === "/rules/accept"
      );
    }
  } catch {
    return false;
  }

  return false;
}

export function safeDashboardReturnPath(
  value: unknown,
  options: SafeDashboardReturnPathOptions,
) {
  const fallback =
    options.fallback === "" ? "" : normalizeLocalPath(options.fallback) || "/";
  const path = normalizeLocalPath(value);
  if (!path) return fallback;
  return pathAllowed(path, options) ? path : fallback;
}
