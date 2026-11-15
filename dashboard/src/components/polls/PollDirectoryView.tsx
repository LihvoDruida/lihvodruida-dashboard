import Link from "next/link";
import type {PollDirectoryWorkspaceModel} from "@/services/pollWorkspace";
import DashboardIdentity from "@/components/DashboardIdentity";
import PageContainer from "@/components/page/PageContainer";
import PageHeader from "@/components/page/PageHeader";
import PageSection from "@/components/page/PageSection";
import Notice from "@/components/page/Notice";
import ErrorState from "@/components/page/ErrorState";
import PageRefreshButton from "@/components/page/PageRefreshButton";
import DropdownMenu from "@/components/ui/DropdownMenu";
import RaidPollRecalculateButton from "@/components/RaidPollRecalculateButton";
import {listNavigationScope} from "@/lib/listNavigationScope";
import PollDirectoryList from "./PollDirectoryList";
export default function PollDirectoryView({user,canManage,publishedPolls,visiblePolls,counts,unavailable,discordEnabled}: PollDirectoryWorkspaceModel) {
  return <PageContainer label="Рейд-пули" navigation={<DashboardIdentity user={user} activeSection="polls" />}>
    <PageHeader title="Рейд-пули" description="Доступність гравців за днями й часом. Голоси надходять із Discord, рекомендації враховують інші активні пули."
      breadcrumbs={[{label:"Рейд-пули"}]} actions={canManage ? <><Link className="btn primary" href="/polls/new">Створити рейд-пул</Link><DropdownMenu label="Інші інструменти" closeOnAction={false}><RaidPollRecalculateButton /></DropdownMenu></> : null}
      metrics={[{label:"Заплановані",value:unavailable ? "—" : counts.scheduled},{label:"Активні",value:unavailable ? "—" : counts.open},{label:"На паузі",value:unavailable ? "—" : counts.paused},{label:"Усього",value:unavailable ? "—" : visiblePolls.length},{label:"У Discord",value:unavailable ? "—" : publishedPolls.length}]} />
    {canManage && !discordEnabled ? <Notice title="Публікація в Discord недоступна" tone="warning">Перевір підключення бота й доступ до каналу.</Notice> : null}
    <PageSection id="polls-directory-title" title="Голосування" description="Вибери стан або знайди потрібний пул за назвою.">
      {unavailable ? <ErrorState title="Рейд-пули тимчасово недоступні" description="Не вдалося отримати список голосувань." actions={<PageRefreshButton />} /> : <PollDirectoryList polls={visiblePolls} relatedPolls={publishedPolls} canManage={canManage} navigationScope={listNavigationScope(user)} />}
    </PageSection>
  </PageContainer>;
}
