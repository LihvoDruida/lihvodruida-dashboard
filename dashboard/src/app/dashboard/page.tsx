import { redirect } from "next/navigation";
import DashboardIdentity from "@/components/DashboardIdentity";
import AdminPageHeader from "@/components/AdminPageHeader";
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
  VALID_NICKNAME_STRUCTURES,
} from "@/lib/guildNicknamePolicy";
import { getGeoAccessPolicy } from "@/lib/geoAccessPolicy";
import { getAuthAccessPolicy } from "@/lib/authAccessPolicy";
import { fetchDiscordRoles } from "@/lib/discordAdmin";

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
    <main className="container app-page admin-container">
      <section
        className="dashboard-shell content-shell admin-page app-page-stack"
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
              value: policy.template,
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

        <section
          className="admin-overview-grid admin-overview-grid--security"
          aria-label="Стан системи та правила доступу"
        >
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

          <article className="panel admin-overview-card admin-overview-card--wide admin-policy-card auth-access-card">
            <header className="admin-policy-card__header">
              <span className="admin-policy-card__icon" aria-hidden="true">
                🔐
              </span>
              <div className="admin-policy-card__title">
                <strong>Авторизація та реєстрація</strong>
                <small>
                  Хто може входити в панель: перевірка участі на Discord-сервері,
                  дозволених ролей і резервного доступу.
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
                  <legend>Режим входу</legend>
                  <p className="admin-policy-section-intro">
                    Основні правила перевірки застосовуються під час входу та
                    повторної перевірки активної сесії.
                  </p>

                  <label className="admin-policy-toggle">
                    <input
                      type="checkbox"
                      name="enabled"
                      defaultChecked={authPolicy.enabled}
                      disabled={!canEditAuthPolicy}
                    />
                    <span className="admin-policy-toggle__copy">
                      <strong>Обмежити вхід Discord-роллю</strong>
                      <small>
                        Пускати лише учасників сервера, які мають дозволену роль.
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
                    <span className="admin-policy-toggle__copy">
                      <strong>Блокувати, якщо роль не вибрана</strong>
                      <small>
                        Захищає від випадкового відкриття входу при порожньому списку ролей.
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
                    <span className="admin-policy-toggle__copy">
                      <strong>Дозволити власнику сервера без ролі</strong>
                      <small>
                        Окремий виняток для Discord-власника, якому роль може бути недоступна.
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
                    <span className="admin-policy-toggle__copy">
                      <strong>Дозволити аварійний вхід</strong>
                      <small>
                        Резервний режим відновлення. Він обходить перевірку Discord-ролі.
                      </small>
                    </span>
                  </label>
                </fieldset>

                <fieldset className="admin-policy-fieldset admin-policy-fieldset--roles">
                  <legend>Дозволені Discord-ролі</legend>
                  <div className="admin-policy-section-headline">
                    <p className="admin-policy-section-intro">
                      Для входу достатньо мати хоча б одну з вибраних ролей.
                    </p>
                    <span className="admin-policy-selection-count">
                      Збережено: {roleCountLabel(authPolicy.requiredRoleIds.length)}
                    </span>
                  </div>

                  {authRolesError ? (
                    <small className="error-note">
                      Не вдалося завантажити ролі Discord. Можна вставити ID ролі вручну нижче.
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
                          <span className="auth-access-role-option__copy">
                            <strong>{role.name}</strong>
                            <small>{role.id}</small>
                          </span>
                        </label>
                      ))}
                    </div>
                  ) : (
                    <small className="admin-policy-empty">
                      Список ролей недоступний або порожній.
                    </small>
                  )}

                  <label className="admin-policy-input admin-policy-input--manual-role">
                    <span>ID ролей вручну</span>
                    <small>
                      Лише для ролей, яких немає у списку вище. Кілька ID розділяй комою.
                    </small>
                    <input
                      name="requiredRoleIdsText"
                      defaultValue={manualAuthRoleIds.join(", ")}
                      placeholder="123456789012345678, 234567890123456789"
                      disabled={!canEditAuthPolicy}
                    />
                  </label>
                </fieldset>
              </div>

              <div className="admin-policy-current-state" aria-label="Поточна конфігурація входу">
                <div>
                  <span>Discord-роль</span>
                  <strong>{authPolicy.enabled ? "Перевіряється" : "Не обмежує"}</strong>
                </div>
                <div>
                  <span>Без налаштованої ролі</span>
                  <strong>{authPolicy.requireConfiguredRole ? "Блокувати" : "Дозволяти"}</strong>
                </div>
                <div>
                  <span>Власник сервера</span>
                  <strong>{authPolicy.allowServerOwner ? "Має виняток" : "За загальними правилами"}</strong>
                </div>
                <div data-tone={authPolicy.allowEmergencyTokenLogin ? "warning" : "good"}>
                  <span>Аварійний вхід</span>
                  <strong>{authPolicy.allowEmergencyTokenLogin ? "Дозволено" : "Вимкнено"}</strong>
                </div>
              </div>

              <footer className="admin-policy-footer">
                <small>
                  Рекомендована конфігурація: перевірка ролі увімкнена,
                  порожній список ролей блокує вхід, аварійний доступ вимкнений.
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
        </section>
      </section>
    </main>
  );
}
