"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition, type FormEvent } from "react";
import { dispatchDashboardToast } from "@/lib/clientToasts";
import styles from "@/app/dashboard/logs/logs.module.css";

type Settings = {
  retentionDays: 3;
  maxStorageMb: number;
  maxRows: number;
  queryLimit: number;
  securityDiscordEnabled: boolean;
  securityDiscordChannelId: string;
  securityDiscordMinLevel: "info" | "warning" | "error";
  updatedAt?: string | null;
  updatedBy?: string | null;
  source?: "database" | "env";
};

export default function StructuredLogSettingsPanel({
  initialSettings,
  canEdit,
  canTuneStorage,
}: {
  initialSettings: Settings;
  canEdit: boolean;
  canTuneStorage: boolean;
}) {
  const router = useRouter();
  const [settings, setSettings] = useState(initialSettings);
  const [isSaving, startSaving] = useTransition();
  const [isTesting, startTesting] = useTransition();

  function patch<K extends keyof Settings>(key: K, value: Settings[K]) {
    setSettings((current) => ({ ...current, [key]: value }));
  }

  function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    startSaving(async () => {
      try {
        const data = new FormData(form);
        data.set("securityDiscordEnabled", settings.securityDiscordEnabled ? "1" : "0");
        const response = await fetch("/api/dashboard/logs/settings", {
          method: "POST",
          body: data,
          credentials: "same-origin",
          headers: { Accept: "application/json", "X-Dashboard-Action": "live" },
        });
        const payload = await response.json().catch(() => null) as { ok?: boolean; settings?: Settings; toast?: { title?: string; message?: string } } | null;
        if (!response.ok || !payload?.ok || !payload.settings) {
          throw new Error(payload?.toast?.message || "Сервер не підтвердив збереження.");
        }
        setSettings(payload.settings);
        dispatchDashboardToast({
          tone: "success",
          title: "Налаштування журналу збережено",
          message: payload.toast?.message || "Нові параметри вже використовуються сервером.",
          ttl: 5200,
        });
        router.refresh();
      } catch (error) {
        dispatchDashboardToast({
          tone: "error",
          title: "Не вдалося зберегти журнал",
          message: error instanceof Error ? error.message : "Невідома помилка.",
          ttl: 7600,
        });
      }
    });
  }

  function testDiscord() {
    startTesting(async () => {
      try {
        const response = await fetch("/api/dashboard/logs/security-test", {
          method: "POST",
          credentials: "same-origin",
          headers: { Accept: "application/json", "X-Dashboard-Action": "live" },
        });
        const payload = await response.json().catch(() => null) as { ok?: boolean; message?: string } | null;
        if (!response.ok || !payload?.ok) throw new Error(payload?.message || `HTTP ${response.status}`);
        dispatchDashboardToast({ tone: "success", title: "Discord mirror працює", message: payload.message, ttl: 5200 });
      } catch (error) {
        dispatchDashboardToast({
          tone: "error",
          title: "Discord mirror не працює",
          message: error instanceof Error ? error.message : "Не вдалося надіслати тестове повідомлення.",
          ttl: 7600,
        });
      }
    });
  }

  return (
    <section className={styles.settingsPanel} aria-label="Налаштування журналу">
      <div className={styles.settingsHeader}>
        <div>
          <span className={styles.sectionEyebrow}>Security → Discord</span>
          <h2>Зберігання та Security mirror</h2>
          <p>
            Основний журнал зберігається тільки у PostgreSQL. Discord отримує лише Security-події,
            якщо дзеркало увімкнене.
          </p>
        </div>
        <div className={styles.settingsStatusBlock}>
          <span className={`${styles.mirrorStatus} ${settings.securityDiscordEnabled ? styles.mirrorEnabled : styles.mirrorDisabled}`}>
            <i /> {settings.securityDiscordEnabled ? "Security mirror увімкнено" : "Security mirror вимкнено"}
          </span>
          <small>{settings.source === "database" ? "Налаштування: PostgreSQL" : "Налаштування: ENV defaults"}</small>
        </div>
      </div>

      <form className={styles.settingsForm} onSubmit={save}>
        <div className={styles.settingsLayout}>
          <div className={styles.settingsPrimary}>
            <div className={styles.settingsSectionTitle}>
              <div><strong>Discord Security</strong><small>Єдина категорія, яку дозволено дублювати за межі VPS.</small></div>
            </div>

            <label className={styles.switchRow}>
              <span>
                <strong>Дублювати Security у Discord</strong>
                <small>API, Action, Auth, Database, Integration, Discord та System залишаються тільки на сервері.</small>
              </span>
              <input
                type="checkbox"
                checked={settings.securityDiscordEnabled}
                onChange={(event) => patch("securityDiscordEnabled", event.target.checked)}
                disabled={!canEdit || isSaving}
              />
            </label>

            <div className={styles.formGrid2}>
              <label className={styles.field}>
                <span>Security channel ID</span>
                <input
                  name="securityDiscordChannelId"
                  inputMode="numeric"
                  pattern="[0-9]{16,25}"
                  value={settings.securityDiscordChannelId}
                  onChange={(event) => patch("securityDiscordChannelId", event.target.value)}
                  placeholder="123456789012345678"
                  disabled={!canEdit || isSaving}
                />
                <small>Боту потрібні View Channel, Send Messages та Embed Links.</small>
              </label>
              <label className={styles.field}>
                <span>Мінімальний рівень</span>
                <select
                  name="securityDiscordMinLevel"
                  value={settings.securityDiscordMinLevel}
                  onChange={(event) => patch("securityDiscordMinLevel", event.target.value as Settings["securityDiscordMinLevel"])}
                  disabled={!canEdit || isSaving}
                >
                  <option value="info">Info, Warning і Error</option>
                  <option value="warning">Warning і Error</option>
                  <option value="error">Тільки Error</option>
                </select>
                <small>Фільтр діє тільки для Security mirror.</small>
              </label>
            </div>

            <div className={styles.settingsActions}>
              <button className="btn primary" type="submit" disabled={!canEdit || isSaving}>
                {isSaving ? "Зберігаємо…" : "Зберегти налаштування"}
              </button>
              <button className="btn" type="button" onClick={testDiscord} disabled={!canEdit || isTesting || isSaving}>
                {isTesting ? "Перевіряємо…" : "Надіслати тест у Discord"}
              </button>
            </div>
          </div>

          <aside className={styles.storageCard}>
            <div className={styles.settingsSectionTitle}>
              <div><strong>Ліміт локального журналу</strong><small>Жорсткі межі для VPS; retention завжди 3 дні.</small></div>
            </div>
            <div className={styles.storageFacts}>
              <span><small>Retention</small><strong>3 дні</strong></span>
              <span><small>Storage</small><strong>{settings.maxStorageMb} МБ</strong></span>
              <span><small>Max rows</small><strong>{settings.maxRows.toLocaleString("uk-UA")}</strong></span>
              <span><small>Browser</small><strong>{settings.queryLimit}</strong></span>
            </div>
            <div className={styles.storageFields}>
              <label className={styles.field}>
                <span>Ліміт таблиці, МБ</span>
                <input type="number" name="maxStorageMb" min="32" max="1024" step="16" value={settings.maxStorageMb}
                  onChange={(event) => patch("maxStorageMb", Number(event.target.value))} disabled={!canTuneStorage || isSaving} />
              </label>
              <label className={styles.field}>
                <span>Максимум записів</span>
                <input type="number" name="maxRows" min="5000" max="250000" step="5000" value={settings.maxRows}
                  onChange={(event) => patch("maxRows", Number(event.target.value))} disabled={!canTuneStorage || isSaving} />
              </label>
              <label className={styles.field}>
                <span>Рядків у браузері</span>
                <input type="number" name="queryLimit" min="50" max="500" step="25" value={settings.queryLimit}
                  onChange={(event) => patch("queryLimit", Number(event.target.value))} disabled={!canTuneStorage || isSaving} />
              </label>
            </div>
            <p className={styles.storageNote}>
              Після перевищення row/storage budget maintenance видаляє найстаріші записи. Volumes, БД інших модулів і Docker cache це не зачіпає.
            </p>
          </aside>
        </div>
      </form>
    </section>
  );
}
