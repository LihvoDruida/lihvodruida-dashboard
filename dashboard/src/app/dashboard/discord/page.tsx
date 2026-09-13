import { redirect } from "next/navigation";

import AdminPageHeader from "@/components/AdminPageHeader";
import AdminTabs from "@/components/AdminTabs";
import DashboardIdentity from "@/components/DashboardIdentity";
import { getSession } from "@/lib/auth";
import {
  fetchDiscordRoleControlSnapshot,
  fetchDiscordTextChannels,
  getDiscordGuildId,
  type DiscordManageableRoleOption,
} from "@/lib/discordAdmin";
import { getGuildNicknamePolicy, nicknameTemplateExample } from "@/lib/guildNicknamePolicy";
import { documentStoreMode, hasFirebaseCredentials } from "@/lib/firebaseAdmin";
import { canManageDiscordMembers } from "@/lib/permissions";
import { buildPageMetadata } from "@/lib/seo";
import { getAccountCleanupAutomationSettings, nextAccountCleanupAt, type AccountCleanupRunStatus } from "@/lib/accountCleanupAutomation";
import { getNicknameWarningAutomationState } from "@/lib/discordNicknameWarnings";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export const metadata = buildPageMetadata({
  title: "Discord-учасники",
  description: "Discord-ролі, серверні ніки, синхронізація та обслуговування профілів Mistblossom Vanguard.",
  path: "/dashboard/discord",
  keywords: ["Discord", "ролі", "ніки", "керування"],
});

function RoleCheckboxes({
  roles,
  fieldName = "roleIds",
  emptyText = "Немає Discord-ролей, якими бот може керувати.",
  inputType = "checkbox",
  density = "regular",
}: {
  roles: DiscordManageableRoleOption[];
  fieldName?: string;
  emptyText?: string;
  inputType?: "checkbox" | "radio";
  density?: "regular" | "compact";
}) {
  if (!roles.length) {
    return <div className="discord-role-checkboxes discord-role-checkboxes--empty">{emptyText}</div>;
  }

  return (
    <div className={`discord-role-checkboxes discord-role-checkboxes--${density}`}>
      {roles.map((role) => (
        <label
          key={`${fieldName}-${role.id}`}
          className={`discord-role-option${!role.manageable ? " is-disabled" : ""}`}
          title={role.blockedReason || role.name}
        >
          <input type={inputType} name={fieldName} value={role.id} disabled={!role.manageable} />
          <span className="discord-role-option__copy">
            <strong>{role.name}</strong>
            <small>
              <span>Позиція {role.position}</span>
              <code>{role.id}</code>
            </small>
          </span>
          {!role.manageable ? <em>Недоступно</em> : null}
        </label>
      ))}
    </div>
  );
}

