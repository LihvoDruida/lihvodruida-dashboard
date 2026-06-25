import { getSession } from "@/lib/auth";
import { canManageRaids, canViewRaidRoster } from "@/lib/permissions";
import { getMainCharacter, getProfileByDiscordUserId, getProfileById } from "@/lib/profiles";
import { getRaid, hasRaidStorage, raidLiveRevision } from "@/lib/raids";
import RaidLiveSync from "@/components/RaidLiveSync";
import { RaidAnnouncementPreview, RaidAttendanceActions, RaidManageActions, RaidPageShell, RaidUnavailableState, RosterSideList, StatusNotice } from "@/components/RaidViews";
import { buildPageMetadata } from "@/lib/seo";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function generateMetadata({ params }: { params: Promise<{ raidId: string }> }) {
  const { raidId } = await params;
  const path = `/raids/${encodeURIComponent(raidId)}`;

  return buildPageMetadata({
    title: "Сторінка рейду",
    description: "Сторінка рейду Mistblossom Vanguard з записом, статусом участі, складом і посиланням на правила.",
    path,
    keywords: ["сторінка рейду", "запис на рейд", "рейд WoW"],
  });
}

export default async function RaidDetailsPage({
  params, searchParams }: { params: Promise<{ raidId: string }>; searchParams: Promise<Record<string, string | undefined>> }) {
  const user = await getSession();
  const canManage = canManageRaids(user);
  const canSeeRoster = canViewRaidRoster(user);
  const { raidId } = await params;
  const query = await searchParams;
  const raid = await getRaid(raidId);
  const visibleRaid = raid && (raid.status === "published" || raid.status === "closed" || canManage) ? raid : null;
  const userDiscordId = user?.provider === "discord" && /^\d{16,25}$/.test(user.id) ? user.id : "";
  const profile = user?.profileId
    ? await getProfileById(user.profileId).catch(() => null)
    : userDiscordId
      ? await getProfileByDiscordUserId(userDiscordId).catch(() => null)
      : null;
  const hasMainCharacter = user ? Boolean(profile && getMainCharacter(profile)) : null;

  return (
    <RaidPageShell
      user={user}
      title="Сторінка рейду"
      description="Пряме посилання доступне учасникам. Вони можуть тільки підписатися, пропустити рейд або позначити запізнення."
    >
      <StatusNotice params={query} />
      {visibleRaid ? <RaidLiveSync raidId={visibleRaid.id} initialRevision={raidLiveRevision(visibleRaid)} /> : null}
      {!hasRaidStorage() ? <div className="notice panel error-note raid-notice">Запис на рейди тимчасово недоступний. Повтори пізніше або звернись до офіцера.</div> : null}

      {visibleRaid ? (
        <section className="raid-member-layout">
          <div className="raid-preview-column">
            <RaidAnnouncementPreview
              raid={visibleRaid}
              actions={<RaidAttendanceActions raid={visibleRaid} user={user} profile={profile} hasMainCharacter={hasMainCharacter} />}
              manageActions={canManage ? <RaidManageActions raid={visibleRaid} /> : null}
              showRosterDetails={true}
              showMemberItemLevels={canManage}
            />
            <div className="raid-detail-links">
              {canManage ? <a className="btn subtle" href="/raids">До списку рейдів</a> : null}
              {visibleRaid.messageUrl ? <a className="btn subtle" href={visibleRaid.messageUrl} target="_blank" rel="noreferrer">Відкрити повідомлення в Discord</a> : null}
            </div>
          </div>
          {canSeeRoster ? (
            <RosterSideList
              raid={visibleRaid}
              showItemLevel={canManage}
              showBenchPriorityMarkers={canManage}
            />
          ) : null}
        </section>
      ) : <RaidUnavailableState canManage={canManage} />}
    </RaidPageShell>
  );
}
