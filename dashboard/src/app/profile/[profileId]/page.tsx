import type { ReactNode } from "react";
import DashboardIdentity from "@/components/DashboardIdentity";
import LogoutButton from "@/components/LogoutButton";
import ProfileCandidateBulkActions from "@/components/ProfileCandidateBulkActions";
import ProfileCandidateExpiryTimer from "@/components/ProfileCandidateExpiryTimer";
import ProfileCharactersLiveSection from "@/components/ProfileCharactersLiveSection";
import { getEnabledBattleNetRegions } from "@/lib/battlenet";
import {
  normalizeCharacterKey,
  pickWowAvatarImageUrl,
} from "@/lib/wowCharacters";
import {
  listProfileRaidSignups,
  raidDisplayCapacity,
  raidAutoCompositionLabel,
  raidTitle,
  raidDifficultyLabel,
  type ProfileRaidSignup,
} from "@/lib/raids";
import { buildPageMetadata } from "@/lib/seo";
import { formatStableUkCompactDate } from "@/lib/stableUiText";
import { getDashboardApiSettings } from "@/lib/dashboardApiSettings";
import { wowRoleLabel } from "@/lib/wowRoles";
import { getSession, type DashboardSession } from "@/lib/auth";
import {
  canViewProfileAccessDetails,
  dashboardRoleLabel,
  guildStatusLabel,
} from "@/lib/permissions";
import {
  canViewProfile,
  profileGenderedText,
  getMainCharacter,
  getProfilePublicName,
  getProfileRaidRole,
  getProfileById,
  profileNeedsSettingsSetup,
  profileSettingsSetupPath,
  profileFromSession,
  upsertProfileFromSession,
  type DashboardProfile,
  type ProfileCharacter,
} from "@/lib/profiles";
import { getGuildNicknamePolicy } from "@/lib/guildNicknamePolicy";
import { notFound, redirect } from "next/navigation";

export const metadata = buildPageMetadata({
  title: "Профіль учасника",
  description:
    "Профіль учасника Mistblossom Vanguard з Battle.net-персонажами, мейном і записами на рейди.",
  path: "/profile",
  keywords: ["профіль учасника", "мейн персонаж", "Battle.net", "рейдова роль"],
});

export const dynamic = "force-dynamic";
export const revalidate = 0;


type ProfileUiIconKind =
  | "home"
  | "gear"
  | "swords"
  | "shield"
  | "user"
  | "group"
  | "link"
  | "check"
  | "sync"
  | "plus"
  | "calendar"
  | "crown"
  | "leaf";

function ProfileUiIcon({ kind }: { kind: ProfileUiIconKind }) {
  return <span className={`profile-ui-icon profile-ui-icon--${kind}`} aria-hidden="true" />;
}

function battleNetActionCopy(
  profile: DashboardProfile,
  hasFreshBattleNetSession: boolean,
) {
  if (hasFreshBattleNetSession) {
    return {
      eyebrow: "Готово до додавання",
      title: "Додати персонажів",
      hint: "Вибери потрібних зі свіжого списку",
    };
  }
  if (profile.battlenet?.linked) {
    return {
      eyebrow: "Battle.net підключено",
      title: "Оновити список",
      hint: "Потрібно для нових або оновлених персонажів",
    };
  }
  return {
    eyebrow: "Battle.net не підключено",
    title: "Підключити Battle.net",
    hint: "Знайде гільдійних та інших персонажів Battle.net",
  };
}

