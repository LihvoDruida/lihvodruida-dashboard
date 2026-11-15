import type { AccountCleanupAutomationSettings } from "@/lib/accountCleanupAutomation";
import { nextAccountCleanupAt } from "@/lib/accountCleanupAutomation";
import PageSection from "@/components/page/PageSection";
import FormSection from "@/components/page/FormSection";
import Notice from "@/components/page/Notice";
import EmptyState from "@/components/page/EmptyState";
import StatusBadge from "@/components/page/StatusBadge";
import Button from "@/components/ui/Button";
import DataTable from "@/components/ui/DataTable";
import FormField from "@/components/ui/FormField";
import styles from "../access/access.module.css";

export function cleanupDate(value?: string | null) {
  if (!value || !Number.isFinite(Date.parse(value))) return "Ще не запускалось";
  return new Intl.DateTimeFormat("uk-UA", { timeZone: "Europe/Kyiv", dateStyle: "short", timeStyle: "short" }).format(new Date(value));
}
export default function ProfileCleanupForms({ settings }: { settings: AccountCleanupAutomationSettings }) {
  const checkAt = nextAccountCleanupAt(settings.lastCheckAt, settings.checkIntervalHours, settings.autoCheckEnabled);
  const applyAt = nextAccountCleanupAt(settings.lastCleanupAt, settings.cleanupIntervalHours, settings.autoCleanupEnabled);
  return <>
    <Notice title="Спочатку перевірка, потім видалення" tone="warning">
      Кандидат має одночасно бути відсутнім у Discord і поточному складі гільдії. Для ручного видалення потрібна успішна попередня перевірка від того самого власника не старше 15 хвилин із тим самим лімітом. Перед застосуванням дані перевіряються повторно.
    </Notice>
    {settings.lastError ? <Notice title="Останнє попередження" tone="warning">{settings.lastError}</Notice> : null}
    <div id="account-automation"><PageSection id="cleanup-schedule-title" title="Автоматизація" description="Розклад перевірки та очищення налаштовуються окремо.">
      <DataTable caption="Поточний стан очищення" headings={["Операція", "Стан", "Останній запуск", "Наступний запуск", "Результат"]}>
        <tr><th scope="row">Перевірка</th><td><StatusBadge tone={settings.autoCheckEnabled ? "success" : "neutral"}>{settings.autoCheckEnabled ? `Кожні ${settings.checkIntervalHours} год` : "Вимкнено"}</StatusBadge></td>
          <td>{cleanupDate(settings.lastCheckAt)}</td><td>{checkAt ? cleanupDate(checkAt) : "Не заплановано"}</td><td>Кандидатів: {settings.lastCheckCandidates} · перевірено: {settings.lastCheckCheckedProfiles}</td></tr>
        <tr><th scope="row">Видалення</th><td><StatusBadge tone={settings.autoCleanupEnabled ? "warning" : "neutral"}>{settings.autoCleanupEnabled ? `Кожні ${settings.cleanupIntervalHours} год` : "Вимкнено"}</StatusBadge></td>
          <td>{cleanupDate(settings.lastCleanupAt)}</td><td>{applyAt ? cleanupDate(applyAt) : "Лише вручну"}</td><td>Видалено: {settings.lastCleanupDeletedProfiles}</td></tr>
      </DataTable>
      <form action="/api/dashboard/discord/profiles/cleanup-settings" method="post" data-dashboard-action-form="true" data-dashboard-live-submit="true">
        <FormSection title="Розклад" description="Налаштування перевіряються кожні 15 хвилин. Автоочищення за замовчуванням вимкнене."
          actions={<Button tone="primary" type="submit">Зберегти автоматизацію</Button>}>
          <label className={styles.toggle}><input name="autoCheckEnabled" type="checkbox" defaultChecked={settings.autoCheckEnabled} /><span><strong>Автоматично перевіряти</strong><small>Знаходить кандидатів і записує результат без видалення.</small></span></label>
          <label className={styles.toggle}><input name="autoCleanupEnabled" type="checkbox" defaultChecked={settings.autoCleanupEnabled} /><span><strong>Автоматично очищати</strong><small>Видаляє неактивні профілі після окремої успішної перевірки.</small></span></label>
          <div className={styles.fields}>
            <label className={styles.field}>Інтервал перевірки<select name="checkIntervalHours" defaultValue={String(settings.checkIntervalHours)}>{[1, 3, 6, 12, 24].map(hours => <option key={hours} value={hours}>Кожні {hours} год</option>)}</select></label>
            <label className={styles.field}>Інтервал очищення<select name="cleanupIntervalHours" defaultValue={String(settings.cleanupIntervalHours)}>{[12, 24, 48, 72, 168].map(hours => <option key={hours} value={hours}>Кожні {hours} год</option>)}</select></label>
            <FormField label="Ліміт профілів за запуск" name="profileLimit" type="number" min={0} max={50000} defaultValue={settings.profileLimit} hint="0 = усі профілі посторінково" />
          </div>
        </FormSection>
      </form>
    </PageSection></div>
    <PageSection id="profile-maintenance" title="Ручна перевірка та очищення" description="Ці дії не змінюють розклад автоматизації.">
      <form className={styles.stack} action="/api/dashboard/discord/profiles/cleanup" method="post" data-dashboard-action-form="true" data-dashboard-live-submit="true">
        <FormSection title="Межі перевірки">
          <FormField label="Скільки профілів перевірити" name="limit" type="number" min={0} max={50000} defaultValue={settings.profileLimit}
            hint="0 = усі профілі посторінково. Для видалення потрібна попередня перевірка з точно таким самим лімітом." />
          <Button name="mode" value="inspect" type="submit">Тільки перевірити</Button>
        </FormSection>
        <details><summary>Видалення після перевірки</summary>
          <FormSection title="Підтвердження видалення" description="Разом із профілем очищаються активні рейдові записи, піки складу та голоси відкритих пулів. Закриті пули залишаються історією.">
            <label className={styles.toggle}><input name="confirmDeletion" type="checkbox" value="DELETE_STALE_PROFILES" /><span>Підтверджую, що переглянув результат перевірки. Видалити лише профілі, відсутні в Discord і roster.</span></label>
            <Button tone="danger" name="mode" value="apply" type="submit" data-confirm-message="Видалити підтверджені неактуальні профілі та їхні пов’язані активні записи?">Видалити неактуальні</Button>
          </FormSection>
        </details>
      </form>
    </PageSection>
    <PageSection id="profile-cleanup-history" title="Історія запусків">
      {settings.recentRuns.length ? <DataTable caption="Останні перевірки й очищення" headings={["Операція", "Джерело / час", "Перевірено", "Кандидати", "Видалено", "Помилки", "Стан"]}>
        {settings.recentRuns.map(run => <tr key={run.id}><th scope="row">{run.mode === "apply" ? "Очищення" : "Перевірка"}</th><td>{run.source === "automatic" ? "Автоматично" : "Вручну"} · {cleanupDate(run.completedAt)}</td>
          <td>{run.checkedProfiles}</td><td>{run.candidates}</td><td>{run.deletedProfiles}</td><td>{run.errors}</td><td><StatusBadge tone={run.status === "error" ? "danger" : run.status === "warning" ? "warning" : "success"}>{run.status === "error" ? "Помилка" : run.status === "warning" ? "З попередженням" : "Успішно"}</StatusBadge></td></tr>)}
      </DataTable> : <EmptyState title="Запусків ще немає" description="Почни з ручної перевірки. Її результат зʼявиться в історії." />}
    </PageSection>
  </>;
}
