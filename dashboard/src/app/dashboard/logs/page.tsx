import { redirect } from "next/navigation";
import DashboardIdentity from "@/components/DashboardIdentity";
import HeroSidePanel from "@/components/HeroSidePanel";
import AdminTabs from "@/components/AdminTabs";
import { buildPageMetadata } from "@/lib/seo";
import { getSession } from "@/lib/auth";
import { listAdminAuditLogs } from "@/lib/accessGroups";
import { canManageGroups, canViewAdminLogs } from "@/lib/permissions";
import { getAdminAuditDiscordPolicy, statusOptions } from "@/lib/dashboardAuditNotifications";
import { getAuditLogRuntimeSettings } from "@/lib/dashboardApiSettings";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export const metadata = buildPageMetadata({
  title: "Журнал дій",
  description: "Останні адміністративні дії Mistblossom із Discord-журналу, результати Discord API та помилки.",
  path: "/dashboard/logs",
  keywords: ["журнал", "адмін", "Discord", "помилки"],
});

function cleanLimit(value: unknown) {
  const number = Number(value);
  if (!Number.isFinite(number)) return 50;
  return Math.max(10, Math.min(250, Math.floor(number)));
}

function formatDate(value?: string | null) {
  if (!value) return "щойно";
  try {
    return new Intl.DateTimeFormat("uk-UA", {
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    }).format(new Date(value));
  } catch {
    return value;
  }
}

function discordPolicySourceLabel(source: string) {
  if (source === "firestore") return "Налаштування з панелі";
  return "Fallback з ENV/коду";
}

function statusLabel(status: string) {
  if (status === "success") return "Успішно";
  if (status === "warning") return "Попередження";
  if (status === "error") return "Помилка";
  return "Інфо";
}


function listStrings(value: unknown, limit = 8) {
  if (!Array.isArray(value)) return [] as string[];
  return value.map((item) => String(item || "").trim()).filter(Boolean).slice(0, limit);
}

function errorSummaries(value: unknown, limit = 4) {
  if (!Array.isArray(value)) return [] as string[];
  return value.slice(0, limit).map((item) => {
    if (!item || typeof item !== "object") return String(item || "").trim();
    const entry = item as Record<string, unknown>;
    const name = String(entry.name || entry.userId || "Учасник").trim();
    const error = String(entry.error || "помилка").trim();
    return `${name}: ${error}`;
  }).filter(Boolean);
}

function detailsJson(details: Record<string, unknown>) {
  try {
    return JSON.stringify(details, null, 2);
  } catch {
    return "{}";
  }
}

