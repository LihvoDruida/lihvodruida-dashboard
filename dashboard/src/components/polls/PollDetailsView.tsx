import Link from "next/link";
import type {PollDetailsWorkspaceModel} from "@/services/pollWorkspace";
import DashboardIdentity from "@/components/DashboardIdentity";
import PageContainer from "@/components/page/PageContainer";
import PageHeader from "@/components/page/PageHeader";
import ErrorState from "@/components/page/ErrorState";
import EmptyState from "@/components/page/EmptyState";
import PageRefreshButton from "@/components/page/PageRefreshButton";
import PageErrorBoundary from "@/components/page/PageErrorBoundary";
import DiscordPublicationWorkbench from "@/components/DiscordPublicationWorkbench";
import RaidPollLiveSync from "@/components/RaidPollLiveSync";
import ListReturnLink from "@/components/ListReturnLink";
import {listNavigationScope} from "@/lib/listNavigationScope";
import {raidPollLiveRevision,raidPollTitle} from "@/lib/raidPolls";
import PollResults from "./PollResults";
export default function PollDetailsView({user,canManage,poll,relatedPolls,unavailable,relatedUnavailable}: PollDetailsWorkspaceModel) {
  return <PageContainer label="Рейд-пул" navigation={<DashboardIdentity user={user} activeSection="polls" />}>
    <PageHeader title={poll ? raidPollTitle(poll) : "Рейд-пул"} description={poll?.description || "Дні, час, голоси та результати голосування."} breadcrumbs={[{label:"Рейд-пули",href:"/polls"},{label:"Результати"}]} />
    <ListReturnLink kind="polls" scope={listNavigationScope(user)} />
    {unavailable ? <ErrorState title="Рейд-пул тимчасово недоступний" description="Не вдалося прочитати результати голосування." actions={<PageRefreshButton />} /> : poll ? <>
      {canManage ? <><PageErrorBoundary resetKey={poll.id}><DiscordPublicationWorkbench kind="poll" id={poll.id} /></PageErrorBoundary><RaidPollLiveSync pollId={poll.id} initialRevision={raidPollLiveRevision(poll)} /></> : null}
      <PollResults poll={poll} relatedPolls={relatedPolls} canManage={canManage} relatedUnavailable={relatedUnavailable} />
    </> : <EmptyState title="Рейд-пул не знайдено" description="Перевір посилання або повернись до списку доступних голосувань." actions={<Link className="btn subtle" href="/polls">До списку</Link>} />}
  </PageContainer>;
}
