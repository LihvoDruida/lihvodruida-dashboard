import "server-only";
import { getFirebaseAdminDb, hasFirebaseProfileConfig } from "@/lib/firebaseAdmin";
import { getDiscordGuildId } from "@/lib/discordAdmin";
import { normalizeAccountCleanupSettings } from "@/lib/accountCleanupAutomation";
import { normalizeNicknameWarningState } from "@/lib/discordNicknameWarnings";
import { normalizeGuildNicknamePolicy } from "@/lib/guildNicknamePolicy";
import { memberCleanupStatus, nicknameWarningStatus, accountCleanupStatus, unavailableAutomationStatuses, type AutomationOverview } from "@/lib/automationStatus";

// Read-only diagnostic snapshot: no cache/default fallback can disguise a failed read.
// PostgreSQL getAll uses one SELECT. Neither this loader nor the projections call Discord.
export async function getAutomationOverview(): Promise<AutomationOverview> {
  const now = Date.now(), checkedAt = new Date(now).toISOString();
  if (!hasFirebaseProfileConfig()) return { checkedAt, cards: unavailableAutomationStatuses("Сховище не налаштоване. Стан автоматизацій недоступний.") };
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const db = getFirebaseAdminDb();
    const guild = getDiscordGuildId(), validGuild = /^\d{16,25}$/.test(guild);
    const keys = [
      ["dashboardSettings", "discordNicknamePolicy"],
      ["dashboardSettings", "discordNicknameWarningAutomation"],
      ["automationLeases", "discord-nickname-warnings"],
      ["dashboardSettings", "accountCleanupAutomation"],
      ["automationLeases", "account-cleanup"],
      ...(validGuild ? [
        ["dashboardSettings", `discordMemberCleanup_${guild}`],
        ["dashboardSettings", `discordMemberCleanupState_${guild}`],
        ["dashboardSettings", `discordMemberCleanupControl_${guild}`],
        ["automationLeases", `discord-member-cleanup_${guild}`],
      ] : []),
    ];
    const snapshots = await Promise.race([
      db.getAll(...keys.map(([collection, id]) => db.collection(collection).doc(id))),
      new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error("Automation snapshot deadline")), 2_000); }),
    ]);
    const data = snapshots.map(snapshot => snapshot.data() || {});
    const member = validGuild ? memberCleanupStatus(data[5], data[6], data[7], data[8], now)
      : unavailableAutomationStatuses("Discord-сервер не налаштований. Очищення учасників недоступне.")[0];
    return { checkedAt, cards: [member,
      nicknameWarningStatus(normalizeGuildNicknamePolicy(data[0]), normalizeNicknameWarningState(data[1]), data[2], now),
      accountCleanupStatus(normalizeAccountCleanupSettings(data[3]), data[4], now),
    ] };
  } catch {
    return { checkedAt, cards: unavailableAutomationStatuses() };
  } finally { if (timer) clearTimeout(timer); }
}
