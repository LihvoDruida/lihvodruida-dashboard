"use client";

import { useId, useMemo, useState } from "react";
import FormSection from "@/components/page/FormSection";
import Notice from "@/components/page/Notice";
import PageSection from "@/components/page/PageSection";
import StatusBadge from "@/components/page/StatusBadge";
import Button from "@/components/ui/Button";
import type { SystemSettingDef } from "@/lib/systemSettingsSchema";
import styles from "./system.module.css";

type SettingView = SystemSettingDef & { override: string; envValue: string };
type EnvStatus = { key: string; label: string; state: "set" | "missing" | "weak"; hint: string };
type State = { revision: number; updatedAt: string | null; updatedBy: string | null; settings: SettingView[]; env: EnvStatus[] };

const GROUPS: SystemSettingDef["group"][] = ["Гільдія", "Інтеграції", "Діагностика", "Сховище"];
const ENV_TONE = { set: "success", missing: "neutral", weak: "warning" } as const;

function SettingField({ setting, value, error, onChange }: { setting: SettingView; value: string; error?: string; onChange: (value: string) => void }) {
  const id = useId();
  const fallback = setting.envValue ? `з .env: ${setting.envValue}` : "у .env не задано";
  const describedBy = `${id}-hint${error ? ` ${id}-error` : ""}`;
  const choices = setting.kind === "bool" ? [["true", "Увімкнено"], ["false", "Вимкнено"]] : setting.kind === "region" ? [["eu", "EU"], ["us", "US"], ["kr", "KR"], ["tw", "TW"]] : null;
  return <div className={styles.field}>
    <div className={styles.labelRow}>
      <label htmlFor={id}>{setting.label}</label>
      <StatusBadge tone={setting.applies === "live" ? "info" : "warning"}>{setting.applies === "live" ? "діє одразу" : "після перезапуску"}</StatusBadge>
      {value ? <StatusBadge tone="success">перевизначено</StatusBadge> : null}
    </div>
    {choices
      ? <select id={id} value={value} aria-describedby={describedBy} aria-invalid={error ? true : undefined} onChange={event => onChange(event.target.value)}>
          <option value="">Як у .env ({setting.envValue || "не задано"})</option>
          {choices.map(([optionValue, label]) => <option key={optionValue} value={optionValue}>{label}</option>)}
        </select>
      : <input id={id} value={value} placeholder={fallback} maxLength={200} inputMode={setting.kind === "int" ? "numeric" : undefined}
          aria-describedby={describedBy} aria-invalid={error ? true : undefined} onChange={event => onChange(event.target.value)} />}
    <small id={`${id}-hint`} className={styles.hint}>{setting.help} Порожнє поле — значення з .env ({setting.key}).</small>
    {error ? <small id={`${id}-error`} className="error-note" role="alert">{error}</small> : null}
  </div>;
}

export default function SystemSettingsClient({ initial }: { initial: State }) {
  const [state, setState] = useState(initial);
  const [draft, setDraft] = useState<Record<string, string>>(() => Object.fromEntries(initial.settings.map(setting => [setting.key, setting.override])));
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [notice, setNotice] = useState<{ tone: "success" | "danger" | "warning"; title: string; text?: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const dirty = useMemo(() => state.settings.some(setting => (draft[setting.key] || "") !== setting.override), [draft, state.settings]);

  async function save() {
    setBusy(true); setNotice(null); setErrors({});
    try {
      const response = await fetch("/api/dashboard/system-settings", {
        method: "POST", headers: { "Content-Type": "application/json", Accept: "application/json" }, credentials: "same-origin",
        body: JSON.stringify({ revision: state.revision, values: Object.fromEntries(Object.entries(draft).filter(([, value]) => value.trim())) }),
      });
      const body = await response.json().catch(() => null) as (State & { ok: boolean; message?: string; errors?: Record<string, string> }) | null;
      if (response.ok && body?.ok) {
        setState(body);
        setDraft(Object.fromEntries(body.settings.map(setting => [setting.key, setting.override])));
        const restart = body.settings.some(setting => setting.applies === "restart" && setting.override !== (state.settings.find(item => item.key === setting.key)?.override || ""));
        setNotice({ tone: "success", title: "Збережено", text: restart ? "Частина змін діятиме після перезапуску панелі (make restart)." : "Зміни вже діють." });
      } else {
        if (body?.errors) setErrors(body.errors);
        setNotice({ tone: response.status === 409 ? "warning" : "danger", title: response.status === 409 ? "Конфлікт змін" : "Не збережено", text: body?.message || `HTTP ${response.status}` });
      }
    } catch {
      setNotice({ tone: "danger", title: "Немає звʼязку", text: "Запит не дійшов до сервера; спробуй ще раз." });
    } finally {
      setBusy(false);
    }
  }

  return <div className={styles.stack}>
    {notice ? <Notice title={notice.title} tone={notice.tone}>{notice.text}</Notice> : null}
    <PageSection id="system-runtime" title="Робочі параметри" description={state.updatedAt ? `Остання зміна: ${new Date(state.updatedAt).toLocaleString("uk-UA")} · ${state.updatedBy || "—"}` : "Ще не змінювалися: діють значення з .env."}>
      <form className={styles.stack} onSubmit={event => { event.preventDefault(); void save(); }}>
        {GROUPS.map(group => <FormSection key={group} title={group}>
          <div className={styles.fields}>
            {state.settings.filter(setting => setting.group === group).map(setting =>
              <SettingField key={setting.key} setting={setting} value={draft[setting.key] || ""} error={errors[setting.key]}
                onChange={value => setDraft(current => ({ ...current, [setting.key]: value }))} />)}
          </div>
        </FormSection>)}
        <div className={styles.actions}>
          <Button tone="primary" type="submit" busy={busy} disabled={!dirty}>Зберегти</Button>
          <Button tone="ghost" type="button" disabled={busy || !dirty} onClick={() => { setDraft(Object.fromEntries(state.settings.map(setting => [setting.key, setting.override]))); setErrors({}); }}>Скасувати зміни</Button>
        </div>
      </form>
    </PageSection>
    <PageSection id="system-env" title="Секрети та ключі запуску" description="Лише стан, без значень. Змінюються на сервері: make configure (або make configure KEY=НАЗВА), потім make up.">
      <ul className={styles.envList}>
        {state.env.map(item => <li key={item.key} className={styles.envRow}>
          <span>{item.label}<small>{item.key} · {item.hint}</small></span>
          <StatusBadge tone={ENV_TONE[item.state]}>{item.state === "set" ? "задано" : item.state === "weak" ? "закоротке" : "не задано"}</StatusBadge>
        </li>)}
      </ul>
    </PageSection>
  </div>;
}
