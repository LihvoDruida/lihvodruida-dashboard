import type { ReactNode } from "react";
import DashboardIdentity from "@/components/DashboardIdentity";
import HeroSidePanel from "@/components/HeroSidePanel";
import RaidAttendanceClient, {
  type RaidSignupCharacterOption,
} from "@/components/RaidAttendanceClient";
import RaidRoleMentionPicker from "@/components/RaidRoleMentionPicker";
import RaidImagePicker from "@/components/RaidImagePicker";
import type { DiscordRoleOption } from "@/components/DiscordEmbedEditor";
import { DiscordMarkdown } from "@/components/DiscordMarkdown";
import type { DashboardSession } from "@/lib/auth";
import type { DashboardProfile } from "@/lib/profiles";
import { hierarchyTitle } from "@/lib/permissions";
import { pickWowAvatarImageUrl } from "@/lib/wowCharacters";
import {
  buildRaidGroupLayout,
  raidGroupLayoutSlotCounts,
  isRaidClosed,
  isRaidRegistrationFull,
  raidAutoComposition,
  raidAutoCompositionLabel,
  raidAverageItemLevel,
  raidDisplayCapacity,
  dashboardRaidRulesUrl,
  isRaidRegistrationLocked,
  raidRegistrationLimit,
  raidRegistrationLockSummary,
  raidConsumablesLabel,
  raidLootLabel,
  raidTitle,
  resolveRaidThumbnailUrl,
  raidMinItemLevelWarning,
  raidMinItemLevelBlockMessage,
  raidSignupCharacterMinimumNote,
  isRaidSubjectBlockedByMinItemLevel,
  isRaidSubjectWarnedByMinItemLevel,
  raidBenchPriorityMatch,
  type RaidBenchPrioritySettings,
  type RaidCharacterRole,
  type RaidItem,
  type RaidParty,
  type RaidSignup,
} from "@/lib/raids";

export type RaidChannelOption = { id: string; name: string };
export type RaidRoleOption = DiscordRoleOption;

export function todayIso() {
  return new Date().toISOString().slice(0, 10);
}

export function formatRaidDateTime(date?: string | null, time?: string | null) {
  if (!date && !time) return "Дата уточнюється";
  return [date || "Дата уточнюється", time || ""].filter(Boolean).join(", ");
}

export function attendanceStatusLabel(action?: string) {
  if (action === "skipped") return "Позначено, що ти пропускаєш рейд.";
  if (action === "late")
    return "Записано: ти затримаєшся. Склад рейду оновлено.";
  if (action === "tentative")
    return "Записано 50/50. За потреби цей запис піде в лаву запасних після сірого списку.";
  if (action === "going") return "Тебе записали на рейд. Склад рейду оновлено.";
  return "Дію виконано.";
}

export function StatusNotice({
  params: _params,
}: {
  params: Record<string, string | undefined>;
}) {
  return null;
}

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

function signupSpecLabel(item?: RaidSignup | null) {
  if (!item) return "";
  const spec = item.activeSpecName
    ? `${item.activeSpecName}${item.className ? ` • ${item.className}` : ""}`
    : item.className || "";
  const guildLabel = item.verifiedGuild === false ? "Інший персонаж" : "";
  return [spec, guildLabel].filter(Boolean).join(" • ");
}

function signupExtraLabel(item?: RaidSignup | null) {
  if (!item) return "";
  return [
    typeof item.level === "number" ? `Lvl ${item.level}` : null,
    item.raceName || null,
    item.faction || null,
    item.guildName || null,
  ]
    .filter(Boolean)
    .join(" • ");
}

function signupAvatarUrl(item?: RaidSignup | null) {
  if (!item) return null;
  return pickWowAvatarImageUrl(item.avatarUrl, item.renderUrl, item.mediaUrl);
}

function SignupAvatar({ item }: { item?: RaidSignup | null }) {
  if (!item)
    return (
      <span
        className="raid-signup-avatar raid-signup-avatar--empty"
        aria-hidden="true"
      >
        —
      </span>
    );
  const image = signupAvatarUrl(item);
  if (image) {
    return (
      <img
        className="raid-signup-avatar"
        src={image}
        alt=""
        loading="lazy"
        referrerPolicy="no-referrer"
      />
    );
  }
  return (
    <span
      className="raid-signup-avatar raid-signup-avatar--empty"
      aria-hidden="true"
    >
      {(item.characterName || item.discordName || "A").charAt(0)}
    </span>
  );
}

function SignupNumberBadge({
  item,
}: {
  item?: Pick<RaidSignup, "signupNumber"> | null;
}) {
  const number = Number(item?.signupNumber || 0);
  const hasNumber = Number.isFinite(number) && number > 0;
  const label = hasNumber ? `${Math.floor(number)}` : "";
  const title = hasNumber
    ? `Порядковий номер запису: ${Math.floor(number)}`
    : "Місце ще не зайняте";
  return (
    <span
      className={`raid-signup-order${label ? "" : " raid-signup-order--empty"}`}
      title={title}
    >
      {label}
    </span>
  );
}



function RoleMarkerStack({
  item,
  role,
  iconClassName = "raid-role-icon",
}: {
  item?: Pick<RaidSignup, "signupNumber"> | null;
  role: RaidCharacterRole;
  iconClassName?: string;
}) {
  return (
    <span className="raid-signup-side" aria-hidden="true">
      <SignupNumberBadge item={item} />
      <span className={iconClassName}>
        {role === "tank" ? "🛡" : role === "healer" ? "✚" : "⚔"}
      </span>
    </span>
  );
}

