import {
  ApplicationStatus,
  getIssue,
  getIssueStatusFromLabels,
  normalizeStatus,
  setIssueStatus,
} from "./applicationsStore";
import {
  editDiscordApplicationMessage,
  notifyDiscordStatusChange,
} from "./discord";
import { mapConcurrentSettled } from "@/lib/concurrency";

export async function moderateApplication(params: {
  issueNumber: number;
  status: ApplicationStatus;
  moderator: string;
  source: "dashboard" | "discord";
  requireReview?: boolean;
}) {
  const issueNumber = Number(params.issueNumber);
  const status = normalizeStatus(params.status);
  const issue = await getIssue(issueNumber);
  const previousStatus = getIssueStatusFromLabels(issue.labels || []);

  if (params.requireReview && previousStatus !== "review" || params.requireReview && issue.state === "closed") {
    return {
      ok: true,
      issueNumber,
      status: previousStatus,
      previousStatus,
      state: issue.state,
      changed: false,
      alreadyModerated: true,
      github: null,
      discord: { edited: null, notified: null },
    };
  }

  const github = await setIssueStatus({
    issueNumber,
    status,
    moderator: params.moderator,
    source: params.source,
    requireReview: params.requireReview,
  });
  if (github.alreadyModerated) return {
    ok: true, issueNumber, status: github.status, state: github.state, previousStatus,
    changed: false, alreadyModerated: true, github, discord: { edited: null, notified: null },
  };

  const discordEdit = await editDiscordApplicationMessage({
    issue,
    issueNumber,
    status,
    moderator: params.moderator,
    source: params.source,
  }).catch(() => ({ ok: false, reason: "Discord не підтвердив оновлення." }));

  let discordNotify: unknown = null;

  if (!discordEdit?.ok) {
    discordNotify = await notifyDiscordStatusChange({
      issueNumber,
      status,
      moderator: params.moderator,
      issueUrl: issue.html_url,
      source: params.source,
    }).catch(() => ({ ok: false, error: "Discord не підтвердив сповіщення." }));
  }

  return {
    ok: true,
    issueNumber,
    status,
    state: github.state,
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
  const byNumber = new Map<number, { issueNumber: number; status: ApplicationStatus }>();
  for (const input of params.items || []) {
    const item = { issueNumber: Number(input.issueNumber), status: normalizeStatus(input.status) };
    if (!Number.isInteger(item.issueNumber) || item.issueNumber <= 0) continue;
    const previous = byNumber.get(item.issueNumber);
    if (previous && previous.status !== item.status) throw new Error("Одна заявка не може мати два різні рішення в одному запиті.");
    byNumber.set(item.issueNumber, item);
  }
  const uniqueItems = Array.from(byNumber.values()).slice(0, 50);

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
      requireReview: true,
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
    ? { ok: true as const, issueNumber: result.item.issueNumber, status: result.value.status, result: result.value }
    : {
      ok: false as const,
      issueNumber: result.item.issueNumber,
      status: result.item.status,
      error: result.error instanceof Error ? result.error.message : String(result.error || "Помилка batch-модерації"),
    });

  return {
    ok: normalizedResults.some((item) => item.ok),
    total: uniqueItems.length,
    succeeded: normalizedResults.filter((item) => item.ok).length,
    failed: normalizedResults.filter((item) => !item.ok).length,
    changed: normalizedResults.filter((item) => item.ok && item.result?.changed).length,
    unchanged: normalizedResults.filter((item) => item.ok && item.result?.alreadyModerated).length,
    discordPending: normalizedResults.filter((item) => item.ok && item.result?.changed && !item.result?.discord.edited?.ok && !(item.result?.discord.notified as { ok?: boolean } | null)?.ok).length,
    concurrency: meta.concurrency,
    durationMs: meta.durationMs,
    items: normalizedResults,
  };
}
