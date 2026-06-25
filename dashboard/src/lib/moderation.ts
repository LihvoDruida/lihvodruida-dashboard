import {
  ApplicationStatus,
  getIssue,
  getIssueStatusFromLabels,
  normalizeStatus,
  setIssueStatus,
} from "./github";
import {
  editDiscordApplicationMessage,
  notifyDiscordStatusChange,
} from "./discord";
import { mapConcurrentSettled } from "@/lib/concurrency";
import { invalidatePublicCacheBatch } from "@/lib/cloudflarePublicCache";

export async function moderateApplication(params: {
  issueNumber: number;
  status: ApplicationStatus;
  moderator: string;
  source: "dashboard" | "discord";
}) {
  const issueNumber = Number(params.issueNumber);
  const status = normalizeStatus(params.status);
  const issue = await getIssue(issueNumber);
  const previousStatus = getIssueStatusFromLabels(issue.labels || []);

  const github = await setIssueStatus({
    issueNumber,
    status,
    moderator: params.moderator,
    source: params.source,
  });

  const discordEdit = await editDiscordApplicationMessage({
    issue,
    issueNumber,
    status,
    moderator: params.moderator,
    source: params.source,
  });

  let discordNotify: unknown = null;

  await invalidatePublicCacheBatch({
    prefixes: ["worker:applications", "dashboard:applications"],
  }).catch(() => null);

  if (!discordEdit?.ok) {
    discordNotify = await notifyDiscordStatusChange({
      issueNumber,
      status,
      moderator: params.moderator,
      issueUrl: issue.html_url,
      source: params.source,
    });
  }

  return {
    ok: true,
    issueNumber,
    status,
    previousStatus,
    changed: previousStatus !== status,
    github,
    discord: {
      edited: discordEdit,
      notified: discordNotify,
    },
  };
}


export async function moderateApplications(params: {
  items: Array<{ issueNumber: number; status: ApplicationStatus }>;
  moderator: string;
  source: "dashboard" | "discord";
}) {
  const uniqueItems = Array.from(
    new Map(
      (params.items || [])
        .map((item) => ({ issueNumber: Number(item.issueNumber), status: normalizeStatus(item.status) }))
        .filter((item) => Number.isInteger(item.issueNumber) && item.issueNumber > 0)
        .map((item) => [`${item.issueNumber}:${item.status}`, item])
    ).values()
  ).slice(0, 50);

  if (!uniqueItems.length) {
    throw new Error("Немає валідних заявок для batch-модерації.");
  }

  const { results, meta } = await mapConcurrentSettled(
    uniqueItems,
    (item) => moderateApplication({
      issueNumber: item.issueNumber,
      status: item.status,
      moderator: params.moderator,
      source: params.source,
    }),
    {
      profile: "external-api",
      envKey: "APPLICATION_BULK_STATUS_CONCURRENCY",
      maxEnvKey: "APPLICATION_BULK_STATUS_MAX_CONCURRENCY",
      min: 1,
      max: 6,
    },
  );

  const normalizedResults = results.map((result) => result.ok
    ? { ok: true, issueNumber: result.item.issueNumber, status: result.item.status, result: result.value }
    : {
      ok: false,
      issueNumber: result.item.issueNumber,
      status: result.item.status,
      error: result.error instanceof Error ? result.error.message : String(result.error || "Помилка batch-модерації"),
    });

  return {
    ok: normalizedResults.some((item) => item.ok),
    total: uniqueItems.length,
    succeeded: normalizedResults.filter((item) => item.ok).length,
    failed: normalizedResults.filter((item) => !item.ok).length,
    concurrency: meta.concurrency,
    durationMs: meta.durationMs,
    items: normalizedResults,
  };
}
