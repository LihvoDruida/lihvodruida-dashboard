"use client";
import type {RaidPollCardModel} from "@/components/RaidPollBrowser";
import {listEntryId} from "@/lib/listViewState";
import DataCard from "@/components/page/DataCard";
import StatusBadge from "@/components/page/StatusBadge";
import RaidPollActions from "@/components/RaidPollActions";
import styles from "./poll-workspace.module.css";
export default function PollDirectoryCard({card,canManage,selected,selectionDisabled,onToggle}: {card: RaidPollCardModel;canManage: boolean;selected: boolean;selectionDisabled: boolean;onToggle: (id: string) => void}) {
  const href = `/polls/${encodeURIComponent(card.id)}`;
  return <DataCard id={listEntryId("polls",card.id)} listEntry="polls" title={card.title} titleHref={href} description={card.description}
    badge={<StatusBadge tone={card.state === "open" ? "success" : card.state === "closed" ? "neutral" : "warning"}>{card.statusLabel}</StatusBadge>}
    actions={<RaidPollActions pollId={card.id} pollTitle={card.title} state={card.state} canManage={canManage} disabled={selectionDisabled} editHref={`${href}/edit`} messageUrl={card.messageUrl} showView />}>
    <div className={styles.stack}>
      <div className={styles.actions}><StatusBadge>{card.difficultyLabel}</StatusBadge>{card.autoRepeat ? <StatusBadge>Повтор: {card.repeatLabel}</StatusBadge> : null}<small className={styles.metadata} title={card.id}>ID: {card.shortId}</small></div>
      {card.pausedNote ? <p className={styles.metadata}>{card.pausedNote}</p> : null}
      <div className={styles.actions} aria-label="Дні рейд-пулу">{card.dayLabels.map(day => <StatusBadge key={day}>{day}</StatusBadge>)}</div>
      <dl className={styles.facts}><div><dt>Голоси</dt><dd>{card.votes}<small>Танки {card.tanks} · хіли {card.healers} · ДД {card.dps}</small></dd></div><div><dt>{card.deadlineCaption}</dt><dd>{card.remainingLabel}<small>{card.deadlineLabel}</small></dd></div><div><dt>Рекомендація</dt><dd>{card.recommendation}</dd></div></dl>
      {canManage ? <label className={styles.selection}><input type="checkbox" disabled={selectionDisabled} checked={selected} onChange={() => onToggle(card.id)} aria-label={`Вибрати «${card.title}»`} />Вибрати для спільної дії</label> : null}
    </div>
  </DataCard>;
}
