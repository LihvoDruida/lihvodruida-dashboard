import DashboardIdentity from "@/components/DashboardIdentity";
import HeroSidePanel from "@/components/HeroSidePanel";
import ProfileCandidateBulkActions from "@/components/ProfileCandidateBulkActions";
import ProfileCandidateExpiryTimer from "@/components/ProfileCandidateExpiryTimer";
import ProfileCharactersLiveSection from "@/components/ProfileCharactersLiveSection";
import ProfileNameControls from "@/components/ProfileNameControls";
import { getSession, type DashboardSession } from "@/lib/auth";
import { getEnabledBattleNetRegions } from "@/lib/battlenet";
import { getDashboardApiSettings } from "@/lib/dashboardApiSettings";
import {
  fetchDiscordGuildMemberSnapshot,
  fetchDiscordRoles,
  hasDiscordEmbedConfig,
} from "@/lib/discordAdmin";
import { getGuildNicknamePolicy } from "@/lib/guildNicknamePolicy";
import {
  buildProfileDiscordNickname,
  buildProfileDiscordNicknamePlan,
  getMainCharacter,
  getProfileById,
  getProfilePublicName,
  getProfileRaidRole,
  getProfileServerStyleName,
  profileGenderLabel,
  type DashboardProfile,
  type ProfileCharacter,
  type ProfileGrammaticalGender,
} from "@/lib/profiles";
import {
  parseRulesRoleTokenDetails,
  rulesLoginPath,
  rulesOnboardingStatus,
} from "@/lib/rulesOnboarding";
import { buildPageMetadata } from "@/lib/seo";
import {
  resolveWowCharacterRole,
  wowRoleLabel,
  type WowCharacterRole,
} from "@/lib/wowRoles";
import {
  normalizeCharacterKey,
  pickWowAvatarImageUrl,
} from "@/lib/wowCharacters";

export const metadata = buildPageMetadata({
  title: "Прийняття правил",
  description:
    "Завершення профілю Mistblossom Vanguard перед видачею Discord-ролі за правила.",
  path: "/rules/accept",
  keywords: ["правила", "Discord", "реєстрація", "профіль"],
});

export const dynamic = "force-dynamic";
export const revalidate = 0;

const RAID_ROLE_OPTIONS: {
  value: "auto" | WowCharacterRole;
  label: string;
  hint: string;
}[] = [
  {
    value: "auto",
    label: "Авто зі спеки",
    hint: "Нормальний стан за замовчуванням, якщо спек мейна визначено правильно.",
  },
  { value: "tank", label: "Танк", hint: "Примусово записувати мейна як танка." },
  { value: "healer", label: "Хіл", hint: "Примусово записувати мейна як хіла." },
  { value: "dps", label: "ДД", hint: "Примусово записувати мейна як ДД." },
];

type SelectableProfileGender = Exclude<
  ProfileGrammaticalGender,
  "unspecified"
>;

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

function roleName(roleId: string, roles: Array<{ id: string; name: string }>) {
  return (
    roles.find((role) => role.id === roleId)?.name ||
    `Discord роль ${roleId.slice(-6)}`
  );
}

function rulesReturnPath(token: string) {
  return token ? `/rules/accept?rt=${encodeURIComponent(token)}` : "/rules/accept";
}

function statusNotice(status?: string | null) {
  if (status === "completed")
    return {
      tone: "ok",
      text: "✅ Реєстрацію завершено. Discord-роль видано, серверний нік оновлено.",
    };
  if (status === "completed_public")
    return {
      tone: "ok",
      text: "✅ Правила прийнято. Discord-роль видано без обовʼязкового входу на сайт.",
    };
  if (status === "completed_owner_nickname_manual")
    return {
      tone: "warning",
      text: "✅ Discord-роль видано. Ти власник сервера, тому Discord не дозволяє боту змінити твій нік — зміни його вручну за шаблоном у профілі.",
    };
  if (status === "completed_nickname_manual")
    return {
      tone: "warning",
      text: "✅ Discord-роль видано. Серверний нік потрібно змінити вручну за шаблоном у профілі.",
    };
  if (status === "incomplete")
    return {
      tone: "warning",
      text: "Заповни всі обовʼязкові пункти, після цього роль можна буде видати.",
    };
  if (status === "missing_role_token")
    return {
      tone: "warning",
      text: "Посилання не містить підтвердженої ролі. Натисни актуальну кнопку правил у Discord.",
    };
  if (status === "not_discord_profile")
    return {
      tone: "warning",
      text: "Реєстрацію правил можна завершити тільки через Discord-вхід.",
    };
  if (status === "discord_not_configured")
    return {
      tone: "error",
      text: "Discord-видача ролей тимчасово не налаштована. Звернись до офіцера.",
    };
  if (status === "discord_user_missing")
    return {
      tone: "warning",
      text: "Сторінка відкрита без Discord-підтвердження користувача. Натисни кнопку правил у Discord або увійди через Discord на сайті.",
    };
  if (status === "discord_member_missing")
    return {
      tone: "warning",
      text: "Discord-користувача не знайдено на сервері гільдії. Роль не видано.",
    };
  if (status === "geo_blocked")
    return {
      tone: "error",
      text: "Завершення реєстрації з цієї країни зараз обмежено правилами спільноти.",
    };
  if (status === "rate_limit")
    return {
      tone: "warning",
      text: "Забагато спроб завершення. Зачекай кілька хвилин і повтори дію.",
    };
  if (status === "request_too_large")
    return {
      tone: "error",
      text: "Запит відхилено: форма містить завеликі дані. Онови сторінку й повтори дію.",
    };
  if (status === "failed")
    return {
      tone: "error",
      text: "Не вдалося завершити реєстрацію. Спробуй ще раз або звернись до офіцера.",
    };
  return null;
}

