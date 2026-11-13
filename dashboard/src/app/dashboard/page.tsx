import { redirect } from "next/navigation";
import DashboardIdentity from "@/components/DashboardIdentity";
import AdminPageHeader from "@/components/AdminPageHeader";
import ManagementSections from "@/components/ManagementSections";
import AdminTabs from "@/components/AdminTabs";
import IntegrationStatusPanel from "@/components/IntegrationStatusPanel";
import AutomationOverview from "@/components/AutomationOverview";
import { getAutomationOverview } from "@/lib/automationOverview";
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
  VALID_NICKNAME_STRUCTURES,
} from "@/lib/guildNicknamePolicy";
import { getGeoAccessPolicy } from "@/lib/geoAccessPolicy";
import { getAuthAccessPolicy } from "@/lib/authAccessPolicy";
import { fetchDiscordRoles } from "@/lib/discordAdmin";
import { ensureDefaultAccessGroups, listAccessGroupsForManagement } from "@/lib/accessGroups";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export const metadata = buildPageMetadata({
  title: "Керування",
  description:
    "Центр керування Mistblossom: групи доступу, Discord-ролі, серверні ніки та глобальні структури ніку.",
  path: "/dashboard",
  keywords: ["керування", "Discord", "права", "ролі"],
});

function roleCountLabel(count: number) {
  const normalized = Math.abs(count) % 100;
  const tail = normalized % 10;
  if (normalized > 10 && normalized < 20) return `${count} ролей`;
  if (tail === 1) return `${count} роль`;
  if (tail >= 2 && tail <= 4) return `${count} ролі`;
  return `${count} ролей`;
}

