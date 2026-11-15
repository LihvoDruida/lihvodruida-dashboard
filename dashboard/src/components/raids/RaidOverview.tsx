import type {ReactNode} from "react";
import {buildRaidGroupLayout, raidGroupLayoutSlotCounts, raidDisplayCapacity, raidAverageItemLevel, raidRegistrationLimit, raidRegistrationLockSummary, raidAutoCompositionLabel, raidConsumablesLabel, raidLootLabel, raidTitle, isRaidClosed, resolveRaidThumbnailUrl, type RaidItem} from "@/lib/raids";
import {DiscordMarkdown} from "@/components/DiscordMarkdown";
import {formatRaidDateTime} from "@/components/RaidSignupPresentation";
import {raidStatusLabel} from "@/lib/raidPresentation";
import PageSection from "@/components/page/PageSection";
import DataCard from "@/components/page/DataCard";
import DataGrid from "@/components/page/DataGrid";
import Notice from "@/components/page/Notice";
import StatusBadge from "@/components/page/StatusBadge";
import Progress from "@/components/page/Progress";
import {PartyCard, BenchCard} from "./RaidRoster";
import styles from "./raid-workspace.module.css";
export default function RaidOverview({raid, actions, manageActions, showRosterDetails = true, showMemberItemLevels = true, showBenchPriorityMarkers = showMemberItemLevels}: {
  raid: RaidItem; actions?: ReactNode; manageActions?: ReactNode; showRosterDetails?: boolean; showMemberItemLevels?: boolean; showBenchPriorityMarkers?: boolean;
}) {
  const layout = buildRaidGroupLayout(raid), counts = raidGroupLayoutSlotCounts(layout), capacity = layout.targetSize || raidDisplayCapacity(raid);
  const lock = raidRegistrationLockSummary(raid), closed = isRaidClosed(raid), average = raidAverageItemLevel(raid);
  return <div className={styles.stack}>
    <DataCard title={raidTitle(raid)} description={formatRaidDateTime(raid.date,raid.time)} badge={<StatusBadge tone={closed ? "neutral" : raid.status === "draft" ? "warning" : "success"}>{raidStatusLabel(raid)}</StatusBadge>} actions={manageActions}>
      <div className={styles.identity}><img className={styles.thumbnail} src={resolveRaidThumbnailUrl(raid)} alt="" width={64} height={64} /><span>{raid.raidLeaderName ? `РЛ: ${raid.raidLeaderName}` : "Рейд-лідер не вказаний"}</span></div>
      <div className={styles.description}><DiscordMarkdown value={raid.description} /></div>
      <dl className={styles.facts}><div><dt>Запис</dt><dd>{closed ? "Закрито" : lock.enabled ? lock.label : "Відкрито"}<small>{lock.enabled ? lock.detail : "До початку рейду через Discord"}</small></dd></div>
        <div><dt>Основний склад</dt><dd>{counts.roster} / {capacity}<Progress value={counts.roster} max={capacity} label={`Основа: ${counts.roster} з ${capacity}`} /></dd></div>
        <div><dt>Ролі</dt><dd>Танки {counts.tanks} · хіли {counts.healers} · ДД {counts.dps}<small>Ціль: {raidAutoCompositionLabel(raid)}</small></dd></div>
        <div><dt>Готовність</dt><dd>{average ? `${average} ilvl` : "—"}<small>Лава: {layout.bench.members.length}</small></dd></div>
        {raid.minItemLevel ? <div><dt>Мінімальний ilvl</dt><dd>{raid.minItemLevel} · {raid.minItemLevelRequired ? "Обовʼязково" : "Попередження"}</dd></div> : null}
        <div><dt>Розхідники</dt><dd>{raidConsumablesLabel(raid.consumables)}</dd></div><div><dt>Лут</dt><dd>{raidLootLabel(raid.lootMode)}</dd></div><div><dt>Створив</dt><dd>{raid.createdByName}{raid.createdByMain ? ` · ${raid.createdByMain}` : ""}</dd></div>
      </dl>
      {raid.discordEventUrl ? <a className="btn subtle" href={raid.discordEventUrl} target="_blank" rel="noreferrer">Подія в Discord ↗</a> : null}
    </DataCard>
    {closed ? <Notice title="Запис закрито">Склад зафіксовано. Доступний перегляд рейду та його учасників.</Notice> : raidRegistrationLimit(raid) && counts.roster >= capacity ? <Notice title="Основний склад заповнений">Нові активні записи потрапляють на лаву запасних до звільнення місця.</Notice> : null}
    {showRosterDetails && layout.warnings.length ? <Notice title="Перевір склад" tone="warning">{layout.warnings.join(" · ")}</Notice> : null}
    <PageSection id={`raid-${raid.id}-signup-title`} title="Участь через Discord" description={closed ? "Рейд закрито — доступний лише перегляд." : "Обери персонажа, спеціалізацію та статус участі в оголошенні Discord."}>
      {actions || (raid.messageUrl ? <a className="btn primary" href={raid.messageUrl} target="_blank" rel="noopener noreferrer">Відкрити оголошення в Discord ↗</a> : <Notice title="Оголошення очікується">Рейд-лідер ще не опублікував повідомлення для запису.</Notice>)}
    </PageSection>
    {showRosterDetails ? <PageSection id={`raid-${raid.id}-parties-title`} title="Паті рейду" description={`Паті: ${layout.parties.length} · основа: ${counts.roster}/${capacity} · лава: ${layout.bench.members.length}. Розподіл враховує ролі та критичні бафи.`}>
      <DataGrid label="Паті рейду" columns="two">{layout.parties.map(party => <PartyCard key={party.index} party={party} minItemLevel={raid.minItemLevel} minItemLevelRequired={raid.minItemLevelRequired} showItemLevel={showMemberItemLevels} benchPriority={raid.benchPriority || null} showBenchPriorityMarkers={showBenchPriorityMarkers} />)}</DataGrid>
      <BenchCard members={layout.bench.members} minItemLevel={raid.minItemLevel} minItemLevelRequired={raid.minItemLevelRequired} showItemLevel={showMemberItemLevels} benchPriority={raid.benchPriority || null} showBenchPriorityMarkers={showBenchPriorityMarkers} />
    </PageSection> : null}
  </div>;
}
