export const DASHBOARD_DATA_MUTATED_EVENT = "dashboard:data-mutated";
export const DASHBOARD_DATA_REFRESHED_EVENT = "dashboard:data-refreshed";
export const DASHBOARD_LAST_MUTATION_STORAGE_KEY = "mistblossom-dashboard:last-data-mutation";
export const DASHBOARD_MUTATION_BROADCAST_CHANNEL = "mistblossom-dashboard:mutations";

export type DashboardDataScope =
  | "applications"
  | "content"
  | "discord"
  | "guild"
  | "integrations"
  | "profile"
  | "profiles"
  | "raids"
  | "session"
  | "unknown";

export type DashboardDataMutationKind =
  | "application"
  | "content"
  | "discord"
  | "guild"
  | "integration"
  | "profile"
  | "raid"
  | "raid-poll"
  | "session"
  | "unknown";

export type DashboardDataMutationDetail = {
  scope?: DashboardDataScope;
  kind?: DashboardDataMutationKind;
  resourceId?: string;
  raidId?: string;
  pollId?: string;
  revision?: string;
  source?: string;
  action?: string;
  path?: string;
  timestamp?: number;
};

type RaidMutationEventDetail = {
  raidId?: string;
  pollId?: string;
  revision?: string;
  source?: string;
  action?: string;
};

function cleanId(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function actionText(detail: DashboardDataMutationDetail) {
  return `${detail.action || ""} ${detail.path || ""}`.toLowerCase();
}

function inferMutationKind(detail: DashboardDataMutationDetail): DashboardDataMutationKind {
  if (detail.kind) return detail.kind;
  const text = actionText(detail);
  if (detail.scope === "raids") {
    if (detail.pollId || text.includes("/polls") || text.includes("raid-poll")) return "raid-poll";
    if (detail.raidId || text.includes("/raids")) return "raid";
    return "unknown";
  }
  if (detail.scope === "applications") return "application";
  if (detail.scope === "content") return "content";
  if (detail.scope === "discord") return "discord";
  if (detail.scope === "guild") return "guild";
  if (detail.scope === "integrations") return "integration";
  if (detail.scope === "profile" || detail.scope === "profiles") return "profile";
  if (detail.scope === "session") return "session";
  return "unknown";
}

function buildMutationDetail(detail: DashboardDataMutationDetail = {}): DashboardDataMutationDetail {
  const raidId = cleanId(detail.raidId);
  const pollId = cleanId(detail.pollId);
  const resourceId = cleanId(detail.resourceId) || raidId || pollId;
  const path = detail.path || (typeof window !== "undefined" ? window.location.pathname : undefined);
  const base = {
    ...detail,
    scope: detail.scope || "unknown",
    resourceId,
    raidId,
    pollId,
    revision: cleanId(detail.revision),
    path,
    timestamp: detail.timestamp || Date.now(),
  };
  return {
    ...base,
    kind: detail.kind || inferMutationKind(base),
  };
}

function dispatchRaidMutationEvents(payload: DashboardDataMutationDetail) {
  if (payload.scope !== "raids") return;

  const kind = inferMutationKind(payload);
  const resourceId = cleanId(payload.resourceId);
  const raidId = cleanId(payload.raidId) || (kind === "raid" ? resourceId : undefined);
  const pollId = cleanId(payload.pollId) || (kind === "raid-poll" ? resourceId : undefined);
  const source = payload.source || "site";
  const base = {
    revision: payload.revision,
    source,
    action: payload.action,
  };

  if (kind === "raid" || raidId) {
    const detail: RaidMutationEventDetail = { ...base, raidId };
    window.dispatchEvent(new CustomEvent<RaidMutationEventDetail>("dashboard:raid-updated", { detail }));
  }

  if (kind === "raid-poll" || pollId) {
    const detail: RaidMutationEventDetail = { ...base, pollId };
    window.dispatchEvent(new CustomEvent<RaidMutationEventDetail>("dashboard:raid-poll-updated", { detail }));
  }

  // Legacy safety: old callers only used scope:"raids" without declaring whether
  // the changed object was a raid or a raid-poll. Keep those listeners alive, but
  // do not pretend one id is both a raidId and a pollId.
  if (kind === "unknown" && !raidId && !pollId) {
    window.dispatchEvent(new CustomEvent<RaidMutationEventDetail>("dashboard:raid-updated", { detail: base }));
    window.dispatchEvent(new CustomEvent<RaidMutationEventDetail>("dashboard:raid-poll-updated", { detail: base }));
  }
}

export function notifyDashboardDataChanged(detail: DashboardDataMutationDetail = {}) {
  if (typeof window === "undefined") return;

  const payload = buildMutationDetail(detail);
  window.dispatchEvent(new CustomEvent<DashboardDataMutationDetail>(DASHBOARD_DATA_MUTATED_EVENT, { detail: payload }));
  dispatchRaidMutationEvents(payload);

  try {
    window.localStorage.setItem(DASHBOARD_LAST_MUTATION_STORAGE_KEY, JSON.stringify(payload));
  } catch {
    // Ignore unavailable storage. Same-tab listeners still receive the event above.
  }

  try {
    if ("BroadcastChannel" in window) {
      const channel = new BroadcastChannel(DASHBOARD_MUTATION_BROADCAST_CHANNEL);
      channel.postMessage(payload);
      channel.close();
    }
  } catch {
    // BroadcastChannel is an optimization. localStorage + same-tab event remain enough.
  }
}
