import DashboardIdentity from "@/components/DashboardIdentity";
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
  type ProfileRaidSignup,
} from "@/lib/raids";
import { buildPageMetadata } from "@/lib/seo";
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

function ProfileRaidSignupCard({ item }: { item: ProfileRaidSignup }) {
  const characterLabel = item.signup.characterName
    ? `${item.signup.characterName}${item.signup.realmName ? ` • ${item.signup.realmName}` : ""}`
    : item.signup.discordName || "Без персонажа";
  const specLabel = [item.signup.activeSpecName, item.signup.className]
    .filter(Boolean)
    .join(" • ");
  const activeRoster = item.raid.signups.filter(
    (signup) => signup.status === "going" || signup.status === "tentative" || signup.status === "late",
  ).length;
  const composition = `${activeRoster} / ${raidDisplayCapacity(item.raid)} • ${raidAutoCompositionLabel(item.raid)}`;

  return (
    <article
      className={`profile-raid-card profile-raid-card--${item.signup.status}`}
    >
      <a
        className="profile-raid-card__main"
        href={`/raids/${encodeURIComponent(item.raid.id)}`}
      >
        <span className="profile-raid-card__icon" aria-hidden="true">
          ⚔
        </span>
        <span>
          <strong>{raidTitle(item.raid)}</strong>
          <small>
            {[item.raid.date, item.raid.time].filter(Boolean).join(", ") ||
              "Дата уточнюється"}
          </small>
        </span>
      </a>
      <div className="profile-raid-card__meta">
        {item.signup.signupNumber ? (
          <span>
            <strong>#{item.signup.signupNumber}</strong>
            <small>Порядок запису</small>
          </span>
        ) : null}
        <span>
          <strong>
            {raidSignupStatusLabel(
              item.signup.status,
              item.signup.grammaticalGender,
            )}
          </strong>
          <small>Статус</small>
        </span>
        <span>
          <strong>{characterLabel}</strong>
          <small>Персонаж</small>
        </span>
        <span>
          <strong>{wowRoleLabel(item.signup.role)}</strong>
          <small>{specLabel || "Роль"}</small>
        </span>
        <span>
          <strong>{composition}</strong>
          <small>Склад</small>
        </span>
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
      className="panel profile-card profile-card--raids"
    >
      <div className="profile-card-head profile-card-head--inline">
        <div>
          <span className="eyebrow">Рейди</span>
          <h2>Мої записи</h2>
        </div>
        <span className="profile-count-pill">{active.length}</span>
      </div>
      <p className="profile-card-lead">
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
        <div className="profile-empty-characters profile-empty-characters--compact">
          <strong>Записів на рейди ще немає</strong>
          <span>
            Коли учасник натисне “Підписатися” або “Затримаюсь”, запис зʼявиться
            тут.
          </span>
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
    <main className="container">
      <section
        className="dashboard-shell content-shell profile-shell profile-account-page"
        aria-label="Профіль Mistblossom Vanguard"
      >
        <DashboardIdentity user={viewer} activeSection="profile" />
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
                <span>☘ {profileGuildCharacterCount} гільд.</span>
                <span>⚔ {wowRoleLabel(selectedRaidRole)}</span>
              </div>
            </div>
            <nav
              className="profile-account-sidebar__nav"
              aria-label="Розділи профілю"
            >
              <a
                href={`/profile/${encodeURIComponent(profile.profileId)}`}
                aria-current="page"
              >
                <span aria-hidden="true">✦</span> Профіль
              </a>
              {isOwnProfile ? (
                <a
                  href={
                    settingsRulesReturnPath ||
                    `/profile/${encodeURIComponent(profile.profileId)}/settings`
                  }
                >
                  <span aria-hidden="true">⚙</span> Налаштування
                </a>
              ) : null}
              <a href="#profile-characters">
                <span aria-hidden="true">⚔</span> Персонажі
              </a>
              {canViewPrivateProfileBlocks ? (
                <a href="#profile-raids">
                  <span aria-hidden="true">◆</span> Рейди
                </a>
              ) : null}
            </nav>
          </aside>

          <div className="profile-account-main">
            <header className="profile-account-header" id="profile-overview">
              <div>
                <span className="eyebrow">Mistblossom Vanguard • Профіль</span>
                <h1>{isOwnProfile ? "Мій профіль" : "Профіль учасника"}</h1>
                <p>
                  Профіль тепер розділений на два зрозумілі рівні: тут —
                  Battle.net, персонажі, мейн і рейдові записи; у налаштуваннях
                  — імʼя, звертання, Discord nickname і формат відображення.
                </p>
              </div>
              <div className="profile-account-header__actions">
                <span className="profile-account-header__badge">
                  {guildStatus}
                </span>
                {isOwnProfile ? (
                  <a
                    className="btn btn-ghost btn-sm"
                    href={
                      settingsRulesReturnPath ||
                      `/profile/${encodeURIComponent(profile.profileId)}/settings`
                    }
                  >
                    Налаштування профілю
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
                  #
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
                  ⚔
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
                  ☘
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
                  ⌁
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
                <div className="profile-card-head profile-card-head--inline">
                  <div>
                    <span className="eyebrow">Battle.net</span>
                    <h2>Персонажі Battle.net</h2>
                  </div>
                  {canManageCharacters ? (
                    <div
                      className="profile-bnet-region-actions"
                      aria-label="Підключити або оновити Battle.net"
                    >
                      <a
                        className="profile-bnet-cta"
                        href={`/api/auth/battlenet/start?region=${primaryBattleNetRegion}${profileRulesReturnPath ? `&next=${encodeURIComponent(profileRulesReturnPath)}` : ""}`}
                      >
                        <span className="profile-bnet-cta__eyebrow">
                          {battleNetAction.eyebrow}
                        </span>
                        <strong>{battleNetAction.title}</strong>
                        <small>{battleNetAction.hint}</small>
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