function raidStatusLabel(raid: RaidItem) {
  if (isRaidClosed(raid)) return "Закрито";
  return raid.status === "published" ? "Опубліковано" : "Чернетка";
}

function raidStatusClass(raid: RaidItem) {
  if (isRaidClosed(raid)) return "closed";
  return raid.status;
}

function raidPartyRoleLabel(role: RaidCharacterRole) {
  if (role === "tank") return "Танк";
  if (role === "healer") return "Хіл";
  return "ДД";
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
      className={`raid-party-row raid-party-row--${role}${item?.status === "late" ? " is-late" : ""}${item?.verifiedGuild === false ? " is-non-guild" : ""}${issue ? " is-undergeared" : ""}${block ? " is-blocked" : ""}`}
      aria-label={`${label}: ${signupDisplayName(item, { showItemLevel, hasItemLevelIssue: Boolean(issue), isBenchPriority })}`}
    >
      <RoleMarkerStack item={item} role={role} />
      <SignupAvatar item={item} />
      <span className="raid-party-member-copy">
        <strong>
          {signupDisplayName(item, {
            showItemLevel,
            hasItemLevelIssue: Boolean(issue),
            isBenchPriority,
          })}
        </strong>
        {item ? <small>{signupSpecLabel(item)}</small> : null}
        {item ? <small>{signupExtraLabel(item)}</small> : null}
        {issue ? <small className="raid-ilvl-warning">{issue}</small> : null}
      </span>
    </div>
  );
}