function SectionHeader({ eyebrow, title, description }: { eyebrow: string; title: string; description?: string }) {
  return (
    <header className="discord-management-section-head">
      <span className="eyebrow">{eyebrow}</span>
      <div>
        <h2>{title}</h2>
        {description ? <p>{description}</p> : null}
      </div>
    </header>
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


function formatCleanupDate(value?: string | null) {
  if (!value) return "Ще не запускалось";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Невідомо";
  return new Intl.DateTimeFormat("uk-UA", {
    timeZone: "Europe/Kyiv",
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

function cleanupStatusLabel(status?: AccountCleanupRunStatus | null) {
  if (status === "success") return "Успішно";
  if (status === "warning") return "З попередженням";
  if (status === "error") return "Помилка";
  return "Немає запусків";
}

function maskSnowflake(value?: string | null) {
  const clean = String(value || "").trim();
  if (!clean) return "не визначено";
  if (clean.length <= 8) return clean;
  return `${clean.slice(0, 4)}…${clean.slice(-4)}`;
}

export default async function AdminDiscordPage() {
  const user = await getSession();
  if (!user) { redirect("/login"); throw new Error("Login required"); }
  if (!canManageDiscordMembers(user)) {
    redirect("/access-denied?reason=discord&from=/dashboard/discord");
    throw new Error("Access denied");
  }

  const [policy, control, cleanupAutomation, nicknameWarningState, textChannels] = await Promise.all([
    getGuildNicknamePolicy(),
    fetchDiscordRoleControlSnapshot(),
    getAccountCleanupAutomationSettings(),
    getNicknameWarningAutomationState(),
    fetchDiscordTextChannels().catch(() => ({ guild: null, channels: [], suggestedChannelId: "", suggestedRulesChannelId: "", warning: "Discord channels unavailable" })),
  ]);
  const roles = control.roles;
  const manageableRoles = control.manageableRoles;
  const hasManageableRoles = manageableRoles.length > 0;
  const guild = control.guild;
  const guildId = getDiscordGuildId();
  const importTargetMode = documentStoreMode();
  const importSourceConfigured = hasFirebaseCredentials();
  const importAvailability = {
    sourceConfigured: importSourceConfigured,
    targetMode: importTargetMode,
    ready: importSourceConfigured && importTargetMode === "postgres",
    reason: !importSourceConfigured
      ? "Не задані Firebase credentials для читання старого Firestore."
      : importTargetMode !== "postgres"
        ? "Цільове сховище має бути PostgreSQL; імпорт Firestore → Firestore заблоковано."
        : null,
  } as const;
  const ownerDiscordId = guild?.ownerId || (user.isServerOwner && user.provider === "discord" ? user.id : null);
  const canImportProfiles = Boolean(user.isServerOwner && importAvailability.ready && (ownerDiscordId || user.profileId));
  const nextCleanupCheckAt = nextAccountCleanupAt(cleanupAutomation.lastCheckAt, cleanupAutomation.checkIntervalHours, cleanupAutomation.autoCheckEnabled);
  const nextCleanupApplyAt = nextAccountCleanupAt(cleanupAutomation.lastCleanupAt, cleanupAutomation.cleanupIntervalHours, cleanupAutomation.autoCleanupEnabled);

  const statusItems = [
    {
      label: "Discord server ID",
      value: guildId || "—",
      note: guildId ? "Сервер підключено" : "Немає DISCORD_GUILD_ID",
      ok: Boolean(guildId),
    },
    {
      label: "Сервер",
      value: guild?.name || "Сервер не прочитано",
      note: guild ? "Bot API відповідає" : "Перевір DISCORD_BOT_TOKEN і права бота",
      ok: Boolean(guild),
    },
    {
      label: "Бот",
      value: control.bot?.displayName || "—",
      note: control.error ? `Bot API: ${control.error}` : "Поточний Discord-бот",
      ok: !control.error,
    },
    {
      label: "Найвища роль",
      value: control.botTopRole?.name || "—",
      note: control.botTopRole ? `Позиція ${control.botTopRole.position}` : "Не вдалося визначити роль",
      ok: Boolean(control.botTopRole),
    },
    {
      label: "Manage Roles",
      value: control.botCanManageRoles ? "Доступ є" : "Немає доступу",
      note: "Discord permission",
      ok: Boolean(control.botCanManageRoles),
    },
    {
      label: "Керовані ролі",
      value: `${manageableRoles.length} / ${roles.length}`,
      note: hasManageableRoles ? "Нижче найвищої ролі бота" : "Робочих ролей немає",
      ok: hasManageableRoles,
    },
  ];

  return (
    <main className="container app-page admin-container">
      <section className="dashboard-shell content-shell admin-page discord-management-page app-page-stack" aria-label="Керування Discord-учасниками">
        <DashboardIdentity user={user} activeSection="admin" />
        <AdminPageHeader
          eyebrow="Mistblossom Vanguard • Discord"
          title="Discord-учасники"
          description="Точкові дії над учасниками, синхронізація ролей, правила серверного ніку та обслуговування бази профілів."
          metrics={[
            { label: "Сервер", value: guild ? guild.name : "Недоступно", note: guildId || "Discord не підключено", tone: guild ? "good" : "danger" },
            { label: "Ролей", value: roles.length.toLocaleString("uk-UA") },
            { label: "Керованих", value: manageableRoles.length.toLocaleString("uk-UA"), tone: manageableRoles.length ? "good" : "warning" },
            { label: "Manage Roles", value: control.botCanManageRoles ? "OK" : "ERR", tone: control.botCanManageRoles ? "good" : "danger" },
          ]}
        />

        <AdminTabs active="discord" user={user} />

        <nav className="discord-management-jump-nav" aria-label="Навігація по Discord-керуванню">
          <a href="#discord-health">Стан</a>
          <a href="#discord-settings">Налаштування</a>
          <a href="#discord-member-actions">Учасник</a>
          <a href="#discord-automation">Синхронізація</a>
          <a href="#discord-profiles">Профілі</a>
        </nav>

        <section id="discord-health" className="discord-management-health-grid" aria-label="Стан Discord">
          <section className="panel discord-management-section discord-management-section--status" aria-label="Стан Discord-підключення">
            <SectionHeader
              eyebrow="Система"
              title="Стан підключення"
              description="Критичні перевірки Discord API та можливостей бота в одному місці."
            />
            <div className="discord-management-status">
              {statusItems.map((item) => (
                <div key={item.label} className={`discord-management-status__item ${item.ok ? "is-ok" : "is-warning"}`}>
                  <small>{item.label}</small>
                  <strong>{item.value}</strong>
                  <em>{item.note}</em>
                </div>
              ))}
            </div>
          </section>

          <section className={`panel discord-management-section discord-management-section--roles ${hasManageableRoles ? "is-ok" : "is-warning"}`} aria-label="Перевірка ієрархії ролей Discord">
            <div className="discord-management-section-head discord-management-section-head--inline">
              <div>
                <span className="eyebrow">Ієрархія ролей</span>
                <h2>{hasManageableRoles ? "Ролі готові до керування" : "Керування ролями обмежене"}</h2>
                <p>У робочих формах показуються тільки ролі, які бот реально може видати або зняти.</p>
              </div>
              <span className={`status-pill ${hasManageableRoles ? "good" : "warning"}`}>{manageableRoles.length} доступно</span>
            </div>
            <div className="discord-role-hierarchy-summary">
              <InfoChip title={control.botTopRole?.name || "—"} text="найвища роль бота" />
              <InfoChip title={String(control.blockedRoles.length)} text="недоступних" />
              <InfoChip title={control.botCanManageRoles ? "Так" : "Ні"} text="Manage Roles" />
            </div>
            {control.blockedRoles.length ? (
              <details className="discord-management-details">
                <summary>Показати {control.blockedRoles.length} недоступних ролей</summary>
                <div className="discord-management-blocked-roles">
                  {control.blockedRoles.slice(0, 20).map((role) => (
                    <span key={role.id}><strong>{role.name}</strong><small>{role.blockedReason}</small></span>
                  ))}
                </div>
              </details>
            ) : null}
          </section>
        </section>

        <section id="discord-settings" className="discord-management-zone" aria-label="Налаштування Discord">
          <div className="discord-management-zone__head">
            <SectionHeader
              eyebrow="Конфігурація"
              title="Глобальні правила Discord"
              description="Шаблон серверного ніку, паралельність Discord-запитів і автоматичні попередження учасникам."
            />
          </div>
          <form className="panel discord-management-card discord-management-card--settings discord-settings-card" action="/api/dashboard/discord/settings" method="post" data-dashboard-action-form="true" data-dashboard-live-submit="true">
            <div className="discord-settings-card__primary">
              <label className="field-label">Шаблон серверного ніку
                <input className="input" name="template" defaultValue={policy.template} placeholder="{name} [{main}, {alt}, {alt}]" required />
                <small>Змінні: <code>{"{name}"}</code>, <code>{"{main}"}</code>, <code>{"{alt}"}</code>. Приклад: {nicknameTemplateExample(policy.template)}.</small>
              </label>
              <div className="discord-settings-summary" aria-label="Поточна конфігурація Discord-дій">
                <InfoChip title={String(policy.nicknameCleanupConcurrency || "Авто")} text="попередження ніків" />
              </div>
            </div>
            <div className="discord-settings-card__limits">
              <div className="discord-settings-grid" aria-label="Паралельність Discord-дій">
                <label className="field-label">Попередження ніків
                  <input className="input" name="nicknameCleanupConcurrency" type="number" min="0" max={policy.nicknameCleanupMaxConcurrency} defaultValue={policy.nicknameCleanupConcurrency} />
                  <small>0 = автоматично</small>
                </label>
                <label className="field-label">Макс. паралельно
                  <input className="input" name="nicknameCleanupMaxConcurrency" type="number" min="1" max="4" defaultValue={policy.nicknameCleanupMaxConcurrency} />
                  <small>1–4 Discord-запити</small>
                </label>
              </div>
              <section className="nickname-warning-settings" aria-label="Автоматичні попередження про серверні ніки">
                <div className="nickname-warning-settings__head">
                  <div><span className="eyebrow">Автоматизація ніків</span><h3>DM → fallback-канал</h3></div>
                  <label className="settings-toggle-row">
                    <input name="nicknameReminderEnabled" type="checkbox" defaultChecked={policy.nicknameReminderEnabled} />
                    <span><strong>Автоматично попереджати</strong><small>Ніколи не змінює ролі чи нік — лише надсилає повідомлення.</small></span>
                  </label>
                </div>
                <div className="nickname-warning-settings__grid">
                  <input type="hidden" name="nicknameReminderIntervalHours" value={policy.nicknameReminderIntervalHours} />
                  <label className="field-label">Некоректні — перевіряти кожні
                    <input className="input" name="nicknameInvalidRecheckHours" type="number" min="1" max="72" defaultValue={policy.nicknameInvalidRecheckHours} />
                    <small>годин; це пріоритетна черга з точковою перевіркою Discord member</small>
                  </label>
                  <label className="field-label">Коректні — повний sweep кожні
                    <input className="input" name="nicknameValidRecheckHours" type="number" min="12" max="720" defaultValue={policy.nicknameValidRecheckHours} />
                    <small>годин; одним guild-members запитом перевіряється весь сервер і перебудовується черга</small>
                  </label>
                  <label className="field-label">Cooldown учасника
                    <input className="input" name="nicknameReminderCooldownHours" type="number" min="1" max="720" defaultValue={policy.nicknameReminderCooldownHours} />
                    <small>повторно не турбувати з тією самою помилкою</small>
                  </label>
                  <label className="field-label">Макс. за прохід
                    <input className="input" name="nicknameReminderBatchLimit" type="number" min="1" max="500" defaultValue={policy.nicknameReminderBatchLimit} />
                    <small>максимум пріоритетних перевірок/попереджень за один cron-прохід</small>
                  </label>
                  <label className="field-label">Fallback-канал
                    <select className="input" name="nicknameReminderChannelId" defaultValue={policy.nicknameReminderChannelId}>
                      <option value="">Без fallback-каналу</option>
                      {policy.nicknameReminderChannelId && !textChannels.channels.some((channel) => channel.id === policy.nicknameReminderChannelId) ? <option value={policy.nicknameReminderChannelId}>Поточний канал ({policy.nicknameReminderChannelId})</option> : null}
                      {textChannels.channels.map((channel) => <option key={channel.id} value={channel.id}># {channel.name}</option>)}
                    </select>
                    <small>Якщо DM закриті — бот тегне учасника тут.</small>
                  </label>
                </div>
                <p className="nickname-warning-settings__hint">Scheduler пріоритезує некоректні ніки: їх перечитує точково й частіше. Коректні не опитуються по одному — вони повторно перевіряються лише під час рідкого повного sweep. Порядок доставки: DM → fallback-канал.</p>
              </section>
              <button className="btn primary" type="submit">Зберегти налаштування</button>
            </div>
          </form>
        </section>

        <section id="discord-member-actions" className="discord-management-zone" aria-label="Дії з одним Discord-учасником">
          <div className="discord-management-zone__head">
            <SectionHeader
              eyebrow="Учасник"
              title="Точкові дії"
              description="Операції над одним Discord-користувачем без масової синхронізації."
            />
          </div>
          <div className="discord-member-actions-grid">
            <form className="panel discord-management-card discord-management-card--compact" action="/api/dashboard/discord/nickname" method="post" data-dashboard-action-form="true" data-dashboard-live-submit="true">
              <div className="profile-card-head">
                <span className="eyebrow">Серверний нік</span>
                <h2>Перейменувати учасника</h2>
              </div>
              <div className="discord-management-card__body">
                <label className="field-label">Discord user ID
                  <input className="input" name="userId" inputMode="numeric" pattern="[0-9]{16,25}" required placeholder="123456789012345678" />
                </label>
                <label className="field-label">Новий серверний нік
                  <input className="input" name="nickname" maxLength={32} required placeholder={nicknameTemplateExample(policy.template)} />
                </label>
                <div className="form-actions"><button className="btn primary" type="submit">Змінити нік</button></div>
              </div>
            </form>

            <form className="panel discord-management-card discord-management-card--compact discord-management-card--member-roles" action="/api/dashboard/discord/roles/add" method="post" data-dashboard-action-form="true" data-dashboard-live-submit="true">
              <div className="profile-card-head profile-card-head--inline">
                <div><span className="eyebrow">Ролі</span><h2>Ручне керування ролями</h2></div>
                <span className="status-pill good">{manageableRoles.length} доступно</span>
              </div>
              <div className="discord-management-card__body">
                <label className="field-label discord-management-user-field">Discord user ID
                  <input className="input" name="userId" inputMode="numeric" pattern="[0-9]{16,25}" required placeholder="123456789012345678" />
                </label>
                <RoleCheckboxes roles={manageableRoles} fieldName="roleIds" emptyText="Немає ролей, якими бот може керувати. Перевір ієрархію та Manage Roles." density="compact" />
                <div className="form-actions form-actions--split">
                  <button className="btn primary" type="submit" disabled={!hasManageableRoles}>Додати вибрані</button>
                  <button
                    className="btn danger"
                    type="submit"
                    formAction="/api/dashboard/discord/roles/remove"
                    formMethod="post"
                    disabled={!hasManageableRoles}
                    data-confirm-message="Зняти вибрані Discord-ролі з цього учасника? Система перевірить результат після операції."
                  >
                    Зняти вибрані
                  </button>
                </div>
              </div>
            </form>
          </div>
        </section>

        <section id="discord-automation" className="discord-management-zone" aria-label="Discord-синхронізація">
          <div className="discord-management-zone__head">
            <SectionHeader
              eyebrow="Синхронізація"
              title="Масові Discord-операції"
              description="Синхронізація ролей і безпечні попередження учасникам із повторною перевіркою актуального Discord-стану."
            />
          </div>
          <div className="discord-automation-grid">
            <form className="panel discord-management-card discord-management-card--action" action="/api/dashboard/discord/officers/sync" method="post" data-dashboard-action-form="true" data-dashboard-live-submit="true">
              <div className="profile-card-head profile-card-head--inline">
                <div><span className="eyebrow">Склад гільдії</span><h2>Офіцерська роль</h2></div>
                <span className="status-pill good">1 роль</span>
              </div>
              <div className="discord-management-card__body">
                <p className="profile-card-lead">Видає вибрану роль профілям, де хоча б один персонаж у складі має ранг <strong>Глава</strong> або <strong>Офіцер</strong>.</p>
                <input type="hidden" name="limit" value="0" />
                <RoleCheckboxes roles={manageableRoles} fieldName="officerRoleIds" inputType="radio" density="compact" emptyText="Немає доступних ролей для офіцерської синхронізації." />
                <div className="discord-officer-sync-summary">
                  <InfoChip title="Склад" text="officer / guild_master" />
                  <InfoChip title="Профілі" text="усі персонажі" />
                  <InfoChip title="Discord" text="member.nick" />
                </div>
                <div className="form-actions">
                  <button className="btn primary" type="submit" disabled={!hasManageableRoles} data-confirm-message="Видати вибрану Discord-роль тільки профілям, де персонаж є у збереженому складі зі статусом Глава або Офіцер?">Синхронізувати роль</button>
                </div>
              </div>
            </form>

            <article className="panel discord-management-card discord-management-card--action nickname-warning-card">
              <div className="profile-card-head profile-card-head--inline">
                <div><span className="eyebrow">Серверні ніки</span><h2>Попередження про неправильний нік</h2></div>
                <span className={`status-pill ${policy.nicknameReminderEnabled ? "good" : "subtle"}`}>{policy.nicknameReminderEnabled ? "Автоматично" : "Ручний режим"}</span>
              </div>
              <div className="discord-management-card__body">
                <p className="profile-card-lead">Перевіряє <code>member.nick</code> за глобальним шаблоном. <strong>Ролі, доступи й нік не змінюються.</strong> Після повного проходу некоректні ніки переходять у пріоритетну часту чергу, а коректні перевіряються значно рідше повним sweep. Некоректному учаснику бот спочатку пише в DM; якщо приватні повідомлення недоступні — тегне у fallback-каналі.</p>
                <div className="nickname-warning-status-grid">
                  <InfoChip title={nicknameWarningState.lastFullScanAt ? formatCleanupDate(nicknameWarningState.lastFullScanAt) : "Ще не було"} text="повна перевірка" />
                  <InfoChip title={`${nicknameWarningState.trackedInvalid} / ${nicknameWarningState.trackedValid}`} text="пріоритет / коректні" />
                  <InfoChip title={nicknameWarningState.nextInvalidCheckAt ? formatCleanupDate(nicknameWarningState.nextInvalidCheckAt) : "Черга порожня"} text="наступна пріоритетна" />
                  <InfoChip title={`${nicknameWarningState.lastDm} / ${nicknameWarningState.lastChannel}`} text="DM / канал" />
                  <InfoChip title={String(nicknameWarningState.lastFailed)} text="помилок" />
                </div>
                {nicknameWarningState.lastError ? <div className="discord-inline-warning"><strong>Остання помилка:</strong> {nicknameWarningState.lastError}</div> : null}
                <form action="/api/dashboard/discord/nicknames/notify" method="post" data-dashboard-action-form="true" data-dashboard-live-submit="true">
                  <label className="field-label discord-management-limit-field">Скільки учасників перевірити
                    <input className="input" name="limit" type="number" min="0" max="50000" defaultValue="0" />
                    <small>0 = весь сервер. Повна перевірка перебудовує пріоритетну чергу; автоматичний priority-run обробляє до {policy.nicknameReminderBatchLimit} некоректних учасників.</small>
                  </label>
                  <div className="nickname-warning-flow" aria-label="Логіка сповіщення">
                    <span><b>1</b><strong>Full sweep</strong><small>коректні раз на {policy.nicknameValidRecheckHours} год</small></span>
                    <span><b>2</b><strong>Priority</strong><small>некоректні раз на {policy.nicknameInvalidRecheckHours} год</small></span>
                    <span><b>3</b><strong>DM → fallback</strong><small>{policy.nicknameReminderChannelId ? `# ${textChannels.channels.find((channel) => channel.id === policy.nicknameReminderChannelId)?.name || policy.nicknameReminderChannelId}` : "без fallback"}</small></span>
                    <span><b>4</b><strong>Cooldown</strong><small>{policy.nicknameReminderCooldownHours} год</small></span>
                  </div>
                  <div className="form-actions form-actions--split">
                    <button className="btn subtle" formAction="/api/dashboard/discord/nicknames/inspect" formMethod="post" type="submit" name="recheckAll" value="1" data-confirm-message="Переперевірити серверні ніки всіх учасників і повністю перебудувати пріоритетну чергу? Повідомлення надсилатися не будуть.">Переперевірити всіх</button>
                    <button className="btn primary" type="submit" data-confirm-message="Перевірити серверні ніки й надіслати попередження учасникам із неправильним ніком? Ролі та ніки автоматично не змінюватимуться.">Перевірити й попередити</button>
                  </div>
                </form>
                {nicknameWarningState.recentRuns.length ? (
                  <details className="discord-management-details nickname-warning-history">
                    <summary>Останні запуски ({nicknameWarningState.recentRuns.length})</summary>
                    <div className="nickname-warning-history__list">
                      {nicknameWarningState.recentRuns.map((run) => (
                        <div className={`nickname-warning-history__row is-${run.status}`} key={run.id}>
                          <span><strong>{run.source === "automatic" ? "Автоматично" : "Вручну"} · {run.mode === "priority" ? "priority" : "full sweep"}</strong><small>{formatCleanupDate(run.completedAt)}</small></span>
                          <span>перевірено <b>{run.checked}</b></span>
                          <span>некоректних <b>{run.invalid}</b></span>
                          <span>попереджено <b>{run.notified}</b></span>
                          <span>помилок <b>{run.failed}</b></span>
                        </div>
                      ))}
                    </div>
                  </details>
                ) : null}
              </div>
            </article>
          </div>
        </section>

        <section id="discord-profiles" className="discord-management-zone discord-management-zone--profiles" aria-label="База Discord-профілів">
          <div className="discord-management-zone__head">
            <SectionHeader
              eyebrow="Профілі"
              title="Дані та обслуговування dashboardProfiles"
              description="Імпорт старих Firestore-профілів і безпечне очищення неактуальних акаунтів розділені на дві незалежні операції."
            />
          </div>
          <div className="discord-profile-maintenance-grid">
            <form className="panel discord-management-card discord-management-card--import" action="/api/dashboard/discord/profiles/import-firestore" method="post" data-dashboard-action-form="true" data-dashboard-live-submit="true">
              <div className="profile-card-head profile-card-head--inline">
                <div><span className="eyebrow">Firestore → PostgreSQL</span><h2>Імпорт dashboardProfiles</h2></div>
                <span className={`status-pill ${canImportProfiles ? "good" : "warning"}`}>{canImportProfiles ? "Готово" : "Заблоковано"}</span>
              </div>
              <div className="discord-management-card__body">
                <p className="profile-card-lead">Імпорт проходить по старій колекції <code>dashboardProfiles</code>. <strong>Профіль власника сервера завжди виключається на сервері</strong> — це не залежить від значень форми.</p>
                <div className="discord-import-safety-grid" aria-label="Умови імпорту">
                  <InfoChip title={importAvailability.sourceConfigured ? "Готово" : "Немає ключів"} text="Firestore source" />
                  <InfoChip title={importAvailability.targetMode === "postgres" ? "PostgreSQL" : importAvailability.targetMode} text="ціль" />
                  <InfoChip title={ownerDiscordId ? maskSnowflake(ownerDiscordId) : user.profileId ? "profileId" : "не визначено"} text="owner захищений" />
                </div>
                {!importAvailability.ready ? <p className="discord-inline-warning">{importAvailability.reason}</p> : null}
                {!user.isServerOwner ? <p className="discord-inline-warning">Імпорт доступний тільки власнику Discord-сервера.</p> : null}
                <label className="field-label">Стратегія злиття
                  <select className="input" name="strategy" defaultValue="safe" disabled={!canImportProfiles}>
                    <option value="safe">Безпечно — поточна PostgreSQL-база має пріоритет</option>
                    <option value="firestore-priority">Firestore має пріоритет для наявних полів</option>
                  </select>
                  <small>Рекомендовано «Безпечно»: нові профілі створюються, а наявні дані не відкочуються старим Firestore.</small>
                </label>
                <label className="field-label discord-management-limit-field">Ліміт профілів
                  <input className="input" name="limit" type="number" min="0" max="50000" defaultValue="0" disabled={!canImportProfiles} />
                  <small>0 = усі. Для першої перевірки можна поставити 20–50.</small>
                </label>
                <div className="form-actions form-actions--split">
                  <button className="btn subtle" name="mode" value="inspect" type="submit" disabled={!canImportProfiles}>Preview імпорту</button>
                  <button className="btn primary" name="mode" value="apply" type="submit" disabled={!canImportProfiles} data-confirm-message="Імпортувати dashboardProfiles зі старого Firestore в PostgreSQL? Власник Discord-сервера буде примусово виключений. Перед застосуванням рекомендовано виконати Preview.">Імпортувати профілі</button>
                </div>
              </div>
            </form>

            <article className="panel discord-management-card discord-management-card--danger account-cleanup-card">
              <div className="profile-card-head profile-card-head--inline">
                <div><span className="eyebrow">Автоматизація очищення</span><h2>Неактуальні акаунти</h2></div>
                <span className={`status-pill ${cleanupAutomation.autoCleanupEnabled ? "warning" : cleanupAutomation.autoCheckEnabled ? "good" : "subtle"}`}>
                  {cleanupAutomation.autoCleanupEnabled ? "Автоочищення" : cleanupAutomation.autoCheckEnabled ? "Автоперевірка" : "Вимкнено"}
                </span>
              </div>
              <div className="discord-management-card__body account-cleanup-body">
                <p className="profile-card-lead">Кандидатом стає лише профіль, який <strong>одночасно</strong> відсутній у поточному roster і більше не є учасником Discord. Перед кожним реальним видаленням система повторно читає Discord і оновлює склад гільдії.</p>

                <div className="account-cleanup-status-grid" aria-label="Стан автоматичного очищення">
                  <div className="account-cleanup-status-card">
                    <small>Автоперевірка</small>
                    <strong>{cleanupAutomation.autoCheckEnabled ? `Кожні ${cleanupAutomation.checkIntervalHours} год` : "Вимкнена"}</strong>
                    <span>{cleanupAutomation.autoCheckEnabled ? `Наступна: ${formatCleanupDate(nextCleanupCheckAt)}` : "Dry-run не запускається автоматично"}</span>
                  </div>
                  <div className="account-cleanup-status-card account-cleanup-status-card--danger">
                    <small>Автоочищення</small>
                    <strong>{cleanupAutomation.autoCleanupEnabled ? `Кожні ${cleanupAutomation.cleanupIntervalHours} год` : "Вимкнене"}</strong>
                    <span>{cleanupAutomation.autoCleanupEnabled ? `Наступне: ${formatCleanupDate(nextCleanupApplyAt)}` : "Видалення тільки вручну"}</span>
                  </div>
                  <div className="account-cleanup-status-card">
                    <small>Остання перевірка</small>
                    <strong>{formatCleanupDate(cleanupAutomation.lastCheckAt)}</strong>
                    <span>{cleanupStatusLabel(cleanupAutomation.lastCheckStatus)} · кандидатів: {cleanupAutomation.lastCheckCandidates}</span>
                  </div>
                  <div className="account-cleanup-status-card">
                    <small>Останнє очищення</small>
                    <strong>{formatCleanupDate(cleanupAutomation.lastCleanupAt)}</strong>
                    <span>{cleanupStatusLabel(cleanupAutomation.lastCleanupStatus)} · видалено: {cleanupAutomation.lastCleanupDeletedProfiles}</span>
                  </div>
                </div>

                {cleanupAutomation.lastError ? <div className="discord-inline-warning account-cleanup-last-error"><strong>Останнє попередження:</strong> {cleanupAutomation.lastError}</div> : null}

                <form className="account-cleanup-settings" action="/api/dashboard/discord/profiles/cleanup-settings" method="post" data-dashboard-action-form="true" data-dashboard-live-submit="true">
                  <div className="account-cleanup-toggle-grid">
                    <label className="admin-policy-toggle">
                      <input name="autoCheckEnabled" type="checkbox" defaultChecked={cleanupAutomation.autoCheckEnabled} disabled={!user.isServerOwner} />
                      <span className="admin-policy-toggle__copy">
                        <strong>Автоматично перевіряти</strong>
                        <small>Безпечний dry-run: шукає кандидатів, нічого не видаляє і записує результат у журнал.</small>
                      </span>
                    </label>
                    <label className="admin-policy-toggle admin-policy-toggle--danger">
                      <input name="autoCleanupEnabled" type="checkbox" defaultChecked={cleanupAutomation.autoCleanupEnabled} disabled={!user.isServerOwner} />
                      <span className="admin-policy-toggle__copy">
                        <strong>Автоматично очищати</strong>
                        <small>Деструктивна дія. Перед автоочищенням scheduler обов’язково виконує окремий успішний dry-run, а видалення — не раніше наступного cron-тику.</small>
                      </span>
                    </label>
                  </div>
                  <div className="account-cleanup-settings-grid">
                    <label className="field-label">Інтервал перевірки
                      <select className="input" name="checkIntervalHours" defaultValue={String(cleanupAutomation.checkIntervalHours)} disabled={!user.isServerOwner}>
                        <option value="1">Щогодини</option>
                        <option value="3">Кожні 3 години</option>
                        <option value="6">Кожні 6 годин</option>
                        <option value="12">Кожні 12 годин</option>
                        <option value="24">Раз на добу</option>
                      </select>
                    </label>
                    <label className="field-label">Інтервал очищення
                      <select className="input" name="cleanupIntervalHours" defaultValue={String(cleanupAutomation.cleanupIntervalHours)} disabled={!user.isServerOwner}>
                        <option value="12">Кожні 12 годин</option>
                        <option value="24">Раз на добу</option>
                        <option value="48">Раз на 2 доби</option>
                        <option value="72">Раз на 3 доби</option>
                        <option value="168">Раз на тиждень</option>
                      </select>
                    </label>
                    <label className="field-label">Ліміт профілів за запуск
                      <input className="input" name="profileLimit" type="number" min="0" max="50000" defaultValue={cleanupAutomation.profileLimit} disabled={!user.isServerOwner} />
                      <small>0 = усі профілі посторінково</small>
                    </label>
                  </div>
                  <div className="form-actions account-cleanup-settings-actions">
                    <span className="form-hint">Scheduler перевіряє налаштування кожні 15 хвилин. Автоочищення за замовчуванням вимкнене і вмикається тільки власником сервера.</span>
                    <button className="btn primary" type="submit" disabled={!user.isServerOwner}>Зберегти автоматизацію</button>
                  </div>
                </form>

                <div className="account-cleanup-manual">
                  <div className="account-cleanup-subhead">
                    <div><span className="eyebrow">Ручний запуск</span><h3>Перевірити або очистити зараз</h3></div>
                    <span className="status-pill subtle">Не змінює розклад</span>
                  </div>
                  <form action="/api/dashboard/discord/profiles/cleanup" method="post" data-dashboard-action-form="true" data-dashboard-live-submit="true">
                    <label className="field-label discord-management-limit-field">Скільки профілів перевірити
                      <input className="input" name="limit" type="number" min="0" max="50000" defaultValue={cleanupAutomation.profileLimit} />
                      <small>0 = усі профілі посторінково</small>
                    </label>
                    <div className="discord-officer-sync-summary" aria-label="Що перевіряється перед очищенням профілів">
                      <InfoChip title="Roster" text="автооновлення" />
                      <InfoChip title="Discord" text="membership" />
                      <InfoChip title="Рейди" text="записи" />
                      <InfoChip title="Склад" text="піки" />
                      <InfoChip title="Пули" text="голоси" />
                    </div>
                    <details className="discord-management-details discord-management-details--explanation">
                      <summary>Що буде очищено разом із профілем</summary>
                      <p>Перед видаленням прибираються активні рейдові записи, піки з активних складів сезону та голоси у відкритих пулах. Закриті пули залишаються історією. Після цього Discord-ембеди перемальовуються.</p>
                    </details>
                    <div className="form-actions form-actions--split">
                      <button className="btn subtle" name="mode" value="inspect" type="submit">Тільки перевірити</button>
                      <button className="btn danger" name="mode" value="apply" type="submit" data-confirm-message="Видалити профілі, які одночасно відсутні в актуальному складі гільдії та на Discord-сервері? Пов’язані активні записи також будуть очищені. Продовжити?">Видалити неактуальні</button>
                    </div>
                  </form>
                </div>

                <details className="discord-management-details account-cleanup-history" open={cleanupAutomation.recentRuns.length > 0}>
                  <summary>Історія останніх запусків ({cleanupAutomation.recentRuns.length})</summary>
                  {cleanupAutomation.recentRuns.length ? (
                    <div className="account-cleanup-history-list">
                      {cleanupAutomation.recentRuns.map((run) => (
                        <div className={`account-cleanup-history-row is-${run.status}`} key={run.id}>
                          <div>
                            <strong>{run.mode === "apply" ? "Очищення" : "Перевірка"}</strong>
                            <small>{run.source === "automatic" ? "Автоматично" : "Вручну"} · {formatCleanupDate(run.completedAt)}</small>
                          </div>
                          <div className="account-cleanup-history-metrics">
                            <span>Перевірено <strong>{run.checkedProfiles}</strong></span>
                            <span>Кандидатів <strong>{run.candidates}</strong></span>
                            {run.mode === "apply" ? <span>Видалено <strong>{run.deletedProfiles}</strong></span> : null}
                            <span>Помилок <strong>{run.errors}</strong></span>
                          </div>
                        </div>
                      ))}
                    </div>
                  ) : <p>Автоматичні або ручні запуски ще не зафіксовані.</p>}
                </details>
              </div>
            </article>
          </div>
        </section>
      </section>
    </main>
  );
}
