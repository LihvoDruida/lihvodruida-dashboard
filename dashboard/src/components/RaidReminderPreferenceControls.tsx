"use client";
import { useEffect, useState } from "react";
import { dashboardApiJson } from "@/lib/dashboardApiClient";

export default function RaidReminderPreferenceControls() {
  const [saved, setSaved] = useState<boolean | null>(null);
  const [enabled, setEnabled] = useState(true);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [failed, setFailed] = useState(false);
  async function read(signal?: AbortSignal) {
    const data = await dashboardApiJson<{ enabled: boolean }>("/api/profile/notifications", { signal, timeoutMs: 10_000 });
    if (typeof data.enabled !== "boolean") throw new Error("invalid preference");
    setSaved(data.enabled); setEnabled(data.enabled);
  }
  useEffect(() => {
    const controller = new AbortController();
    void read(controller.signal).catch(() => { if (!controller.signal.aborted) { setFailed(true); setMessage("Не вдалося завантажити налаштування."); } });
    return () => controller.abort();
  }, []);
  async function save(event: React.FormEvent) {
    event.preventDefault(); setBusy(true); setMessage(""); setFailed(false);
    try {
      if (saved === null) { await read(); setMessage("Актуальний стан завантажено."); return; }
      const data = await dashboardApiJson<{ enabled: boolean }>("/api/profile/notifications", { method: "POST", json: { enabled }, retries: 0, timeoutMs: 10_000 });
      if (data.enabled !== enabled) throw new Error("preference mismatch");
      setSaved(data.enabled); setMessage("Налаштування збережено для всіх твоїх рейдів.");
    } catch {
      setFailed(true);
      try { await read(); setMessage("Відповідь не підтверджено. Показано актуальний збережений стан."); }
      catch { setSaved(null); setMessage("Не вдалося перевірити збереження. Спробуй оновити стан."); }
    } finally { setBusy(false); }
  }
  return <form onSubmit={save}>
    {saved !== null ? <label className="settings-toggle-row"><input type="checkbox" checked={enabled} disabled={busy || saved === null} onChange={(event) => setEnabled(event.target.checked)} /><span>Нагадати в особисті за 15 хвилин</span></label> : <p role="status">{failed ? "Стан нагадувань недоступний." : "Завантажуємо налаштування…"}</p>}
    <p className="muted">Спільне налаштування для всіх рейдів. Зміни у Discord також зберігаються тут.</p>
    <button className="btn" type="submit" disabled={busy || (saved === null && !failed) || (saved !== null && saved === enabled)}>{busy ? "Зберігаємо…" : saved === null ? "Оновити стан" : "Зберегти"}</button>
    {message ? <p role={failed ? "alert" : "status"}>{message}</p> : null}
  </form>;
}
