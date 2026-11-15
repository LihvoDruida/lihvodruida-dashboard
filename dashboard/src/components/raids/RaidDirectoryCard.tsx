import Link from "next/link";
import {listEntryId} from "@/lib/listViewState";
import {buildRaidGroupLayout, raidGroupLayoutSlotCounts, raidDisplayCapacity, raidAverageItemLevel, raidRegistrationLockSummary, raidTitle, isRaidClosed, resolveRaidThumbnailUrl, type RaidItem} from "@/lib/raids";
import {raidStatusLabel} from "@/lib/raidPresentation";
import {formatRaidDateTime} from "@/components/RaidSignupPresentation";
import DataCard from "@/components/page/DataCard";
import StatusBadge from "@/components/page/StatusBadge";
import Progress from "@/components/page/Progress";
import RaidManageActions from "./RaidManageActions";
import styles from "./raid-workspace.module.css";
export default function RaidDirectoryCard({raid,canManage = false}: {raid: RaidItem; canManage?: boolean}) {
  const layout = buildRaidGroupLayout(raid), counts = raidGroupLayoutSlotCounts(layout), capacity = layout.targetSize || raidDisplayCapacity(raid);
  const lock = raidRegistrationLockSummary(raid), average = raidAverageItemLevel(raid), href = `/raids/${encodeURIComponent(raid.id)}`;
  return <DataCard id={listEntryId("raids",raid.id)} listEntry="raids" title={raidTitle(raid)} titleHref={href} description={formatRaidDateTime(raid.date,raid.time)}
    badge={<StatusBadge tone={raid.status === "draft" ? "warning" : isRaidClosed(raid) ? "neutral" : "success"}>{raidStatusLabel(raid)}</StatusBadge>}
    actions={<><Link className="btn primary" href={href} prefetch={false}>Відкрити рейд</Link>{canManage ? <RaidManageActions raid={raid} /> : null}</>}>
    <div className={styles.identity}><img className={styles.thumbnail} src={resolveRaidThumbnailUrl(raid)} alt="" width={64} height={64} loading="lazy" decoding="async" /><span>{raid.raidLeaderName ? `РЛ: ${raid.raidLeaderName}` : "Рейд-лідер не вказаний"}{lock.enabled ? <small>{lock.label}</small> : null}</span></div>
    <dl className={styles.facts}><div><dt>Основа</dt><dd>{counts.roster} / {capacity}</dd></div><div><dt>Ролі</dt><dd>Танки {counts.tanks} · хіли {counts.healers} · ДД {counts.dps}</dd></div><div><dt>Лава</dt><dd>{layout.bench.members.length}</dd></div><div><dt>Середній ilvl</dt><dd>{average || "—"}</dd></div></dl>
    <Progress value={counts.roster} max={capacity} label={`Заповнення рейду ${counts.roster} з ${capacity}`} />
  </DataCard>;
}
