import { redirect } from "next/navigation";

import AdminTabs from "@/components/AdminTabs";
import DashboardIdentity from "@/components/DashboardIdentity";
import HeroSidePanel from "@/components/HeroSidePanel";
import { getSession } from "@/lib/auth";
import { safeRecruitmentGatewayStatus } from "@/lib/discordRecruitmentGatewayControl";
import { getRecruitmentAdvisorSettings } from "@/lib/discordRecruitmentAdvisorSettings";
import { listRecentRecruitmentAdviceEntries } from "@/lib/discordRecruitmentAdvisor";
import { canManageDiscordMembers } from "@/lib/permissions";
import { buildPageMetadata } from "@/lib/seo";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export const metadata = buildPageMetadata({
  title: "Discord-автовідповіді",
  description:
    "Керування автоматичними відповідями для новачків і поверненців у Discord.",
  path: "/dashboard/discord/recruitment",
  keywords: ["Discord", "рекрутинг", "автовідповіді", "Raider.IO"],
});

function onOffHuman(value: unknown, on: string, off: string) {
  return value ? on : off;
}

function statusHuman(status: string) {
  const map: Record<string, string> = {
    processing: "Обробляється",
    replied: "Відповіли",
    skipped: "Пропущено",
    failed: "Помилка",
    no_content: "Без тексту",
    discord_send_error: "Discord не прийняв",
  };
  return map[status] || status || "—";
}

function gatewayHint(gateway: Awaited<ReturnType<typeof safeRecruitmentGatewayStatus>>) {
  if (!gateway.connected) return "Gateway не підключений → натисни “Перепідключити”.";
  if (gateway.lastDispatchType && !gateway.lastMessageCreateAt) return "Dispatch є, але MESSAGE_CREATE не приходить → перевір Message Content Intent, guild id і права каналу.";
  if (gateway.lastMessageContentLength === 0) return "MESSAGE_CREATE без тексту → найчастіше вимкнений Message Content Intent або немає права читати канал.";
  if (gateway.lastRelayError) return "Relay помиляється → перевір dashboard URL і секрет Worker/dashboard.";
  if (gateway.lastMessageDropReason) return `Останній drop: ${gateway.lastMessageDropReason}.`;
  return "Якщо нове повідомлення не дає відповіді — перевір Preview і останні обробки нижче.";
}

function dateText(value: unknown) {
  if (!value) return "—";
  const date = new Date(String(value));
  if (!Number.isFinite(date.getTime())) return String(value);
  return date.toLocaleString("uk-UA", { timeZone: "Europe/Kyiv" });
}

function StatusTile({
  label,
  value,
  note,
  ok,
}: {
  label: string;
  value: string;
  note?: string;
  ok?: boolean;
}) {
  return (
    <div
      className={`discord-management-status__item ${ok ? "is-ok" : "is-warning"}`}
    >
      <strong>{value}</strong>
      <small>{label}</small>
      {note ? <em>{note}</em> : null}
    </div>
  );
}

function InfoChip({ title, text }: { title: string; text: string }) {
  return (
    <span className="discord-info-chip">
      <strong>{title}</strong>
      <small>{text}</small>
    </span>
  );
}

function ControlButton({
  action,
  label,
  tone = "primary",
  confirm,
}: {
  action: string;
  label: string;
  tone?: "primary" | "subtle" | "danger";
  confirm?: string;
}) {
  return (
    <form
      action="/api/dashboard/discord/recruitment/control"
      method="post"
      data-dashboard-action-form="true"
      data-dashboard-live-submit="true"
    >
      <input type="hidden" name="action" value={action} />
      <button
        className={`btn ${tone}`}
        type="submit"
        data-confirm-message={confirm || undefined}
      >
        {label}
      </button>
    </form>
  );
}

