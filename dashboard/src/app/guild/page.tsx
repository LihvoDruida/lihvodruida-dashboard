import { redirect } from "next/navigation";
import AppProblemScreen from "@/components/AppProblemScreen";
import DashboardIdentity from "@/components/DashboardIdentity";
import GuildRosterExplorer from "@/components/GuildRosterExplorer";
import GuildRosterLiveHeroStats from "@/components/GuildRosterLiveHeroStats";
import { getSessionUser, isAuthenticated } from "@/lib/auth";
import { loadGuildRosterData } from "@/lib/guildRoster";
import { getOwnProfilePath } from "@/lib/profiles";
import { canViewGuildRoster } from "@/lib/permissions";
import { buildPageMetadata } from "@/lib/seo";
import { getDashboardApiSettings } from "@/lib/dashboardApiSettings";
import { recordDashboardSystemLog } from "@/lib/dashboardSystemLogs";
import rosterStyles from "@/components/GuildRoster.module.css";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const revalidate = 0;

export const metadata = buildPageMetadata({
  title: "Склад гільдії",
  description:
    "Огляд складу Mistblossom Vanguard: ролі, класи, типи броні, item level, Mythic+ рейтинг і зручні фільтри для учасників.",
  path: "/guild",
  keywords: ["склад гільдії", "рейдери WoW", "Raider.IO", "item level"],
});

export default async function GuildRosterPage() {
  if (!(await isAuthenticated())) {
    redirect("/login");
    throw new Error("Login required");
  }
  const user = await getSessionUser();
  if (!user) {
    redirect("/login");
    throw new Error("Login required");
  }
  if (!canViewGuildRoster(user)) redirect(await getOwnProfilePath(user));

  const [roster, apiSettings] = await Promise.all([
    loadGuildRosterData().catch((error) => {
      void recordDashboardSystemLog(
        "error",
        "page.guild.roster_read_failed",
        {
          summary:
            "Сторінка складу відкрилась без даних зі сховища: читання roster не спрацювало.",
          message:
            error instanceof Error ? error.message : String(error || "unknown"),
        },
        { persist: true },
      );
      return {
        members: [],
        stats: {
          guildName: "Mistblossom Vanguard",
          guildRealm: "Terokkar",
          guildFaction: "Alliance",
          profileUrl: null,
          memberCount: 0,
          averageItemLevel: 0,
          averageRioAll: 0,
          maxItemLevel: 0,
          maxRioAll: 0,
          updatedAt: null,
        },
        source: "fallback",
        error:
          "Склад тимчасово недоступний. Сторінку відкрито без live-збору; синхронізація відновить записи в базі даних покроково.",
      };
    }),
    getDashboardApiSettings().catch((error) => {
      void recordDashboardSystemLog(
        "warning",
        "page.guild.settings_read_failed",
        {
          summary:
            "Налаштування синхронізації складу тимчасово недоступні, використано безпечні значення.",
          message:
            error instanceof Error ? error.message : String(error || "unknown"),
        },
        { persist: false },
      );
      return {
        guildRosterClientDrivenSyncEnabled: false,
        guildRosterClientStepDelayMs: 500,
        guildRosterClientRequestTimeoutMs: 25_000,
        guildRosterClientMaxSteps: 500,
      };
    }),
  ]);
  const members = roster.members;
  const storageLimited = roster.source === "firebase-temporary-unavailable" && members.length === 0;

  if (storageLimited) {
    return (
      <AppProblemScreen
        kind="quota"
        eyebrow="Склад гільдії"
        title="Склад тимчасово недоступний"
        message="База даних зараз недоступна або читання тимчасово обмежене. Сторінка не запускає додаткове масове читання складу, щоб не збільшувати навантаження."
        primaryLabel="Повторити"
        secondaryHref="/profile"
        secondaryLabel="До панелі"
        details={[
          roster.error || "Синхронізація складу відновиться після відновлення доступу до бази даних.",
          "Адмінські дії, профілі та рейди не запускають зайвих читань цієї сторінки.",
        ]}
      />
    );
  }

  return (
    <main className="container app-page guild-page guild-page--modern">
      <section
        className="dashboard-shell content-shell guild-shell app-page-stack"
        aria-label="Панель Mistblossom Vanguard"
      >
        <DashboardIdentity user={user} activeSection="guild" />
        <header className={`panel ${rosterStyles.pageHero}`}>
          <div className={rosterStyles.heroCopy}>
            <div className="eyebrow">Mistblossom Vanguard • Склад гільдії</div>
            <h1>Склад гільдії</h1>
            <p>
              Актуальна база персонажів із Battle.net, Raider.IO та рейд-прогресом.
              Сервер оновлює дані автоматично — відкривати сторінку для синхронізації більше не потрібно.
            </p>
            <div className={rosterStyles.heroBadges} aria-label="Джерела даних">
              <span className={rosterStyles.heroBadge}>Автооновлення VPS</span>
              <span className={rosterStyles.heroBadge}>Battle.net roster</span>
              <span className={rosterStyles.heroBadge}>Raider.IO M+</span>
              <span className={rosterStyles.heroBadge}>Raid progress</span>
            </div>
          </div>

          <GuildRosterLiveHeroStats
            members={members}
            stats={roster.stats}
            source={roster.source}
            error={roster.error}
            allowManualRefresh={Boolean(user.isServerOwner)}
            refreshSettings={{
              clientDrivenSyncEnabled:
                apiSettings.guildRosterClientDrivenSyncEnabled,
              clientStepDelayMs: apiSettings.guildRosterClientStepDelayMs,
              clientRequestTimeoutMs:
                apiSettings.guildRosterClientRequestTimeoutMs,
              clientMaxSteps: apiSettings.guildRosterClientMaxSteps,
            }}
          />
        </header>
        <GuildRosterExplorer
          members={members}
          stats={roster.stats}
          source={roster.source}
          error={roster.error}
        />
      </section>
    </main>
  );
}
