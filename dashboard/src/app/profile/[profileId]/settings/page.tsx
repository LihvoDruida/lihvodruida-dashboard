import DashboardIdentity from "@/components/DashboardIdentity";
import ProfileNameControls from "@/components/ProfileNameControls";
import { buildPageMetadata } from "@/lib/seo";
import { getSession } from "@/lib/auth";
import { recordDashboardSystemLog } from "@/lib/dashboardSystemLogs";
import { withTimeout } from "@/lib/runtimeResilience";
import {
  fetchDiscordGuildMemberSnapshot,
  fetchDiscordGuildSnapshot,
  hasDiscordEmbedConfig,
} from "@/lib/discordAdmin";
import { getGuildNicknamePolicy } from "@/lib/guildNicknamePolicy";
import {
  wowRoleLabel,
  resolveWowCharacterRole,
  type WowCharacterRole,
} from "@/lib/wowRoles";
import { guildStatusLabel } from "@/lib/permissions";
import {
  buildProfileDiscordNickname,
  buildProfileDiscordNicknamePlan,
  getMainCharacter,
  getProfileById,
  getProfilePublicName,
  getProfileRaidRole,
  getProfileServerStyleName,
  profileGenderLabel,
  profileFromSession,
  profileSettingsSetupStatus,
  upsertProfileFromSession,
  type DashboardProfile,
  type ProfileCharacter,
  type ProfileGrammaticalGender,
} from "@/lib/profiles";
import { notFound, redirect } from "next/navigation";

export const metadata = buildPageMetadata({
  title: "Налаштування профілю",
  description:
    "Налаштування імені профілю, Discord nickname, альтів для шаблону та ролі у рейдах.",
  path: "/profile/settings",
  keywords: [
    "налаштування профілю",
    "Discord nickname",
    "Battle.net альти",
    "рейдова роль",
  ],
});

export const dynamic = "force-dynamic";
export const revalidate = 0;

function formatCompactDate(value?: string | null) {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return new Intl.DateTimeFormat("uk-UA", {
    day: "2-digit",
    month: "short",
  }).format(date);
}

function characterAutoRaidRole(
  character?: ProfileCharacter | null,
): WowCharacterRole {
  return character
    ? resolveWowCharacterRole({
        className: character.className,
        activeSpecName: character.activeSpecName,
        activeSpecId: character.activeSpecId,
        activeSpecRole: character.activeSpecRole,
      })
    : "dps";
}

const RAID_ROLE_OPTIONS: {
  value: "auto" | WowCharacterRole;
  label: string;
  hint: string;
}[] = [
  {
    value: "auto",
    label: "Авто зі спеки",
    hint: "Ручний вибір не потрібен, якщо спек визначено правильно",
  },
  { value: "tank", label: "Танк", hint: "Примусово записувати мейна як танка" },
  { value: "healer", label: "Хіл", hint: "Примусово записувати мейна як хіла" },
  { value: "dps", label: "ДД", hint: "Примусово записувати мейна як ДД" },
];

type SelectableProfileGender = Exclude<ProfileGrammaticalGender, "unspecified">;

const PROFILE_GENDER_OPTIONS: {
  value: SelectableProfileGender;
  label: string;
  hint: string;
  example: string;
}[] = [
  {
    value: "male",
    label: "Чоловіча форма",
    hint: "Для повідомлень, статусів і рейдових підписів у чоловічій формі.",
    example: "Підписаний",
  },
  {
    value: "female",
    label: "Жіноча форма",
    hint: "Для повідомлень, статусів і рейдових підписів у жіночій формі.",
    example: "Підписана",
  },
  {
    value: "neutral",
    label: "Нейтральне звертання",
    hint: "Без привʼязки до чоловічої або жіночої форми в текстах інтерфейсу.",
    example: "Підписали",
  },
  {
    value: "nonbinary",
    label: "Небінарна особа",
    hint: "Для нейтральних форм у персональних повідомленнях сайту та Discord.",
    example: "Підписали",
  },
];