function PartyCard({
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
    <article className="raid-party-card">
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

function BenchCard({
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
    <article className="raid-party-card raid-bench-card">
      <h3>🪑 Лава запасних</h3>
      <div className="raid-bench-members">
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
    <div className="raid-roster-block">
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
              className={`raid-roster-member${item.verifiedGuild === false ? " is-non-guild" : ""}${issue ? " is-undergeared" : ""}${isBenchPriority ? " is-bench-priority" : ""}`}
              key={`${title}-${item.discordId}`}
            >
              <RoleMarkerStack
                item={item}
                role={item.role}
                iconClassName="raid-roster-role-icon"
              />
              <SignupAvatar item={item} />
              <span className="raid-roster-member-copy">
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
  return (
    <aside className="raid-roster-panel panel">
      <div className="raid-roster-heading">
        <strong>Хто йде</strong>
        <span>
          {layoutCounts.roster} / {layoutCapacity}
        </span>
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
      <RosterBlock
        title={`50/50 / невпевнені (${grouped.tentative.length})`}
        items={grouped.tentative}
        empty="—"
        showItemLevel={showItemLevel}
        minItemLevel={raid.minItemLevel}
        minItemLevelRequired={raid.minItemLevelRequired}
        benchPriority={raid.benchPriority || null}
        showBenchPriorityMarkers={showBenchPriorityMarkers}
      />
      <RosterBlock
        title={`Затримаюсь (${grouped.late.length})`}
        items={grouped.late}
        empty="—"
        showItemLevel={showItemLevel}
        minItemLevel={raid.minItemLevel}
        minItemLevelRequired={raid.minItemLevelRequired}
        benchPriority={raid.benchPriority || null}
        showBenchPriorityMarkers={showBenchPriorityMarkers}
      />
      <RosterBlock
        title={`Пропускають (${grouped.skipped.length})`}
        items={grouped.skipped}
        empty="—"
        showItemLevel={showItemLevel}
        minItemLevel={raid.minItemLevel}
        minItemLevelRequired={raid.minItemLevelRequired}
        benchPriority={raid.benchPriority || null}
        showBenchPriorityMarkers={showBenchPriorityMarkers}
      />
    </aside>
  );
}

function characterSignupOption(
  character: DashboardProfile["characters"][number],
  raid: Pick<RaidItem, "minItemLevel" | "minItemLevelRequired">,
): RaidSignupCharacterOption {
  const realm = character.realmName || character.realmSlug || "realm";
  const warningPrefix = isRaidSubjectWarnedByMinItemLevel(raid, character)
    ? "⚠️ "
    : "";
  const guildPrefix = character.verifiedGuild ? "" : "🤝 ";
  const minimumNote = raidSignupCharacterMinimumNote(raid, character);
  const meta = [
    minimumNote || null,
    character.verifiedGuild ? "Гільдійний" : "Інший персонаж",
    character.activeSpecName || null,
    character.className || null,
    character.itemLevel ? `${character.itemLevel} ilvl` : null,
  ]
    .filter(Boolean)
    .join(" • ");
  return {
    key: character.key,
    label: `${warningPrefix}${guildPrefix}${character.name} • ${realm}`,
    meta,
  };
}

export function RaidAttendanceActions({
  raid,
  user,
  profile = null,
  hasMainCharacter = null,
}: {
  raid: RaidItem;
  user?: DashboardSession | null;
  profile?: DashboardProfile | null;
  hasMainCharacter?: boolean | null;
}) {
  const closed = isRaidClosed(raid) || raid.status !== "published";
  const attendanceLayout = buildRaidGroupLayout(raid);
  const attendanceCounts = raidGroupLayoutSlotCounts(attendanceLayout);
  const attendanceCapacity = attendanceLayout.targetSize || raidDisplayCapacity(raid);
  const mainRosterFull = Boolean(
    raidRegistrationLimit(raid) && attendanceCounts.roster >= attendanceCapacity,
  );
  const newSignupWouldStartOnBench = isRaidRegistrationFull(raid);
  const registrationLocked = isRaidRegistrationLocked(raid);
  const registrationLock = raidRegistrationLockSummary(raid);
  const viewerDiscordId =
    user?.provider === "discord" && /^\d{16,25}$/.test(user.id) ? user.id : "";
  const viewerSignup = viewerDiscordId
    ? raid.signups.find((item) => item.discordId === viewerDiscordId)
    : null;
  const viewerAlreadyActive =
    viewerSignup?.status === "going" ||
    viewerSignup?.status === "tentative" ||
    viewerSignup?.status === "late";
  const allCharacters = profile?.characters || [];
  const characterOptions = allCharacters
    .filter((character) => !isRaidSubjectBlockedByMinItemLevel(raid, character))
    .map((character) => characterSignupOption(character, raid));
  const selectedCharacterKey = viewerSignup?.characterKey || "";
  const hiddenByMinItemLevel = Math.max(
    0,
    allCharacters.length - characterOptions.length,
  );
  const hasAnyCharacter = characterOptions.length > 0;
  const needsLogin = !user;
  const needsDiscordLogin = Boolean(user && !viewerDiscordId);
  const needsEligibleCharacter = Boolean(
    viewerDiscordId &&
    allCharacters.length > 0 &&
    !characterOptions.length &&
    raid.minItemLevelRequired &&
    raid.minItemLevel,
  );
  const needsCharacter = Boolean(viewerDiscordId && !hasAnyCharacter);
  const canSubmitAnyAction = Boolean(user && viewerDiscordId);
  const activeJoinDisabled =
    closed ||
    registrationLocked ||
    needsLogin ||
    needsDiscordLogin ||
    needsCharacter;
  const skipDisabled = closed || !canSubmitAnyAction;
  const title = closed
    ? "Запис на цей рейд уже вимкнено."
    : registrationLocked
      ? "Запис і зміна персонажа вже заблоковані за дедлайном рейду."
      : needsLogin
        ? "Спочатку увійди через Discord."
        : needsDiscordLogin
          ? "Для запису потрібен Discord-вхід."
          : needsEligibleCharacter
            ? `Немає персонажа з мінімальним item level ${raid.minItemLevel}. Персонажі нижче порогу приховані.`
            : needsCharacter
              ? "Спочатку додай хоча б одного персонажа Battle.net у профілі."
              : newSignupWouldStartOnBench && !viewerAlreadyActive
                ? "Основний склад заповнений. Новий запис піде в лаву запасних, якщо місця в основі не звільняться."
                : undefined;
  const showRequirement = needsLogin || needsDiscordLogin || needsCharacter;
  const requirementTitle =
    needsLogin || needsDiscordLogin
      ? "Потрібна авторизація"
      : needsEligibleCharacter
        ? "Немає доступного персонажа"
        : "Потрібен персонаж";
  const requirementMessage =
    needsLogin || needsDiscordLogin
      ? "Щоб підписатися на рейд, увійди через Discord. Після входу додай персонажа Battle.net у профілі."
      : needsEligibleCharacter
        ? `Для цього рейду потрібен мінімум ${raid.minItemLevel} ilvl. Персонажі нижче порогу приховані, бо увімкнено блокування запису.`
        : "Запис на рейд бере роль, item level і нік із вибраного персонажа. Додай персонажа Battle.net у профілі та повтори запис.";
  return (
    <RaidAttendanceClient
      raidId={raid.id}
      closed={closed}
      full={newSignupWouldStartOnBench}
      viewerAlreadyActive={Boolean(viewerAlreadyActive)}
      activeJoinDisabled={activeJoinDisabled}
      skipDisabled={skipDisabled}
      registrationLocked={registrationLocked}
      registrationLockMessage={
        registrationLock.enabled
          ? `${registrationLock.label}. ${registrationLock.detail}`
          : ""
      }
      showRequirement={showRequirement}
      requirementTitle={requirementTitle}
      requirementMessage={requirementMessage}
      loginHref={`/login?next=${encodeURIComponent(`/raids/${raid.id}`)}&error=session_required`}
      profileHref="/profile"
      rulesHref={dashboardRaidRulesUrl()}
      characterOptions={characterOptions}
      selectedCharacterKey={selectedCharacterKey}
      title={
        hiddenByMinItemLevel > 0 && !needsEligibleCharacter
          ? `${hiddenByMinItemLevel} персонаж(ів) нижче мінімального ilvl приховано.`
          : title
      }
    />
  );
}

export function RaidManageActions({ raid }: { raid: RaidItem }) {
  const closed = isRaidClosed(raid);
  return (
    <div className="raid-manage-actions">
      <a
        className="btn subtle btn-sm"
        href={`/raids/${encodeURIComponent(raid.id)}/edit`}
      >
        Редагувати
      </a>
      {!closed && raid.status !== "draft" ? (
        <form
          action={`/api/raids/${encodeURIComponent(raid.id)}/close`}
          method="post"
        >
          <button className="btn warning btn-sm" type="submit">
            Закрити
          </button>
        </form>
      ) : null}
      <form
        action={`/api/raids/${encodeURIComponent(raid.id)}/delete`}
        method="post"
        data-confirm-message={
          raid.status === "draft"
            ? "Видалити чернетку рейду?"
            : "Видалити рейд із панелі? Повʼязане Discord-повідомлення також буде прибране, якщо це можливо."
        }
      >
        <button className="btn danger btn-sm" type="submit">
          {raid.status === "draft" ? "Видалити чернетку" : "Видалити рейд"}
        </button>
      </form>
    </div>
  );
}

export function RaidAnnouncementPreview({
  raid,
  actions,
  manageActions,
  showRosterDetails = true,
  showMemberItemLevels = true,
  showBenchPriorityMarkers = showMemberItemLevels,
}: {
  raid: RaidItem;
  actions?: ReactNode;
  manageActions?: ReactNode;
  showRosterDetails?: boolean;
  showMemberItemLevels?: boolean;
  showBenchPriorityMarkers?: boolean;
}) {
  const averageItemLevel = raidAverageItemLevel(raid);
  const layout = buildRaidGroupLayout(raid);
  const layoutCounts = raidGroupLayoutSlotCounts(layout);
  const layoutCapacity = layout.targetSize || raidDisplayCapacity(raid);
  const parties = layout.parties;
  const oddParties = parties.filter((party) => party.index % 2 === 1);
  const evenParties = parties.filter((party) => party.index % 2 === 0);
  const bench = layout.bench;
  const compositionWarnings = layout.warnings;
  const closed = isRaidClosed(raid);
  const mainRosterFull = Boolean(
    raidRegistrationLimit(raid) && layoutCounts.roster >= layoutCapacity,
  );
  const registrationLock = raidRegistrationLockSummary(raid);
  return (
    <section
      className={`panel raid-preview-card${closed ? " is-closed" : ""}`}
      aria-label="Оголошення рейду"
    >
      <div className="raid-preview-accent" aria-hidden="true" />
      <div className="raid-preview-head">
        {
          <img
            src={resolveRaidThumbnailUrl(raid)}
            alt=""
            width={74}
            height={74}
            referrerPolicy="no-referrer"
          />
        }
        <div>
          <div className="raid-preview-title-row">
            <h2>{raidTitle(raid)}</h2>
            {manageActions ? (
              <div className="raid-preview-manage-actions">{manageActions}</div>
            ) : null}
          </div>
          <div className="raid-description-markdown">
            <DiscordMarkdown value={raid.description} />
          </div>
          {closed ? (
            <div className="raid-closed-banner">
              🔒 Рейд закрито. Запис і Discord-кнопки неактивні.
            </div>
          ) : null}
        </div>
      </div>
      <div className="raid-preview-meta">
        <span>
          <strong>📌 Статус</strong>
          {raidStatusLabel(raid)}
        </span>
        <span>
          <strong>📅 Дата</strong>
          {formatRaidDateTime(raid.date, raid.time)}
        </span>
        <span>
          <strong>👤 Створив</strong>
          {raid.createdByName}
          {raid.createdByMain ? (
            <small>Мейн: {raid.createdByMain}</small>
          ) : null}
        </span>
        {raid.raidLeaderName ? (
          <span>
            <strong>🧭 РЛ</strong>
            {raid.raidLeaderName}
          </span>
        ) : null}
        <span>
          <strong>🧪 Розхідники</strong>
          {raidConsumablesLabel(raid.consumables)}
        </span>
        <span>
          <strong>🎁 Лут</strong>
          {raidLootLabel(raid.lootMode)}
        </span>
        {showRosterDetails && raid.minItemLevel ? (
          <span>
            <strong>👙 Мін. ilvl</strong>
            {raid.minItemLevel}
            <small>
              {raid.minItemLevelRequired
                ? "Блокує запис нижче порогу"
                : "Лише попередження"}
            </small>
          </span>
        ) : null}
        {showRosterDetails && averageItemLevel ? (
          <span>
            <strong>📊 Середній ilvl</strong>
            {averageItemLevel}
            <small>За активними учасниками рейду</small>
          </span>
        ) : null}
        <span>
          <strong>👥 Записано</strong>
          {layoutCounts.roster} / {layoutCapacity}
          <small>
            {raid.maxPlayers
              ? `Основний склад: ${raid.maxPlayers} • схема ${raidAutoCompositionLabel(raid)}`
              : raidAutoCompositionLabel(raid)}
          </small>
        </span>
        {registrationLock.enabled ? (
          <span>
            <strong>🔐 Дедлайн запису</strong>
            {registrationLock.label}
            <small>{registrationLock.detail}</small>
          </span>
        ) : null}
      </div>
      {showRosterDetails && raid.minItemLevel ? (
        <div className="raid-ilvl-notice">
          👙 Мінімальний ilvl для цього рейду:{" "}
          <strong>{raid.minItemLevel}</strong>.{" "}
          {raid.minItemLevelRequired
            ? "Якщо персонаж нижче порогу, система заблокує запис."
            : "Якщо персонаж нижче порогу, система покаже попередження, але не блокує запис."}
        </div>
      ) : null}
      {raidRegistrationLimit(raid) ? (
        <div className="raid-ilvl-notice">
          👥 Основний склад для цього рейду:{" "}
          <strong>{raidRegistrationLimit(raid)}</strong>.{" "}
          {mainRosterFull
            ? "Основний склад заповнений — наступні активні записи будуть відображені в лаві запасних."
            : "Після заповнення основного складу нові активні записи підуть у лаву запасних, а не будуть заблоковані."}
        </div>
      ) : null}
      {registrationLock.enabled ? (
        <div
          className={`raid-ilvl-notice${registrationLock.locked ? " is-blocked" : ""}`}
        >
          🔐 Блокування запису: <strong>{registrationLock.label}</strong>.{" "}
          {registrationLock.locked
            ? "Запис і зміна персонажа вже недоступні."
            : registrationLock.detail}
        </div>
      ) : null}
      {showRosterDetails && compositionWarnings.length ? (
        <div className="raid-ilvl-notice is-warning">
          ⚠️ Валідація складу: {compositionWarnings.join(" • ")}
        </div>
      ) : null}
      {actions || (
        <div
          className={`raid-preview-buttons${closed ? " is-disabled" : ""}`}
          aria-hidden="true"
        >
          <span className="raid-action raid-action--go">✓ Підписатися</span>
          <span className="raid-action raid-action--maybe">❓ 50/50</span>
          <span className="raid-action raid-action--skip">↩ Пропустити</span>
          <span className="raid-action raid-action--late">🕒 Затримаюсь</span>
        </div>
      )}
      {showRosterDetails ? (
        <>
          <div className="raid-preview-roster-head">
            <div>
              <strong>Склад рейду</strong>
              <p>
                Паті будуються динамічно: максимум 2 танки на рейд, хіли
                масштабуються від кількості паті, ДД добираються за критичними
                бафами та балансом мілі/рендж. Якщо основний склад заповнено,
                зайві танки/хіли/ДД переходять у лаву запасних.
              </p>
            </div>
          </div>
          <div className="raid-party-grid">
            <div className="raid-party-layout">
              <div className="raid-party-columns">
                <div className="raid-party-column">
                  {oddParties.map((party) => (
                    <PartyCard
                      key={party.index}
                      party={party}
                      minItemLevel={raid.minItemLevel}
                      minItemLevelRequired={raid.minItemLevelRequired}
                      showItemLevel={showMemberItemLevels}
                      benchPriority={raid.benchPriority || null}
                      showBenchPriorityMarkers={showBenchPriorityMarkers}
                    />
                  ))}
                </div>
                <div className="raid-party-column">
                  {evenParties.map((party) => (
                    <PartyCard
                      key={party.index}
                      party={party}
                      minItemLevel={raid.minItemLevel}
                      minItemLevelRequired={raid.minItemLevelRequired}
                      showItemLevel={showMemberItemLevels}
                      benchPriority={raid.benchPriority || null}
                      showBenchPriorityMarkers={showBenchPriorityMarkers}
                    />
                  ))}
                </div>
              </div>
              <BenchCard
                members={bench.members}
                minItemLevel={raid.minItemLevel}
                minItemLevelRequired={raid.minItemLevelRequired}
                showItemLevel={showMemberItemLevels}
                benchPriority={raid.benchPriority || null}
                showBenchPriorityMarkers={showBenchPriorityMarkers}
              />
            </div>
          </div>
        </>
      ) : (
        <div className="raid-member-roster-note">
          <strong>Склад формують офіцери</strong>
          <span>
            Ти можеш записатися, обрати 50/50, пропустити рейд або позначити запізнення.
            Детальний розподіл паті видно офіцерам.
          </span>
        </div>
      )}
    </section>
  );
}

export function RaidListCard({
  raid,
  canManage = true,
}: {
  raid: RaidItem;
  canManage?: boolean;
}) {
  const averageItemLevel = raidAverageItemLevel(raid);
  const layout = buildRaidGroupLayout(raid);
  const layoutCounts = raidGroupLayoutSlotCounts(layout);
  const statusClass = raidStatusClass(raid);
  const capacity = layout.targetSize || raidDisplayCapacity(raid);
  const closed = isRaidClosed(raid);
  const registrationLock = raidRegistrationLockSummary(raid);
  return (
    <article className={`raid-list-item dashboard-list-row raid-list-item--${statusClass}`}>
      <a
        className="raid-list-main-link"
        href={`/raids/${encodeURIComponent(raid.id)}`}
        aria-label={`Відкрити рейд ${raidTitle(raid)}`}
      >
        {
          <img
            src={resolveRaidThumbnailUrl(raid)}
            alt=""
            width={86}
            height={86}
            loading="lazy"
            referrerPolicy="no-referrer"
          />
        }
        <span className="raid-list-copy">
          <span className="raid-list-title-row">
            <strong>{raidTitle(raid)}</strong>
            <em className={`raid-state raid-state--${statusClass}`}>
              {raidStatusLabel(raid)}
            </em>
          </span>
          <span className="raid-list-facts">
            <small>Дата: {formatRaidDateTime(raid.date, raid.time)}</small>
            <small>Склад: {layoutCounts.roster} / {capacity}</small>
            <small>Тип: {raidAutoCompositionLabel(raid)}</small>
            {raid.raidLeaderName ? <small>РЛ: {raid.raidLeaderName}</small> : null}
            {raid.minItemLevel ? <small>Мін. ilvl: {raid.minItemLevel}</small> : null}
            {averageItemLevel ? <small>Сер. ilvl: {averageItemLevel}</small> : null}
            {registrationLock.enabled ? <small>Запис: {registrationLock.label}</small> : null}
          </span>
          <span
            className="raid-list-progress"
            aria-label={`Заповнення рейду ${layoutCounts.roster} з ${capacity}`}
          >
            <span
              style={{
                width: `${Math.min(100, Math.round((layoutCounts.roster / Math.max(1, capacity)) * 100))}%`,
              }}
            />
          </span>
        </span>
      </a>
      <div
        className="raid-list-actions dashboard-list-actions"
        aria-label={canManage ? "Керування рейдом" : "Дії рейду"}
      >
        <a
          className="btn subtle btn-sm raid-list-action-open"
          href={`/raids/${encodeURIComponent(raid.id)}`}
        >
          Відкрити
        </a>
        {canManage ? (
          <>
            <div className="raid-list-action-tools" aria-label="Швидкі дії рейду">
              <a
                className="btn subtle btn-sm raid-list-icon-action raid-list-icon-action--edit"
                href={`/raids/${encodeURIComponent(raid.id)}/edit`}
                aria-label={`Редагувати рейд ${raidTitle(raid)}`}
                title="Редагувати"
              >
                <span aria-hidden="true">✎</span>
              </a>
              <form
                action={`/api/raids/${encodeURIComponent(raid.id)}/delete`}
                method="post"
                data-confirm-message={
                  raid.status === "draft"
                    ? "Видалити чернетку рейду?"
                    : "Видалити рейд із панелі? Повʼязане Discord-повідомлення також буде прибране, якщо це можливо."
                }
              >
                <button
                  className="btn danger btn-sm raid-list-icon-action raid-list-icon-action--delete"
                  type="submit"
                  aria-label={raid.status === "draft" ? `Видалити чернетку ${raidTitle(raid)}` : `Видалити рейд ${raidTitle(raid)}`}
                  title="Видалити"
                >
                  <span aria-hidden="true">×</span>
                </button>
              </form>
            </div>
            {!closed && raid.status !== "draft" ? (
              <form
                className="raid-list-action-state-form"
                action={`/api/raids/${encodeURIComponent(raid.id)}/close`}
                method="post"
              >
                <button className="btn warning btn-sm raid-list-action-state" type="submit">
                  Закрити
                </button>
              </form>
            ) : closed ? (
              <span className="raid-list-archive-note">Архів</span>
            ) : (
              <span className="raid-list-archive-note raid-list-archive-note--draft">Чернетка</span>
            )}
          </>
        ) : closed ? (
          <span className="raid-list-archive-note">Архів</span>
        ) : null}
      </div>
    </article>
  );
}

export function RaidForm({
  raid,
  channels,
  roles = [],
  discordEnabled = true,
}: {
  raid?: RaidItem | null;
  channels: RaidChannelOption[];
  roles?: RaidRoleOption[];
  discordEnabled?: boolean;
}) {
  const defaultComposition = raid
    ? raidAutoCompositionLabel(raid).replace(/\s/g, "")
    : "0/0/0";
  const channelOptions =
    raid?.channelId &&
    !channels.some((channel) => channel.id === raid.channelId)
      ? [{ id: raid.channelId, name: "поточний канал" }, ...channels]
      : channels;
  const selectedMentionRoleIds = Array.from(
    new Set((raid?.mentionRoleIds || []).filter(Boolean)),
  );
  const isExistingRaid = Boolean(raid?.id);
  const isDiscordPublished = Boolean(
    raid?.channelId && raid?.messageId && raid?.status !== "draft",
  );
  const canPublish = discordEnabled && !(raid ? isRaidClosed(raid) : false);
  const saveLabel =
    isExistingRaid && raid?.status !== "draft"
      ? "Зберегти без публікації"
      : "Зберегти чернетку";
  const publishLabel = isDiscordPublished
    ? "Оновити Discord"
    : "Опублікувати в Discord";
  return (
    <div className="raid-form-stack">
      <form
        className="panel raid-form-panel raid-form-panel--modern"
        action="/api/raids"
        method="post"
        data-raid-editor-form="true"
      >
        <input type="hidden" name="raidId" value={raid?.id || ""} />
        <input type="hidden" name="composition" value={defaultComposition} />
        <div className="raid-form-heading">
          <div>
            <div className="section-title">
              {raid?.id ? "Редагування рейду" : "Створення рейду"}
            </div>
            <p>
              Чернетка зберігає дані без публікації. Публікація створює або
              оновлює Discord-оголошення з кнопками запису.
            </p>
          </div>
          {raid ? (
            <em className={`raid-state raid-state--${raidStatusClass(raid)}`}>
              {raidStatusLabel(raid)}
            </em>
          ) : null}
        </div>

        <div className="raid-form-section">
          <strong>Основне</strong>
          <label className="field-label">
            Назва рейду
            <input
              className="input"
              name="title"
              defaultValue={raid?.title || "Войдспайр"}
              required
            />
          </label>
          <label className="field-label">
            Тип рейду
            <select
              className="select"
              name="difficulty"
              defaultValue={raid?.difficulty || "heroic"}
            >
              <option value="normal">Нормал</option>
              <option value="heroic">Героїк</option>
              <option value="mythic">Міфік</option>
            </select>
          </label>
          <div className="raid-form-row">
            <label className="field-label">
              Дата
              <input
                className="input"
                type="date"
                name="date"
                defaultValue={raid?.date || todayIso()}
                required
              />
            </label>
            <label className="field-label">
              Час
              <input
                className="input"
                type="time"
                name="time"
                defaultValue={raid?.time || "20:00"}
                required
              />
            </label>
          </div>
          <label className="field-label">
            Рейд-лідер / РЛ
            <input
              className="input"
              name="raidLeaderName"
              placeholder="Напр. Sebas"
              defaultValue={raid?.raidLeaderName || ""}
              maxLength={120}
            />
            <small>
              Необов’язково. Якщо поле порожнє, у Discord-оголошенні блок РЛ не
              показується.
            </small>
          </label>
          <label className="field-label">
            Мінімальний item level
            <input
              className="input"
              type="number"
              name="minItemLevel"
              min="1"
              max="9999"
              step="1"
              placeholder="Напр. 675"
              defaultValue={raid?.minItemLevel || ""}
            />
            <small>
              Необов’язково. Без галочки нижче це лише попередження; з галочкою
              запис нижче порогу буде заблоковано.
            </small>
          </label>
          <label className="raid-checkbox-line">
            <input
              type="checkbox"
              name="minItemLevelRequired"
              value="1"
              defaultChecked={Boolean(raid?.minItemLevelRequired)}
            />
            <span>
              Блокувати запис, якщо item level нижче мінімального порогу
            </span>
          </label>
          <label className="field-label">
            Максимум гравців
            <input
              className="input"
              type="number"
              name="maxPlayers"
              min="1"
              max="80"
              step="1"
              placeholder="Напр. 20"
              defaultValue={raid?.maxPlayers || ""}
            />
            <small>
              Порожньо — без жорсткого ліміту. Коли активних записів стане
              стільки ж, нові “Підписатися” і “Затримаюсь” будуть заблоковані.
            </small>
          </label>
          <label className="raid-checkbox-line">
            <input
              type="checkbox"
              name="registrationLockEnabled"
              value="1"
              defaultChecked={Boolean(raid?.registrationLockEnabled)}
            />
            <span>Блокувати запис за X часу до старту рейду</span>
          </label>
          <label className="field-label">
            Коли закрити запис
            <select
              className="select"
              name="registrationLockMinutesBefore"
              defaultValue={String(raid?.registrationLockMinutesBefore || 60)}
            >
              <option value="30">За 30 хв</option>
              <option value="60">За 1 год</option>
              <option value="120">За 2 год</option>
              <option value="180">За 3 год</option>
              <option value="1440">За 1 день</option>
            </select>
            <small>
              Після дедлайну “Підписатися”, “Затримаюсь” і зміна персонажа
              будуть відхилятися. “Пропустити” лишається доступним до старту,
              щоб не тримати зайве місце.
            </small>
          </label>
        </div>

        <div className="raid-form-section raid-form-section--two">
          <label className="field-label">
            Канал Discord
            {channelOptions.length ? (
              <select
                className="select"
                name="channelId"
                defaultValue={raid?.channelId || channelOptions[0]?.id || ""}
              >
                {channelOptions.map((channel) => (
                  <option key={channel.id} value={channel.id}>
                    #{channel.name}
                  </option>
                ))}
              </select>
            ) : (
              <input
                className="input"
                name="channelId"
                inputMode="numeric"
                pattern="[0-9]{16,25}"
                placeholder="ID текстового каналу Discord"
                defaultValue={raid?.channelId || ""}
                disabled={!discordEnabled}
                required={discordEnabled}
              />
            )}
            {!channelOptions.length ? (
              <small>
                Список каналів не прочитався автоматично. Встав ID каналу вручну
                або задай DISCORD_CHANNEL_ID / DISCORD_GUILD_CHANNELS_ENDPOINT у
                змінних середовища.
              </small>
            ) : null}
          </label>
          <label className="field-label">
            Розхідники
            <select
              className="select"
              name="consumables"
              defaultValue={raid?.consumables || "own"}
            >
              <option value="own">Власні</option>
              <option value="guild">Гільдійні</option>
            </select>
          </label>
          <label className="field-label">
            Лут
            <select
              className="select"
              name="lootMode"
              defaultValue={raid?.lootMode || "ms-os"}
            >
              <option value="ms-os">MS &gt; OS</option>
              <option value="free-roll">Вільний рол</option>
              <option value="soft-reserve">Soft Reserve</option>
              <option value="loot-council">Loot Council</option>
            </select>
          </label>
        </div>

        <div className="raid-form-section discord-visual-section discord-visual-section--roles">
          <strong>Тег ролей у Discord</strong>
          <RaidRoleMentionPicker
            roles={roles}
            selectedRoleIds={selectedMentionRoleIds}
          />
        </div>

        <div className="raid-auto-composition-note">
          <strong>Склад формується автоматично</strong>
          <span>
            Поточна схема: {defaultComposition}. Якщо задано максимум гравців,
            схема рахується від цього числа; без ліміту — від активного запису.
            Правило: максимум 2 танки на рейд, хіли масштабуються від кількості паті
            з верхньою межею 5, ДД добираються за бафами та балансом мілі/рендж.
          </span>
        </div>

        <div className="raid-form-section">
          <strong>Текст і зображення</strong>
          <label className="field-label">
            Опис
            <textarea
              className="input textarea markdown-area raid-description-textarea"
              name="description"
              rows={8}
              defaultValue={
                raid?.description ||
                "Глибоко в серці темної цитаделі нас чекають давні таємниці та смертельні вороги.\n\nБудьте готові до суворого випробування!"
              }
            />
          </label>
          <p className="raid-form-hint">
            Підтримується Markdown для Discord: жирний текст, курсив, списки,
            заголовки, цитати, посилання й код.
          </p>
          <label className="field-label">
            Мініатюра / іконка
            <input
              className="input"
              name="thumbnailUrl"
              placeholder="https://..."
              defaultValue={
                raid?.thumbnailUrl ||
                resolveRaidThumbnailUrl({
                  difficulty: raid?.difficulty || "heroic",
                })
              }
            />
            <small>
              Якщо поле не змінювати, система автоматично використає мініатюру
              за типом рейду.
            </small>
          </label>
          <RaidImagePicker defaultValue={raid?.imageUrl || ""} />
        </div>

        <div className="raid-form-actions">
          <button
            className="btn subtle"
            name="action"
            value="save"
            type="submit"
          >
            {saveLabel}
          </button>
          <button
            className="btn primary"
            formAction="/api/raids/publish"
            name="action"
            value="publish"
            type="submit"
            disabled={!canPublish}
          >
            {publishLabel}
          </button>
        </div>
        <div className="raid-form-links">
          {raid?.id ? (
            <a
              className="raid-message-link"
              href={`/raids/${encodeURIComponent(raid.id)}`}
            >
              Відкрити сторінку рейду
            </a>
          ) : null}
          {raid?.messageUrl ? (
            <a
              className="raid-message-link"
              href={raid.messageUrl}
              target="_blank"
              rel="noreferrer"
            >
              Відкрити Discord-повідомлення
            </a>
          ) : null}
        </div>
      </form>
      {raid?.id ? (
        <form
          className="panel raid-form-danger-zone raid-form-danger-zone--separate"
          action={`/api/raids/${encodeURIComponent(raid.id)}/delete`}
          method="post"
          data-confirm-message={
            raid.status === "draft"
              ? "Видалити чернетку рейду?"
              : "Видалити рейд із панелі? Повʼязане Discord-повідомлення також буде прибране, якщо це можливо."
          }
        >
          <strong>
            {raid.status === "draft" ? "Видалення чернетки" : "Видалення рейду"}
          </strong>
          <p>
            {raid.status === "draft"
              ? "Чернетка зникне зі списку рейдів."
              : "З панелі рейд видаляється тільки вручну. Автоматично після старту прибирається лише Discord-повідомлення, а архів у панелі зберігається."}
          </p>
          <button className="btn danger" type="submit">
            {raid.status === "draft" ? "Видалити чернетку" : "Видалити рейд"}
          </button>
        </form>
      ) : null}
    </div>
  );
}

export function RaidPageShell({
  user,
  title,
  description,
  children,
}: {
  user?: DashboardSession | null;
  title: string;
  description: string;
  children: ReactNode;
}) {
  return (
    <main className="container raid-page">
      <section
        className="dashboard-shell content-shell raid-shell"
        aria-label="Панель рейдів Mistblossom Vanguard"
      >
        {user ? <DashboardIdentity user={user} activeSection="raids" /> : null}
        <header className="hero panel dashboard-hero raid-dashboard-hero">
          <div className="hero-copy dashboard-hero__copy guild-hero__copy">
            <div className="eyebrow">Mistblossom Vanguard • Рейди</div>
            <div className="content-hero-status-row">
              <span className="content-mode-pill content-mode-pill--library">
                {user ? hierarchyTitle(user.role) : "Учасник"}
              </span>
              <span className="content-hero-path">
                Запис у Discord • склад паті • автооновлення
              </span>
            </div>
            <h1>{title}</h1>
            <span className="hero-accent" aria-hidden="true" />
            <p className="lead">{description}</p>
          </div>
          <HeroSidePanel
            ariaLabel="Огляд рейдів"
            summary={[
              {
                label: "РОЗДІЛ",
                value: "Рейди",
                note: "Запис, склад і публікація",
              },
              {
                label: "ДОСТУП",
                value: user ? hierarchyTitle(user.role) : "Учасник",
                note: user ? "Права з Discord/Firebase" : "Публічний перегляд",
              },
            ]}
            stats={[
              { label: "DISCORD", value: "SYNC" },
              { label: "ПАТІ", value: "AUTO" },
              { label: "LIVE", value: "ON" },
            ]}
          />
        </header>
        {children}
      </section>
    </main>
  );
}

export function RaidUnavailableState({
  canManage = false,
}: {
  canManage?: boolean;
}) {
  return (
    <section className="panel raid-member-panel">
      <h2>Рейд недоступний</h2>
      <p>
        {canManage
          ? "Рейд не знайдено або був видалений."
          : "Цей рейд не знайдено, ще не опублікований або був видалений. Перевір посилання з Discord-повідомлення."}
      </p>
    </section>
  );
}

export function makePreviewRaid(
  user: DashboardSession,
  createdByName?: string,
): RaidItem {
  return {
    id: "previewraid",
    title: "Войдспайр",
    difficulty: "heroic",
    date: todayIso(),
    time: "20:00",
    description:
      "Глибоко в серці темної цитаделі Войдспайр нас чекають давні таємниці та смертельні вороги.\n\nБудьте готові до суворого випробування!",
    createdByDiscordId: user.provider === "discord" ? user.id : "",
    createdByName: createdByName || user.name || "@Sebas",
    createdByMain: null,
    raidLeaderName: null,
    consumables: "own",
    lootMode: "ms-os",
    composition: { tanks: 0, healers: 0, dps: 0 },
    maxPlayers: null,
    registrationLockEnabled: false,
    registrationLockMinutesBefore: null,
    mentionRoleIds: [],
    status: "draft",
    signups: [],
  };
}
