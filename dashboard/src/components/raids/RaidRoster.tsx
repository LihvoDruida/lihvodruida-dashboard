import { pickWowAvatarImageUrl } from "@/lib/wowCharacters";

import { buildRaidGroupLayout, raidGroupLayoutSlotCounts, raidAutoComposition, raidDisplayCapacity, raidMinItemLevelWarning, raidMinItemLevelBlockMessage, raidBenchPriorityMatch, type RaidBenchPrioritySettings, type RaidCharacterRole, type RaidItem, type RaidParty, type RaidSignup } from "@/lib/raids";
import { RoleMarkerStack, raidPartyRoleLabel, signupSpecLabel } from "@/components/RaidSignupPresentation";

import Progress from "@/components/page/Progress";
import styles from "./raid-workspace.module.css";
function signupMarkers(
  item?: RaidSignup | null,
  options?: { hasItemLevelIssue?: boolean; isBenchPriority?: boolean },
) {
  if (!item) return "";
  return [
    options?.isBenchPriority ? "❌" : null,
    options?.hasItemLevelIssue ? "⚠️" : null,
    item.status === "tentative" ? "❓" : null,
    item.status === "late" ? "🕒" : null,
    item.verifiedGuild === false ? "🤝" : null,
  ]
    .filter(Boolean)
    .join(" ");
}

export function signupDisplayName(
  item?: RaidSignup | null,
  options?: {
    showItemLevel?: boolean;
    hasItemLevelIssue?: boolean;
    isBenchPriority?: boolean;
  },
) {
  if (!item) return "—";
  const name = item.characterName || item.discordName || "Гравець";
  const showItemLevel = options?.showItemLevel !== false;
  const markers = signupMarkers(item, {
    hasItemLevelIssue: options?.hasItemLevelIssue,
    isBenchPriority: options?.isBenchPriority,
  });
  const value =
    showItemLevel && item.itemLevel ? `${name} • ${item.itemLevel}` : name;
  return markers ? `${markers} ${value}` : value;
}

function shouldShowBenchPriorityMarker(
  item: RaidSignup | null | undefined,
  benchPriority: RaidBenchPrioritySettings | null | undefined,
  enabled: boolean,
) {
  return Boolean(
    enabled && item && raidBenchPriorityMatch(item, benchPriority).matched,
  );
}

function signupExtraLabel(item?: RaidSignup | null) {
  if (!item) return "";
  // Ручний запис не має ані рівня, ані раси — офіцеру важливо бачити,
  // що клас і спек вказані вручну, а не підтягнуті з Battle.net.
  const manualNote = isManualSignup(item) ? "Ручний запис" : null;
  return [
    typeof item.level === "number" ? `Lvl ${item.level}` : null,
    item.raceName || null,
    item.faction || null,
    item.guildName || null,
    manualNote,
  ]
    .filter(Boolean)
    .join(" • ");
}

/** Запис без персонажа Battle.net: клас і спек обрані вручну. */
function isManualSignup(item?: RaidSignup | null) {
  return Boolean(item && !item.characterKey && item.manualClassKey && item.manualSpecKey);
}

function signupAvatarUrl(item?: RaidSignup | null) {
  if (!item) return null;
  return pickWowAvatarImageUrl(item.avatarUrl, item.renderUrl, item.mediaUrl);
}

function SignupAvatar({ item }: { item?: RaidSignup | null }) {
  if (!item)
    return (
      <span
        className={styles.avatarFallback}
        aria-hidden="true"
      >
        —
      </span>
    );
  const image = signupAvatarUrl(item);
  if (image) {
    return (
      <img
        className={styles.avatar}
        src={image}
        alt=""
        loading="lazy"
        referrerPolicy="no-referrer" decoding="async" />
    );
  }
  return (
    <span
      className={styles.avatarFallback}
      aria-hidden="true"
    >
      {(item.characterName || item.discordName || "A").charAt(0)}
    </span>
  );
}