function ProfileGenderPreferenceForm({
  value,
  returnTo = "",
}: {
  value?: ProfileGrammaticalGender | null;
  returnTo?: string;
}) {
  const selected = value && value !== "unspecified" ? value : null;

  return (
    <section
      className="profile-gender-box"
      aria-label="Стать або звертання профілю"
    >
      <div className="profile-gender-box__head">
        <span className="profile-gender-box__icon" aria-hidden="true">
          ✦
        </span>
        <span>
          <strong>Стать / звертання</strong>
          <small>
            Це системне поле для правильних форм у профілі, рейдах, правилах і
            Discord-повідомленнях.
          </small>
        </span>
        <span
          className={`profile-gender-pill${selected ? " is-selected" : " is-missing"}`}
        >
          {profileGenderLabel(selected || "unspecified")}
        </span>
      </div>

      <form
        className="profile-gender-form"
        action="/api/profile/gender"
        method="post"
      >
        {returnTo ? (
          <input type="hidden" name="returnTo" value={returnTo} />
        ) : null}
        {PROFILE_GENDER_OPTIONS.map((option) => {
          const checked = selected === option.value;
          return (
            <label
              className={`profile-gender-option${checked ? " is-selected" : ""}`}
              key={option.value}
            >
              <input
                type="radio"
                name="grammaticalGender"
                value={option.value}
                defaultChecked={checked}
                required
              />
              <span>
                <strong>{option.label}</strong>
                <small>{option.hint}</small>
                <em>Приклад: {option.example}</em>
              </span>
            </label>
          );
        })}
        <button className="btn btn-primary btn-sm" type="submit">
          Зберегти звертання
        </button>
      </form>
    </section>
  );
}

function RaidRolePreferenceForm({
  mainCharacter,
  manualRole,
  selectedRole,
  returnTo = "",
}: {
  mainCharacter?: ProfileCharacter | null;
  manualRole?: WowCharacterRole | null;
  selectedRole: WowCharacterRole;
  returnTo?: string;
}) {
  const autoRole = characterAutoRaidRole(mainCharacter);
  const sourceLabel = manualRole ? "Вибрано вручну" : "Авто з мейна";
  const mainLabel = mainCharacter
    ? `${mainCharacter.name}${mainCharacter.realmName || mainCharacter.realmSlug ? ` • ${mainCharacter.realmName || mainCharacter.realmSlug}` : ""}`
    : "Мейн не вибрано";

  return (
    <div
      className="profile-raid-role-box"
      aria-label="Роль для запису на рейди"
    >
      <div className="profile-raid-role-box__head">
        <span className="profile-raid-role-box__icon" aria-hidden="true">
          ⚔
        </span>
        <span>
          <strong>Роль у рейді</strong>
          <small>{mainLabel}</small>
        </span>
        <span
          className={`profile-raid-role-pill profile-raid-role-pill--${selectedRole}`}
        >
          {wowRoleLabel(selectedRole)}
        </span>
      </div>

      <p className="profile-raid-role-box__note">
        {sourceLabel}:{" "}
        {manualRole
          ? wowRoleLabel(manualRole)
          : `${wowRoleLabel(autoRole)} зі спеки мейна`}
        . Авто — нормальний завершений стан для реєстрації; ручний вибір
        потрібен лише якщо спек або роль визначились неправильно. Для іншого
        персонажа на рейді система бере роль уже з його спеки.
      </p>

      {mainCharacter ? (
        <form
          className="profile-raid-role-form"
          action="/api/profile/raid-role"
          method="post"
        >
          {returnTo ? (
            <input type="hidden" name="returnTo" value={returnTo} />
          ) : null}
          {RAID_ROLE_OPTIONS.map((option) => {
            const checked =
              option.value === "auto"
                ? !manualRole
                : manualRole === option.value;
            const label =
              option.value === "auto"
                ? `Авто: ${wowRoleLabel(autoRole)}`
                : option.label;
            const hint = option.value === "auto" ? option.hint : option.hint;
            return (
              <label
                className={`profile-raid-role-option${checked ? " is-selected" : ""}`}
                key={option.value}
              >
                <input
                  type="radio"
                  name="raidRole"
                  value={option.value}
                  defaultChecked={checked}
                />
                <span>
                  <strong>{label}</strong>
                  <small>{hint}</small>
                </span>
              </label>
            );
          })}
          <button className="btn btn-primary btn-sm" type="submit">
            Зберегти роль
          </button>
        </form>
      ) : (
        <div className="profile-empty-characters profile-empty-characters--compact">
          <strong>Спочатку вибери мейна</strong>
          <span>Після цього можна буде вказати роль для рейдів.</span>
        </div>
      )}
    </div>
  );
}

