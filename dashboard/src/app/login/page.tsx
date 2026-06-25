import { getStoredSession } from "@/lib/auth";
import { getGuildBranding } from "@/lib/branding";
import { redirect } from "next/navigation";
import { buildPageMetadata } from "@/lib/seo";
import {
  getProfileById,
  profileFromSession,
  profileNeedsSettingsSetup,
  profileSettingsSetupPath,
} from "@/lib/profiles";
import { getGuildNicknamePolicy } from "@/lib/guildNicknamePolicy";
import {
  normalizeRulesAcceptPath,
  rulesOnboardingStatus,
} from "@/lib/rulesOnboarding";
import { getAuthAccessPolicy } from "@/lib/authAccessPolicy";

export const metadata = buildPageMetadata({
  title: "Вхід до панелі",
  description:
    "Безпечний вхід до особистої панелі Mistblossom Vanguard через Discord для учасників, офіцерів і гільдмайстра.",
  path: "/login",
  keywords: ["вхід Discord", "панель гільдії"],
});

export const dynamic = "force-dynamic";
export const revalidate = 0;

function safeNextPath(value?: string) {
  const path = String(value || "").trim();
  if (!path || path.length > 220) return "";
  if (!path.startsWith("/") || path.startsWith("//")) return "";
  if (
    path === "/" ||
    /^\/(?:raids|profile|rules\/accept)(?:[/?#]|$)/.test(path)
  )
    return path;
  return "";
}

function errorText(error?: string) {
  if (!error) return null;

  const map: Record<string, string> = {
    access_denied:
      "Доступ закрито: потрібна роль адміна, модератора, наставника або дозволений доступ учасника гільдії.",
    discord_oauth: "Discord не завершив авторизацію. Спробуй ще раз.",
    oauth_state:
      "Сесія входу застаріла або було відкрито кілька входів одночасно. Натисни вхід ще раз — тепер паралельні входи обробляються без блокування.",
    discord_required: "Для входу потрібен Discord.",
    discord_only: "GitHub вхід вимкнено. Використай Discord.",
    token: "Резервний ключ неправильний.",
    rate_limit: "Забагато спроб. Зачекай кілька хвилин.",
    geo_blocked: "Доступ із цієї країни зараз обмежено правилами спільноти.",
    required_discord_role:
      "Доступ закрито: ти є на сервері Discord, але не маєш ролі, потрібної для авторизації або реєстрації.",
    auth_role_not_configured:
      "Доступ тимчасово закрито: адміністратор ще не вибрав Discord-роль, потрібну для авторизації.",
    not_guild_member:
      "Доступ закрито: Discord-акаунт не є учасником сервера гільдії.",
    discord_banned: "Доступ закрито: Discord-акаунт заблокований на сервері.",
    security_check_failed:
      "Не вдалося безпечно перевірити Discord-сервер або ролі. Спробуй пізніше.",
    token_disabled:
      "Резервний вхід вимкнено правилами безпеки. Використай Discord.",
  };

  return map[error] || "Не вдалося увійти. Перевір доступ у Discord.";
}

function isEnabled(value?: string) {
  return /^(1|true|yes|force|switch)$/i.test(String(value || "").trim());
}

function discordStartPath(nextPath: string, forceFreshLogin: boolean) {
  const params = new URLSearchParams();
  if (forceFreshLogin) params.set("force", "1");
  if (nextPath) params.set("next", nextPath);
  const query = params.toString();
  return `/api/auth/discord/start${query ? `?${query}` : ""}`;
}

export default async function LoginPage({
    searchParams,
}: {
  searchParams: Promise<{
    error?: string;
    next?: string;
    force?: string;
    switch?: string;
    reauth?: string;
  }>;
}) {
  const params = await searchParams;
  const nextPath = safeNextPath(params.next);
  const forceFreshLogin =
    isEnabled(params.force) ||
    isEnabled(params.switch) ||
    isEnabled(params.reauth);
  const session = forceFreshLogin
    ? null
    : await getStoredSession().catch(() => null);
  if (session) {
    const profileId = session.profileId || "";
    const profile = profileId
      ? await getProfileById(profileId).catch(() => null)
      : null;
    const setupProfile =
      profile ||
      (profileId ? profileFromSession({ ...session, profileId }) : null);
    const setupPath =
      setupProfile && profileNeedsSettingsSetup(setupProfile)
        ? profileSettingsSetupPath(setupProfile.profileId)
        : "";
    const rulesNextPath = normalizeRulesAcceptPath(nextPath);
    const nicknamePolicy = rulesNextPath
      ? await getGuildNicknamePolicy()
      : null;
    const rulesStatus =
      setupProfile && rulesNextPath
        ? rulesOnboardingStatus(setupProfile, nicknamePolicy?.template)
        : null;
    const rulesRedirectPath =
      rulesNextPath && !rulesStatus?.complete
        ? normalizeRulesAcceptPath(rulesNextPath, "incomplete")
        : rulesNextPath;
    redirect(rulesRedirectPath || setupPath || nextPath || "/");
  }

  const guild = await getGuildBranding();
  const authPolicy = await getAuthAccessPolicy();
  const error = errorText(params.error);
  const hasDiscord = Boolean(process.env.DISCORD_OAUTH_CLIENT_ID);
  const hasTokenFallback =
    Boolean(process.env.ADMIN_DASHBOARD_TOKEN) &&
    (!authPolicy.enabled || authPolicy.allowEmergencyTokenLogin);

  return (
    <main className="login-screen">
      <div className="login-screen__backdrop" aria-hidden="true">
        <span className="login-glow login-glow--gold" />
        <span className="login-glow login-glow--violet" />
        <span className="login-grid" />
        <span className="login-ornament login-ornament--top" />
        <span className="login-ornament login-ornament--bottom" />
      </div>

      <section className="login-shell" aria-labelledby="login-title">
        <div className="login-hero">
          <div className="login-pill">Панель гільдії</div>

          <div className="login-brandmark">
            <img
              src={guild.iconUrl}
              alt=""
              width={64}
              height={64}
              loading="eager"
              referrerPolicy="no-referrer"
            />
            <span aria-hidden="true" />
          </div>

          <p className="login-eyebrow">{guild.name}</p>
          <h1 id="login-title">
            Вхід до панелі
            <span>гільдії</span>
          </h1>
          <p className="login-lead">
            Увійди через Discord. Адміни й офіцери отримують керування,
            наставники — перегляд заявок, учасники — особистий профіль.
          </p>

          <div className="login-feature-list" aria-label="Можливості панелі">
            <span>Discord ролі</span>
            <span>Профілі</span>
            <span>Заявки</span>
          </div>

          {error ? (
            <div className="login-alert" role="alert">
              {error}
            </div>
          ) : null}

          <div className="login-action-row">
            {hasDiscord ? (
              <a
                className="login-discord-button"
                href={discordStartPath(nextPath, forceFreshLogin)}
              >
                <span className="login-discord-button__icon" aria-hidden="true">
                  <svg viewBox="0 0 24 24" focusable="false">
                    <path
                      fill="currentColor"
                      d="M20.32 4.37A19.8 19.8 0 0 0 15.36 2.84a.07.07 0 0 0-.08.04c-.21.37-.45.85-.62 1.23a18.27 18.27 0 0 0-5.32 0 12.4 12.4 0 0 0-.63-1.23.08.08 0 0 0-.08-.04A19.74 19.74 0 0 0 3.68 4.37a.07.07 0 0 0-.03.03C.54 9.05-.31 13.57.11 18.03c0 .02.01.05.03.06a19.9 19.9 0 0 0 6.08 3.07.08.08 0 0 0 .08-.03c.47-.64.89-1.31 1.25-2.02a.08.08 0 0 0-.04-.1 13.1 13.1 0 0 1-1.9-.9.08.08 0 0 1 0-.13l.37-.29a.08.08 0 0 1 .08-.01c3.96 1.8 8.24 1.8 12.16 0a.08.08 0 0 1 .08.01l.38.29a.08.08 0 0 1 0 .13c-.6.36-1.23.67-1.9.9a.08.08 0 0 0-.04.1c.37.71.78 1.38 1.25 2.02a.08.08 0 0 0 .08.03 19.84 19.84 0 0 0 6.09-3.07.08.08 0 0 0 .03-.06c.5-5.15-.84-9.64-3.52-13.63a.06.06 0 0 0-.03-.03ZM8.02 15.33c-1.19 0-2.17-1.1-2.17-2.45 0-1.35.96-2.45 2.17-2.45 1.22 0 2.18 1.1 2.17 2.45 0 1.35-.96 2.45-2.17 2.45Zm7.96 0c-1.19 0-2.17-1.1-2.17-2.45 0-1.35.96-2.45 2.17-2.45 1.22 0 2.18 1.1 2.17 2.45 0 1.35-.95 2.45-2.17 2.45Z"
                    />
                  </svg>
                </span>
                <span>
                  <strong>Увійти через Discord</strong>
                  <small>Перевірка ролей автоматична</small>
                </span>
                <span
                  className="login-discord-button__arrow"
                  aria-hidden="true"
                >
                  →
                </span>
              </a>
            ) : (
              <div className="login-alert" role="alert">
                Вхід через Discord тимчасово недоступний.
              </div>
            )}
          </div>

          {hasTokenFallback ? (
            <details className="login-token">
              <summary>Резервний вхід</summary>
              <form method="post" action="/api/auth/login">
                <label htmlFor="token">Резервний ключ</label>
                <div className="login-token__row">
                  <input
                    id="token"
                    name="token"
                    type="password"
                    placeholder="Введи резервний ключ"
                    autoComplete="current-password"
                  />
                  <button type="submit">Увійти</button>
                </div>
              </form>
            </details>
          ) : null}

          <p className="login-note">
            Доступ визначається Discord-ролями. Учасники бачать тільки власний
            профіль, а приватні дані не показуються в інтерфейсі.
          </p>
        </div>
      </section>
    </main>
  );
}