function RoleRow({
  label,
  item,
  role,
  minItemLevel,
  minItemLevelRequired,
  showItemLevel = true,
  isBenchPriority = false,
}: {
  label: string;
  item?: RaidSignup | null;
  role: RaidCharacterRole;
  minItemLevel?: number | null;
  minItemLevelRequired?: boolean | null;
  showItemLevel?: boolean;
  isBenchPriority?: boolean;
}) {
  const block =
    showItemLevel && item
      ? raidMinItemLevelBlockMessage(
          { minItemLevel, minItemLevelRequired },
          item,
        )
      : null;
  const warning =
    showItemLevel && item
      ? raidMinItemLevelWarning({ minItemLevel, minItemLevelRequired }, item)
      : null;
  const issue = block || warning;
  return (
    <div
      className={styles.memberRow} data-role={role} data-warning={Boolean(issue)} data-blocked={Boolean(block)}
      aria-label={`${label}: ${signupDisplayName(item, { showItemLevel, hasItemLevelIssue: Boolean(issue), isBenchPriority })}`}
    >
      <RoleMarkerStack item={item} role={role} />
      <SignupAvatar item={item} />
      <span className={styles.memberCopy}>
        <strong>
          {signupDisplayName(item, {
            showItemLevel,
            hasItemLevelIssue: Boolean(issue),
            isBenchPriority,
          })}
        </strong>
        {item ? <small>{signupSpecLabel(item)}</small> : null}
        {item ? <small>{signupExtraLabel(item)}</small> : null}
        {issue ? <small className={styles.warning}>{issue}</small> : null}
      </span>
    </div>
  );
}

export function PartyCard({
  party,
  minItemLevel,
  minItemLevelRequired,
  showItemLevel = true,
  benchPriority = null,
  showBenchPriorityMarkers = false,
}: {
  party: RaidParty;
  minItemLevel?: number | null;
  minItemLevelRequired?: boolean | null;
  showItemLevel?: boolean;
  benchPriority?: RaidBenchPrioritySettings | null;
  showBenchPriorityMarkers?: boolean;
}) {
  const hasMembers = party.members.length > 0;
  return (
    <article className={styles.party}>
      <h3>Паті {party.index}</h3>
      {party.tank ? (
        <RoleRow
          label="Танк"
          role="tank"
          item={party.tank}
          minItemLevel={minItemLevel}
          minItemLevelRequired={minItemLevelRequired}
          showItemLevel={showItemLevel}
          isBenchPriority={shouldShowBenchPriorityMarker(
            party.tank,
            benchPriority,
            showBenchPriorityMarkers,
          )}
        />
      ) : null}
      {party.healer ? (
        <RoleRow
          label="Хіл"
          role="healer"
          item={party.healer}
          minItemLevel={minItemLevel}
          minItemLevelRequired={minItemLevelRequired}
          showItemLevel={showItemLevel}
          isBenchPriority={shouldShowBenchPriorityMarker(
            party.healer,
            benchPriority,
            showBenchPriorityMarkers,
          )}
        />
      ) : null}
      {party.dps.length ? (
        party.dps.map((member, index) => (
          <RoleRow
            key={`${party.index}-${member.discordId}-${member.characterName || member.discordName}-${index}`}
            label={raidPartyRoleLabel(member.role)}
            role={member.role}
            item={member}
            minItemLevel={minItemLevel}
            minItemLevelRequired={minItemLevelRequired}
            showItemLevel={showItemLevel}
            isBenchPriority={shouldShowBenchPriorityMarker(
              member,
              benchPriority,
              showBenchPriorityMarkers,
            )}
          />
        ))
      ) : !hasMembers ? (
        <RoleRow
          label="ДД"
          role="dps"
          item={null}
          minItemLevel={minItemLevel}
          minItemLevelRequired={minItemLevelRequired}
          showItemLevel={showItemLevel}
        />
      ) : null}
    </article>
  );
}