function NicknameCharactersForm({
  profile,
  nicknameTemplate,
  returnTo = "",
}: {
  profile: DashboardProfile;
  nicknameTemplate: string;
  returnTo?: string;
}) {
  const main = getMainCharacter(profile);
  const selected = new Set(
    (profile.nicknameCharacterKeys || []).filter((key) => key !== main?.key),
  );
  const altCandidates = profile.characters
    .filter((character) => character.key !== main?.key)
    .sort((a, b) => {
      if (a.verifiedGuild !== b.verifiedGuild) return a.verifiedGuild ? -1 : 1;
      return a.name.localeCompare(b.name, "uk");
    });
  const plan = buildProfileDiscordNicknamePlan(profile, nicknameTemplate);
  const previewCharacters = plan.requestedCharacterNames.length
    ? plan.requestedCharacterNames.join(", ")
    : "—";

  return (
    <section
      className="profile-discord-standard profile-nickname-character-box"
      aria-label="Персонажі для Discord nickname"
    >
      <div className="profile-discord-standard__head profile-discord-standard__head--modern">
        <div className="profile-discord-standard__identity">
          <span className="profile-name-panel__label">
            Персонажі у Discord-ніку
          </span>
          <strong>{plan.value || "Спочатку вкажи імʼя"}</strong>
          <small>Формат береться з адмін-панелі: {nicknameTemplate}</small>
        </div>
        <span className="profile-count-pill">
          {Math.min(2, selected.size)} / 2 альти
        </span>
      </div>

      <div className="profile-nickname-preview is-synced">
        <span>Порядок у шаблоні</span>
        <strong>{previewCharacters}</strong>
        <small>
          Першим завжди іде мейн. Нижче можна вибрати до двох альтів.
        </small>
      </div>

      {altCandidates.length ? (
        <form
          className="profile-nickname-character-form"
          action="/api/profile/nickname-characters"
          method="post"
        >
          {returnTo ? (
            <input type="hidden" name="returnTo" value={returnTo} />
          ) : null}
          <div className="profile-nickname-character-list">
            {altCandidates.map((character) => {
              const checked = selected.has(character.key);
              return (
                <label
                  className={`profile-nickname-character-option${checked ? " is-selected" : ""}`}
                  key={character.key}
                >
                  <input
                    type="checkbox"
                    name="nicknameCharacterKeys"
                    value={character.key}
                    defaultChecked={checked}
                  />
                  <span>
                    <strong>{character.name}</strong>
                    <small>
                      {[
                        character.realmName || character.realmSlug,
                        character.activeSpecName,
                        character.className,
                        character.verifiedGuild ? "Гільдійний" : "Інший",
                      ]
                        .filter(Boolean)
                        .join(" • ")}
                    </small>
                  </span>
                </label>
              );
            })}
          </div>
          <p className="profile-nickname-hint">
            Сервер перевіряє ліміт: буде збережено максимум 2 альти, мейн сюди
            не потрапляє.
          </p>
          <button className="btn btn-primary btn-sm" type="submit">
            Зберегти альтів для ніку
          </button>
        </form>
      ) : (
        <div className="profile-empty-characters profile-empty-characters--compact">
          <strong>Немає альтів для вибору</strong>
          <span>
            Додай персонажів у профілі, після цього вони зʼявляться тут.
          </span>
        </div>
      )}
    </section>
  );
}

function setupStepAnchor(key: string) {
  if (key === "profile_name" || key === "profile_display_mode") {
    return "#profile-name-settings";
  }
  if (key === "profile_gender") return "#profile-gender-settings";
  return "#profile-settings-overview";
}

