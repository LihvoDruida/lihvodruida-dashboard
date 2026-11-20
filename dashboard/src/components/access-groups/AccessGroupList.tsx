"use client";
import type { AccessGroup } from "@/lib/accessGroupSchema";
import type { GroupDraft } from "@/lib/accessGroupDrafts";
import { groupDraftKey, NEW_GROUP_DRAFT } from "@/lib/accessGroupDrafts";
import FilterToolbar from "@/components/page/FilterToolbar";
import FormField from "@/components/ui/FormField";
import Button from "@/components/ui/Button";
import EmptyState from "@/components/page/EmptyState";
import StatusBadge from "@/components/page/StatusBadge";
import { groupIcon, roleLabel } from "./groupLabels";
import styles from "./groups.module.css";

type Props = {
  groups: AccessGroup[]; filteredGroups: AccessGroup[]; visibleCount: number; drafts: Map<string, GroupDraft>; expanded: string;
  query: string; onQuery: (value: string) => void; onSelect: (key: string) => void; onMore: () => void;
  busy: boolean; refreshing: boolean; onRefresh: (button: HTMLButtonElement) => void;
};
export default function AccessGroupList(props: Props) {
  return <section className={`access-groups-list ${styles.list}`} aria-label="Список груп доступу">
    <FilterToolbar label="Пошук груп" search={<FormField label="Знайти групу" type="search" maxLength={120} value={props.query} onChange={event => props.onQuery(event.target.value)} placeholder="Назва, ID або Discord-роль" />}
      result={`${props.groups.length} груп · ${props.drafts.size} чернеток`} />
    {props.filteredGroups.slice(0, props.visibleCount).map(group => <Button key={group.id} className={`access-group-tab ${styles.groupButton}`} aria-pressed={props.expanded === groupDraftKey(group.id)} onClick={() => props.onSelect(groupDraftKey(group.id))}>
      <strong>{groupIcon(group)} {group.name}</strong><small>ID {group.id} · {roleLabel(group.role)} · {group.permissions.length} прав</small>
      {props.drafts.has(groupDraftKey(group.id)) ? <StatusBadge tone="warning">Незбережені зміни</StatusBadge> : null}
    </Button>)}
    {!props.filteredGroups.length ? <EmptyState title="Груп не знайдено" description="Зміни пошук або створи нову групу." /> : null}
    {props.filteredGroups.length > props.visibleCount ? <Button onClick={props.onMore}>Показати ще 10 · {props.filteredGroups.length - props.visibleCount} залишилось</Button> : null}
    {[...props.drafts.keys()].filter(key => key !== NEW_GROUP_DRAFT && !props.groups.some(group => groupDraftKey(group.id) === key)).map(key => <Button key={key} onClick={() => props.onSelect(key)}>Чернетка видаленої групи · {props.drafts.get(key)!.values.name}</Button>)}
    <Button tone="primary" aria-pressed={props.expanded === NEW_GROUP_DRAFT} onClick={() => props.onSelect(NEW_GROUP_DRAFT)}>Нова група</Button>
    <Button busy={props.refreshing} disabled={props.busy} onClick={event => props.onRefresh(event.currentTarget)}>{props.refreshing ? "Оновлюємо…" : "Оновити список"}</Button>
  </section>;
}