function characterAvatarUrl(
  character?: Pick<
    ProfileCharacter,
    "renderUrl" | "avatarUrl" | "mediaUrl"
  > | null,
) {
  if (!character) return null;
  return pickWowAvatarImageUrl(
    character.avatarUrl,
    character.renderUrl,
    character.mediaUrl,
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

function raidSignupStatusLabel(
  status: string,
  gender?: DashboardProfile["grammaticalGender"] | null,
) {
  if (status === "going")
    return profileGenderedText(gender, "Підписаний", "Підписана", "Підписали");
  if (status === "tentative") return "50/50";
  if (status === "late") return "Затримаюсь";
  if (status === "skipped") return "Пропускає";
  return "Невідомо";
}

function raidSignupStatusClass(status: string) {
  if (status === "going") return "success";
  if (status === "tentative") return "warning";
  if (status === "late") return "info";
  if (status === "skipped") return "muted";
  return "muted";
}

function raidRoleClass(role: string) {
  if (role === "tank") return "tank";
  if (role === "healer") return "healer";
  if (role === "dps") return "dps";
  return "unknown";
}

function ProfileRaidMetaItem({
  label,
  value,
  detail,
  className = "",
}: {
  label: string;
  value: ReactNode;
  detail?: ReactNode;
  className?: string;
}) {
  return (
    <span className={`profile-raid-meta-item ${className}`.trim()}>
      <small>{label}</small>
      <strong>{value}</strong>
      {detail ? <em>{detail}</em> : null}
    </span>
  );
}

function ProfileRaidSignupCard({ item }: { item: ProfileRaidSignup }) {
  const characterName = item.signup.characterName || item.signup.discordName || "Без персонажа";
  const realmLabel = item.signup.realmName || item.signup.realmSlug || "";
  const characterLabel = realmLabel ? `${characterName} • ${realmLabel}` : characterName;
  const specLabel = [item.signup.activeSpecName, item.signup.className]
    .filter(Boolean)
    .join(" • ");
  const activeRoster = item.raid.signups.filter(
    (signup) => signup.status === "going" || signup.status === "tentative" || signup.status === "late",
  ).length;
  const composition = `${activeRoster} / ${raidDisplayCapacity(item.raid)} • ${raidAutoCompositionLabel(item.raid)}`;
  const statusLabel = raidSignupStatusLabel(
    item.signup.status,
    item.signup.grammaticalGender,
  );
  const roleLabel = wowRoleLabel(item.signup.role);
  const dateLabel =
    [item.raid.date, item.raid.time].filter(Boolean).join(", ") ||
    "Дата уточнюється";
  const difficultyLabel = raidDifficultyLabel(item.raid.difficulty);

  return (
    <article
      className={`profile-raid-card profile-raid-card--${item.signup.status}`}
    >
      <a
        className="profile-raid-card__main"
        href={`/raids/${encodeURIComponent(item.raid.id)}`}
      >
        <span className={`profile-raid-card__icon profile-raid-card__icon--${raidRoleClass(item.signup.role)}`} aria-hidden="true">
          ⚔
        </span>
        <span className="profile-raid-card__title">
          <strong>{raidTitle(item.raid)}</strong>
          <small>{dateLabel}</small>
          <em>{difficultyLabel}</em>
        </span>
      </a>

      <div className="profile-raid-card__body">
        <div className="profile-raid-card__headline">
          <span
            className={`profile-raid-status-chip profile-raid-status-chip--${raidSignupStatusClass(item.signup.status)}`}
          >
            {statusLabel}
          </span>
          <span
            className={`profile-raid-role-chip profile-raid-role-chip--${raidRoleClass(item.signup.role)}`}
          >
            {roleLabel}
          </span>
        </div>

        <div className="profile-raid-card__meta">
          <ProfileRaidMetaItem
            label="Порядок"
            value={item.signup.signupNumber ? `#${item.signup.signupNumber}` : "—"}
            className="profile-raid-meta-item--order"
          />
          <ProfileRaidMetaItem
            label="Персонаж"
            value={characterLabel}
            detail={specLabel || "Клас / спек не вказано"}
            className="profile-raid-meta-item--character"
          />
          <ProfileRaidMetaItem
            label="Роль"
            value={roleLabel}
            detail={specLabel || "Роль запису"}
          />
          <ProfileRaidMetaItem
            label="Склад"
            value={composition}
          />
        </div>

        <div className="profile-raid-card__actions">
          <a
            className="profile-raid-card__action"
            href={`/raids/${encodeURIComponent(item.raid.id)}`}
          >
            Відкрити рейд
          </a>
        </div>
      </div>
    </article>
  );
}

function ProfileRaidSignups({ items }: { items: ProfileRaidSignup[] }) {
  const active = items.filter(
    (item) => item.signup.status === "going" || item.signup.status === "tentative" || item.signup.status === "late",
  );
  const skipped = items.filter((item) => item.signup.status === "skipped");

  return (
    <article
      id="profile-raids"
      className="panel profile-card profile-card--raids profile-card--raids-modern"
    >
      <div className="profile-card-head profile-card-head--inline profile-card-head--raids">
        <div>
          <span className="eyebrow">Рейди</span>
          <h2>Мої записи</h2>
        </div>
        <span className="profile-count-pill profile-count-pill--raid-count">{active.length}</span>
      </div>
      <p className="profile-card-lead profile-card-lead--raids">
        Тут видно активні записи на рейди. Для кожного нового запису персонажа
        потрібно вибрати вручну.
      </p>

      {items.length ? (
        <div className="profile-raid-list">
          {active.map((item) => (
            <ProfileRaidSignupCard
              key={`${item.raid.id}-${item.signup.discordId}`}
              item={item}
            />
          ))}
          {skipped.length ? (
            <details className="profile-raid-skipped">
              <summary>Пропущені рейди: {skipped.length}</summary>
              <div className="profile-raid-list profile-raid-list--nested">
                {skipped.map((item) => (
                  <ProfileRaidSignupCard
                    key={`${item.raid.id}-${item.signup.discordId}-skipped`}
                    item={item}
                  />
                ))}
              </div>
            </details>
          ) : null}
        </div>
      ) : (
        <div className="profile-raid-empty-state">
          <span className="profile-raid-empty-state__icon" aria-hidden="true">
            ⚔
          </span>
          <div>
            <strong>У тебе ще немає активних записів на рейди</strong>
            <span>
              Коли ти запишеш персонажа на рейд, запис зʼявиться тут.
            </span>
          </div>
          <a className="profile-raid-empty-state__action" href="/raids">
            Перейти до рейдів
          </a>
        </div>
      )}
    </article>
  );
}

function CandidateRow({
  character,
  bulkFormId,
}: {
  character: ProfileCharacter;
  bulkFormId: string;
}) {
  const kindLabel = character.verifiedGuild ? "🌿 Гільдійний" : "🤝 Інший";
  const image = characterAvatarUrl(character);
  const realmLabel = character.realmName || character.realmSlug || "Реалм —";
  const extraMeta = characterAuxMeta(character);
  return (
    <li
      className={`profile-character-candidate${character.verifiedGuild ? " is-guild" : " is-other"}`}
    >
      <label
        className="profile-candidate-select"
        title={`Позначити ${character.name}`}
      >
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
        {image ? (
          <img src={image} alt="" loading="lazy" referrerPolicy="no-referrer" />
        ) : (
          character.name.charAt(0)
        )}
      </span>
      <span className="profile-character-candidate__body">
        <strong>
          {character.name}{" "}
          <em className="profile-character-candidate__kind">{kindLabel}</em>
        </strong>
        <small>
          {realmLabel} •{" "}
          {character.activeSpecName ? `${character.activeSpecName} ` : ""}
          {character.className || "Клас невідомий"} •{" "}
          {wowRoleLabel(character.activeSpecRole)}
          {typeof character.itemLevel === "number"
            ? ` • ilvl ${character.itemLevel}`
            : ""}
          {typeof character.level === "number"
            ? ` • lvl ${character.level}`
            : ""}
        </small>
        {extraMeta.length ? <small>{extraMeta.join(" • ")}</small> : null}
      </span>
    </li>
  );
}

export default async function ProfilePage({
  params,
  searchParams,
}: {
  params: Promise<{ profileId: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const session = await getSession();
  const nicknamePolicy = await getGuildNicknamePolicy();
  if (!session) {
    redirect("/login");
    throw new Error("Unauthorized");
  }
  const viewer: DashboardSession = session;

  const [{ profileId }, query] = await Promise.all([params, searchParams]);
  const rulesReturnToken = String(
    Array.isArray(query.rt) ? query.rt[0] : query.rt || "",
  ).trim();
  const isRulesReturn =
    String(Array.isArray(query.from) ? query.from[0] : query.from || "") ===
      "rules" && Boolean(rulesReturnToken);
  const profileRulesReturnPath = isRulesReturn
    ? `/profile/${profileId}?from=rules&rt=${encodeURIComponent(rulesReturnToken)}`
    : "";
  const settingsRulesReturnPath = isRulesReturn
    ? `/profile/${profileId}/settings?setup=1&from=rules&rt=${encodeURIComponent(rulesReturnToken)}`
    : "";
  const rulesReviewPath = isRulesReturn
    ? `/rules/accept?rt=${encodeURIComponent(rulesReturnToken)}&status=incomplete`
    : "";
  const initialProfile = await getProfileById(profileId);

  const isOwnProfile = Boolean(
    viewer.profileId && viewer.profileId === profileId,
  );
  if (initialProfile && !canViewProfile(viewer, profileId, initialProfile)) {
    notFound();
  }
  if (!initialProfile && !isOwnProfile && !canViewProfile(viewer, profileId)) {
    notFound();
  }

  let profile = initialProfile;
  let storageWarning = "";

  if (!profile && isOwnProfile) {
    const result = await upsertProfileFromSession(viewer).catch(() => null);
    profile = result?.profile || { ...profileFromSession(viewer), profileId };
    if (!result?.stored) {
      storageWarning =
        "Профіль тимчасово показано з поточної сесії. Частина даних може оновитися після повторного входу.";
    }
  }

  if (!profile) {
    notFound();
  }

  if (isOwnProfile && profileNeedsSettingsSetup(profile)) {
    const setupPath = profileSettingsSetupPath(profile.profileId);
    redirect(
      isRulesReturn
        ? `${setupPath}&from=rules&rt=${encodeURIComponent(rulesReturnToken)}`
        : setupPath,
    );
  }

  const mainCharacter = getMainCharacter(profile);
  const selectedRaidRole = getProfileRaidRole(profile);
  const enabledBattleNetRegions = getEnabledBattleNetRegions();
  const canManageCharacters = isOwnProfile;
  const canViewPrivateProfileBlocks =
    isOwnProfile || canViewProfileAccessDetails(viewer);
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
  const profileGuildCharacterCount = profile.characters.filter(
    (item) => item.verifiedGuild,
  ).length;
  const hasAvailableBattleNetCandidates = Boolean(
    availableCandidates.length && profile.battlenet?.candidateExpiresAt,
  );
  const hasFreshBattleNetSession = hasAvailableBattleNetCandidates;
  const primaryBattleNetRegion = enabledBattleNetRegions[0] || "eu";
  const battleNetAction = battleNetActionCopy(
    profile,
    hasFreshBattleNetSession,
  );
  const battleNetRefreshHref = `/api/auth/battlenet/start?region=${primaryBattleNetRegion}${profileRulesReturnPath ? `&next=${encodeURIComponent(profileRulesReturnPath)}` : ""}`;
  const battleNetLastSyncAt =
    profile.battlenet?.lastProfileViewRefreshAt ||
    profile.battlenet?.lastCharacterRefreshAt ||
    profile.battlenet?.lastSyncAt ||
    null;
  const battleNetLastSyncLabel = formatStableUkCompactDate(battleNetLastSyncAt);
  const bulkFormId = "profile-candidate-bulk-add";
  const publicNamePreview = getProfilePublicName(
    profile,
    nicknamePolicy.template,
  );
  const guildStatus = guildStatusLabel(profile.role);
  const apiSettings = await getDashboardApiSettings();
  const raidSignups = canViewPrivateProfileBlocks
    ? await listProfileRaidSignups(profile).catch(() => [])
    : [];
  const accountStatusLabel = dashboardRoleLabel(profile.role);
  const visibleCharacters = [...profile.characters].sort((a, b) => {
    if (a.isMain !== b.isMain) return a.isMain ? -1 : 1;
    if (a.verifiedGuild !== b.verifiedGuild) return a.verifiedGuild ? -1 : 1;
    return a.name.localeCompare(b.name, "uk");
  });
  return (
    <main className="container profile-page-container">
      <section
        className="dashboard-shell content-shell profile-shell profile-account-page"
        aria-label="Профіль Mistblossom Vanguard"
      >
        <DashboardIdentity user={viewer} activeSection="profile" />
        {/* Класична двоколонкова схема: липка бічна колонка з
            навігацією та коротким станом + основний потік праворуч.
            Проти першої версії тут додано швидкі показники в бічній
            колонці й активний стан пунктів, а на телефоні колонка
            стає горизонтальною смугою, а не високим блоком. */}
        <div className="profile-account-layout">
          <aside className="panel profile-account-sidebar" aria-label="Навігація профілю">
            <div className="profile-account-sidebar__identity">
              {profile.avatarUrl ? (
                <img
                  className="profile-account-sidebar__avatar"
                  src={profile.avatarUrl}
                  alt=""
                  width={96}
                  height={96}
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
              <div className="profile-account-sidebar__pills" aria-label="Стан профілю">
                <span className="status-pill">{guildStatus}</span>
                <span className="status-pill">⚔ {wowRoleLabel(selectedRaidRole)}</span>
              </div>
            </div>

            {/* Короткий стан замість переходу на іншу сторінку по число */}
            <dl className="profile-account-sidebar__facts">
              <div>
                <dt>Персонажів</dt>
                <dd>{profile.characters.length}</dd>
              </div>
              <div>
                <dt>Гільдійних</dt>
                <dd>{profileGuildCharacterCount}</dd>
              </div>
              <div>
                <dt>Мейн</dt>
                <dd>{mainCharacter?.name || "—"}</dd>
              </div>
              <div>
                <dt>Battle.net</dt>
                <dd>{profile.battlenet?.linked ? "Підключено" : "Немає"}</dd>
              </div>
            </dl>

            <nav className="profile-account-sidebar__nav" aria-label="Розділи профілю">
              <a href={`/profile/${encodeURIComponent(profile.profileId)}`} aria-current="page">
                <ProfileUiIcon kind="home" /> <span className="profile-account-sidebar__nav-label">Огляд</span>
              </a>
              <a href="#profile-characters">
                <ProfileUiIcon kind="swords" /> <span className="profile-account-sidebar__nav-label">Персонажі</span>
                {profile.characters.length ? (
                  <span className="profile-account-sidebar__nav-count">{profile.characters.length}</span>
                ) : null}
              </a>
              {canViewPrivateProfileBlocks ? (
                <a href="#profile-raids">
                  <ProfileUiIcon kind="shield" /> <span className="profile-account-sidebar__nav-label">Рейди</span>
                </a>
              ) : null}
              {isOwnProfile ? (
                <a
                  href={
                    settingsRulesReturnPath ||
                    `/profile/${encodeURIComponent(profile.profileId)}/settings`
                  }
                >
                  <ProfileUiIcon kind="gear" /> <span className="profile-account-sidebar__nav-label">Налаштування</span>
                </a>
              ) : null}
            </nav>

            {isOwnProfile ? (
              <div className="profile-account-sidebar__footer">
                <LogoutButton />
              </div>
            ) : null}
          </aside>

          <div className="profile-account-main">
            <header className="profile-account-header" id="profile-overview">
              <div>
                <span className="eyebrow">Mistblossom Vanguard • Профіль</span>
                <h1>{isOwnProfile ? "Мій профіль" : "Профіль учасника"}</h1>
                <p>
                  Тут — Battle.net, персонажі, мейн і рейдові записи.
                  Імʼя, звертання та Discord-нік редагуються в налаштуваннях.
                </p>
              </div>
              <div className="profile-account-header__actions">
                {/* Підключення Battle.net — головна дія, доки акаунт не привʼязаний */}
                <a className="btn subtle btn-sm" href={battleNetRefreshHref}>
                  <ProfileUiIcon kind="swords" />
                  <span>{profile.battlenet?.linked ? "Оновити Battle.net" : "Підключити Battle.net"}</span>
                </a>
                {isOwnProfile ? (
                  <a
                    className="btn primary btn-sm profile-header-settings"
                    href={
                      settingsRulesReturnPath ||
                      `/profile/${encodeURIComponent(profile.profileId)}/settings`
                    }
                  >
                    <ProfileUiIcon kind="gear" />
                    <span>Налаштування</span>
                  </a>
                ) : null}
              </div>
            </header>
            <section
              className="profile-account-overview profile-account-overview--clean"
              aria-label="Короткий стан профілю"
            >
              <div className="profile-account-overview-card profile-account-overview-card--primary">
                <span
                  className="profile-account-overview-card__icon"
                  aria-hidden="true"
                >
                  <ProfileUiIcon kind="user" />
                </span>
                <span>
                  <small>Імʼя профілю</small>
                  <strong>{publicNamePreview}</strong>
                </span>
              </div>
              <div className="profile-account-overview-card profile-account-overview-card--main-role">
                <span
                  className="profile-account-overview-card__icon"
                  aria-hidden="true"
                >
                  <ProfileUiIcon kind="swords" />
                </span>
                <span>
                  <small>Мейн / роль у рейді</small>
                  <strong>{mainCharacter?.name || "—"}</strong>
                  <small className="profile-account-overview-card__meta">
                    {wowRoleLabel(selectedRaidRole)}
                  </small>
                </span>
              </div>
              <div className="profile-account-overview-card">
                <span
                  className="profile-account-overview-card__icon"
                  aria-hidden="true"
                >
                  <ProfileUiIcon kind="group" />
                </span>
                <span>
                  <small>Персонажі</small>
                  <strong>{visibleCharacters.length}</strong>
                  <small className="profile-account-overview-card__meta">
                    {profileGuildCharacterCount} гільдійних
                  </small>
                </span>
              </div>
              <div className="profile-account-overview-card profile-account-overview-card--success">
                <span
                  className="profile-account-overview-card__icon"
                  aria-hidden="true"
                >
                  <ProfileUiIcon kind="link" />
                </span>
                <span>
                  <small>Battle.net</small>
                  <strong>
                    {profile.battlenet?.linked ? "Підключено" : "Не підключено"}
                  </strong>
                </span>
              </div>
            </section>

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
                    Перевір персонажів і мейна, потім повернись до перевірки
                    правил.
                  </small>
                </span>
                <a className="btn btn-ghost btn-sm" href={rulesReviewPath}>
                  Повернутись до правил
                </a>
              </div>
            ) : null}
            {!isOwnProfile && canViewPrivateProfileBlocks ? (
              <div
                className="login-alert profile-storage-warning"
                role="status"
              >
                Ти можеш переглядати цей профіль, але змінювати персонажів може
                тільки власник.
              </div>
            ) : null}

            <section
              className="profile-grid profile-grid--single"
              aria-label="Персонажі профілю"
            >
              <article
                id="profile-characters"
                className="panel profile-card profile-card--characters"
              >
                <div className="profile-card-head profile-card-head--inline profile-card-head--bnet">
                  <div className="profile-card-title-with-icon">
                    <span className="profile-card-title-icon" aria-hidden="true">
                      <ProfileUiIcon kind="user" />
                    </span>
                    <span>
                      <span className="eyebrow">Battle.net</span>
                      <h2>Персонажі Battle.net</h2>
                    </span>
                  </div>
                  {canManageCharacters ? (
                    <div
                      className={`profile-bnet-status${profile.battlenet?.linked ? " is-connected" : " is-disconnected"}`}
                      aria-label="Підключити або оновити Battle.net"
                    >
                      <span className="profile-bnet-status__icon" aria-hidden="true">
                        <ProfileUiIcon kind={profile.battlenet?.linked ? "check" : "link"} />
                      </span>
                      <span className="profile-bnet-status__copy">
                        <strong>{profile.battlenet?.linked ? "Battle.net підключено" : battleNetAction.eyebrow}</strong>
                        <small>{profile.battlenet?.linked ? `Остання синхронізація: ${battleNetLastSyncLabel}` : battleNetAction.hint}</small>
                      </span>
                      <a className="profile-bnet-status__action" href={battleNetRefreshHref}>
                        <ProfileUiIcon kind={profile.battlenet?.linked ? "sync" : "link"} />
                        <span>{battleNetAction.title}</span>
                      </a>
                    </div>
                  ) : null}
                </div>

                <ProfileCharactersLiveSection
                  profileId={profile.profileId}
                  initialCharacters={visibleCharacters}
                  initialUpdatedAt={
                    profile.battlenet?.lastProfileViewRefreshAt ||
                    profile.battlenet?.lastCharacterRefreshAt ||
                    profile.battlenet?.lastSyncAt ||
                    profile.updatedAt ||
                    profile.lastLoginAt ||
                    mainCharacter?.lastSeenAt ||
                    null
                  }
                  canManage={canManageCharacters}
                  showMainBadge={canViewPrivateProfileBlocks}
                  returnTo={profileRulesReturnPath}
                  candidateCount={availableCandidates.length}
                  emptyMessage={
                    canManageCharacters
                      ? "Підключи Battle.net і додай мейна для рейдів."
                      : "Учасник ще не додав персонажів."
                  }
                  refreshMinMs={apiSettings.profileViewRefreshMinSeconds * 1000}
                />

                {canManageCharacters ? (
                  <div className="profile-character-add-footer">
                    <span>
                      <ProfileUiIcon kind="plus" />
                      <span>
                        {hasAvailableBattleNetCandidates
                          ? `Персонажів можна додати: ${availableCandidates.length}`
                          : profile.battlenet?.linked
                            ? "Список персонажів Battle.net застарів — онови, щоб додати ще"
                            : "Підключи Battle.net, щоб додати персонажів"}
                      </span>
                    </span>
                    <a className="profile-character-add-button" href={battleNetRefreshHref}>
                      <ProfileUiIcon kind="plus" />
                      <span>
                        {hasAvailableBattleNetCandidates
                          ? "Додати персонажа"
                          : profile.battlenet?.linked
                            ? "Оновити список"
                            : "Підключити Battle.net"}
                      </span>
                    </a>
                  </div>
                ) : null}

                {/* Раніше блок «Можна додати» просто зникав, коли список
                    кандидатів застарівав, і людина не розуміла, чому
                    кнопка нічого не дає. Тепер стан названо явно. */}
                {canManageCharacters &&
                !hasAvailableBattleNetCandidates &&
                profile.battlenet?.linked ? (
                  <div className="profile-bnet-cta" role="status">
                    <span className="profile-bnet-cta__eyebrow">Battle.net</span>
                    <strong>Список персонажів більше не активний</strong>
                    <span>
                      Список тримається обмежений час після входу через Battle.net.
                      Натисни «Оновити список» — і персонажі знову зʼявляться тут.
                      Уже додані персонажі нікуди не зникають.
                    </span>
                    <a className="btn primary btn-sm" href={battleNetRefreshHref}>
                      Оновити список Battle.net
                    </a>
                  </div>
                ) : null}

                {canManageCharacters && hasAvailableBattleNetCandidates ? (
                  <div
                    className="profile-candidates-box"
                    data-profile-candidates-box="true"
                  >
                    <div className="profile-card-head profile-card-head--inline">
                      <div>
                        <span className="eyebrow">Battle.net</span>
                        <h3>Можна додати</h3>
                        <small className="profile-card-note">
                          Вибери гільдійних або інших персонажів, які мають бути
                          в профілі.
                        </small>
                      </div>
                      <div
                        className="profile-candidate-counter"
                        aria-label="Скільки ще доступний список Battle.net"
                      >
                        <span
                          className="profile-count-pill"
                          data-profile-candidate-count="true"
                        >
                          {availableCandidates.length}
                        </span>
                        {profile.battlenet?.candidateExpiresAt ? (
                          <ProfileCandidateExpiryTimer
                            expiresAt={profile.battlenet.candidateExpiresAt}
                          />
                        ) : null}
                      </div>
                    </div>
                    <form
                      id={bulkFormId}
                      className="profile-candidate-bulk-form"
                      action="/api/profile/characters/bulk-add"
                      method="post"
                    >
                      {profileRulesReturnPath ? (
                        <input
                          type="hidden"
                          name="returnTo"
                          value={profileRulesReturnPath}
                        />
                      ) : null}
                    </form>
                    <ProfileCandidateBulkActions
                      formId={bulkFormId}
                      count={availableCandidates.length}
                    />
                    <div className="profile-candidate-groups">
                      {availableGuildCandidates.length ? (
                        <section
                          className="profile-candidate-group"
                          aria-label="Кандидати гільдії"
                        >
                          <div className="profile-subsection-head profile-subsection-head--compact">
                            <strong>Гільдійні</strong>
                            <small>{availableGuildCandidates.length}</small>
                          </div>
                          <ul className="profile-character-candidates">
                            {availableGuildCandidates.map((character) => (
                              <CandidateRow
                                key={character.key}
                                character={character}
                                bulkFormId={bulkFormId}
                              />
                            ))}
                          </ul>
                        </section>
                      ) : null}
                      {availableOtherCandidates.length ? (
                        <section
                          className="profile-candidate-group"
                          aria-label="Інші кандидати"
                        >
                          <div className="profile-subsection-head profile-subsection-head--compact">
                            <strong>Інші</strong>
                            <small>{availableOtherCandidates.length}</small>
                          </div>
                          <ul className="profile-character-candidates">
                            {availableOtherCandidates.map((character) => (
                              <CandidateRow
                                key={character.key}
                                character={character}
                                bulkFormId={bulkFormId}
                              />
                            ))}
                          </ul>
                        </section>
                      ) : null}
                    </div>
                  </div>
                ) : null}
              </article>

              {canViewPrivateProfileBlocks ? (
                <ProfileRaidSignups items={raidSignups} />
              ) : null}
            </section>
          </div>
        </div>
      </section>
    </main>
  );
}