function ProfileSettingsCompletionPanel({
  status,
}: {
  status: ReturnType<typeof profileSettingsSetupStatus>;
}) {
  const completed = status.steps.filter((step) => step.complete).length;
  const total = Math.max(1, status.steps.length);
  const progress = Math.round((completed / total) * 100);

  return (
    <section
      className={`profile-setup-progress-panel${status.complete ? " is-complete" : " is-missing"}`}
      aria-label="Стан заповнення профілю"
    >
      <div className="profile-setup-progress-panel__head">
        <span className="profile-setup-progress-panel__icon" aria-hidden="true">
          {status.complete ? "✓" : "!"}
        </span>
        <span>
          <strong>
            {status.complete
              ? "Реєстраційні дані заповнені"
              : "Потрібно виправити або доповнити дані"}
          </strong>
          <small>
            {status.complete
              ? "Профіль має валідне імʼя, звертання і формат відображення."
              : `Не вистачає: ${status.missing.map((step) => step.title).join(", ")}.`}
          </small>
        </span>
        <span className="profile-count-pill">
          {completed}/{status.steps.length}
        </span>
      </div>
      <div
        className="profile-setup-progress-panel__bar"
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={progress}
        aria-valuetext={`${completed} з ${status.steps.length}`}
      >
        <span style={{ width: `${progress}%` }} />
      </div>
      <div className="profile-setup-progress-panel__steps" role="list">
        {status.steps.map((step) => (
          <a
            className={`profile-setup-progress-step${step.complete ? " is-complete" : " is-missing"}`}
            href={setupStepAnchor(step.key)}
            role="listitem"
            key={step.key}
          >
            <span aria-hidden="true">{step.complete ? "✓" : "!"}</span>
            <strong>{step.title}</strong>
            <small>{step.description}</small>
          </a>
        ))}
      </div>
    </section>
  );
}

