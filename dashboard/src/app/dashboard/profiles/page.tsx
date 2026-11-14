import ManagementShell from "@/components/management/ManagementShell";
import { redirect } from "next/navigation";
import AdminPageHeader from "@/components/AdminPageHeader";
import { getSession } from "@/lib/auth";
import { getAccountCleanupAutomationSettings, nextAccountCleanupAt, type AccountCleanupRunStatus } from "@/lib/accountCleanupAutomation";
import { buildPageMetadata } from "@/lib/seo";
export const dynamic = "force-dynamic";
export const revalidate = 0;
export const metadata = buildPageMetadata({ title: "Очищення профілів", description: "Приватний аудит та контрольоване очищення застарілих профілів.", path: "/dashboard/profiles" });

function SectionHeader({ eyebrow, title, description }: { eyebrow: string; title: string; description?: string }) {
  return <header className="discord-management-section-head"><span className="eyebrow">{eyebrow}</span>
    <div><h2>{title}</h2>{description ? <p>{description}</p> : null}</div></header>;
}
function InfoChip({ title, text }: { title: string; text: string }) {
  return <span className="discord-info-chip"><strong>{title}</strong><small>{text}</small></span>;
}
function formatCleanupDate(value?: string | null) {
  if (!value) return "Ще не запускалось";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Невідомо";
  return new Intl.DateTimeFormat("uk-UA", { timeZone: "Europe/Kyiv", day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" }).format(date);
}
function cleanupStatusLabel(status?: AccountCleanupRunStatus | null) {
  if (status === "success") return "Успішно";
  if (status === "warning") return "З попередженням";
  if (status === "error") return "Помилка";
  return "Немає запусків";
}
export default async function ProfileMaintenancePage() {
  const user = await getSession({ live: true });
  if (!user) redirect("/login?next=%2Fdashboard%2Fprofiles");
  if (!user.isServerOwner) redirect("/access-denied?reason=owner-only&from=/dashboard/profiles");
  const cleanupAutomation = await getAccountCleanupAutomationSettings();
  const nextCleanupCheckAt = nextAccountCleanupAt(cleanupAutomation.lastCheckAt, cleanupAutomation.checkIntervalHours, cleanupAutomation.autoCheckEnabled);
  const nextCleanupApplyAt = nextAccountCleanupAt(cleanupAutomation.lastCleanupAt, cleanupAutomation.cleanupIntervalHours, cleanupAutomation.autoCleanupEnabled);
  return <ManagementShell user={user} active="profiles" className="">
      <AdminPageHeader eyebrow="Mistblossom Vanguard • Обслуговування" title="Очищення профілів"
        description="Лише власник: попередня перевірка, підтверджене видалення та історія запусків. Дані з Discord-записів у рейди не є вебпрофілями." />
      
      <div className="panel management-cleanup-notice" role="note">
        <strong>Безпечний порядок: спочатку перевірка, потім підтвердження.</strong>
        <p>Не видаляємо всіх користувачів лише тому, що рейди перейшли в Discord. Чинні адміністративні облікові записи, учасники Discord і roster захищаються поточними перевірками. Перевірку має виконати той самий власник не раніше ніж за 15 хвилин до видалення; ліміт повинен збігатися.</p>
      </div>
        <section id="profile-maintenance" className="discord-management-zone discord-management-zone--profiles" aria-label="База Discord-профілів">
          <div className="discord-management-zone__head">
            <SectionHeader
              eyebrow="Профілі"
              title="Дані та обслуговування dashboardProfiles"
              description="Профілі зберігаються у PostgreSQL. Очищення перевіряє актуальний склад гільдії та Discord."
            />
          </div>
          <div className="discord-profile-maintenance-grid">
            <article id="account-automation" className="panel discord-management-card discord-management-card--danger account-cleanup-card">
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
                      <small>0 = усі профілі посторінково; для видалення потрібен dry-run з таким самим лімітом.</small>
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
                    <label className="account-cleanup-confirm-label">
                      <input name="confirmDeletion" type="checkbox" value="DELETE_STALE_PROFILES" />
                      <span>Підтверджую, що ознайомився з результатом перевірки. Видаляти лише відсутні в Discord і roster профілі.</span>
                    </label>
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
    </ManagementShell>;
}