function profileActionNotice(status?: string | null) {
  if (!status) return null;
  const ok = new Set([
    "profile_name_saved",
    "profile_name_mode_saved",
    "profile_gender_saved",
    "profile_nickname_characters_saved",
    "raid_role_set",
    "raid_role_auto",
    "character_added",
    "characters_added",
    "characters_added_partial",
    "main_character_set",
    "character_removed",
    "discord_nick_synced",
    "discord_nick_synced_short",
  ]);
  const warning = new Set([
    "profile_name_invalid",
    "profile_gender_invalid",
    "profile_nickname_characters_failed",
    "raid_role_invalid",
    "raid_role_main_missing",
    "character_reauth_required",
    "character_add_invalid",
    "character_add_duplicate",
    "characters_bulk_empty",
    "characters_bulk_no_verified",
    "characters_bulk_all_duplicates",
    "characters_bulk_noop",
    "discord_nick_owner",
    "discord_nick_hierarchy",
    "discord_nick_name_missing",
  ]);

  if (ok.has(status)) {
    return { tone: "ok", text: "Зміни збережено. Перевірка нижче оновлена." };
  }
  if (warning.has(status)) {
    return {
      tone: "warning",
      text: "Дію не завершено. Перевір позначений блок і повтори з цієї сторінки.",
    };
  }
  return {
    tone: "error",
    text: "Не вдалося зберегти зміну. Спробуй ще раз або звернись до офіцера.",
  };
}

function ProblemList({
  profile,
  nicknameTemplate,
}: {
  profile: DashboardProfile | null;
  nicknameTemplate: string;
}) {
  const status = rulesOnboardingStatus(profile, nicknameTemplate);
  const visibleSteps = status.missing.length ? status.missing : [];

  if (!visibleSteps.length) {
    return (
      <div className="rules-onboarding-problems is-clear" role="status">
        <span aria-hidden="true">✓</span>
        <strong>Проблемних місць немає</strong>
        <small>Усі обовʼязкові поля заповнені. Дані все одно можна змінити нижче перед фінальним підтвердженням.</small>
      </div>
    );
  }

  return (
    <div className="rules-onboarding-steps" role="list" aria-label="Проблемні місця реєстрації">
      {visibleSteps.map((step, index) => (
        <article
          className={[
            "rules-onboarding-step",
            "is-missing",
            index === 0 ? "is-next" : "",
          ]
            .filter(Boolean)
            .join(" ")}
          role="listitem"
          key={step.key}
        >
          <span className="rules-onboarding-step__state" aria-hidden="true">
            !
          </span>
          <span className="rules-onboarding-step__body">
            <strong>{step.title}</strong>
            <small>{step.description}</small>
          </span>
        </article>
      ))}
    </div>
  );
}

function ProfileSummary({
  profile,
  nicknameTemplate,
}: {
  profile: DashboardProfile;
  nicknameTemplate: string;
}) {
  const status = rulesOnboardingStatus(profile, nicknameTemplate);
  const main = status.mainCharacter;
  const manualRole =
    profile.raidRolePreference?.characterKey === main?.key
      ? profile.raidRolePreference?.role
      : null;
  const role = getProfileRaidRole(profile);
  return (
    <div className="rules-onboarding-summary" aria-label="Підсумок профілю">
      <span>
        <strong>{profile.preferredName || "—"}</strong>
        <small>Імʼя</small>
      </span>
      <span>
        <strong>{profileGenderLabel(profile.grammaticalGender)}</strong>
        <small>Звертання</small>
      </span>
      <span>
        <strong>{main?.name || "—"}</strong>
        <small>Мейн</small>
      </span>
      <span>
        <strong>{wowRoleLabel(role)}</strong>
        <small>{manualRole ? "Роль у рейді" : "Авто зі спеки"}</small>
      </span>
      <span>
        <strong>{status.nicknamePlan.value || "—"}</strong>
        <small>Новий Discord-нік</small>
      </span>
    </div>
  );
}