export default async function ProfileSettingsPage({
  params,
  searchParams,
}: {
  params: Promise<{ profileId: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const session = await getSession();
  if (!session) {
    redirect("/login");
    throw new Error("Unauthorized");
  }

  const [nicknamePolicy, query] = await Promise.all([
    getGuildNicknamePolicy().catch((error) => {
      void recordDashboardSystemLog(
        "warning",
        "page.profile_settings.nickname_policy_unavailable",
        {
          summary:
            "Шаблон Discord-ніку тимчасово недоступний, використано стандартний.",
          message:
            error instanceof Error ? error.message : String(error || "unknown"),
        },
        { persist: false },
      );
      return {
        template: "{name} [{main}, {alt}, {alt}]",
        roleRemoveConcurrency: 0,
        roleRemoveMaxConcurrency: 5,
        nicknameCleanupConcurrency: 0,
        nicknameCleanupMaxConcurrency: 4,
        updatedAt: null,
        updatedBy: null,
      };
    }),
    searchParams,
  ]);

  const { profileId } = await params;
  const rulesReturnToken = String(
    Array.isArray(query.rt) ? query.rt[0] : query.rt || "",
  ).trim();
  const isRulesReturn =
    String(Array.isArray(query.from) ? query.from[0] : query.from || "") ===
      "rules" && Boolean(rulesReturnToken);
  const settingsRulesReturnPath = isRulesReturn
    ? `/profile/${profileId}/settings?setup=1&from=rules&rt=${encodeURIComponent(rulesReturnToken)}`
    : "";
  const profileRulesReturnPath = isRulesReturn
    ? `/profile/${profileId}?from=rules&rt=${encodeURIComponent(rulesReturnToken)}`
    : "";
  const rulesReviewPath = isRulesReturn
    ? `/rules/accept?rt=${encodeURIComponent(rulesReturnToken)}&status=incomplete`
    : "";
  const isOwnProfile = Boolean(
    session.profileId && session.profileId === profileId,
  );
  if (!isOwnProfile) notFound();

  let profile = await getProfileById(profileId);
  let storageWarning = "";

  if (!profile) {
    const result = await upsertProfileFromSession(session).catch(() => null);
    profile = result?.profile || { ...profileFromSession(session), profileId };
    if (!result?.stored) {
      storageWarning =
        "Профіль тимчасово показано з поточної сесії. Частина даних може оновитися після повторного входу.";
    }
  }

  if (!profile) notFound();

  const mainCharacter = getMainCharacter(profile);
  const raidRolePreference = profile.raidRolePreference || null;
  const manualRaidRole =
    raidRolePreference &&
    mainCharacter &&
    raidRolePreference.characterKey === mainCharacter.key
      ? raidRolePreference.role
      : null;
  const selectedRaidRole = getProfileRaidRole(profile);
  const publicNamePreview = getProfilePublicName(
    profile,
    nicknamePolicy.template,
  );
  const serverStyleNamePreview = getProfileServerStyleName(
    profile,
    80,
    nicknamePolicy.template,
  );
  const discordNicknamePreview = buildProfileDiscordNickname(
    profile,
    nicknamePolicy.template,
  );
  const discordMemberReadable =
    profile.provider === "discord" &&
    /^\d{16,25}$/.test(profile.providerUserId) &&
    hasDiscordEmbedConfig();
  const canSyncDiscordNickname = discordMemberReadable;
  let discordOwnerLocked = false;
  let currentServerNickname: string | null = null;
  let liveDiscordMember: Awaited<
    ReturnType<typeof fetchDiscordGuildMemberSnapshot>
  > | null = null;

  if (discordMemberReadable) {
    const [guild, member] = await withTimeout(
      Promise.all([
        fetchDiscordGuildSnapshot().catch(() => null),
        fetchDiscordGuildMemberSnapshot(profile.providerUserId).catch(
          () => null,
        ),
      ]),
      1_800,
      "profile settings discord member read",
    ).catch((error) => {
      void recordDashboardSystemLog(
        "warning",
        "page.profile_settings.discord_live_read_failed",
        {
          summary:
            "Discord-нік не перевірено наживо, показано збережені дані профілю.",
          profileId,
          message:
            error instanceof Error ? error.message : String(error || "unknown"),
        },
        { persist: false },
      );
      return [null, null] as const;
    });
    liveDiscordMember = member;
    discordOwnerLocked = Boolean(
      guild?.ownerId && guild.ownerId === profile.providerUserId,
    );
    currentServerNickname = member?.nick || null;
  }

  const setupStatus = profileSettingsSetupStatus(profile);
  const isSetupEntry =
    String(Array.isArray(query.setup) ? query.setup[0] : query.setup || "") ===
      "1" || setupStatus.missing.length > 0;
  const setupCompleteCount = setupStatus.steps.filter(
    (step) => step.complete,
  ).length;
  const settingsPageTitle = isSetupEntry
    ? "Реєстрація профілю"
    : "Налаштування профілю";
  const guildStatus = guildStatusLabel(profile.role);
  const accountStatusLabel = guildStatus;
  const savedCharacterCount = profile.characters.length;

  return (
    <main className="container">
      <section
        className="dashboard-shell content-shell profile-shell profile-account-page"
        aria-label="Налаштування профілю Mistblossom Vanguard"
      >
        <DashboardIdentity user={session} activeSection="profile" />
        <div className="profile-account-layout">
          <aside
            className="panel profile-account-sidebar"
            aria-label="Коротка навігація профілю"
          >
            <div className="profile-account-sidebar__identity">
              {profile.avatarUrl ? (
                <img
                  className="profile-account-sidebar__avatar"
                  src={profile.avatarUrl}
                  alt=""
                  width={84}
                  height={84}
                  loading="lazy"
                  referrerPolicy="no-referrer"
                />
              ) : (
                <span
                  className="profile-account-sidebar__avatar profile-account-sidebar__avatar--fallback"
                  aria-hidden="true"
                >
                  {(publicNamePreview || profile.displayName || "A").charAt(0)}
                </span>
              )}
              <strong>{publicNamePreview}</strong>
              <span>{accountStatusLabel}</span>
              <div
                className="profile-account-sidebar__pills"
                aria-label="Стан профілю"
              >
                <span>☘ {savedCharacterCount} перс.</span>
                <span>
                  ✓ {setupCompleteCount}/{setupStatus.steps.length}
                </span>
                <span>⚔ {wowRoleLabel(selectedRaidRole)}</span>
              </div>
            </div>
            <nav
              className="profile-account-sidebar__nav"
              aria-label="Розділи профілю"
            >
              <a
                href={
                  profileRulesReturnPath ||
                  `/profile/${encodeURIComponent(profile.profileId)}`
                }
              >
                <span aria-hidden="true">✦</span> Профіль
              </a>
              <a
                href={
                  settingsRulesReturnPath ||
                  `/profile/${encodeURIComponent(profile.profileId)}/settings`
                }
                aria-current="page"
              >
                <span aria-hidden="true">⚙</span> Налаштування
              </a>
              <a href="#profile-name-settings">
                <span aria-hidden="true">#</span> Імʼя
              </a>
              <a href="#profile-gender-settings">
                <span aria-hidden="true">✦</span> Звертання
              </a>
              <a href="#profile-nickname-settings">
                <span aria-hidden="true">◆</span> Discord-нік
              </a>
              <a href="#profile-role-settings">
                <span aria-hidden="true">⚔</span> Роль
              </a>
            </nav>
          </aside>

          <div className="profile-account-main">
            <header
              className="profile-account-header"
              id="profile-settings-overview"
            >
              <div>
                <span className="eyebrow">
                  Mistblossom Vanguard •{" "}
                  {isSetupEntry ? "Реєстрація" : "Налаштування"}
                </span>
                <h1>{settingsPageTitle}</h1>
                <p>
                  Всі базові дані вводяться тут: імʼя, формат відображення,
                  звертання, Discord nickname, альти для шаблону та роль для
                  рейдів. Некоректні або неповні поля підсвічуються нижче.
                </p>
              </div>
              <span className="profile-account-header__badge">
                {guildStatus}
              </span>
            </header>

            <section
              className="profile-account-overview profile-account-overview--clean"
              aria-label="Короткий стан налаштувань"
            >
              <div className="profile-account-overview-card profile-account-overview-card--primary">
                <span
                  className="profile-account-overview-card__icon"
                  aria-hidden="true"
                >
                  #
                </span>
                <span>
                  <small>Публічно</small>
                  <strong>{publicNamePreview}</strong>
                </span>
              </div>
              <div className="profile-account-overview-card">
                <span
                  className="profile-account-overview-card__icon"
                  aria-hidden="true"
                >
                  ⌁
                </span>
                <span>
                  <small>Discord-нік</small>
                  <strong>{discordNicknamePreview || "—"}</strong>
                </span>
              </div>
              <div className="profile-account-overview-card">
                <span
                  className="profile-account-overview-card__icon"
                  aria-hidden="true"
                >
                  ✦
                </span>
                <span>
                  <small>Звертання</small>
                  <strong>
                    {profileGenderLabel(profile.grammaticalGender)}
                  </strong>
                </span>
              </div>
              <div className="profile-account-overview-card">
                <span
                  className="profile-account-overview-card__icon"
                  aria-hidden="true"
                >
                  ⚔
                </span>
                <span>
                  <small>Роль у рейді</small>
                  <strong>{wowRoleLabel(selectedRaidRole)}</strong>
                </span>
              </div>
              <div className="profile-account-overview-card profile-account-overview-card--success">
                <span
                  className="profile-account-overview-card__icon"
                  aria-hidden="true"
                >
                  ✦
                </span>
                <span>
                  <small>Оновлено</small>
                  <strong>
                    {formatCompactDate(
                      profile.updatedAt || profile.lastLoginAt,
                    ) || "—"}
                  </strong>
                </span>
              </div>
            </section>

            <ProfileSettingsCompletionPanel status={setupStatus} />

            {storageWarning ? (
              <div
                className="login-alert profile-storage-warning"
                role="status"
              >
                {storageWarning}
              </div>
            ) : null}
            {rulesReviewPath ? (
              <div className="profile-rules-return-callout" role="status">
                <span aria-hidden="true">🌿</span>
                <span>
                  <strong>
                    Ти завершуєш реєстрацію через правила Discord.
                  </strong>
                  <small>
                    Заповни обовʼязкові поля, потім повернись до перевірки
                    правил.
                  </small>
                </span>
                <a className="btn btn-ghost btn-sm" href={rulesReviewPath}>
                  Повернутись до правил
                </a>
              </div>
            ) : null}
            {isSetupEntry ? (
              <div
                className={`profile-setup-callout${setupStatus.complete ? " is-complete" : " is-warning"}`}
                role="status"
              >
                <span
                  className="profile-setup-callout__icon"
                  aria-hidden="true"
                >
                  {setupStatus.complete ? "✓" : "!"}
                </span>
                <span>
                  <strong>
                    {setupStatus.complete
                      ? "Базові налаштування профілю заповнені"
                      : "Потрібно завершити базові налаштування"}
                  </strong>
                  <small>
                    {setupStatus.complete
                      ? "Тепер можна перейти до профілю, Battle.net і персонажів."
                      : `Не вистачає: ${setupStatus.missing.map((step) => step.title).join(", ")}. Заповни або виправ ці поля прямо на цій сторінці.`}
                  </small>
                </span>
                {setupStatus.complete ? (
                  <a
                    className="btn btn-ghost btn-sm"
                    href={
                      profileRulesReturnPath ||
                      `/profile/${encodeURIComponent(profile.profileId)}`
                    }
                  >
                    Перейти в профіль
                  </a>
                ) : null}
              </div>
            ) : null}

            <section
              className="profile-grid profile-grid--settings"
              aria-label="Налаштування профілю"
            >
              <article
                id="profile-name-settings"
                className="panel profile-card profile-card--identity profile-card--clean-profile"
              >
                <div className="profile-card-head">
                  <span className="eyebrow">Профіль</span>
                  <h2>Імʼя та відображення</h2>
                </div>

                <ProfileNameControls
                  preferredName={profile.preferredName}
                  publicNameMode={profile.publicNameMode}
                  discordName={profile.displayName}
                  publicNamePreview={publicNamePreview}
                  serverStyleNamePreview={serverStyleNamePreview}
                  nicknamePreview={discordNicknamePreview}
                  lastSyncedNickname={profile.discordNickname?.value}
                  lastSyncedAt={
                    profile.discordNickname?.syncedAt
                      ? formatCompactDate(profile.discordNickname.syncedAt)
                      : null
                  }
                  currentServerNickname={currentServerNickname}
                  serverNicknameChecked={Boolean(
                    discordMemberReadable && liveDiscordMember,
                  )}
                  canManage={true}
                  canSyncDiscord={canSyncDiscordNickname}
                  discordOwnerLocked={discordOwnerLocked}
                  returnTo={settingsRulesReturnPath}
                />
              </article>

              <article
                id="profile-gender-settings"
                className="panel profile-card profile-card--identity profile-card--clean-profile"
              >
                <div className="profile-card-head">
                  <span className="eyebrow">Система</span>
                  <h2>Стать / звертання</h2>
                  <p className="profile-card-lead">
                    Цей блок не декоративний: від нього залежать персональні
                    тексти, статуси записів на рейди та перевірка завершення
                    профілю.
                  </p>
                </div>
                <div className="profile-name-panel">
                  <ProfileGenderPreferenceForm
                    value={profile.grammaticalGender}
                    returnTo={settingsRulesReturnPath}
                  />
                </div>
              </article>

              <article
                id="profile-nickname-settings"
                className="panel profile-card profile-card--identity profile-card--clean-profile"
              >
                <div className="profile-card-head">
                  <span className="eyebrow">Discord</span>
                  <h2>Шаблон ніку</h2>
                  <p className="profile-card-lead">
                    Мейн береться автоматично. Нижче вибираються тільки два
                    альти, які підставляються в шаблон з адмін-панелі.
                  </p>
                </div>
                <div className="profile-name-panel">
                  <NicknameCharactersForm
                    profile={profile}
                    nicknameTemplate={nicknamePolicy.template}
                    returnTo={settingsRulesReturnPath}
                  />
                </div>
              </article>

              <article
                id="profile-role-settings"
                className="panel profile-card profile-card--identity profile-card--clean-profile"
              >
                <div className="profile-card-head">
                  <span className="eyebrow">Рейди</span>
                  <h2>Роль у рейді</h2>
                </div>
                <div className="profile-name-panel">
                  <RaidRolePreferenceForm
                    mainCharacter={mainCharacter}
                    manualRole={manualRaidRole}
                    selectedRole={selectedRaidRole}
                    returnTo={settingsRulesReturnPath}
                  />
                </div>
              </article>
            </section>
          </div>
        </div>
      </section>
    </main>
  );
}