export default async function DiscordRecruitmentPage() {
  const user = await getSession();
  if (!user) {
    redirect("/login");
    throw new Error("Login required");
  }
  if (!canManageDiscordMembers(user)) {
    redirect(
      "/access-denied?reason=discord-recruitment&from=/dashboard/discord/recruitment",
    );
    throw new Error("Access denied");
  }

  const [settings, gateway, recentEntries] = await Promise.all([
    getRecruitmentAdvisorSettings({ bypassCache: true }),
    safeRecruitmentGatewayStatus(),
    listRecentRecruitmentAdviceEntries(18),
  ]);

  return (
    <main className="container admin-container">
      <section
        className="dashboard-shell content-shell admin-page discord-management-page"
        aria-label="Discord-автовідповіді"
      >
        <DashboardIdentity user={user} activeSection="admin" />
        <header className="hero panel admin-hero discord-admin-hero">
          <div className="hero-copy dashboard-hero__copy guild-hero__copy">
            <span className="eyebrow">Mistblossom Vanguard • Discord</span>
            <h1>Автовідповіді новачкам</h1>
            <span className="hero-accent" aria-hidden="true" />
            <p className="lead">
              Gateway слухає нові повідомлення миттєво, а ручна перевірка
              проходить старі повідомлення за вибраний період без повторних
              відповідей на вже оброблені.
            </p>
          </div>
          <HeroSidePanel
            ariaLabel="Стан автовідповідей"
            summary={[
              {
                label: "СИСТЕМА",
                value: settings.enabled ? "Увімкнено" : "Вимкнено",
                note: settings.dryRun ? "Dry-run активний" : "Бойовий режим",
              },
              {
                label: "GATEWAY",
                value: gateway.connected ? "Підключений" : "Відключений",
                note:
                  gateway.lastError ||
                  gateway.error ||
                  "Cloudflare Durable Object",
              },
            ]}
            stats={[
              { label: "ГОД.", value: String(settings.lookbackHours) },
              { label: "ВІДП.", value: String(settings.manualScanLimit) },
              {
                label: "RIO",
                value: settings.minRio ? String(settings.minRio) : "AUTO",
              },
            ]}
          />
        </header>

        <AdminTabs active="recruitment" user={user} />

        <section
          className="panel discord-management-section discord-management-section--status"
          aria-label="Стан Discord Gateway"
        >
          <header className="discord-management-section-head">
            <span className="eyebrow">Gateway</span>
            <div>
              <h2>Стан Cloudflare Discord Gateway</h2>
              <p>
                Якщо <strong>connected=true</strong>, Worker отримує
                Discord-події. Якщо відповідей немає — запускай тестову або
                ручну перевірку нижче.
              </p>
            </div>
          </header>
          <div className="discord-management-status">
            <StatusTile
              label="Увімкнено"
              value={onOffHuman(gateway.enabled, "Gateway дозволений", "Gateway вимкнений")}
              ok={Boolean(gateway.enabled)}
            />
            <StatusTile
              label="Підключено"
              value={onOffHuman(gateway.connected, "Gateway підключений", "Gateway не підключений")}
              ok={Boolean(gateway.connected)}
            />
            <StatusTile
              label="readyState"
              value={String(gateway.readyState ?? "—")}
              ok={gateway.readyState === 1}
            />
            <StatusTile
              label="Остання подія"
              value={dateText(gateway.lastEventAt)}
              ok={Boolean(gateway.lastEventAt)}
            />
            <StatusTile
              label="Старт"
              value={dateText(gateway.startedAt)}
              ok={Boolean(gateway.startedAt)}
            />
            <StatusTile
              label="Останній dispatch"
              value={gateway.lastDispatchType || "Dispatch ще не було"}
              note={dateText(gateway.lastDispatchAt)}
              ok={Boolean(gateway.lastDispatchType)}
            />
            <StatusTile
              label="MESSAGE_CREATE"
              value={dateText(gateway.lastMessageCreateAt)}
              note={`подій=${gateway.messageCreateCount || 0}, довжина тексту=${gateway.lastMessageContentLength ?? "—"}`}
              ok={Boolean(gateway.lastMessageCreateAt)}
            />
            <StatusTile
              label="Останній relay"
              value={dateText(gateway.lastRelayAt)}
              note={gateway.lastRelaySummary || `спроб=${gateway.relayAttemptCount || 0}`}
              ok={Boolean(gateway.lastRelayAt)}
            />
            <StatusTile
              label="Остання причина пропуску"
              value={gateway.lastMessageDropReason || "Пропусків не було"}
              note={gateway.lastMessageDropSummary || undefined}
              ok={!gateway.lastMessageDropReason}
            />
            <StatusTile
              label="Остання помилка"
              value={gateway.lastError || gateway.error || "Помилок не видно"}
              ok={!gateway.lastError && !gateway.error}
            />
          </div>
          <div className="discord-recruitment-hint">
            <strong>Що робити зараз:</strong> {gatewayHint(gateway)}
          </div>
          <details className="discord-management-details">
            <summary>Деталі Gateway</summary>
            <pre className="discord-debug-pre">{JSON.stringify(gateway, null, 2)}</pre>
          </details>
          <div className="form-actions form-actions--split">
            <ControlButton action="start" label="Запустити" />
            <ControlButton
              action="reconnect"
              label="Перепідключити"
              tone="subtle"
            />
            <ControlButton
              action="status"
              label="Оновити статус"
              tone="subtle"
            />
            <ControlButton
              action="stop"
              label="Зупинити"
              tone="danger"
              confirm="Зупинити Discord Gateway? Нові повідомлення не будуть оброблятись, доки не запустиш знову."
            />
          </div>
        </section>

        <section
          className="discord-management-layout"
          aria-label="Налаштування автовідповідей"
        >
          <aside className="discord-management-sidebar">
            <form
              className="panel discord-management-card discord-management-card--settings"
              action="/api/dashboard/discord/recruitment/settings"
              method="post"
              data-dashboard-action-form="true"
              data-dashboard-live-submit="true"
            >
              <div className="profile-card-head">
                <span className="eyebrow">Конфігурація</span>
                <h2>Параметри аналізу</h2>
              </div>
              <div className="discord-management-card__body">
                <label className="check-row">
                  <input
                    type="checkbox"
                    name="enabled"
                    value="1"
                    defaultChecked={settings.enabled}
                  />{" "}
                  <span>Увімкнути автовідповіді</span>
                </label>
                <label className="check-row">
                  <input
                    type="checkbox"
                    name="dryRun"
                    value="1"
                    defaultChecked={settings.dryRun}
                  />{" "}
                  <span>Dry-run: аналізувати, але не писати в Discord</span>
                </label>
                <label className="field-label">
                  Скільки годин дивитись назад
                  <input
                    className="input"
                    name="lookbackHours"
                    type="number"
                    min="1"
                    max="168"
                    defaultValue={settings.lookbackHours}
                  />
                  <small>
                    Для ручної перевірки старих повідомлень. Рекомендовано 48.
                  </small>
                </label>
                <label className="field-label">
                  Максимум сторінок на канал
                  <input
                    className="input"
                    name="maxPages"
                    type="number"
                    min="1"
                    max="20"
                    defaultValue={settings.maxPages}
                  />
                </label>
                <label className="field-label">
                  Ліміт відповідей за запуск
                  <input
                    className="input"
                    name="maxReplies"
                    type="number"
                    min="1"
                    max="20"
                    defaultValue={settings.maxReplies}
                  />
                </label>
                <label className="field-label">
                  Ручний ліміт відповідей
                  <input
                    className="input"
                    name="manualScanLimit"
                    type="number"
                    min="1"
                    max="20"
                    defaultValue={settings.manualScanLimit}
                  />
                </label>
                <label className="field-label">
                  Макс. каналів
                  <input
                    className="input"
                    name="maxChannels"
                    type="number"
                    min="1"
                    max="200"
                    defaultValue={settings.maxChannels}
                  />
                </label>
                <label className="field-label">
                  Мінімальний RIO
                  <input
                    className="input"
                    name="minRio"
                    type="number"
                    min="0"
                    max="6000"
                    defaultValue={settings.minRio}
                  />
                  <small>0 = авто-поріг по складу.</small>
                </label>
                <label className="field-label">
                  Мінімальний ilvl
                  <input
                    className="input"
                    name="minIlvl"
                    type="number"
                    min="0"
                    max="2000"
                    defaultValue={settings.minIlvl}
                  />
                  <small>0 = не фільтрувати по ilvl.</small>
                </label>
                <button className="btn primary" type="submit">
                  Зберегти параметри
                </button>
              </div>
            </form>
          </aside>

          <div className="discord-management-main">
            <section className="panel discord-management-card discord-management-card--primary">
              <div className="profile-card-head profile-card-head--inline">
                <div>
                  <span className="eyebrow">Ручна перевірка</span>
                  <h2>Старі повідомлення без повторів</h2>
                </div>
                <span className="status-pill warning">
                  {settings.lookbackHours} год.
                </span>
              </div>
              <div className="discord-management-card__body">
                <p className="profile-card-lead">
                  Ця дія сканує доступні текстові канали й активні треди за
                  заданий період. Якщо на повідомлення вже була успішна
                  відповідь, Firebase-мітка{" "}
                  <code>discordRecruitmentAdviceReplies</code> заблокує дубль.
                </p>
                <div className="discord-officer-sync-summary">
                  <InfoChip
                    title={String(settings.maxChannels)}
                    text="каналів"
                  />
                  <InfoChip
                    title={String(settings.maxPages)}
                    text="сторінок/канал"
                  />
                  <InfoChip
                    title={String(settings.manualScanLimit)}
                    text="відповідей зараз"
                  />
                  <InfoChip
                    title={settings.dryRun ? "Dry-run" : "Live"}
                    text="режим"
                  />
                </div>
                <div className="form-actions form-actions--split">
                  <ControlButton
                    action="dry-run-scan"
                    label="Тест без відправки"
                    tone="subtle"
                  />
                  <ControlButton
                    action="scan"
                    label="Перевірити і відповісти"
                    confirm="Запустити ручну перевірку старих Discord-повідомлень і відповісти на релевантні, якщо ще не було відповіді?"
                  />
                  <ControlButton
                    action="retry-failed-skipped"
                    label="Повторити failed/skipped"
                    tone="subtle"
                    confirm="Повторити обробку повідомлень, які раніше були failed/skipped/no_content/dashboard_error/discord_send_error?"
                  />
                </div>
              </div>
            </section>

            <section className="panel discord-management-card discord-management-card--action">
              <div className="profile-card-head profile-card-head--inline">
                <div>
                  <span className="eyebrow">Тест алгоритму</span>
                  <h2>Перевірити будь-яке повідомлення</h2>
                </div>
                <span className="status-pill good">preview</span>
              </div>
              <form
                className="discord-management-card__body"
                action="/api/dashboard/discord/recruitment/control"
                method="post"
                data-dashboard-action-form="true"
                data-dashboard-live-submit="true"
              >
                <input type="hidden" name="action" value="preview-text" />
                <p className="profile-card-lead">
                  Встав текст із Discord. Панель покаже score, причини
                  спрацювання, розпізнані версії гри й приклад адаптивної
                  відповіді без відправки в Discord.
                </p>
                <label className="field-label">
                  Текст повідомлення
                  <textarea
                    className="input"
                    name="content"
                    rows={7}
                    placeholder="Наприклад: Останній раз грав у Ліча/Драгонфлай/БФА, ким краще почати і хто потрібен гільдії?"
                    required
                  />
                </label>
                <button className="btn subtle" type="submit">
                  Проаналізувати текст
                </button>
              </form>
            </section>

            <section className="panel discord-management-card discord-management-card--action">
              <div className="profile-card-head profile-card-head--inline">
                <div>
                  <span className="eyebrow">Cloudflare</span>
                  <h2>Worker manual-scan</h2>
                </div>
                <span className="status-pill good">ручний</span>
              </div>
              <div className="discord-management-card__body">
                <p className="profile-card-lead">
                  Автоматичний backfill при старті Worker вимкнений. Якщо треба
                  перевірити пропущене після reconnect/deploy — запускай його
                  вручну з панелі.
                </p>
                <div className="form-actions form-actions--split">
                  <ControlButton
                    action="test-relay"
                    label="Тест Worker → dashboard"
                    tone="subtle"
                  />
                  <ControlButton
                    action="manual-scan"
                    label="Запустити Worker manual-scan"
                    tone="subtle"
                  />
                </div>
              </div>
            </section>

            <section className="panel discord-management-card discord-management-card--action">
              <div className="profile-card-head profile-card-head--inline">
                <div>
                  <span className="eyebrow">Live pipeline</span>
                  <h2>Останні обробки</h2>
                </div>
                <span className="status-pill good">Firebase</span>
              </div>
              <div className="discord-management-card__body">
                {recentEntries.length ? (
                  <div className="discord-recruitment-events">
                    {recentEntries.map((entry) => (
                      <article key={entry.messageId} className="discord-recruitment-event">
                        <div>
                          <strong>{statusHuman(entry.status)}</strong>
                          <small>{dateText(entry.updatedAt || entry.createdAt)}</small>
                        </div>
                        <p>{entry.responsePreview || entry.error || entry.skipReason || entry.decisionReasons.join(", ") || "Без деталей"}</p>
                        <dl>
                          <div><dt>Автор</dt><dd>{entry.authorId || "—"}</dd></div>
                          <div><dt>Канал</dt><dd>{entry.channelId || "—"}</dd></div>
                          <div><dt>Score</dt><dd>{entry.score}</dd></div>
                          <div><dt>Reply</dt><dd>{entry.replyMessageId || "—"}</dd></div>
                        </dl>
                        {entry.status !== "replied" ? (
                          <form action="/api/dashboard/discord/recruitment/control" method="post" data-dashboard-action-form="true" data-dashboard-live-submit="true">
                            <input type="hidden" name="action" value="retry-failed-skipped" />
                            <button className="btn subtle" type="submit">Retry failed/skipped</button>
                          </form>
                        ) : null}
                      </article>
                    ))}
                  </div>
                ) : (
                  <p className="profile-card-lead">Ще немає записів обробки або Firebase недоступний.</p>
                )}
              </div>
            </section>
          </div>
        </section>
      </section>
    </main>
  );
}
