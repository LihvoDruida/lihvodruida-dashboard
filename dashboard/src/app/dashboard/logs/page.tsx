import { redirect } from "next/navigation";
import DashboardIdentity from "@/components/DashboardIdentity";
import AdminPageHeader from "@/components/AdminPageHeader";
import AdminTabs from "@/components/AdminTabs";
import StructuredLogsExplorer from "@/components/StructuredLogsExplorer";
import { buildPageMetadata } from "@/lib/seo";
import { getSession } from "@/lib/auth";
import { canManageGroups, canViewAdminLogs } from "@/lib/permissions";
import { getStructuredLogOverview, listStructuredLogs } from "@/lib/structuredLogs";
import { getStructuredLogSettings } from "@/lib/logSettings";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export const metadata = buildPageMetadata({
  title: "Журнал системи",
  description: "Структуровані логи Mistblossom: безпека, API, дії, Discord, база та інтеграції.",
  path: "/dashboard/logs",
  keywords: ["журнал", "логи", "безпека", "API", "Discord"],
});

function formatMb(bytes: number) {
  return `${(Math.max(0, bytes) / 1024 / 1024).toLocaleString("uk-UA", { maximumFractionDigits: 1 })} МБ`;
}

export default async function AdminLogsPage() {
  const user = await getSession();
  if (!user) { redirect("/login"); throw new Error("Login required"); }
  if (!canViewAdminLogs(user)) {
    redirect("/access-denied?reason=logs&from=/dashboard/logs");
    throw new Error("Access denied");
  }

  const [items, overview, settings] = await Promise.all([
    listStructuredLogs({ limit: 100, sinceHours: 24 }),
    getStructuredLogOverview(24),
    getStructuredLogSettings(),
  ]);
  const canEdit = canManageGroups(user);
  const canTuneStorage = Boolean(user.isServerOwner);

  return (
    <main className="container app-page admin-container">
      <section className="dashboard-shell content-shell admin-page admin-logs-page app-page-stack" aria-label="Журнал системи">
        <DashboardIdentity user={user} activeSection="admin" />
        <AdminPageHeader
          eyebrow="Mistblossom Vanguard • Observability"
          title="Журнал системи"
          description="Локальний структурований журнал із PostgreSQL. Зберігаємо останні 3 дні; API, дії та системні події не дублюються в Discord. У Discord може йти тільки Security."
          metrics={[
            { label: "24 години", value: overview.total.toLocaleString("uk-UA"), note: "структурованих подій" },
            { label: "Помилки", value: overview.errors.toLocaleString("uk-UA"), tone: overview.errors ? "danger" : "good" },
            { label: "Security", value: overview.security.toLocaleString("uk-UA"), tone: overview.security ? "warning" : "good" },
            { label: "Сховище", value: formatMb(overview.storageBytes), note: `ліміт ${settings.maxStorageMb} МБ` },
            { label: "Retention", value: "3 дні", note: `до ${settings.maxRows.toLocaleString("uk-UA")} записів` },
          ]}
        />

        <AdminTabs active="logs" user={user} />

        <StructuredLogsExplorer initialItems={items} initialOverview={overview} settings={settings} />

        <section className="panel admin-log-toolbar admin-log-toolbar--settings" aria-label="Security mirror">
          <div className="profile-card-head profile-card-head--inline">
            <div>
              <span className="eyebrow">Security → Discord</span>
              <h2>Дублювання тільки безпекових подій</h2>
            </div>
            <span className={`status-pill ${settings.securityDiscordEnabled ? "success" : "neutral"}`}>
              {settings.securityDiscordEnabled ? "Увімкнено" : "Вимкнено"}
            </span>
          </div>
          <p className="profile-card-lead">
            Discord більше не є сховищем журналу. Події API, дії адміністраторів, база, Discord-інтеграції та системні логи залишаються тільки на сервері. У Discord дозволено дублювати лише категорію Security.
          </p>
          <form className="admin-log-discord-form" action="/api/dashboard/logs/settings" method="post" data-dashboard-action-form="true" data-dashboard-live-submit="true">
            <div className="admin-log-discord-grid">
              <label className="toggle-row admin-log-toggle-row">
                <input type="checkbox" name="securityDiscordEnabled" value="1" defaultChecked={settings.securityDiscordEnabled} disabled={!canEdit} />
                <span>Дублювати Security у Discord</span>
              </label>
              <label className="field-label">Security channel ID
                <input className="input" name="securityDiscordChannelId" inputMode="numeric" pattern="[0-9]{16,25}" defaultValue={settings.securityDiscordChannelId} placeholder="123456789012345678" disabled={!canEdit} />
                <small>Бот потребує View Channel, Send Messages та Embed Links.</small>
              </label>
              <label className="field-label">Мінімальний рівень
                <select className="select" name="securityDiscordMinLevel" defaultValue={settings.securityDiscordMinLevel} disabled={!canEdit}>
                  <option value="info">Info і вище</option>
                  <option value="warning">Warning і Error</option>
                  <option value="error">Тільки Error</option>
                </select>
                <small>Фільтр застосовується тільки до Security; інші категорії ніколи не відправляються в Discord.</small>
              </label>
            </div>
            <div className="admin-log-discord-summary">
              <span><strong>3 дні</strong><small>retention</small></span>
              <span><strong>{settings.maxStorageMb} МБ</strong><small>storage budget</small></span>
              <span><strong>{settings.maxRows.toLocaleString("uk-UA")}</strong><small>max rows</small></span>
              <span><strong>{settings.queryLimit}</strong><small>rows in browser</small></span>
              <span><strong>Security only</strong><small>Discord mirror</small></span>
            </div>
            <div className="admin-log-discord-grid">
              <label className="field-label">Ліміт таблиці логів, МБ
                <input className="input" type="number" name="maxStorageMb" min="32" max="1024" step="16" defaultValue={settings.maxStorageMb} disabled={!canTuneStorage} />
                <small>{canTuneStorage ? "Жорсткий бюджет PostgreSQL для system_logs. Після перевищення видаляються найстаріші записи." : "Змінювати ліміт диска може тільки власник сервера."}</small>
              </label>
              <label className="field-label">Максимум записів
                <input className="input" type="number" name="maxRows" min="5000" max="250000" step="5000" defaultValue={settings.maxRows} disabled={!canTuneStorage} />
                <small>Другий запобіжник: retention 3 дні лишається фіксованим незалежно від цього числа.</small>
              </label>
              <label className="field-label">Рядків у браузері
                <input className="input" type="number" name="queryLimit" min="50" max="500" step="25" defaultValue={settings.queryLimit} disabled={!canTuneStorage} />
                <small>Обмежує памʼять вкладки й розмір одного API-відповіді журналу.</small>
              </label>
            </div>
            <button className="btn primary" type="submit" disabled={!canEdit}>Зберегти журнал</button>
          </form>
        </section>
      </section>
    </main>
  );
}
