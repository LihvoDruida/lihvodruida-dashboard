import Link from "next/link";
import type {RaidDetailsWorkspaceModel} from "@/services/raidDetailsWorkspace";
import DashboardIdentity from "@/components/DashboardIdentity";
import PageContainer from "@/components/page/PageContainer";
import PageHeader from "@/components/page/PageHeader";
import ErrorState from "@/components/page/ErrorState";
import EmptyState from "@/components/page/EmptyState";
import PageRefreshButton from "@/components/page/PageRefreshButton";
import PageErrorBoundary from "@/components/page/PageErrorBoundary";
import DiscordPublicationWorkbench from "@/components/DiscordPublicationWorkbench";
import RaidLiveSync from "@/components/RaidLiveSync";
import ListReturnLink from "@/components/ListReturnLink";
import {listNavigationScope} from "@/lib/listNavigationScope";
import {raidLiveRevision,raidTitle} from "@/lib/raids";
import RaidOverview from "./RaidOverview";
import RaidManageActions from "./RaidManageActions";
import {RosterSideList} from "./RaidRoster";
import styles from "@/components/community/workspace.module.css";
export default function RaidDetailsView({user,canManage,canSeeRoster,raid,unavailable,canReturnToList}: RaidDetailsWorkspaceModel) {
  return <PageContainer label="Сторінка рейду" navigation={<DashboardIdentity user={user} activeSection="raids" />}>
    <PageHeader title={raid ? raidTitle(raid) : "Сторінка рейду"} description="Склад, умови участі та розподіл паті. Запис і зміна статусу участі — через Discord."
      breadcrumbs={[{label:"Рейди",href:"/raids"},{label:raid ? raidTitle(raid) : "Деталі"}]} actions={raid?.messageUrl ? <a className="btn primary" href={raid.messageUrl} target="_blank" rel="noreferrer">Відкрити в Discord ↗</a> : null} />
    {canReturnToList ? <ListReturnLink kind="raids" scope={listNavigationScope(user)} /> : null}
    {unavailable ? <ErrorState title="Рейд тимчасово недоступний" description="Не вдалося прочитати дані рейду. Спробуй повторити." actions={<PageRefreshButton />} /> : raid ? <>
      <RaidLiveSync raidId={raid.id} initialRevision={raidLiveRevision(raid)} />
      {canManage ? <PageErrorBoundary resetKey={raid.id}><DiscordPublicationWorkbench kind="raid" id={raid.id} /></PageErrorBoundary> : null}
      <div className={canSeeRoster ? styles.columns : styles.stack}>
        <RaidOverview raid={raid} showRosterDetails={canSeeRoster} showMemberItemLevels={canManage} showBenchPriorityMarkers={canManage} manageActions={canManage ? <RaidManageActions raid={raid} /> : null} />
        {canSeeRoster ? <RosterSideList raid={raid} showItemLevel={canManage} showBenchPriorityMarkers={canManage} /> : null}
      </div>
    </> : <EmptyState title="Рейд недоступний" description="Рейд не знайдено, не опубліковано або видалено." actions={<Link className="btn subtle" href="/raids">До списку рейдів</Link>} />}
  </PageContainer>;
}
