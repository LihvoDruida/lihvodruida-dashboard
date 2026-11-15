import Link from "next/link";
import type { ApplicationWorkspaceModel } from "@/services/applicationWorkspace";
import DashboardIdentity from "@/components/DashboardIdentity";
import PageContainer from "@/components/page/PageContainer";
import PageHeader from "@/components/page/PageHeader";
import PageSection from "@/components/page/PageSection";
import DataGrid from "@/components/page/DataGrid";
import EmptyState from "@/components/page/EmptyState";
import ErrorState from "@/components/page/ErrorState";
import PageRefreshButton from "@/components/page/PageRefreshButton";
import Notice from "@/components/page/Notice";
import ApplicationFilters from "@/components/ApplicationFilters";
import { ApplicationModerationProvider } from "@/components/ApplicationModerationQueue";
import ListViewMemory from "@/components/ListViewMemory";
import { listNavigationScope } from "@/lib/listNavigationScope";
import ApplicationCard from "./ApplicationCard";

export default function ApplicationWorkspaceView(model: ApplicationWorkspaceModel) {
  const {user, currentUrl, listParams, items, counts, classOptions, mayManageApplications, mayViewSensitiveApplications, unavailable, filtersUnavailable} = model;
  const scope = listNavigationScope(user);
  return <PageContainer label="Заявки до гільдії" navigation={<DashboardIdentity user={user} activeSection="applications" />}>
    <PageHeader title="Заявки до гільдії" description="Кандидати, їхній прогрес і рішення офіцерів. Пошук та фільтри оновлюють поточну чергу."
      breadcrumbs={[{label: "Заявки"}]} metrics={[{label: "У поточному списку",value: unavailable ? "—" : counts.all},{label: "На розгляді",value: unavailable ? "—" : counts.review},{label: "Прийнято",value: unavailable ? "—" : counts.accepted},{label: "Відхилено",value: unavailable ? "—" : counts.declined}]} />
    <ApplicationFilters initialQuery={listParams.get("q") || ""} initialStatus={listParams.get("status") || "all"} initialClass={listParams.get("class") || "all"} initialSort={listParams.get("sort") || "created"} classOptions={classOptions} />
    <ListViewMemory key={scope} kind="applications" scope={scope} currentUrl={currentUrl} restorePosition={!unavailable} />
    {filtersUnavailable ? <Notice title="Список класів тимчасово недоступний" tone="warning">Поточний фільтр збережено. Інші фільтри залишаються доступними.</Notice> : null}
    {!mayManageApplications ? <Notice title="Режим перегляду">Зміна рішень недоступна. Контактні дані показуються відповідно до твоїх прав.</Notice> : null}
    <PageSection id="applications-list-title" title="Кандидати" description={mayManageApplications ? "Приймай рішення окремо або вибери кілька заявок для спільної дії." : "Дані кандидатів, доступні для перегляду."}>
      {unavailable ? <ErrorState title="Заявки тимчасово недоступні" description="Не вдалося отримати чергу. Фільтри збережено." actions={<PageRefreshButton />} />
        : items.length ? <ApplicationModerationProvider key={`${scope}:${currentUrl}`} canModerate={mayManageApplications} items={items.map(item => ({issueNumber: item.number,status: item.status_key,state: item.state}))}>
          <DataGrid label="Список заявок" columns="two">{items.map(item => <ApplicationCard key={String(item.id || item.tracking_number || item.number)} item={item} canManage={mayManageApplications} canViewSensitive={mayViewSensitiveApplications} isOwner={Boolean(user.isServerOwner)} />)}</DataGrid>
        </ApplicationModerationProvider>
        : <EmptyState title={listParams.size ? "Нічого не знайдено" : "Заявок поки немає"} description="Зміни пошук або скинь фільтри, щоб перевірити всю чергу." actions={listParams.size ? <Link className="btn subtle" href="/applications?view=all" data-list-reset-position>Скинути фільтри</Link> : null} />}
    </PageSection>
  </PageContainer>;
}