function countryCountLabel(count: number) {
  const normalized = Math.abs(count) % 100;
  const tail = normalized % 10;
  if (normalized > 10 && normalized < 20) return `${count} країн`;
  if (tail === 1) return `${count} країна`;
  if (tail >= 2 && tail <= 4) return `${count} країни`;
  return `${count} країн`;
}

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

  const canEditGeoPolicy = canManageGroups(user);
  const canEditAuthPolicy = canManageGroups(user);
  const rolesPromise = canEditAuthPolicy
    ? fetchDiscordRoles()
        .then((roles) => ({ roles, error: "" }))
        .catch((error) => ({
          roles: [] as Array<{ id: string; name: string; color: number; position: number; managed: boolean }>,
          error: error instanceof Error ? error.message : String(error || "Discord API error"),
        }))
    : Promise.resolve({
        roles: [] as Array<{ id: string; name: string; color: number; position: number; managed: boolean }>,
        error: "",
      });
  const [policy, geoPolicy, authPolicy, rolesResult, automationOverview, loadedGroups] = await Promise.all([
    getGuildNicknamePolicy(),
    getGeoAccessPolicy(),
    getAuthAccessPolicy(),
    rolesPromise,
    canManageDiscordMembers(user) ? getAutomationOverview() : Promise.resolve(null),
    canEditAuthPolicy ? listAccessGroupsForManagement().catch(() => []) : Promise.resolve([]),
  ]);
  // On a fresh deployment the group catalog may not exist yet.
  // Initialize via the canonical storage writer, never from cached fallback rights.
  const siteGroups = loadedGroups.length || !canEditAuthPolicy
    ? loadedGroups
    : await ensureDefaultAccessGroups()
        .then(() => listAccessGroupsForManagement())
        .catch(() => []);
  const discordRoles = rolesResult.roles;
  const authRolesError = rolesResult.error;

  const mappings = new Map(authPolicy.roleGroupMappings.map((mapping) => [mapping.roleId, mapping.groupId]));
  const knownRoleIds = new Set(discordRoles.map((role) => role.id));
  const unknownMappings = authPolicy.roleGroupMappings.filter((mapping) => !knownRoleIds.has(mapping.roleId));
  const eligibleGroups = siteGroups.filter((group) => group.permissions.includes("dashboard.view") &&
    (user.isServerOwner || (group.role !== "admin" && !group.permissions.includes("groups.manage"))));

  return (
    <main className="container app-page admin-container">
      <section
        className="dashboard-shell content-shell admin-workspace admin-page app-page-stack"
        aria-label="Керування Mistblossom Vanguard"
      >
        <DashboardIdentity user={user} activeSection="admin" />
        <AdminPageHeader
          eyebrow="Mistblossom Vanguard • Панель керування"
          title="Керування"
          description="Один центр для прав доступу, Discord-ролей, серверних ніків, журналу й стану сервера."
          metrics={[
            {
              label: "Група",
              value: user.groupName || user.role,
              note: user.isServerOwner ? "Власник сервера" : "Поточні права",
              tone: "good",
            },
            {
              label: "Шаблон ніку",
              value: "3 формати",
              note: nicknameTemplateExample(policy.template),
            },
            {
              label: "Discord",
              value: canManageDiscordMembers(user) ? "Доступ" : "—",
              tone: canManageDiscordMembers(user) ? "good" : "neutral",
            },
            {
              label: "Вхід",
              value: authPolicy.enabled ? "Обмежено" : "Вільний",
              tone: authPolicy.enabled ? "warning" : "neutral",
            },
            {
              label: "Гео",
              value: geoPolicy.enabled ? "Увімкнено" : "Вимкнено",
            },
          ]}
        />

        <AdminTabs active="overview" user={user} />

        <ManagementSections sections={[
          { id: "overview-status", label: "Стан системи", description: "Інтеграції та чинні правила гільдії в одному місці." },
          { id: "overview-auth", label: "Доступ за Discord-ролями", description: "Яка Discord-роль відповідає якій групі сайту." },
          { id: "overview-geo", label: "Географія доступу", description: "Країни та винятки для доступу до сайту." },
        ]}>
          <div>
          <div className="admin-overview-top-grid">
            <IntegrationStatusPanel
              compact
              className="admin-overview-status-card"
            />

            <article className="panel admin-nickname-summary-card">
              <header className="admin-nickname-summary-card__header">
                <span className="admin-policy-card__icon" aria-hidden="true">
                  ✦
                </span>
                <div>
                  <strong>Структури Discord-ніку</strong>
                  <small>Єдині валідні формати по всьому сайту</small>
                </div>
              </header>
              <div className="admin-nickname-template">{VALID_NICKNAME_STRUCTURES.map((structure) => <div key={structure}>{structure}</div>)}</div>
              <div className="admin-nickname-example">
                <span>Приклад</span>
                <strong>{nicknameTemplateExample(policy.template)}</strong>
              </div>
            </article>
          </div>
          {automationOverview && <AutomationOverview overview={automationOverview} />}
          </div>

          <article className="panel admin-overview-card admin-overview-card--wide admin-policy-card auth-access-card">
            <header className="admin-policy-card__header">
              <span className="admin-policy-card__icon" aria-hidden="true">
                🔐
              </span>
              <div className="admin-policy-card__title">
                <strong>Вхід для команди за Discord-ролями</strong>
                <small>
                  Публічні рейди не потребують входу. Тут зіставляються Discord-ролі з групами адміністративної панелі.
                </small>
              </div>
              <div
                className="admin-policy-status"
                data-state={authPolicy.enabled ? "on" : "off"}
                aria-label={`Авторизація: ${authPolicy.enabled ? "обмеження увімкнені" : "обмеження вимкнені"}; ${roleCountLabel(authPolicy.requiredRoleIds.length)}`}
              >
                <span className="admin-policy-status__dot" aria-hidden="true" />
                <strong>{authPolicy.enabled ? "Обмежено" : "Вільний вхід"}</strong>
                <span>{roleCountLabel(authPolicy.requiredRoleIds.length)}</span>
              </div>
            </header>

            <form
              className="admin-policy-form auth-access-form"
              action="/api/dashboard/security/auth-access"
              method="post"
              data-dashboard-action-form="true"
              data-dashboard-live-submit="true"
            >
              <div className="admin-policy-layout admin-policy-layout--auth">
                <fieldset className="admin-policy-fieldset admin-policy-fieldset--mode">
                  <legend>Правила доступу</legend>
                  <p className="admin-policy-section-intro">Сайт і рейди відкриті для перегляду без входу. OAuth потрібен лише тим, кому призначена Discord-роль із групою доступу сайту.</p>
                  <strong>Роль Discord → група сайту</strong>
                  <small>За відсутності відповідності вхід заборонено. Права беруться з вибраної групи доступу, а не з профілю користувача.</small>
                  <label className="admin-policy-toggle">
                    <input type="checkbox" name="allowServerOwner" defaultChecked={authPolicy.allowServerOwner} disabled={!user.isServerOwner} />
                    <span className="admin-policy-toggle__copy"><strong>Вхід власника Discord-сервера без окремої ролі</strong><small>Керувати винятком може лише власник сервера.</small></span>
                  </label>
                </fieldset>
                <fieldset className="admin-policy-fieldset admin-policy-fieldset--roles">
                  <legend>Відповідності ролей</legend>
                  <p className="admin-policy-section-intro">Для кожної Discord-ролі вибери групу доступу або «Без доступу». Якщо користувач має кілька дозволених ролей, діє група з вищим рангом.</p>
                  {authRolesError ? <small className="error-note">Не вдалося завантажити ролі Discord. Існуючі відповідності збережено нижче.</small> : null}
                  <div className="auth-access-role-list">
                    {discordRoles.map((role) => (
                      <label className="auth-access-role-option" key={role.id}>
                        <span className="auth-access-role-option__copy"><strong>{role.name}</strong><small>{role.id}</small></span>
                        <select name={`roleMap:${role.id}`} defaultValue={mappings.get(role.id) || ""} disabled={!canEditAuthPolicy || !eligibleGroups.length} aria-label={`Група сайту для Discord-ролі ${role.name}`}>
                          <option value="">Без доступу</option>
                          {eligibleGroups.map((group) => <option value={group.id} key={group.id}>{group.name} · {group.role}</option>)}
                        </select>
                      </label>
                    ))}
                    {unknownMappings.map((mapping) => (
                      <label className="auth-access-role-option" key={mapping.roleId}>
                        <span className="auth-access-role-option__copy"><strong>Discord ID {mapping.roleId}</strong><small>Роль не повернута Discord API</small></span>
                        <select name={`roleMap:${mapping.roleId}`} defaultValue={mapping.groupId} disabled={!canEditAuthPolicy}>
                          <option value="">Без доступу</option>
                          {eligibleGroups.map((group) => <option value={group.id} key={group.id}>{group.name}</option>)}
                        </select>
                      </label>
                    ))}
                  </div>
                  <div className="admin-policy-input admin-policy-input--manual-role">
                    <label>Discord role ID (додати вручну)<input name="manualRoleId" placeholder="123456789012345678" pattern="[0-9]{16,25}" maxLength={25} disabled={!canEditAuthPolicy}/></label>
                    <label>Група доступу сайту<select name="manualGroupId" defaultValue="" disabled={!canEditAuthPolicy}><option value="">Не додавати</option>{eligibleGroups.map((group) => <option key={group.id} value={group.id}>{group.name}</option>)}</select></label>
                  </div>
                  {!eligibleGroups.length ? <p className="error-note">Групи сайту недоступні. Збереження вимкнено, щоб не скинути права випадково.</p> : null}
                </fieldset>
              </div>

              <div className="admin-policy-current-state" aria-label="Поточна конфігурація входу">
                <div>
                  <span>Роль Discord</span><strong>Обовʼязкова</strong>
                </div>
                <div>
                  <span>Без відповідності</span><strong>Вхід заборонено</strong>
                </div>
                <div>
                  <span>Власник сервера</span>
                  <strong>{authPolicy.allowServerOwner ? "Має виняток" : "За загальними правилами"}</strong>
                </div>
                <div data-tone="good"><span>Звичайний учасник</span><strong>Перегляд без входу</strong></div>
              </div>

              <footer className="admin-policy-footer">
                <small>
                  Сайт не приймає заявок на рейди. Доступ до панелі отримують лише Discord-ролі, явно зіставлені з групами сайту.
                </small>
                <button
                  className="btn primary"
                  type="submit"
                  disabled={!canEditAuthPolicy || !eligibleGroups.length}
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
                  Окремі правила для авторизації та заявок за країною, визначеною під час запиту.
                </small>
              </div>
              <div
                className="admin-policy-status"
                data-state={geoPolicy.enabled ? "on" : "off"}
                aria-label={`Геообмеження: ${geoPolicy.enabled ? "увімкнено" : "вимкнено"}`}
              >
                <span className="admin-policy-status__dot" aria-hidden="true" />
                <strong>{geoPolicy.enabled ? "Увімкнено" : "Вимкнено"}</strong>
                <span>
                  {geoPolicy.blockedCountries.length
                    ? countryCountLabel(geoPolicy.blockedCountries.length)
                    : "Без країн"}
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
              <div className="admin-policy-layout admin-policy-layout--geo">
                <fieldset className="admin-policy-fieldset admin-policy-fieldset--mode">
                  <legend>Що блокувати</legend>
                  <p className="admin-policy-section-intro">
                    Спочатку увімкни правило, потім обери, де саме воно має діяти.
                  </p>

                  <label className="admin-policy-toggle">
                    <input
                      type="checkbox"
                      name="enabled"
                      defaultChecked={geoPolicy.enabled}
                      disabled={!canEditGeoPolicy}
                    />
                    <span className="admin-policy-toggle__copy">
                      <strong>Увімкнути геообмеження</strong>
                      <small>Головний перемикач для всіх правил нижче.</small>
                    </span>
                  </label>

                  <label className="admin-policy-toggle">
                    <input
                      type="checkbox"
                      name="blockApplications"
                      defaultChecked={geoPolicy.blockApplications}
                      disabled={!canEditGeoPolicy}
                    />
                    <span className="admin-policy-toggle__copy">
                      <strong>Забороняти подання заявок</strong>
                      <small>Заявка не створиться для країни зі списку блокування.</small>
                    </span>
                  </label>

                  <label className="admin-policy-toggle">
                    <input
                      type="checkbox"
                      name="blockAuth"
                      defaultChecked={geoPolicy.blockAuth}
                      disabled={!canEditGeoPolicy}
                    />
                    <span className="admin-policy-toggle__copy">
                      <strong>Забороняти авторизацію</strong>
                      <small>Discord-вхід не почнеться для заблокованої країни.</small>
                    </span>
                  </label>

                  <label className="admin-policy-toggle admin-policy-toggle--danger">
                    <input
                      type="checkbox"
                      name="blockUnknownCountries"
                      defaultChecked={geoPolicy.blockUnknownCountries}
                      disabled={!canEditGeoPolicy}
                    />
                    <span className="admin-policy-toggle__copy">
                      <strong>Блокувати невідому країну</strong>
                      <small>
                        Обережно: може зачепити VPN, проксі або запити без геоданих.
                      </small>
                    </span>
                  </label>
                </fieldset>

                <fieldset className="admin-policy-fieldset admin-policy-fieldset--countries">
                  <legend>Країни</legend>
                  <p className="admin-policy-section-intro">
                    Використовуй ISO-коди через кому. Наприклад: <code>RU</code>, <code>BY</code>.
                  </p>

                  <label className="admin-policy-input">
                    <span>Коди країн для блокування</span>
                    <small>
                      Регістр і розширені варіанти нормалізуються сервером автоматично.
                    </small>
                    <input
                      name="blockedCountries"
                      defaultValue={geoPolicy.blockedCountries.join(", ")}
                      placeholder="RU, BY"
                      maxLength={512}
                      autoComplete="off"
                      disabled={!canEditGeoPolicy}
                      autoCapitalize="characters"
                      spellCheck={false}
                    />
                  </label>

                  <div className="geo-country-summary">
                    <span>Зараз заблоковано</span>
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
                  </div>

                  <div className="admin-policy-country-source">
                    <strong>Як визначається країна</strong>
                    <small>
                      Автоматично з серверних даних запиту; користувач не обирає її вручну.
                    </small>
                  </div>
                </fieldset>
              </div>

              <div className="admin-policy-current-state" aria-label="Поточна конфігурація геообмежень">
                <div>
                  <span>Заявки</span>
                  <strong>{geoPolicy.blockApplications ? "Блокуються" : "Дозволені"}</strong>
                </div>
                <div>
                  <span>Авторизація</span>
                  <strong>{geoPolicy.blockAuth ? "Блокується" : "Дозволена"}</strong>
                </div>
                <div data-tone={geoPolicy.blockUnknownCountries ? "warning" : "neutral"}>
                  <span>Невідома країна</span>
                  <strong>{geoPolicy.blockUnknownCountries ? "Блокується" : "Дозволена"}</strong>
                </div>
                <div>
                  <span>Список</span>
                  <strong>{geoPolicy.blockedCountries.join(", ") || "Порожній"}</strong>
                </div>
              </div>

              <footer className="admin-policy-footer">
                <small>
                  Dashboard і Worker використовують одну політику, тому після збереження правило діє і для входу, і для заявок.
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
        </ManagementSections>
      </section>
    </main>
  );
}