export default async function AdminLogsPage({
  searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const user = await getSession();
  if (!user) { redirect("/login"); throw new Error("Login required"); }
  if (!canViewAdminLogs(user)) {
    redirect("/access-denied?reason=logs&from=/dashboard/logs");
    throw new Error("Access denied");
  }

  const params = await searchParams;
  const limit = cleanLimit(params.limit);
  const [logs, discordPolicy, auditSettings] = await Promise.all([
    listAdminAuditLogs(limit),
    getAdminAuditDiscordPolicy(),
    getAuditLogRuntimeSettings(),
  ]);
  const failed = logs.filter((item) => item.status === "error").length;
  const warnings = logs.filter((item) => item.status === "warning").length;
  const canEditLogSettings = canManageGroups(user);

  return (
    <main className="container admin-container">
      <section className="dashboard-shell content-shell admin-page admin-logs-page" aria-label="Журнал адміністративних дій">
        <DashboardIdentity user={user} activeSection="admin" />
        <header className="hero panel admin-hero admin-logs-hero">
          <div className="hero-copy dashboard-hero__copy guild-hero__copy">
            <span className="eyebrow">Mistblossom Vanguard • Журнал</span>
            <h1>Журнал дій</h1>
            <span className="hero-accent" aria-hidden="true" />
            <p className="lead">Останні адміністративні дії читаються з Discord-каналу журналу. Firebase більше не використовується для зберігання журналу.</p>
          </div>
          <HeroSidePanel
            ariaLabel="Огляд журналу дій"
            summary={[
              { label: "ЗАПИСИ", value: logs.length.toLocaleString("uk-UA"), note: `Discord + поточна памʼять, до ${limit}` },
              { label: "СТАН", value: failed ? "Є помилки" : warnings ? "Є попередження" : "Чисто", note: "Адміністративні операції" },
              { label: "ДЖЕРЕЛО", value: discordPolicy.enabled ? "Discord" : "Локально", note: discordPolicy.channelId ? `Канал ${discordPolicy.channelId}` : "Канал не задано" },
            ]}
            stats={[
              { label: "WARNING", value: warnings.toLocaleString("uk-UA") },
              { label: "ERROR", value: failed.toLocaleString("uk-UA") },
              { label: "LIMIT", value: limit.toLocaleString("uk-UA") },
              { label: "CACHE", value: `${Math.round(auditSettings.readCacheTtlMs / 1000)}с` },
              { label: "DEDUPE", value: `${Math.round(auditSettings.dedupeWindowMs / 1000)}с` },
              { label: "MIRROR", value: discordPolicy.minStatus.toUpperCase() },
            ]}
          />
        </header>

        <AdminTabs active="logs" user={user} />

        <section className="panel admin-log-toolbar admin-log-toolbar--settings" aria-label="Параметри журналу">
          <form className="admin-log-limit-form" method="get">
            <label className="field-label">Кількість дій для показу
              <input className="input" type="number" name="limit" min="10" max="250" defaultValue={limit} />
              <small>Показуємо записи з Discord-каналу журналу та тимчасові записи з памʼяті поточного процесу.</small>
            </label>
            <button className="btn subtle" type="submit">Оновити журнал</button>
          </form>

          <form className="admin-log-discord-form" action="/api/dashboard/logs/settings" method="post" data-dashboard-action-form="true" data-dashboard-live-submit="true">
            <div className="profile-card-head profile-card-head--inline">
              <div>
                <span className="eyebrow">Discord журнал</span>
                <h2>Журнал без Firebase-записів</h2>
              </div>
              <span className={`status-pill ${discordPolicy.enabled ? "success" : "neutral"}`}>{discordPolicy.enabled ? "Discord" : "Локально"}</span>
            </div>
            <p className="profile-card-lead">Журнал більше не пишеться в Firebase. Кожна дія відправляється в окремий Discord-канал як embed, а ця сторінка читає останні повідомлення назад із каналу. Токени, cookie, email і приватні поля обрізаються перед публікацією.</p>
            <div className="admin-log-discord-grid">
              <label className="toggle-row admin-log-toggle-row">
                <input type="checkbox" name="enabled" value="1" defaultChecked={discordPolicy.enabled} disabled={!canEditLogSettings} />
                <span>Писати audit-log у Discord</span>
              </label>
              <label className="field-label">Discord channel ID
                <input className="input" name="channelId" inputMode="numeric" pattern="[0-9]{16,25}" defaultValue={discordPolicy.channelId} placeholder="123456789012345678" disabled={!canEditLogSettings} />
                <small>Бот має права View Channel, Read Message History, Send Messages і Embed Links.</small>
              </label>
              <label className="field-label">Які записи дублювати
                <select className="select" name="minStatus" defaultValue={discordPolicy.minStatus} disabled={!canEditLogSettings}>
                  {statusOptions().map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
                </select>
                <small>Для бойового каналу краще warning/error, щоб не спамити Discord.</small>
              </label>
              <label className="toggle-row admin-log-toggle-row">
                <input type="checkbox" name="includeSystemLogs" value="1" defaultChecked={discordPolicy.includeSystemLogs} disabled={!canEditLogSettings} />
                <span>Дублювати системні записи auth/live-check</span>
              </label>
            </div>
            <div className="admin-log-discord-summary" aria-label="Поточний стан дублювання журналу">
              <span><strong>{discordPolicySourceLabel(discordPolicy.source)}</strong><small>Джерело налаштувань</small></span>
              <span><strong>{discordPolicy.minStatus}</strong><small>Мінімальний рівень</small></span>
              <span><strong>{discordPolicy.includeSystemLogs ? "Так" : "Ні"}</strong><small>System logs</small></span>
              <span><strong>{Math.round(auditSettings.readCacheTtlMs / 1000)}с</strong><small>Discord read cache</small></span>
              <span><strong>{Math.round(auditSettings.dedupeWindowMs / 1000)}с</strong><small>Dedupe</small></span>
            </div>
            <button className="btn primary" type="submit" disabled={!canEditLogSettings}>Зберегти Discord-журнал</button>
            {!canEditLogSettings ? <small className="muted-note">Змінювати ці параметри може тільки адміністратор із правом керування групами.</small> : null}
          </form>
        </section>

        <section className="admin-log-list dashboard-list" aria-label="Останні дії">
          {logs.length ? logs.map((item) => (
            <article className={`panel admin-log-row dashboard-list-row admin-log-row--${item.status}`} key={item.id}>
              <div className="admin-log-row__head">
                <span className={`admin-log-status admin-log-status--${item.status}`}>{statusLabel(item.status)}</span>
                <strong>{item.action}</strong>
                <time dateTime={item.createdAt || undefined}>{formatDate(item.createdAt)}</time>
              </div>
              <p>{item.summary || "Дію виконано."}</p>
              {listStrings(item.details.changedNames).length ? (
                <div className="admin-log-highlight admin-log-highlight--success">
                  <strong>Змінено ролі у:</strong>
                  <span>{listStrings(item.details.changedNames).join(", ")}{Number(item.details.changedItemsTotal || 0) > listStrings(item.details.changedNames).length ? ` та ще ${Number(item.details.changedItemsTotal || 0) - listStrings(item.details.changedNames).length}` : ""}</span>
                </div>
              ) : null}
              {errorSummaries(item.details.errors).length ? (
                <div className="admin-log-highlight admin-log-highlight--error">
                  <strong>Помилки:</strong>
                  <span>{errorSummaries(item.details.errors).join(" | ")}</span>
                </div>
              ) : null}
              <div className="admin-log-meta">
                <span>Автор: <strong>{item.actorName || item.actorId || "невідомо"}</strong></span>
                {item.actorGroupId ? <span>Група: <strong>{item.actorGroupId}</strong></span> : null}
                {item.isServerOwner ? <span>Власник сервера</span> : null}
              </div>
              <details className="admin-log-details">
                <summary>Технічні деталі</summary>
                <pre>{detailsJson(item.details)}</pre>
              </details>
            </article>
          )) : (
            <article className="panel admin-log-row dashboard-list-row admin-log-row--info">
              <strong>Журнал порожній</strong>
              <p>Записи зʼявляться після першої дії, яку бот опублікує в Discord-канал журналу.</p>
            </article>
          )}
        </section>
      </section>
    </main>
  );
}