export function BenchCard({
  members,
  minItemLevel,
  minItemLevelRequired,
  showItemLevel = true,
  benchPriority = null,
  showBenchPriorityMarkers = false,
}: {
  members: RaidSignup[];
  minItemLevel?: number | null;
  minItemLevelRequired?: boolean | null;
  showItemLevel?: boolean;
  benchPriority?: RaidBenchPrioritySettings | null;
  showBenchPriorityMarkers?: boolean;
}) {
  if (!members.length) return null;
  return (
    <article className={styles.bench}>
      <h3>🪑 Лава запасних</h3>
      <div className={styles.benchMembers}>
        {members.map((member, index) => (
          <RoleRow
            key={`bench-${member.discordId}-${member.characterName || member.discordName}-${index}`}
            label={raidPartyRoleLabel(member.role)}
            role={member.role}
            item={member}
            minItemLevel={minItemLevel}
            minItemLevelRequired={minItemLevelRequired}
            showItemLevel={showItemLevel}
            isBenchPriority={shouldShowBenchPriorityMarker(
              member,
              benchPriority,
              showBenchPriorityMarkers,
            )}
          />
        ))}
      </div>
    </article>
  );
}

function RosterBlock({
  title,
  items,
  empty = "Поки порожньо",
  showItemLevel = true,
  minItemLevel,
  minItemLevelRequired,
  benchPriority = null,
  showBenchPriorityMarkers = false,
}: {
  title: string;
  items: RaidSignup[];
  empty?: string;
  showItemLevel?: boolean;
  minItemLevel?: number | null;
  minItemLevelRequired?: boolean | null;
  benchPriority?: RaidBenchPrioritySettings | null;
  showBenchPriorityMarkers?: boolean;
}) {
  return (
    <div className={styles.rosterBlock}>
      <h4>{title}</h4>
      {items.length ? (
        items.map((item) => {
          const issue = showItemLevel
            ? raidMinItemLevelBlockMessage(
                { minItemLevel, minItemLevelRequired },
                item,
              ) ||
              raidMinItemLevelWarning(
                { minItemLevel, minItemLevelRequired },
                item,
              )
            : null;
          const isBenchPriority = shouldShowBenchPriorityMarker(
            item,
            benchPriority,
            showBenchPriorityMarkers,
          );
          return (
            <div
              className={styles.memberRow} data-warning={Boolean(issue)} data-bench-priority={isBenchPriority}
              key={`${title}-${item.discordId}`}
            >
              <RoleMarkerStack
                item={item}
                role={item.role}
                iconClassName="raid-roster-role-icon"
              />
              <SignupAvatar item={item} />
              <span className={styles.memberCopy}>
                <strong>
                  {signupDisplayName(item, {
                    showItemLevel,
                    hasItemLevelIssue: Boolean(issue),
                    isBenchPriority,
                  })}
                </strong>
                <small>{signupSpecLabel(item) || item.discordName}</small>
                {signupExtraLabel(item) ? (
                  <small>{signupExtraLabel(item)}</small>
                ) : null}
              </span>
            </div>
          );
        })
      ) : (
        <p>{empty}</p>
      )}
    </div>
  );
}

