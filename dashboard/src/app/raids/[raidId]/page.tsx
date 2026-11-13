import ListReturnLink from "@/components/ListReturnLink";
import { listNavigationScope } from "@/lib/listNavigationScope";
import DiscordPublicationWorkbench from "@/components/DiscordPublicationWorkbench";
import { getSession } from "@/lib/auth";
import { canManageRaids, canViewRaidRoster, canViewRaidDirectory } from "@/lib/permissions";
import { getRaid, hasRaidStorage, raidLiveRevision } from "@/lib/raids";
import RaidLiveSync from "@/components/RaidLiveSync";
import { RaidAnnouncementPreview, RaidManageActions, RaidPageShell, RaidUnavailableState, RosterSideList, StatusNotice } from "@/components/RaidViews";
import { buildPageMetadata } from "@/lib/seo";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function generateMetadata({ params }: { params: Promise<{ raidId: string }> }) {
  const { raidId } = await params;
  const path = `/raids/${encodeURIComponent(raidId)}`;

  return buildPageMetadata({
    title: "Сторінка рейду",
    description: "Публічний перегляд рейду та складу. Запис на участь відбувається в Discord.",
    path,
    keywords: ["сторінка рейду", "запис на рейд", "рейд WoW"],
  });
}

export default async function RaidDetailsPage({
  params, searchParams }: { params: Promise<{ raidId: string }>; searchParams: Promise<Record<string, string | undefined>> }) {
  const user = await getSession();
  const canManage = canManageRaids(user);
  const canSeeRoster = !user || canViewRaidRoster(user);
  const { raidId } = await params;
  const query = await searchParams;
  const raid = await getRaid(raidId);
  const visibleRaid = raid && (raid.status === "published" || raid.status === "closed" || canManage) ? raid : null;

  return (
    <RaidPageShell
      user={user}
      title="Сторінка рейду"
      description="Публічний перегляд рейду. Підписатися, обрати 50/50, пропустити або позначити запізнення можна тільки в Discord."
    >
      <StatusNotice params={query} />
      {visibleRaid ? <RaidLiveSync raidId={visibleRaid.id} initialRevision={raidLiveRevision(visibleRaid)} /> : null}
      {!hasRaidStorage() ? <div className="notice panel error-note raid-notice">Дані рейдів тимчасово недоступні. Спробуй пізніше або звернись до офіцера.</div> : null}

      {canManage && visibleRaid ? <DiscordPublicationWorkbench kind="raid" id={visibleRaid.id} /> : null}

      {visibleRaid ? (
        <>
          <nav className="raid-detail-toolbar" aria-label="Навігація рейду">
            {user && canViewRaidDirectory(user) ? <ListReturnLink kind="raids" scope={listNavigationScope(user)} className="raid-detail-back" /> : null}
            <span className="raid-detail-toolbar__spacer" />
            {visibleRaid.messageUrl ? (
              <a className="btn subtle btn-sm" href={visibleRaid.messageUrl} target="_blank" rel="noreferrer">
                Discord ↗
              </a>
            ) : null}
          </nav>
          <section className="raid-member-layout">
            <div className="raid-preview-column">
              <RaidAnnouncementPreview
                raid={visibleRaid}
                actions={
                  <div className="raid-discord-only-cta" role="note">
                    <strong>Запис на рейд — лише через Discord</strong>
                    <span>Обери клас, спеціалізацію та статус участі в повідомленні бота на сервері Discord.</span>
                    {visibleRaid.messageUrl ? <a className="btn primary" href={visibleRaid.messageUrl} target="_blank" rel="noopener noreferrer">Відкрити запис у Discord ↗</a> : <small>Оголошення в Discord ще не опубліковано. Звернись до рейд-лідера.</small>}
                  </div>
                }
                manageActions={canManage ? <RaidManageActions raid={visibleRaid} /> : null}
                showRosterDetails={true}
                showMemberItemLevels={canManage}
              />
            </div>
            {canSeeRoster ? (
              <RosterSideList
                raid={visibleRaid}
                showItemLevel={canManage}
                showBenchPriorityMarkers={canManage}
              />
            ) : null}
          </section>
        </>
      ) : <RaidUnavailableState canManage={canManage} />}
    </RaidPageShell>
  );
}
