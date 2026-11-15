"use client";
import type { KeyboardEvent, MouseEvent } from "react";
import Link from "next/link";
import type { GuildRosterMember, GuildRosterStats, GuildScoreSegment } from "@/lib/guildRoster";
import { bestRaid, raidSummary } from "@/lib/guildRosterPresentation";
import { formatStableNumber } from "@/lib/stableUiText";
import { listEntryId } from "@/lib/listViewState";
import DataTable from "@/components/ui/DataTable";
import StatusBadge from "@/components/page/StatusBadge";
import styles from "./guild-workspace.module.css";

function openProfile(event: MouseEvent<HTMLTableRowElement> | KeyboardEvent<HTMLTableRowElement>, href: string | null) {
  if (!href || event.target instanceof Element && event.target.closest("a,button,input,select,textarea,label")) return;
  if ("key" in event) { if (event.key !== "Enter" && event.key !== " ") return; event.preventDefault(); }
  window.location.href = href;
}
export default function GuildRosterTable({members, segment, raidFilter, snapshot}: {members: GuildRosterMember[]; segment: GuildScoreSegment; raidFilter: string; snapshot: GuildRosterStats["raidSeasonSnapshot"]}) {
  return <DataTable caption="Персонажі гільдії" headings={["Персонаж", "Клас / спек", "Роль", "ILVL", "RIO", "Рейд", "Ранг", "Посилання"]} className={styles.tableArea} tableClassName={styles.table}>
    {members.map(member => {
      const href = member.ownerProfileId ? `/profile/${encodeURIComponent(member.ownerProfileId)}?from=guild` : null;
      const raid = bestRaid(member, snapshot, raidFilter), progress = raidSummary(raid), score = member.scores[segment] || 0;
      return <tr key={member.key} id={listEntryId("guild", member.key)} data-list-entry="guild" data-list-href={href || undefined} tabIndex={href ? 0 : undefined}
        onClick={event => openProfile(event, href)} onKeyDown={event => openProfile(event, href)}>
        <th scope="row" data-label="Персонаж"><div className={styles.identity}>
          {member.avatarUrl ? <img className={styles.avatar} src={member.avatarUrl} width={40} height={40} alt="" loading="lazy" decoding="async" /> : null}
          <span>{href ? <Link href={href} className={styles.characterName} data-wow-class={member.className.toLowerCase()} prefetch={false}>{member.name}</Link> : <strong className={styles.characterName} data-wow-class={member.className.toLowerCase()}>{member.name}</strong>}<small>{member.realmName || member.realmSlug}</small></span>
        </div></th>
        <td data-label="Клас / спек"><strong>{member.className || "—"}</strong><small>{member.specName || "—"}</small></td>
        <td data-label="Роль"><StatusBadge tone={member.role === "healer" ? "success" : member.role === "tank" ? "info" : "neutral"}>{member.role === "tank" ? "Танк" : member.role === "healer" ? "Хіл" : member.role === "dps" ? "ДД" : "—"}</StatusBadge></td>
        <td data-label="ILVL">{member.itemLevel || "—"}</td>
        <td data-label="RIO"><strong>{score > 0 ? formatStableNumber(score, 1) : "—"}</strong><small>{segment === "all" ? "Загальний" : segment}</small></td>
        <td data-label="Рейд" title={raid ? `${raid.name}: ${progress.detail}` : undefined}><strong>{progress.main}</strong><small>{raid?.name || progress.detail}</small></td>
        <td data-label="Ранг">{member.rank === null || member.rank === undefined ? "—" : `#${member.rank}`}</td>
        <td data-label="Посилання"><div className={styles.actions}>{href ? <Link href={href} prefetch={false}>Профіль</Link> : null}{member.profileUrl ? <a href={member.profileUrl} target="_blank" rel="noreferrer">Raider.IO ↗</a> : null}{!href && !member.profileUrl ? "—" : null}</div></td>
      </tr>;
    })}
  </DataTable>;
}
