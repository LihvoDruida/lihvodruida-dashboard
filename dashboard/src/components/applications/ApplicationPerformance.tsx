import type { ApplicationItem } from "@/lib/applicationsStore";
import styles from "./applications-workspace.module.css";
function formatScore(value: unknown) {
  const num = Number(value);
  if (!Number.isFinite(num) || num <= 0) return "—";
  return Number.isInteger(num) ? String(num) : num.toFixed(1);
}


function MiniMetric({ label, value }: { label: string; value: string }) {
  return <span className={styles.metric}><strong>{value}</strong><small>{label}</small></span>;
}

function formatRaidName(raid: unknown): string | null {
  if (typeof raid === "string") {
    const value = raid.trim();
    return value || null;
  }

  if (raid && typeof raid === "object") {
    const item = raid as {
      name?: string;
      key?: string;
      summary?: string;
      mythic_bosses_killed?: number;
      heroic_bosses_killed?: number;
      normal_bosses_killed?: number;
      total_bosses?: number;
    };

    const baseName = item.name || item.key || "Raid";
    if (item.summary && item.summary.trim()) return `${baseName}: ${item.summary.trim()}`;

    const total = Number(item.total_bosses || 0) > 0 ? item.total_bosses : "?";
    const progress = [
      Number(item.mythic_bosses_killed || 0) > 0 ? `${item.mythic_bosses_killed}/${total} M` : "",
      Number(item.heroic_bosses_killed || 0) > 0 ? `${item.heroic_bosses_killed}/${total} H` : "",
      Number(item.normal_bosses_killed || 0) > 0 ? `${item.normal_bosses_killed}/${total} N` : "",
    ].filter(Boolean).join(" • ");

    return progress ? `${baseName}: ${progress}` : null;
  }

  return null;
}

function getRaidLines(raids: unknown[] | undefined): string[] {
  return (Array.isArray(raids) ? raids : [])
    .map(formatRaidName)
    .filter((value): value is string => Boolean(value));
}

function raidKey(raid: unknown, index: number): string {
  if (typeof raid === "string") return `${raid}-${index}`;

  if (raid && typeof raid === "object") {
    const item = raid as { key?: string; name?: string; summary?: string };
    return `${item.key || item.name || item.summary || "raid"}-${index}`;
  }

  return `raid-${index}`;
}

function getCharacterAvatarUrl(item: ApplicationItem): string | undefined {
  return item.avatar_url || item.raider_io?.thumbnail_url || undefined;
}

function getInitial(value?: string | null): string {
  return (value || "?").trim().charAt(0).toUpperCase() || "?";
}

export function CharacterAvatar({ item }: { item: ApplicationItem }) {
  const avatarUrl = getCharacterAvatarUrl(item);

  if (avatarUrl) {
    return <img className={styles.avatar} src={avatarUrl} alt="" loading="lazy" referrerPolicy="no-referrer" decoding="async" />;
  }

  return (
    <div className={styles.placeholder}>
      {getInitial(item.character_name || item.title)}
    </div>
  );
}

export default function RaiderIoPanel({ item }: { item: ApplicationItem }) {
  const rio = item.raider_io ?? null;
  const current = rio?.mythic_plus?.current || {};
  const previous = rio?.mythic_plus?.previous || {};
  const currentRaids = getRaidLines(rio?.raids?.current);
  const previousRaids = getRaidLines(rio?.raids?.previous);

  return (
    <div className={styles.stack}>
      <h4 className={styles.heading}>Raider.IO</h4>
      {(item.raider_io_error ?? null) ? <p className={styles.metadata}>Raider.IO тимчасово не відповів для цього персонажа.</p> : null}
      <div className={styles.facts}>
        <MiniMetric label="M+ зараз" value={formatScore(current.all)} />
        <MiniMetric label="Хіл" value={formatScore(current.healer)} />
        <MiniMetric label="DPS" value={formatScore(current.dps)} />
        <MiniMetric label="Танк" value={formatScore(current.tank)} />
        <MiniMetric label="M+ попередній" value={formatScore(previous.all)} />
      </div>
      <div className={styles.facts}>
        <div>
          <strong>Рейди зараз</strong>
          {currentRaids.length ? currentRaids.map((raid, index) => <span key={raidKey(raid, index)}>{raid}</span>) : <span>Дані відсутні</span>}
        </div>
        <div>
          <strong>Рейди раніше</strong>
          {previousRaids.length ? previousRaids.map((raid, index) => <span key={raidKey(raid, index)}>{raid}</span>) : <span>Дані відсутні</span>}
        </div>
      </div>
      {rio?.profile_url ? <a className="btn subtle" href={rio.profile_url} target="_blank" rel="noreferrer">Відкрити Raider.IO</a> : null}
    </div>
  );
}

