import { redirect } from "next/navigation";
import DashboardIdentity from "@/components/DashboardIdentity";
import HeroSidePanel from "@/components/HeroSidePanel";
import AdminTabs from "@/components/AdminTabs";
import IntegrationStatusPanel from "@/components/IntegrationStatusPanel";
import { buildPageMetadata } from "@/lib/seo";
import { getSession } from "@/lib/auth";
import {
  canManageDiscordMembers,
  canManageGroups,
  canViewAdminLogs,
} from "@/lib/permissions";
import {
  getGuildNicknamePolicy,
  nicknameTemplateExample,
} from "@/lib/guildNicknamePolicy";
import { getGeoAccessPolicy } from "@/lib/geoAccessPolicy";
import { getAuthAccessPolicy } from "@/lib/authAccessPolicy";
import { fetchDiscordRoles } from "@/lib/discordAdmin";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export const metadata = buildPageMetadata({
  title: "Керування",
  description:
    "Центр керування Mistblossom: групи доступу, Discord-ролі, серверні ніки та глобальний шаблон ніку.",
  path: "/dashboard",
  keywords: ["керування", "Discord", "права", "ролі"],
});

export default async function AdminOverviewPage() {
  const user = await getSession();
  if (!user) {
    redirect("/login");
    throw new Error("Login required");
  }
  if (
    !canManageGroups(user) &&
    !canManageDiscordMembers(user) &&
    !canViewAdminLogs(user)
  ) {
    redirect("/access-denied?reason=admin&from=/dashboard");
    throw new Error("Access denied");
  }

  const policy = await getGuildNicknamePolicy();
  const geoPolicy = await getGeoAccessPolicy();
  const authPolicy = await getAuthAccessPolicy();
  const canEditGeoPolicy = canManageGroups(user);
  const canEditAuthPolicy = canManageGroups(user);
  let discordRoles: Array<{
    id: string;
    name: string;
    color: number;
    position: number;
    managed: boolean;
  }> = [];
  let authRolesError = "";

  if (canEditAuthPolicy) {
    try {
      discordRoles = await fetchDiscordRoles();
    } catch (error) {
      authRolesError =
        error instanceof Error
          ? error.message
          : String(error || "Discord API error");
    }
  }
  const selectedAuthRoleIds = new Set(authPolicy.requiredRoleIds);
  const loadedAuthRoleIds = new Set(discordRoles.map((role) => role.id));
  const manualAuthRoleIds = discordRoles.length
    ? authPolicy.requiredRoleIds.filter(
        (roleId) => !loadedAuthRoleIds.has(roleId),
      )
    : authPolicy.requiredRoleIds;

  return (
    <main className="container admin-container">
      <section
        className="dashboard-shell content-shell admin-page"
        aria-label="Керування Mistblossom Vanguard"
      >
        <DashboardIdentity user={user} activeSection="admin" />
        <header className="hero panel admin-hero">
          <div className="hero-copy dashboard-hero__copy guild-hero__copy">
            <span className="eyebrow">
              Mistblossom Vanguard • Панель керування
            </span>
            <h1>Керування</h1>
            <span className="hero-accent" aria-hidden="true" />
            <p className="lead">
              Один центр для прав доступу, Discord-ролей, серверних ніків і
              глобального шаблону імен.
            </p>
          </div>
          <HeroSidePanel
            ariaLabel="Огляд панелі керування"
            summary={[
              {
                label: "ГРУПА",
                value: user.groupName || user.role,
                note: user.isServerOwner
                  ? "Власник сервера"
                  : "Права з поточної сесії",
              },
              {
                label: "ШАБЛОН",
                value: policy.template,
                note: nicknameTemplateExample(policy.template),
              },
            ]}
            stats={[
              { label: "ГРУПИ", value: canManageGroups(user) ? "ON" : "—" },
              {
                label: "DISCORD",
                value: canManageDiscordMembers(user) ? "ON" : "—",
              },
              { label: "ЛОГИ", value: canViewAdminLogs(user) ? "ON" : "—" },
              { label: "ГЕО", value: geoPolicy.enabled ? "ON" : "OFF" },
              { label: "ВХІД", value: authPolicy.enabled ? "ON" : "OFF" },
            ]}
          />
        </header>

        <AdminTabs active="overview" user={user} />

        <section
          className="admin-overview-grid admin-overview-grid--security"
          aria-label="Стан системи та правила доступу"
        >
          <IntegrationStatusPanel
            compact
            className="admin-overview-status-card"
          />

          <article className="panel admin-overview-card admin-overview-card--wide admin-system-summary-card">
            <span aria-hidden="true">✦</span>
            <div>
              <strong>Поточний шаблон ніку</strong>
              <small>
                <code>{policy.template}</code>
              </small>
              <small>Приклад: {nicknameTemplateExample(policy.template)}</small>
            </div>
          </article>

          <article className="panel admin-overview-card admin-overview-card--wide admin-policy-card auth-access-card">
            <header className="admin-policy-card__header">
              <span className="admin-policy-card__icon" aria-hidden="true">
                🔐
              </span>
              <div className="admin-policy-card__title">
                <strong>Авторизація та реєстрація</strong>
                <small>
                  Серверна перевірка Discord-входу: користувач має бути на
                  сервері й мати одну з дозволених ролей.
                </small>
              </div>
              <div
                className="admin-policy-status"
                aria-label="Поточний стан авторизації"
              >
                <span className={authPolicy.enabled ? "is-on" : "is-off"}>
                  {authPolicy.enabled ? "Увімкнено" : "Вимкнено"}
                </span>
                <span>
                  {authPolicy.requiredRoleIds.length
                    ? `${authPolicy.requiredRoleIds.length} рол.`
                    : "роль не вибрана"}
                </span>
              </div>
            </header>

            <form
              className="admin-policy-form auth-access-form"
              action="/api/dashboard/security/auth-access"
              method="post"
              data-dashboard-action-form="true"
              data-dashboard-live-submit="true"
            >
              <fieldset className="admin-policy-fieldset">
                <legend>Режим входу</legend>
                <label className="admin-policy-toggle">
                  <input
                    type="checkbox"
                    name="enabled"
                    defaultChecked={authPolicy.enabled}
                    disabled={!canEditAuthPolicy}
                  />
                  <span>
                    <strong>Обмежити вхід Discord-роллю</strong>
                    <small>
                      Перевіряється під час OAuth callback і live-перевірки
                      сесії.
                    </small>
                  </span>
                </label>
                <label className="admin-policy-toggle">
                  <input
                    type="checkbox"
                    name="requireConfiguredRole"
                    defaultChecked={authPolicy.requireConfiguredRole}
                    disabled={!canEditAuthPolicy}
                  />
                  <span>
                    <strong>Блокувати, якщо роль не вибрана</strong>
                    <small>
                      <code>AUTH_ACCESS_REQUIRE_CONFIGURED_ROLE=true</code>.
                      Якщо роль не вибрана — вхід блокується.
                    </small>
                  </span>
                </label>
                <label className="admin-policy-toggle">
                  <input
                    type="checkbox"
                    name="allowServerOwner"
                    defaultChecked={authPolicy.allowServerOwner}
                    disabled={!canEditAuthPolicy}
                  />
                  <span>
                    <strong>Дозволити власнику сервера обхід ролі</strong>
                    <small>
                      Корисно, якщо Discord не дозволяє видати власнику звичайну
                      роль.
                    </small>
                  </span>
                </label>
                <label className="admin-policy-toggle admin-policy-toggle--danger">
                  <input
                    type="checkbox"
                    name="allowEmergencyTokenLogin"
                    defaultChecked={authPolicy.allowEmergencyTokenLogin}
                    disabled={!canEditAuthPolicy}
                  />
                  <span>
                    <strong>Дозволити резервний token-вхід</strong>
                    <small>
                      <code>AUTH_ACCESS_ALLOW_EMERGENCY_TOKEN_LOGIN=false</code>
                      . Вмикати тільки як аварійний доступ: token-вхід не має
                      Discord membership/role перевірки.
                    </small>
                  </span>
                </label>
              </fieldset>

              <fieldset className="admin-policy-fieldset admin-policy-fieldset--roles">
                <legend>Роль, потрібна для авторизації / реєстрації</legend>
                {authRolesError ? (
                  <small className="error-note">
                    Не вдалося завантажити ролі Discord. Можна вставити role ID
                    вручну нижче.
                  </small>
                ) : null}
                {discordRoles.length ? (
                  <div className="auth-access-role-list">
                    {discordRoles.map((role) => (
                      <label className="auth-access-role-option" key={role.id}>
                        <input
                          type="checkbox"
                          name="requiredRoleIds"
                          value={role.id}
                          defaultChecked={selectedAuthRoleIds.has(role.id)}
                          disabled={!canEditAuthPolicy}
                        />
                        <span>{role.name}</span>
                        <small>{role.id}</small>
                      </label>
                    ))}
                  </div>
                ) : (
                  <small className="admin-policy-empty">
                    Список ролей недоступний або порожній.
                  </small>
                )}
                <label className="admin-policy-input">
                  <span>Role ID вручну</span>
                  <small>
                    Сюди потрапляють тільки ролі, яких немає у списку вище.
                    Інакше зняті чекбокси знову додавалися б через це поле.
                  </small>
                  <input
                    name="requiredRoleIdsText"
                    defaultValue={manualAuthRoleIds.join(", ")}
                    placeholder="123456789012345678, 234567890123456789"
                    disabled={!canEditAuthPolicy}
                  />
                </label>
              </fieldset>

              <footer className="admin-policy-footer">
                <small>
                  Поточний стан:{" "}
                  {authPolicy.enabled
                    ? "обмеження увімкнені"
                    : "обмеження вимкнені"}
                  ; без вибраної ролі:{" "}
                  {authPolicy.requireConfiguredRole
                    ? "блокувати"
                    : "дозволяти за старими правилами"}
                  ; резервний token-вхід:{" "}
                  {authPolicy.allowEmergencyTokenLogin
                    ? "дозволено"
                    : "заборонено"}
                  . Безпечний дефолт:{" "}
                  <code>AUTH_ACCESS_REQUIRE_CONFIGURED_ROLE=true</code>,{" "}
                  <code>AUTH_ACCESS_ALLOW_EMERGENCY_TOKEN_LOGIN=false</code>.
                </small>
                <button
                  className="btn primary"
                  type="submit"
                  disabled={!canEditAuthPolicy}
                >
                  Зберегти правила входу
                </button>
              </footer>
            </form>
          </article>

          <article className="panel admin-overview-card admin-overview-card--wide admin-policy-card geo-access-card">
            <header className="admin-policy-card__header">
              <span className="admin-policy-card__icon" aria-hidden="true">
                🛡
              </span>
              <div className="admin-policy-card__title">
                <strong>Геообмеження доступу</strong>
                <small>
                  Блокує подання заявок і старт авторизації за edge-сигналом
                  Cloudflare/Vercel без зовнішніх IP-баз.
                </small>
              </div>
              <div
                className="admin-policy-status"
                aria-label="Поточний стан геообмежень"
              >
                <span className={geoPolicy.enabled ? "is-on" : "is-off"}>
                  {geoPolicy.enabled ? "Увімкнено" : "Вимкнено"}
                </span>
                <span>
                  {geoPolicy.blockedCountries.join(", ") || "країни не задані"}
                </span>
              </div>
            </header>

            <form
              className="admin-policy-form"
              action="/api/dashboard/security/geo-access"
              method="post"
              data-dashboard-action-form="true"
              data-dashboard-live-submit="true"
            >
              <fieldset className="admin-policy-fieldset">
                <legend>Що блокувати</legend>
                <label className="admin-policy-toggle">
                  <input
                    type="checkbox"
                    name="enabled"
                    defaultChecked={geoPolicy.enabled}
                    disabled={!canEditGeoPolicy}
                  />
                  <span>
                    <strong>Увімкнути геообмеження</strong>
                    <small>Глобальний перемикач для цієї політики.</small>
                  </span>
                </label>
                <label className="admin-policy-toggle">
                  <input
                    type="checkbox"
                    name="blockApplications"
                    defaultChecked={geoPolicy.blockApplications}
                    disabled={!canEditGeoPolicy}
                  />
                  <span>
                    <strong>Забороняти подання заявок</strong>
                    <small>
                      Перевірка виконується у Worker перед створенням заявки.
                    </small>
                  </span>
                </label>
                <label className="admin-policy-toggle">
                  <input
                    type="checkbox"
                    name="blockAuth"
                    defaultChecked={geoPolicy.blockAuth}
                    disabled={!canEditGeoPolicy}
                  />
                  <span>
                    <strong>Забороняти авторизацію</strong>
                    <small>
                      Старт OAuth і callback блокуються до створення сесії.
                    </small>
                  </span>
                </label>
                <label className="admin-policy-toggle admin-policy-toggle--danger">
                  <input
                    type="checkbox"
                    name="blockUnknownCountries"
                    defaultChecked={geoPolicy.blockUnknownCountries}
                    disabled={!canEditGeoPolicy}
                  />
                  <span>
                    <strong>Блокувати невідому країну</strong>
                    <small>
                      Обережно: може зачепити VPN, privacy relay або погано
                      проксовані запити.
                    </small>
                  </span>
                </label>
              </fieldset>

              <fieldset className="admin-policy-fieldset admin-policy-fieldset--compact">
                <legend>Країни</legend>
                <label className="admin-policy-input">
                  <span>ISO-коди країн</span>
                  <small>
                    Зберігаються як ISO 3166 Alpha-2. Можна вводити{" "}
                    <code>RU</code>, <code>BY</code>, а також aliases{" "}
                    <code>RUS/643</code>, <code>BLR/112</code> — вони
                    автоматично стануть <code>RU/BY</code>.
                  </small>
                  <input
                    name="blockedCountries"
                    defaultValue={geoPolicy.blockedCountries.join(", ")}
                    placeholder="RU, BY"
                    disabled={!canEditGeoPolicy}
                    autoCapitalize="characters"
                    spellCheck={false}
                  />
                </label>
                <div
                  className="geo-country-chip-list"
                  aria-label="Заблоковані країни"
                >
                  {geoPolicy.blockedCountries.length ? (
                    geoPolicy.blockedCountries.map((country) => (
                      <span className="geo-country-chip" key={country}>
                        {country}
                      </span>
                    ))
                  ) : (
                    <span className="geo-country-chip geo-country-chip--muted">
                      країни не задані
                    </span>
                  )}
                </div>
                <div className="admin-policy-hint admin-policy-hint--split">
                  <strong>Поточний стан</strong>
                  <small>
                    Заявки:{" "}
                    {geoPolicy.blockApplications
                      ? "блокуються"
                      : "не блокуються"}
                  </small>
                  <small>
                    Авторизація:{" "}
                    {geoPolicy.blockAuth ? "блокується" : "не блокується"}
                  </small>
                  <small>
                    Невідома країна:{" "}
                    {geoPolicy.blockUnknownCountries
                      ? "блокується"
                      : "дозволяється"}
                  </small>
                  <small>
                    Сигнали: <code>CF-IPCountry</code>,{" "}
                    <code>request.cf.country</code>,{" "}
                    <code>X-Vercel-IP-Country</code>.
                  </small>
                </div>
              </fieldset>

              <footer className="admin-policy-footer">
                <small>
                  Dashboard і Worker читають одну політику з Firebase.
                  Cloudflare/Vercel передають країну як Alpha-2; Alpha-3 і
                  цифрові ISO-коди лише нормалізуються перед збереженням.
                </small>
                <button
                  className="btn primary"
                  type="submit"
                  disabled={!canEditGeoPolicy}
                >
                  Зберегти геообмеження
                </button>
              </footer>
            </form>
          </article>
        </section>
      </section>
    </main>
  );
}
