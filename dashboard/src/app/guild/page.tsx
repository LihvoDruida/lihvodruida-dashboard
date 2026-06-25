import { redirect } from "next/navigation";
import AppProblemScreen from "@/components/AppProblemScreen";
import DashboardIdentity from "@/components/DashboardIdentity";
import GuildRosterExplorer from "@/components/GuildRosterExplorer";
import GuildRosterLiveHeroStats from "@/components/GuildRosterLiveHeroStats";
import GuildRosterRefreshButton from "@/components/GuildRosterRefreshButton";
import { getSessionUser, isAuthenticated } from "@/lib/auth";
import { loadGuildRosterData } from "@/lib/guildRoster";
import { getOwnProfilePath } from "@/lib/profiles";
import { canViewGuildRoster } from "@/lib/permissions";
import { buildPageMetadata } from "@/lib/seo";
import { getDashboardApiSettings } from "@/lib/dashboardApiSettings";
import { recordDashboardSystemLog } from "@/lib/dashboardSystemLogs";

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
            "Сторінка складу відкрилась без Firebase-записів: читання roster не спрацювало.",
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
          "Склад тимчасово недоступний. Сторінку відкрито без live-збору; синхронізація створить Firebase-записи покроково.",
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
        guildRosterClientDrivenSyncEnabled: true,
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
        message="Firebase зараз недоступний або досяг ліміту читань. Сторінка не запускає додаткове масове читання складу, щоб не збільшувати навантаження."
        primaryLabel="Повторити"
        secondaryHref="/"
        secondaryLabel="До панелі"
        details={[
          roster.error || "Синхронізація складу відновиться після доступу до Firebase.",
          "Адмінські дії, профілі та рейди не запускають зайвих читань цієї сторінки.",
        ]}
      />
    );
  }

  return (
    <main className="container guild-page">
      <section
        className="dashboard-shell content-shell"
        aria-label="Панель Mistblossom Vanguard"
      >
        <DashboardIdentity user={user} activeSection="guild" />
        <header className="hero panel guild-hero">
          <div className="hero-copy dashboard-hero__copy guild-hero__copy">
            <div className="eyebrow">Mistblossom Vanguard • Склад гільдії</div>
            <h1>Склад гільдії</h1>
            <span className="hero-accent" aria-hidden="true" />
            <p className="lead">
              Живий список персонажів гільдії з Raider.IO, item level, ролями,
              класами, спеками та фракціями.
            </p>
          </div>

          <div className="guild-hero-side" aria-label="Огляд складу гільдії">
            <GuildRosterLiveHeroStats
              members={members}
              stats={roster.stats}
              source={roster.source}
              error={roster.error}
            />

            <div className="guild-hero-actions">
              <GuildRosterRefreshButton
                autoStartMissingRecords={members.length === 0}
                settings={{
                  clientDrivenSyncEnabled:
                    apiSettings.guildRosterClientDrivenSyncEnabled,
                  clientStepDelayMs: apiSettings.guildRosterClientStepDelayMs,
                  clientRequestTimeoutMs:
                    apiSettings.guildRosterClientRequestTimeoutMs,
                  clientMaxSteps: apiSettings.guildRosterClientMaxSteps,
                }}
              />
            </div>
          </div>
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