export function RosterSideList({
  raid,
  showItemLevel = true,
  showBenchPriorityMarkers = true,
}: {
  raid: RaidItem;
  showItemLevel?: boolean;
  showBenchPriorityMarkers?: boolean;
}) {
  const composition = raidAutoComposition(raid);
  const grouped = {
    tanks: raid.signups.filter(
      (item) => item.status !== "skipped" && item.role === "tank",
    ),
    healers: raid.signups.filter(
      (item) => item.status !== "skipped" && item.role === "healer",
    ),
    dps: raid.signups.filter(
      (item) => item.status !== "skipped" && item.role === "dps",
    ),
    tentative: raid.signups.filter((item) => item.status === "tentative"),
    late: raid.signups.filter((item) => item.status === "late"),
    skipped: raid.signups.filter((item) => item.status === "skipped"),
  };
  const layout = buildRaidGroupLayout(raid);
  const layoutCounts = raidGroupLayoutSlotCounts(layout);
  const layoutCapacity = layout.targetSize || raidDisplayCapacity(raid);
  const fillPercent = Math.min(
    100,
    Math.round((layoutCounts.roster / Math.max(1, layoutCapacity)) * 100),
  );
  const benchCount = layout.bench.members.length;
  return (
    <div className={styles.rosterPanel}>
      <div className={styles.rosterHeading}>
        <div>
          <strong>Склад рейду</strong>
          <small>{fillPercent}% основи заповнено</small>
        </div>
        <span>
          {layoutCounts.roster} / {layoutCapacity}
        </span>
      </div>
      <Progress value={layoutCounts.roster} max={layoutCapacity} label={`Заповнення складу ${layoutCounts.roster} з ${layoutCapacity}`} />
      <div className={styles.roles} aria-label="Ролі у складі">
        <span className={styles.tank}>🛡 {layoutCounts.tanks}/{composition.tanks}</span>
        <span className={styles.healer}>✚ {layoutCounts.healers}/{composition.healers}</span>
        <span className={styles.dps}>⚔ {layoutCounts.dps}/{composition.dps}</span>
        {benchCount ? <span className={styles.metadata}>Лава {benchCount}</span> : null}
      </div>
      <RosterBlock
        title={`Танки (${grouped.tanks.length}/${composition.tanks})`}
        items={grouped.tanks}
        showItemLevel={showItemLevel}
        minItemLevel={raid.minItemLevel}
        minItemLevelRequired={raid.minItemLevelRequired}
        benchPriority={raid.benchPriority || null}
        showBenchPriorityMarkers={showBenchPriorityMarkers}
      />
      <RosterBlock
        title={`Хіли (${grouped.healers.length}/${composition.healers})`}
        items={grouped.healers}
        showItemLevel={showItemLevel}
        minItemLevel={raid.minItemLevel}
        minItemLevelRequired={raid.minItemLevelRequired}
        benchPriority={raid.benchPriority || null}
        showBenchPriorityMarkers={showBenchPriorityMarkers}
      />
      <RosterBlock
        title={`ДД (${grouped.dps.length}/${composition.dps})`}
        items={grouped.dps}
        showItemLevel={showItemLevel}
        minItemLevel={raid.minItemLevel}
        minItemLevelRequired={raid.minItemLevelRequired}
        benchPriority={raid.benchPriority || null}
        showBenchPriorityMarkers={showBenchPriorityMarkers}
      />
      {grouped.tentative.length ? (
        <RosterBlock
          title={`50/50 (${grouped.tentative.length})`}
          items={grouped.tentative}
          showItemLevel={showItemLevel}
          minItemLevel={raid.minItemLevel}
          minItemLevelRequired={raid.minItemLevelRequired}
          benchPriority={raid.benchPriority || null}
          showBenchPriorityMarkers={showBenchPriorityMarkers}
        />
      ) : null}
      {grouped.late.length ? (
        <RosterBlock
          title={`Затримаюсь (${grouped.late.length})`}
          items={grouped.late}
          showItemLevel={showItemLevel}
          minItemLevel={raid.minItemLevel}
          minItemLevelRequired={raid.minItemLevelRequired}
          benchPriority={raid.benchPriority || null}
          showBenchPriorityMarkers={showBenchPriorityMarkers}
        />
      ) : null}
      {grouped.skipped.length ? (
        <RosterBlock
          title={`Пропускають (${grouped.skipped.length})`}
          items={grouped.skipped}
          showItemLevel={showItemLevel}
          minItemLevel={raid.minItemLevel}
          minItemLevelRequired={raid.minItemLevelRequired}
          benchPriority={raid.benchPriority || null}
          showBenchPriorityMarkers={showBenchPriorityMarkers}
        />
      ) : null}
    </div>
  );
}

