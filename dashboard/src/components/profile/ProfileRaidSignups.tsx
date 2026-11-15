import Link from "next/link";
import type { ProfileRaidSignup } from "@/lib/raids";
import { raidDisplayCapacity, raidAutoCompositionLabel, raidTitle, raidDifficultyLabel } from "@/lib/raids";
import { profileGenderedText } from "@/lib/profiles";
import { wowRoleLabel } from "@/lib/wowRoles";
import PageSection from "@/components/page/PageSection";
import DataGrid from "@/components/page/DataGrid";
import DataCard from "@/components/page/DataCard";
import EmptyState from "@/components/page/EmptyState";
import ErrorState from "@/components/page/ErrorState";
import PageRefreshButton from "@/components/page/PageRefreshButton";
import StatusBadge, { type StatusTone } from "@/components/page/StatusBadge";
import styles from "./profile-workspace.module.css";

function SignupCard({ item }: { item: ProfileRaidSignup }) {
  const status = item.signup.status;
  const label = status === "going" ? profileGenderedText(item.signup.grammaticalGender, "Підписаний", "Підписана", "Підписали")
    : status === "tentative" ? "50/50" : status === "late" ? "Затримаюсь" : "Пропускає";
  const tone: StatusTone = status === "going" ? "success" : status === "tentative" ? "warning" : status === "late" ? "info" : "neutral";
  const active = item.raid.signups.filter(signup => ["going", "tentative", "late"].includes(signup.status)).length;
  return <DataCard title={raidTitle(item.raid)} description={`${[item.raid.date, item.raid.time].filter(Boolean).join(", ") || "Дата уточнюється"} · ${raidDifficultyLabel(item.raid.difficulty)}`}
    badge={<StatusBadge tone={tone}>{label}</StatusBadge>}
    actions={<Link className="btn subtle" href={`/raids/${encodeURIComponent(item.raid.id)}`} prefetch={false}>Відкрити рейд</Link>}>
    <dl className={styles.facts}>
      <div><dt>Порядок запису</dt><dd>{item.signup.signupNumber ? `#${item.signup.signupNumber}` : "—"}</dd></div>
      <div><dt>Персонаж</dt><dd>{[item.signup.characterName || item.signup.discordName || "Без персонажа", item.signup.realmName || item.signup.realmSlug].filter(Boolean).join(" · ")}</dd></div>
      <div><dt>Роль і спеціалізація</dt><dd>{[wowRoleLabel(item.signup.role), item.signup.activeSpecName, item.signup.className].filter(Boolean).join(" · ")}</dd></div>
      <div><dt>Склад</dt><dd>{active} / {raidDisplayCapacity(item.raid)} · {raidAutoCompositionLabel(item.raid)}</dd></div>
    </dl>
  </DataCard>;
}
export default function ProfileRaidSignups({ items, unavailable = false }: { items: ProfileRaidSignup[]; unavailable?: boolean }) {
  const active = items.filter(item => ["going", "tentative", "late"].includes(item.signup.status));
  const skipped = items.filter(item => item.signup.status === "skipped");
  return <div id="profile-raids"><PageSection id="profile-raids-title" title="Рейдові записи" description="Поточні записи, роль і статус участі. Керування записом відбувається через Discord.">
    {unavailable ? <ErrorState title="Рейдові записи тимчасово недоступні" description="Не вдалося отримати записи. Спробуй оновити дані." actions={<PageRefreshButton />} />
      : active.length ? <DataGrid label="Поточні рейдові записи">{active.map(item => <SignupCard key={`${item.raid.id}-${item.signup.discordId}`} item={item} />)}</DataGrid>
      : <EmptyState title="Немає активних записів" description="Запис через Discord зʼявиться тут після збереження."
        actions={<Link href="/raids" className="btn subtle">Переглянути рейди</Link>} />}
    {skipped.length ? <details><summary>Пропущені рейди: {skipped.length}</summary><DataGrid label="Пропущені рейди">{skipped.map(item => <SignupCard key={`${item.raid.id}-${item.signup.discordId}`} item={item} />)}</DataGrid></details> : null}
  </PageSection></div>;
}
