import Link from "next/link";
import type { ProfileDirectoryModel } from "@/services/profileDirectory";
import { buildProfilesHref } from "@/lib/profileDirectoryNavigation";
import DashboardIdentity from "@/components/DashboardIdentity";
import ListViewMemory from "@/components/ListViewMemory";
import { listNavigationScope } from "@/lib/listNavigationScope";
import PageContainer from "@/components/page/PageContainer";
import PageHeader from "@/components/page/PageHeader";
import PageSection from "@/components/page/PageSection";
import EmptyState from "@/components/page/EmptyState";
import ErrorState from "@/components/page/ErrorState";
import PageRefreshButton from "@/components/page/PageRefreshButton";
import ProfileDirectoryFilters from "./ProfileDirectoryFilters";
import ProfileDirectoryTable from "./ProfileDirectoryTable";
import DiscordRaidPreferences from "./DiscordRaidPreferences";
import styles from "./directory.module.css";

export default function ProfileDirectoryView(model: ProfileDirectoryModel) {
  const { user, params, filters, result, profiles, total, characterCount, linkedBattleNetCount, liveDiscordAvatars, canManageCleanup, raidPreferences, hasFilters } = model;
  const currentUrl = buildProfilesHref({ ...filters, cursor: result.cursorReset || result.unavailable ? null : params.cursor });
  return <PageContainer label="Профілі учасників" navigation={<DashboardIdentity user={user} activeSection="profiles" />}>
    <PageHeader title="Профілі учасників" description="Мейни, персонажі, Battle.net та активність учасників. Пошук охоплює весь доступний каталог."
      breadcrumbs={[{ label: "Керування", href: "/dashboard" }, { label: "Профілі" }]}
      actions={canManageCleanup ? <Link className="btn subtle" href="/dashboard/profiles">Аудит та очищення</Link> : null}
      metrics={[{ label: "Профілі", value: total }, { label: "Персонажі", value: characterCount }, { label: "Battle.net підключено", value: linkedBattleNetCount }]} />
    <ProfileDirectoryFilters key={buildProfilesHref(filters)} filters={filters} total={total} />
    <ListViewMemory key={listNavigationScope(user)} kind="profiles" scope={listNavigationScope(user)} currentUrl={currentUrl} restorePosition={!result.cursorReset && !result.unavailable} />
    <PageSection id="profile-directory-results" title="Учасники" description={total ? `${result.start}–${result.end} із ${total}` : "Доступні профілі за поточними фільтрами."}>
      {result.unavailable ? <ErrorState title="Каталог тимчасово недоступний" description="Не вдалося прочитати профілі. Фільтри збережено в адресі сторінки." actions={<PageRefreshButton />} />
        : profiles.length ? <ProfileDirectoryTable profiles={profiles} avatars={liveDiscordAvatars} />
        : <EmptyState title={hasFilters ? "Нічого не знайдено" : "Профілів ще немає"} description={hasFilters ? "Зміни пошук або скинь фільтри." : "Профіль зʼявиться після входу учасника через Discord."}
            actions={hasFilters ? <Link className="btn subtle" href="/profiles?view=all" data-list-reset-position>Очистити фільтри</Link> : null} />}
      {!result.unavailable && total > 0 ? <nav className={styles.pagination} aria-label="Навігація сторінками профілів">
        {result.previousCursor ? <Link className="btn subtle" rel="prev" href={buildProfilesHref({ ...filters, cursor: result.previousCursor })} prefetch={false}>← Назад</Link> : <span className="btn subtle is-disabled" aria-disabled="true">← Назад</span>}
        <span>{result.start}–{result.end} із {total}</span>
        {result.nextCursor ? <Link className="btn subtle" rel="next" href={buildProfilesHref({ ...filters, cursor: result.nextCursor })} prefetch={false}>Далі →</Link> : <span className="btn subtle is-disabled" aria-disabled="true">Далі →</span>}
      </nav> : null}
    </PageSection>
    <DiscordRaidPreferences items={raidPreferences} />
  </PageContainer>;
}
