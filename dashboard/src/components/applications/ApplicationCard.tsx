import type { ApplicationItem } from "@/lib/applicationsStore";
import { listEntryId } from "@/lib/listViewState";
import ApplicationDelivery from "@/components/ApplicationDelivery";
import ApplicationStatusActions from "@/components/ApplicationStatusActions";
import { ApplicationSelection, ApplicationStatusBadge } from "@/components/ApplicationModerationQueue";
import DataCard from "@/components/page/DataCard";
import RaiderIoPanel, { CharacterAvatar } from "./ApplicationPerformance";
import styles from "./applications-workspace.module.css";

export function applicationDate(value?: string | null) {
  if (!value || !Number.isFinite(Date.parse(value))) return "Дата невідома";
  return new Intl.DateTimeFormat("uk-UA", {timeZone: "Europe/Kyiv", dateStyle: "medium", timeStyle: "short"}).format(new Date(value));
}
export default function ApplicationCard({item, canManage, canViewSensitive, isOwner}: {item: ApplicationItem; canManage: boolean; canViewSensitive: boolean; isOwner: boolean}) {
  const name = item.character_name || item.title || "Персонаж";
  return <DataCard id={listEntryId("applications", String(item.id || item.tracking_number || item.number))} listEntry="applications" title={name}
    description={`Заявка #${item.number || "—"} · ${applicationDate(item.created_at)}`}
    badge={<ApplicationStatusBadge issueNumber={item.number} initialStatus={item.status_key} />}>
    <div className={styles.stack}>
      <div className={styles.identity}><CharacterAvatar item={item} /><span>{String(item.region || "eu").toUpperCase()} · {item.realm || "Реалм не вказано"}<small>{[item.class_name, item.faction].filter(Boolean).join(" · ")}</small></span></div>
      <dl className={styles.facts}>
        <div><dt>Відстеження</dt><dd>{item.tracking_number || "—"}</dd></div><div><dt>Джерело</dt><dd>{item.source || "Не вказано"}</dd></div>
        <div><dt>Коли грає</dt><dd>{item.availability || "Не вказано"}</dd></div>
        {canViewSensitive ? <><div><dt>Discord</dt><dd>{item.discord || "Не вказано"}</dd></div><div><dt>BattleTag</dt><dd>{item.battle_tag || "Не вказано"}</dd></div></> : null}
      </dl>
      <RaiderIoPanel item={item} />
      <div className={styles.actions}><small className={styles.metadata}>{item.source_system === "public-site" ? "Надіслано із сайту" : "Синхронізовано зі сховищем"}</small>
        {canViewSensitive && item.html_url ? <a className="btn subtle" href={item.html_url} target="_blank" rel="noreferrer">Відкрити джерело ↗</a> : null}</div>
      <ApplicationSelection issueNumber={item.number} />
      <ApplicationStatusActions issueNumber={item.number} initialStatus={item.status_key} issueState={item.state} canModerate={canManage} canDelete={isOwner && canManage} />
      {canManage ? <details className={styles.details}><summary>Доставка в Discord</summary><ApplicationDelivery number={item.number} /></details> : null}
    </div>
  </DataCard>;
}
