import { redirect } from "next/navigation";

import AdminTabs from "@/components/AdminTabs";
import DashboardIdentity from "@/components/DashboardIdentity";
import AdminPageHeader from "@/components/AdminPageHeader";
import ServerStatusDashboard from "@/components/ServerStatusDashboard";
import { getSession } from "@/lib/auth";
import { fetchDiscordTextChannels } from "@/lib/discordAdmin";
import { getDiscordWelcomeCardSettings } from "@/lib/discordWelcomeCardSettings";
import { buildPageMetadata } from "@/lib/seo";
import { getServerStatusSnapshot } from "@/lib/serverStatus";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

export const metadata = buildPageMetadata({
  title: "Стан сервера",
  description: "Приватний моніторинг CPU, RAM, swap, диска та uptime сервера Mistblossom Vanguard.",
  path: "/dashboard/server",
  keywords: ["server monitoring", "cpu", "ram", "disk", "uptime"],
});

export default async function ServerStatusPage() {
  const user = await getSession();
  if (!user) {
    redirect("/login");
  }
  if (!user.isServerOwner) {
    redirect("/access-denied?reason=owner-only&from=/dashboard/server");
  }

  const [snapshot, textChannels, welcomeCardSettings] = await Promise.all([
    getServerStatusSnapshot(),
    fetchDiscordTextChannels().catch(() => ({ guild: null, channels: [], suggestedChannelId: "", suggestedRulesChannelId: "", warning: "Discord channels unavailable" })),
    getDiscordWelcomeCardSettings(),
  ]);

  return (
    <main className="container app-page admin-container server-status-container">
      <section className="dashboard-shell content-shell admin-page server-status-page app-page-stack" aria-label="Стан сервера Mistblossom Vanguard">
        <DashboardIdentity user={user} activeSection="admin" />
        <AdminPageHeader
          eyebrow="Mistblossom Vanguard • Owner only"
          title="Стан сервера"
          description="Живі CPU, RAM, Swap, диск, Docker cache та uptime без запису телеметрії в базу даних."
          metrics={[
            { label: "Хост", value: snapshot.platform.hostname, note: `${snapshot.platform.platform} ${snapshot.platform.arch}` },
            { label: "CPU", value: `${snapshot.cpu.logicalCores} ядра`, note: snapshot.cpu.model },
            { label: "RAM", value: `${Math.round(snapshot.memory.usagePercent)}%`, tone: snapshot.memory.usagePercent >= 85 ? "danger" : snapshot.memory.usagePercent >= 70 ? "warning" : "good" },
            { label: "Диск", value: snapshot.disk.usagePercent === null ? "—" : `${Math.round(snapshot.disk.usagePercent)}%`, tone: (snapshot.disk.usagePercent ?? 0) >= 85 ? "danger" : (snapshot.disk.usagePercent ?? 0) >= 70 ? "warning" : "good" },
          ]}
        />
        <AdminTabs active="server" user={user} />
        <ServerStatusDashboard initialSnapshot={snapshot} />

        <section className="panel" aria-label="Welcome-картки Discord">
          <div className="discord-management-section-head discord-management-section-head--inline">
            <div>
              <span className="eyebrow">Owner only • Discord</span>
              <h2>Публічна welcome-картка для нових учасників</h2>
              <p>Картка генерується сервером за шаблоном нічних ельфів і відправляється в обраний канал для кожного нового учасника, якого знайде onboarding-автоматизація.</p>
            </div>
            <span className={`status-pill ${welcomeCardSettings.enabled ? "good" : "warning"}`}>{welcomeCardSettings.enabled ? "Увімкнено" : "Вимкнено"}</span>
          </div>

          <form action="/api/dashboard/server/discord-welcome-card" method="post" data-dashboard-action-form="true" data-dashboard-live-submit="true">
            <div className="nickname-warning-settings__head">
              <label className="settings-toggle-row settings-toggle-row--card">
                <input name="enabled" type="checkbox" defaultChecked={welcomeCardSettings.enabled} />
                <span>
                  <strong>Публікувати welcome-картку в канал</strong>
                  <small>Не в DM. Тригер — новий учасник у Discord-гілдії.</small>
                </span>
              </label>
            </div>

            <div className="nickname-warning-settings__grid nickname-warning-settings__grid--delivery">
              <label className="field-label">Канал для привітання
                <select className="input" name="channelId" defaultValue={welcomeCardSettings.channelId}>
                  <option value="">Не вибрано</option>
                  {welcomeCardSettings.channelId && !textChannels.channels.some((channel) => channel.id === welcomeCardSettings.channelId)
                    ? <option value={welcomeCardSettings.channelId}>Поточний канал ({welcomeCardSettings.channelId})</option>
                    : null}
                  {textChannels.channels.map((channel) => <option key={channel.id} value={channel.id}># {channel.name}</option>)}
                </select>
                <small>Бот надсилатиме картинку саме сюди.</small>
              </label>

              <label className="field-label">Підпис під номером
                <input className="input" name="labelPrefix" defaultValue={welcomeCardSettings.labelPrefix} maxLength={24} />
                <small>За замовчуванням: «Мурлок» → картка покаже «Мурлок №1234».</small>
              </label>

              <label className="field-label">Назва PNG-файлу
                <input className="input" name="fileName" defaultValue={welcomeCardSettings.fileName} maxLength={60} />
                <small>Лише для назви вкладення в Discord.</small>
              </label>
            </div>

            <div className="nickname-warning-settings__group">
              <label className="field-label">Текст повідомлення в каналі
                <textarea className="input" name="messageTemplate" rows={4} defaultValue={welcomeCardSettings.messageTemplate} />
                <small>Доступні плейсхолдери: <code>{"{mention}"}</code>, <code>{"{displayName}"}</code>, <code>{"{username}"}</code>, <code>{"{greeting}"}</code>, <code>{"{label}"}</code>.</small>
              </label>
            </div>

            <div className="nickname-warning-settings__group">
              <label className="field-label">Варіанти привітання (по одному в рядку)
                <textarea className="input" name="greetings" rows={8} defaultValue={welcomeCardSettings.greetings.join("\n")} />
                <small>Для кожного нового учасника система вибирає один випадковий/детермінований варіант з цього списку.</small>
              </label>
            </div>

            <div className="form-actions">
              <button className="btn" type="submit">Зберегти welcome-картку</button>
            </div>
          </form>
        </section>
      </section>
    </main>
  );
}
