import Link from "next/link";
import type {RaidDirectoryWorkspaceModel} from "@/services/raidDirectoryWorkspace";
import DashboardIdentity from "@/components/DashboardIdentity";
import PageContainer from "@/components/page/PageContainer";
import PageHeader from "@/components/page/PageHeader";
import PageSection from "@/components/page/PageSection";
import DataGrid from "@/components/page/DataGrid";
import FilterToolbar from "@/components/page/FilterToolbar";
import FilterNavigationForm from "@/components/page/FilterNavigationForm";
import EmptyState from "@/components/page/EmptyState";
import ErrorState from "@/components/page/ErrorState";
import Notice from "@/components/page/Notice";
import PageRefreshButton from "@/components/page/PageRefreshButton";
import FormField from "@/components/ui/FormField";
import Button from "@/components/ui/Button";
import DropdownMenu from "@/components/ui/DropdownMenu";
import ListViewMemory from "@/components/ListViewMemory";
import {listNavigationScope} from "@/lib/listNavigationScope";
import {formatRaidDateTime} from "@/components/RaidSignupPresentation";
import RaidArchiveLoadMore from "@/components/RaidArchiveLoadMore";
import RaidDirectoryCard from "./RaidDirectoryCard";
export default function RaidDirectoryView(model: RaidDirectoryWorkspaceModel) {
  const {user,canManage,unavailable,discordEnabled,activeRaids,draftRaids,closedRaids,nextRaid,currentUrl,query,state,visibleCurrent,visibleArchive} = model;
  const filtered = Boolean(query || state !== "all");
  const reset = <Link className="btn subtle" href="/raids?view=all" data-list-reset-position>Показати всі рейди</Link>;
  const empty = (section: "current" | "archive") => filtered
    ? <EmptyState title="Рейдів за цими фільтрами немає" description="Зміни пошук або скинь фільтри." actions={reset} />
    : section === "current"
      ? <EmptyState title="Поточних рейдів немає" description={canManage ? "Створи рейд, щоб відкрити запис через Discord." : "Новий рейд з’явиться тут, щойно його опублікують."} actions={canManage ? <Link className="btn subtle" href="/raids/new">Створити рейд</Link> : null} />
      : <EmptyState title="Минулих рейдів ще немає" description="Завершені рейди потрапляють в архів разом зі складом і записами." />;
  return <PageContainer label="Рейди" navigation={<DashboardIdentity user={user} activeSection="raids" />}>
    <PageHeader title="Рейди" description="Поточні рейди, їхній склад та архів. Запис на участь відбувається через Discord."
      breadcrumbs={[{label: "Рейди"}]} actions={canManage ? <><Link className="btn primary" href="/raids/new">Створити рейд</Link><DropdownMenu label="Інші інструменти" items={[{id:"roster",label:"Збір сезонного складу",href:"/roster"},{id:"polls",label:"Рейд-пули",href:"/polls"},{id:"bench",label:"Сірий список",href:"/raids/bench-priority"}]} /></> : null}
      metrics={[{label:"Активні",value:unavailable ? "—" : activeRaids.length},...(canManage ? [{label:"Чернетки",value:unavailable ? "—" : draftRaids.length}] : []),{label:"Архів",value:unavailable ? "—" : closedRaids.length},{label:"Найближчий рейд",value:unavailable ? "—" : nextRaid ? formatRaidDateTime(nextRaid.date,nextRaid.time) : "Немає"}]} />
    {canManage && !discordEnabled ? <Notice title="Публікація в Discord недоступна" tone="warning">Чернетки можна підготувати й опублікувати після відновлення підключення.</Notice> : null}
    <FilterNavigationForm key={`${query}:${state}`} action="/raids"><FilterToolbar label="Пошук і фільтри рейдів" search={<FormField label="Пошук рейду" name="q" type="search" maxLength={160} defaultValue={query} placeholder="Назва, дата або ID" />}
      filters={<label>Стан<select name="state" defaultValue={state}><option value="all">Усі</option><option value="active">Активні</option>{canManage ? <option value="draft">Чернетки</option> : null}<option value="closed">Архів</option></select></label>}
      actions={<><Button tone="primary" type="submit">Застосувати</Button><Link className="btn subtle" href="/raids?view=all" data-list-reset-position>Скинути</Link></>} /></FilterNavigationForm>
    <ListViewMemory key={listNavigationScope(user)} kind="raids" scope={listNavigationScope(user)} currentUrl={currentUrl} clientLocation restorePosition={!unavailable} />
    {unavailable ? <ErrorState title="Рейди тимчасово недоступні" description="Не вдалося отримати список рейдів. Фільтри збережено." actions={<PageRefreshButton />} /> : <>
      {state !== "closed" ? <PageSection id="raids-current-title" title="Поточні рейди" description={canManage ? "Опубліковані рейди та чернетки." : "Опубліковані рейди для перегляду."}>{visibleCurrent.length ? <DataGrid label="Поточні рейди" columns="two">{visibleCurrent.map(raid => <RaidDirectoryCard key={raid.id} raid={raid} canManage={canManage} />)}</DataGrid> : empty("current")}</PageSection> : null}
      {state === "all" || state === "closed" ? <PageSection id="raids-archive-title" title="Минулі рейди" description={`Знайдено: ${visibleArchive.length}. Склад і записи зберігаються в архіві.`}>{visibleArchive.length ? <RaidArchiveLoadMore step={6} total={visibleArchive.length}>{visibleArchive.map(raid => <RaidDirectoryCard key={raid.id} raid={raid} canManage={canManage} />)}</RaidArchiveLoadMore> : empty("archive")}</PageSection> : null}
    </>}
  </PageContainer>;
}