function ProgressBar({ complete, total }: { complete: number; total: number }) {
  const safeTotal = Math.max(1, total);
  const percentage = Math.max(
    0,
    Math.min(100, Math.round((complete / safeTotal) * 100)),
  );
  return (
    <div
      className="rules-onboarding-progress"
      aria-label={`Заповнення профілю ${complete} з ${total}`}
    >
      <div className="rules-onboarding-progress__meta">
        <strong>{percentage}%</strong>
        <small>
          {complete} з {total} пунктів
        </small>
      </div>
      <div
        className="rules-onboarding-progress__bar"
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={total}
        aria-valuenow={complete}
        aria-valuetext={`${complete} з ${total} пунктів`}
      >
        <span style={{ width: `${percentage}%` }} />
      </div>
      <small>
        {complete === total
          ? "Усе готово до фінального підтвердження."
          : `Залишилось пунктів: ${Math.max(0, total - complete)}.`}
      </small>
    </div>
  );
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

function RegistrationGenderForm({
  value,
  returnTo,
}: {
  value?: ProfileGrammaticalGender | null;
  returnTo: string;
}) {
  const selected = value && value !== "unspecified" ? value : null;

  return (
    <section className={`rules-registration-block${selected ? "" : " is-problem"}`} aria-label="Стать або звертання профілю">
      <div className="rules-registration-block__head">
        <span className="rules-registration-block__icon" aria-hidden="true">✦</span>
        <span>
          <strong>Стать / звертання</strong>
          <small>Використовується для правильних форм у профілі, рейдах і Discord-повідомленнях.</small>
        </span>
        <span className={`profile-gender-pill${selected ? " is-selected" : " is-missing"}`}>
          {profileGenderLabel(selected || "unspecified")}
        </span>
      </div>

      <form className="profile-gender-form" action="/api/profile/gender" method="post">
        <input type="hidden" name="returnTo" value={returnTo} />
        {PROFILE_GENDER_OPTIONS.map((option) => {
          const checked = selected === option.value;
          return (
            <label className={`profile-gender-option${checked ? " is-selected" : ""}`} key={option.value}>
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

function RegistrationRaidRoleForm({
  mainCharacter,
  manualRole,
  selectedRole,
  returnTo,
}: {
  mainCharacter?: ProfileCharacter | null;
  manualRole?: WowCharacterRole | null;
  selectedRole: WowCharacterRole;
  returnTo: string;
}) {
  const autoRole = characterAutoRaidRole(mainCharacter);
  const sourceLabel = manualRole ? "Вибрано вручну" : "Авто з мейна";
  const mainLabel = mainCharacter
    ? `${mainCharacter.name}${mainCharacter.realmName || mainCharacter.realmSlug ? ` • ${mainCharacter.realmName || mainCharacter.realmSlug}` : ""}`
    : "Мейн не вибрано";

  return (
    <section className={`rules-registration-block${mainCharacter ? "" : " is-problem"}`} aria-label="Роль для запису на рейди">
      <div className="rules-registration-block__head">
        <span className="rules-registration-block__icon" aria-hidden="true">⚔</span>
        <span>
          <strong>Роль у рейді</strong>
          <small>{mainLabel}</small>
        </span>
        <span className={`profile-raid-role-pill profile-raid-role-pill--${selectedRole}`}>
          {wowRoleLabel(selectedRole)}
        </span>
      </div>

      <p className="rules-registration-block__note">
        {sourceLabel}: {manualRole ? wowRoleLabel(manualRole) : `${wowRoleLabel(autoRole)} зі спеки мейна`}. Авто — валідний стан, ручний вибір потрібен тільки якщо API визначив спек неправильно.
      </p>

      {mainCharacter ? (
        <form className="profile-raid-role-form" action="/api/profile/raid-role" method="post">
          <input type="hidden" name="returnTo" value={returnTo} />
          {RAID_ROLE_OPTIONS.map((option) => {
            const checked =
              option.value === "auto" ? !manualRole : manualRole === option.value;
            const label = option.value === "auto" ? `Авто: ${wowRoleLabel(autoRole)}` : option.label;
            return (
              <label className={`profile-raid-role-option${checked ? " is-selected" : ""}`} key={option.value}>
                <input
                  type="radio"
                  name="raidRole"
                  value={option.value}
                  defaultChecked={checked}
                />
                <span>
                  <strong>{label}</strong>
                  <small>{option.hint}</small>
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
          <strong>Спочатку додай і вибери мейна</strong>
          <span>Після цього роль підтягнеться автоматично або її можна буде вказати вручну.</span>
        </div>
      )}
    </section>
  );
}

function RegistrationNicknameCharactersForm({
  profile,
  nicknameTemplate,
  returnTo,
}: {
  profile: DashboardProfile;
  nicknameTemplate: string;
  returnTo: string;
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
    <section className={`rules-registration-block${plan.value && main ? "" : " is-problem"}`} aria-label="Персонажі для Discord nickname">
      <div className="rules-registration-block__head">
        <span className="rules-registration-block__icon" aria-hidden="true">⌁</span>
        <span>
          <strong>Discord-нік</strong>
          <small>Мейн береться автоматично. Нижче можна вибрати до двох альтів для шаблону.</small>
        </span>
        <span className="profile-count-pill">{Math.min(2, selected.size)} / 2 альти</span>
      </div>

      <div className="profile-nickname-preview is-synced">
        <span>Буде встановлено</span>
        <strong>{plan.value || "Спочатку вкажи імʼя та мейна"}</strong>
        <small>Порядок у шаблоні: {previewCharacters}. Шаблон: {nicknameTemplate}</small>
      </div>

      {altCandidates.length ? (
        <form className="profile-nickname-character-form" action="/api/profile/nickname-characters" method="post">
          <input type="hidden" name="returnTo" value={returnTo} />
          <div className="profile-nickname-character-list">
            {altCandidates.map((character) => {
              const checked = selected.has(character.key);
              return (
                <label className={`profile-nickname-character-option${checked ? " is-selected" : ""}`} key={character.key}>
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
            Сервер збере нік із мейна та максимум двох альтів. Якщо альтів немає — це не блокує реєстрацію.
          </p>
          <button className="btn btn-primary btn-sm" type="submit">
            Зберегти альтів для ніку
          </button>
        </form>
      ) : (
        <div className="profile-empty-characters profile-empty-characters--compact">
          <strong>Альтів для вибору немає</strong>
          <span>Це нормально: для завершення достатньо імені та мейн-персонажа.</span>
        </div>
      )}
    </section>
  );
}

function characterAuxMeta(
  character: Pick<ProfileCharacter, "level" | "raceName" | "faction">,
) {
  return [
    typeof character.level === "number" ? `Lvl ${character.level}` : null,
    character.raceName || null,
    character.faction || null,
  ].filter(Boolean);
}

function RegistrationCandidateRow({
  character,
  bulkFormId,
}: {
  character: ProfileCharacter;
  bulkFormId: string;
}) {
  const kindLabel = character.verifiedGuild ? "🌿 Гільдійний" : "🤝 Інший";
  const image = pickWowAvatarImageUrl(
    character.avatarUrl,
    character.renderUrl,
    character.mediaUrl,
  );
  const realmLabel = character.realmName || character.realmSlug || "Реалм —";
  const extraMeta = characterAuxMeta(character);

  return (
    <li className={`profile-character-candidate${character.verifiedGuild ? " is-guild" : " is-other"}`}>
      <label className="profile-candidate-select" title={`Позначити ${character.name}`}>
        <input
          data-profile-candidate-checkbox="true"
          form={bulkFormId}
          type="checkbox"
          name="characterKeys"
          value={character.key}
          aria-label={`Вибрати ${character.name}`}
        />
        <span aria-hidden="true" />
      </label>
      <span className="profile-character-candidate__avatar">
        {image ? <img src={image} alt="" loading="lazy" referrerPolicy="no-referrer" /> : character.name.charAt(0)}
      </span>
      <span className="profile-character-candidate__body">
        <strong>
          {character.name} <em className="profile-character-candidate__kind">{kindLabel}</em>
        </strong>
        <small>
          {realmLabel} • {character.activeSpecName ? `${character.activeSpecName} ` : ""}
          {character.className || "Клас невідомий"} • {wowRoleLabel(character.activeSpecRole)}
          {typeof character.itemLevel === "number" ? ` • ilvl ${character.itemLevel}` : ""}
          {typeof character.level === "number" ? ` • lvl ${character.level}` : ""}
        </small>
        {extraMeta.length ? <small>{extraMeta.join(" • ")}</small> : null}
      </span>
    </li>
  );
}

function RegistrationCharactersBlock({
  profile,
  returnTo,
  primaryBattleNetRegion,
  refreshMinMs,
}: {
  profile: DashboardProfile;
  returnTo: string;
  primaryBattleNetRegion: string;
  refreshMinMs: number;
}) {
  const addedKeys = new Set(
    profile.characters
      .map((item) => normalizeCharacterKey(item.key))
      .filter(Boolean),
  );
  const candidateByKey = new Map<string, ProfileCharacter>();
  for (const candidate of profile.battlenet?.candidateCharacters || []) {
    const key = normalizeCharacterKey(candidate.key);
    if (key && !candidateByKey.has(key)) candidateByKey.set(key, candidate);
  }
  const availableCandidates = Array.from(candidateByKey.values()).filter(
    (item) => !addedKeys.has(normalizeCharacterKey(item.key)),
  );
  const availableGuildCandidates = availableCandidates.filter(
    (item) => item.verifiedGuild,
  );
  const availableOtherCandidates = availableCandidates.filter(
    (item) => !item.verifiedGuild,
  );
  const hasAvailableCandidates = Boolean(
    availableCandidates.length && profile.battlenet?.candidateExpiresAt,
  );
  const hasCharacters = Boolean(profile.characters.length);
  const hasMain = Boolean(profile.mainCharacterKey && getMainCharacter(profile));
  const bulkFormId = "rules-profile-candidate-bulk-add";
  const battleNetAction = profile.battlenet?.linked
    ? {
        eyebrow: hasAvailableCandidates ? "Список отримано" : "Battle.net підключено",
        title: hasAvailableCandidates ? "Додай персонажів нижче" : "Оновити список",
        hint: hasAvailableCandidates ? "Познач потрібних і збережи" : "Потрібно для нових або оновлених персонажів",
      }
    : {
        eyebrow: "Battle.net не підключено",
        title: "Підключити Battle.net",
        hint: "Після входу персонажі зʼявляться на цій сторінці",
      };

  return (
    <section className={`rules-registration-block${hasCharacters && hasMain ? "" : " is-problem"}`} aria-label="Персонажі Battle.net">
      <div className="rules-registration-block__head">
        <span className="rules-registration-block__icon" aria-hidden="true">☘</span>
        <span>
          <strong>Персонажі Battle.net</strong>
          <small>Додай персонажів і вибери мейна без переходу в окремий профіль.</small>
        </span>
        <span className={`profile-count-pill${hasCharacters && hasMain ? " is-ok" : " is-warning"}`}>
          {profile.characters.length} перс.
        </span>
      </div>

      <div className="rules-registration-bnet-action">
        <span>
          <small>{battleNetAction.eyebrow}</small>
          <strong>{battleNetAction.title}</strong>
          <small>{battleNetAction.hint}</small>
        </span>
        <a
          className="profile-bnet-cta"
          href={`/api/auth/battlenet/start?region=${primaryBattleNetRegion}&next=${encodeURIComponent(returnTo)}`}
        >
          <span className="profile-bnet-cta__eyebrow">Battle.net</span>
          <strong>{profile.battlenet?.linked ? "Оновити" : "Підключити"}</strong>
          <small>{primaryBattleNetRegion.toUpperCase()}</small>
        </a>
      </div>

      <ProfileCharactersLiveSection
        profileId={profile.profileId}
        initialCharacters={[...profile.characters].sort((a, b) => {
          if (a.isMain !== b.isMain) return a.isMain ? -1 : 1;
          if (a.verifiedGuild !== b.verifiedGuild) return a.verifiedGuild ? -1 : 1;
          return a.name.localeCompare(b.name, "uk");
        })}
        initialUpdatedAt={
          profile.battlenet?.lastProfileViewRefreshAt ||
          profile.battlenet?.lastCharacterRefreshAt ||
          profile.battlenet?.lastSyncAt ||
          profile.updatedAt ||
          profile.lastLoginAt ||
          null
        }
        canManage={true}
        showMainBadge={true}
        returnTo={returnTo}
        candidateCount={availableCandidates.length}
        emptyMessage="Підключи Battle.net і додай мейна для завершення реєстрації."
        refreshMinMs={refreshMinMs}
      />

      {hasAvailableCandidates ? (
        <div className="profile-candidates-box" data-profile-candidates-box="true">
          <div className="profile-card-head profile-card-head--inline">
            <div>
              <span className="eyebrow">Battle.net</span>
              <h3>Можна додати</h3>
              <small className="profile-card-note">Вибери персонажів, які мають бути в профілі.</small>
            </div>
            <div className="profile-candidate-counter" aria-label="Скільки ще доступний список Battle.net">
              <span className="profile-count-pill" data-profile-candidate-count="true">
                {availableCandidates.length}
              </span>
              {profile.battlenet?.candidateExpiresAt ? (
                <ProfileCandidateExpiryTimer expiresAt={profile.battlenet.candidateExpiresAt} />
              ) : null}
            </div>
          </div>
          <form id={bulkFormId} className="profile-candidate-bulk-form" action="/api/profile/characters/bulk-add" method="post">
            <input type="hidden" name="returnTo" value={returnTo} />
          </form>
          <ProfileCandidateBulkActions formId={bulkFormId} count={availableCandidates.length} />
          <div className="profile-candidate-groups">
            {availableGuildCandidates.length ? (
              <section className="profile-candidate-group" aria-label="Кандидати гільдії">
                <div className="profile-subsection-head profile-subsection-head--compact">
                  <strong>Гільдійні</strong>
                  <small>{availableGuildCandidates.length}</small>
                </div>
                <ul className="profile-character-candidates">
                  {availableGuildCandidates.map((character) => (
                    <RegistrationCandidateRow key={character.key} character={character} bulkFormId={bulkFormId} />
                  ))}
                </ul>
              </section>
            ) : null}
            {availableOtherCandidates.length ? (
              <section className="profile-candidate-group" aria-label="Інші кандидати">
                <div className="profile-subsection-head profile-subsection-head--compact">
                  <strong>Інші</strong>
                  <small>{availableOtherCandidates.length}</small>
                </div>
                <ul className="profile-character-candidates">
                  {availableOtherCandidates.map((character) => (
                    <RegistrationCandidateRow key={character.key} character={character} bulkFormId={bulkFormId} />
                  ))}
                </ul>
              </section>
            ) : null}
          </div>
        </div>
      ) : null}
    </section>
  );
}

function RegistrationEditPanel({
  profile,
  nicknameTemplate,
  returnTo,
  primaryBattleNetRegion,
  refreshMinMs,
  canSyncDiscordNickname,
}: {
  profile: DashboardProfile;
  nicknameTemplate: string;
  returnTo: string;
  primaryBattleNetRegion: string;
  refreshMinMs: number;
  canSyncDiscordNickname: boolean;
}) {
  const mainCharacter = getMainCharacter(profile);
  const raidRolePreference = profile.raidRolePreference || null;
  const manualRaidRole =
    raidRolePreference &&
    mainCharacter &&
    raidRolePreference.characterKey === mainCharacter.key
      ? raidRolePreference.role
      : null;
  const selectedRaidRole = getProfileRaidRole(profile);
  const publicNamePreview = getProfilePublicName(profile, nicknameTemplate);
  const serverStyleNamePreview = getProfileServerStyleName(
    profile,
    80,
    nicknameTemplate,
  );
  const discordNicknamePreview = buildProfileDiscordNickname(
    profile,
    nicknameTemplate,
  );

  return (
    <section className="rules-registration-editor" aria-label="Редагування реєстраційних даних">
      <div className="profile-card-head profile-card-head--inline">
        <div>
          <span className="eyebrow">Редагування на цій сторінці</span>
          <h2>Реєстраційні дані</h2>
          <p className="profile-card-lead">
            Всі обовʼязкові дані вводяться тут: імʼя, звертання, Battle.net-персонажі, мейн, Discord-нік і роль.
          </p>
        </div>
      </div>

      <div className="rules-registration-grid">
        <article className="rules-registration-block rules-registration-block--wide" id="rules-profile-name">
          <div className="rules-registration-block__head">
            <span className="rules-registration-block__icon" aria-hidden="true">#</span>
            <span>
              <strong>Імʼя та формат відображення</strong>
              <small>Поле завжди відкрите для редагування. Після зміни натисни галочку.</small>
            </span>
          </div>
          <ProfileNameControls
            preferredName={profile.preferredName}
            publicNameMode={profile.publicNameMode}
            discordName={profile.displayName}
            publicNamePreview={publicNamePreview}
            serverStyleNamePreview={serverStyleNamePreview}
            nicknamePreview={discordNicknamePreview}
            lastSyncedNickname={profile.discordNickname?.value}
            lastSyncedAt={profile.discordNickname?.syncedAt || null}
            currentServerNickname={null}
            serverNicknameChecked={false}
            canManage={true}
            canSyncDiscord={canSyncDiscordNickname}
            discordOwnerLocked={false}
            returnTo={returnTo}
          />
        </article>

        <RegistrationGenderForm value={profile.grammaticalGender} returnTo={returnTo} />

        <RegistrationCharactersBlock
          profile={profile}
          returnTo={returnTo}
          primaryBattleNetRegion={primaryBattleNetRegion}
          refreshMinMs={refreshMinMs}
        />

        <RegistrationNicknameCharactersForm
          profile={profile}
          nicknameTemplate={nicknameTemplate}
          returnTo={returnTo}
        />

        <RegistrationRaidRoleForm
          mainCharacter={mainCharacter}
          manualRole={manualRaidRole}
          selectedRole={selectedRaidRole}
          returnTo={returnTo}
        />
      </div>
    </section>
  );
}


function AuthBenefitsList() {
  return (
    <ul className="rules-onboarding-benefits" aria-label="Переваги входу через Discord">
      <li>автоматичне звʼязування профілю з Discord;</li>
      <li>редагування імені, звертання, мейна та Battle.net-персонажів;</li>
      <li>оновлення серверного ніку за шаблоном гільдії.</li>
    </ul>
  );
}

function RegistrationLockedPanel({ loginHref }: { loginHref: string }) {
  return (
    <section
      className="rules-registration-editor rules-registration-editor--locked"
      aria-label="Вхід для редагування реєстраційних даних"
    >
      <div className="profile-card-head profile-card-head--inline">
        <div>
          <span className="eyebrow">Опційно після прийняття правил</span>
          <h2>Реєстраційні дані приховано</h2>
          <p className="profile-card-lead">
            Без Discord-входу сторінка не показує профіль, Battle.net-персонажів,
            мейна, звертання та налаштування серверного ніку. Це приватні дані,
            тому для редагування потрібна авторизація через Discord.
          </p>
        </div>
      </div>
      <div className="rules-registration-locked-card">
        <span className="rules-registration-locked-card__icon" aria-hidden="true">🔒</span>
        <span>
          <strong>Увійти через Discord</strong>
          <small>
            Після входу відкриється повний редактор реєстрації. Видача ролі через
            Discord-кнопку може працювати й без цього входу.
          </small>
        </span>
        <a className="btn primary" href={loginHref}>
          Увійти через Discord
        </a>
      </div>
    </section>
  );
}

function PublicRulesAction({
  token,
  canAcceptPublicly,
  loginHref,
}: {
  token: string;
  canAcceptPublicly: boolean;
  loginHref: string;
}) {
  return (
    <section
      className={`rules-onboarding-final-action${canAcceptPublicly ? " is-ready" : " is-pending"}`}
      aria-label="Фінальна дія прийняття правил"
    >
      <span className="rules-onboarding-final-action__copy">
        <strong>
          {canAcceptPublicly
            ? "Можна прийняти правила без входу"
            : "Потрібне Discord-підтвердження"}
        </strong>
        <small>
          {canAcceptPublicly
            ? "Discord-кнопка вже передала сайту підписаний userId. Натисни кнопку — бот видасть ту ж роль без перевірок профільного редактора."
            : "Відкрий цю сторінку з кнопки правил у Discord або увійди через Discord, інакше сайт не знає, кому видавати роль."}
        </small>
      </span>

      {canAcceptPublicly ? (
        <form
          action="/api/rules/accept/complete"
          method="post"
          data-dashboard-action="/api/rules/accept/complete"
        >
          <input type="hidden" name="rt" value={token} />
          <button
            className="btn primary rules-onboarding-primary-action"
            type="submit"
            data-loading-label="Видаємо роль..."
          >
            Прийняти правила й отримати роль
          </button>
        </form>
      ) : (
        <a className="btn primary rules-onboarding-primary-action" href={loginHref}>
          Увійти через Discord
        </a>
      )}
    </section>
  );
}

export default async function RulesAcceptPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const token = String(
    Array.isArray(params.rt) ? params.rt[0] : params.rt || "",
  ).trim();
  const parsedToken = parseRulesRoleTokenDetails(token);
  const roleIds = parsedToken.roleIds;
  const publicDiscordUserId = parsedToken.discordUserId;
  const notice = statusNotice(
    String(
      Array.isArray(params.status) ? params.status[0] : params.status || "",
    ),
  );
  const actionNotice = profileActionNotice(
    String(
      Array.isArray(params.characterStatus)
        ? params.characterStatus[0]
        : params.characterStatus || "",
    ),
  );
  const session = await getSession();
  const [nicknamePolicy, apiSettings] = await Promise.all([
    getGuildNicknamePolicy(),
    getDashboardApiSettings(),
  ]);
  const profile = session?.profileId
    ? await getProfileById(session.profileId).catch(() => null)
    : null;
  const isDiscordAuthorized = Boolean(
    session?.provider === "discord" &&
      profile?.provider === "discord" &&
      /^\d{16,25}$/.test(profile.providerUserId),
  );
  const status = rulesOnboardingStatus(profile, nicknamePolicy.template);
  const completedSteps = status.steps.filter((step) => step.complete).length;
  const nextMissingStep = status.missing[0] || null;
  const roles = roleIds.length ? await fetchDiscordRoles().catch(() => []) : [];
  const primaryRegion = getEnabledBattleNetRegions()[0] || "eu";
  const returnTo = rulesReturnPath(token);
  const loginHref = rulesLoginPath(token);
  const publicDiscordMember =
    !isDiscordAuthorized && publicDiscordUserId && hasDiscordEmbedConfig()
      ? await fetchDiscordGuildMemberSnapshot(publicDiscordUserId).catch(
          () => null,
        )
      : null;
  const tokenDiscordUser = parsedToken.discordUser;
  const publicDiscordLabel = publicDiscordMember?.displayName
    ? publicDiscordMember.displayName
    : tokenDiscordUser?.displayName ||
        tokenDiscordUser?.globalName ||
        tokenDiscordUser?.username ||
        (publicDiscordUserId ? `Discord ID ${publicDiscordUserId.slice(-6)}` : "Не визначено");
  const publicDiscordSource = publicDiscordMember
    ? "Discord bot API"
    : tokenDiscordUser
      ? "підписаний Discord token"
      : "немає підтверджених даних";
  const canAcceptPublicly = Boolean(
    !isDiscordAuthorized && roleIds.length && publicDiscordUserId,
  );
  const canSyncDiscordNickname = Boolean(
    profile?.provider === "discord" &&
      /^\d{16,25}$/.test(profile.providerUserId) &&
      hasDiscordEmbedConfig(),
  );

  return (
    <main className="container rules-onboarding-page">
      <section
        className="dashboard-shell content-shell rules-onboarding-shell"
        aria-label="Прийняття правил Mistblossom Vanguard"
      >
        {session ? (
          <DashboardIdentity
            user={session as DashboardSession}
            activeSection="profile"
          />
        ) : null}
        <header className="hero panel dashboard-hero rules-onboarding-hero">
          <div className="hero-copy dashboard-hero__copy guild-hero__copy">
            <div className="eyebrow">Mistblossom Vanguard • Правила</div>
            <h1>Прийняття правил</h1>
            <span className="hero-accent" aria-hidden="true" />
            <p className="lead">
              Сторінка доступна без обовʼязкового входу. Якщо вона відкрита з
              Discord-кнопки, бот уже має безпечне підтвердження твого Discord
              ID і може видати роль. Вхід через Discord потрібен тільки для
              повного профілю та автоматизації даних.
            </p>
            <AuthBenefitsList />
          </div>
          <HeroSidePanel
            ariaLabel="Огляд прийняття правил"
            summary={[
              {
                label: "ДОСТУП",
                value: isDiscordAuthorized ? "Discord-вхід" : "Публічна сторінка",
                note: isDiscordAuthorized
                  ? "Повний профіль і перевірки доступні"
                  : "Інші сторінки панелі лишаються закритими",
              },
              {
                label: "DISCORD",
                value: isDiscordAuthorized
                  ? profile?.displayName || session?.name || "Авторизовано"
                  : publicDiscordLabel,
                note: publicDiscordUserId
                  ? `Користувач підтверджений: ${publicDiscordSource}`
                  : "Для видачі ролі без входу потрібен клік у Discord",
              },
            ]}
            stats={[
              {
                label: "РОЛІ",
                value: roleIds.length.toLocaleString("uk-UA"),
              },
              {
                label: "ПРОФІЛЬ",
                value: isDiscordAuthorized ? "Відкрито" : "Приховано",
              },
              {
                label: "B.NET",
                value: profile?.battlenet?.linked ? "OK" : "—",
              },
            ]}
          />
        </header>

        <section
          className="panel rules-onboarding-card"
          aria-label="Стан прийняття правил"
        >
          {notice ? (
            <div
              className={`login-alert profile-storage-warning rules-onboarding-notice rules-onboarding-notice--${notice.tone}`}
              role="status"
            >
              {notice.text}
            </div>
          ) : null}
          {actionNotice ? (
            <div
              className={`login-alert profile-storage-warning rules-onboarding-notice rules-onboarding-notice--${actionNotice.tone}`}
              role="status"
            >
              {actionNotice.text}
            </div>
          ) : null}

          {!isDiscordAuthorized ? (
            <>
              <div className="profile-card-head profile-card-head--inline">
                <div>
                  <span className="eyebrow">Без обовʼязкової авторизації</span>
                  <h2>Швидке прийняття правил</h2>
                  <p className="profile-card-lead">
                    Для неавторизованого користувача профільний редактор не
                    використовується. Якщо Discord ID прийшов із підписаного
                    токена кнопки, фінальна кнопка тільки видає вибрану роль.
                  </p>
                </div>
                <span
                  className={`profile-count-pill${canAcceptPublicly ? " is-ok" : " is-warning"}`}
                >
                  {canAcceptPublicly ? "Готово" : "Потрібен Discord"}
                </span>
              </div>

              {!roleIds.length ? (
                <div className="login-alert profile-storage-warning" role="status">
                  Посилання правил не містить підтвердженої ролі. Натисни
                  актуальну кнопку “Прийняти правила” в Discord або попроси
                  офіцера оновити embed правил.
                </div>
              ) : null}

              <div className="rules-onboarding-role-box">
                <strong>Роль після прийняття</strong>
                <span>
                  {roleIds.length
                    ? roleIds.map((roleId) => roleName(roleId, roles)).join(", ")
                    : "Не задано"}
                </span>
                <small>
                  Discord-користувач: {publicDiscordLabel}. Джерело: {publicDiscordSource}.
                  Дані передаються з Discord interaction у підписаному токені та,
                  коли доступно, доповнюються через bot API без прямої OAuth-авторизації.
                </small>
              </div>

              <PublicRulesAction
                token={token}
                canAcceptPublicly={canAcceptPublicly}
                loginHref={loginHref}
              />

              <RegistrationLockedPanel loginHref={loginHref} />
            </>
          ) : !roleIds.length ? (
            <div className="login-alert profile-storage-warning" role="status">
              Посилання правил не містить підтвердженої ролі. Натисни актуальну
              кнопку “Прийняти правила” в Discord або попроси офіцера оновити
              embed правил.
            </div>
          ) : profile ? (
            <>
              <div className="profile-card-head profile-card-head--inline">
                <div>
                  <span className="eyebrow">Обовʼязково для повного профілю</span>
                  <h2>
                    {status.complete
                      ? "Профіль готовий"
                      : "Дані неповні або некоректні"}
                  </h2>
                </div>
                <span
                  className={`profile-count-pill${status.complete ? " is-ok" : " is-warning"}`}
                >
                  {completedSteps}/{status.steps.length}
                </span>
              </div>
              <ProgressBar complete={completedSteps} total={status.steps.length} />
              <ProfileSummary
                profile={profile}
                nicknameTemplate={nicknamePolicy.template}
              />
              {!status.complete ? (
                <div className="rules-onboarding-data-warning" role="status">
                  <strong>Реєстрація ще не готова</strong>
                  <small>
                    Нижче показані тільки проблемні місця. Всі потрібні поля
                    редагуються прямо на цій сторінці, без переходу в окремі
                    налаштування профілю.
                  </small>
                </div>
              ) : null}
              <ProblemList
                profile={profile}
                nicknameTemplate={nicknamePolicy.template}
              />

              <RegistrationEditPanel
                profile={profile}
                nicknameTemplate={nicknamePolicy.template}
                returnTo={returnTo}
                primaryBattleNetRegion={primaryRegion}
                refreshMinMs={apiSettings.profileViewRefreshMinSeconds * 1000}
                canSyncDiscordNickname={canSyncDiscordNickname}
              />

              <div className="rules-onboarding-role-box">
                <strong>Роль після завершення</strong>
                <span>
                  {roleIds.map((roleId) => roleName(roleId, roles)).join(", ")}
                </span>
                <small>
                  <span id="rules-complete-help">
                    Роль видається після одного фінального підтвердження. Нік
                    формується за шаблоном: {nicknamePolicy.template}.
                  </span>
                </small>
              </div>

              <section
                className={`rules-onboarding-final-action${status.complete ? " is-ready" : " is-pending"}`}
                aria-label="Фінальна дія реєстрації"
              >
                <span className="rules-onboarding-final-action__copy">
                  <strong>
                    {status.complete
                      ? "Можна підтверджувати"
                      : nextMissingStep
                        ? `Проблемне місце: ${nextMissingStep.title}`
                        : "Потрібно доповнити профіль"}
                  </strong>
                  <small>
                    {status.complete
                      ? "Залишилась одна дія: підтвердити правила, видати Discord-роль і прийняти зміни профілю."
                      : nextMissingStep?.description ||
                        "Заповни обовʼязкові дані прямо на цій сторінці, після цього тут зʼявиться фінальне підтвердження."}
                  </small>
                </span>

                {status.complete ? (
                  <form
                    action="/api/rules/accept/complete"
                    method="post"
                    data-dashboard-action="/api/rules/accept/complete"
                    aria-describedby="rules-complete-help"
                  >
                    <input type="hidden" name="rt" value={token} />
                    <button
                      className="btn primary rules-onboarding-primary-action"
                      type="submit"
                      data-loading-label="Підтверджуємо..."
                    >
                      Підтвердити й прийняти зміни
                    </button>
                  </form>
                ) : null}
              </section>
            </>
          ) : (
            <div className="login-alert profile-storage-warning" role="status">
              Профіль ще створюється або тимчасово недоступний. Онови сторінку
              через кілька секунд.
            </div>
          )}
        </section>
      </section>
    </main>
  );
}
