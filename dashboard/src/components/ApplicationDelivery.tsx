"use client";
import { useEffect, useRef, useState } from "react";
import { ApiHttpError } from "@/lib/apiHttp";
import { dashboardApiJson } from "@/lib/dashboardApiClient";
type Delivery = { state: string; attempts: number; nextAttemptAt: string | null; messageUrl: string; code: string };
const labels: Record<string, string> = { pending: "Очікує доставки", processing: "Доставка виконується", retry: "Повтор заплановано", blocked: "Перевір налаштування бота й каналу", uncertain: "Потрібна звірка з Discord", delivered: "Доставлено в Discord", cancelled: "Доставку скасовано", untracked: "Стара заявка: автоматичний повтор не заплановано" };
export default function ApplicationDelivery({ number }: { number: number }) {
  const [delivery, setDelivery] = useState<Delivery | null>(null), [error, setError] = useState(""), [readError, setReadError] = useState(""), [busy, setBusy] = useState(false), [messageUrl, setMessageUrl] = useState("");
  const epoch = useRef(0), lock = useRef(false), refresh = useRef<() => void>(() => {});
  const endpoint = `/api/applications/${number}/delivery`;
  useEffect(() => {
    let stopped = false, reading = false, queued = false, timer: ReturnType<typeof setTimeout> | undefined; const controller = new AbortController();
    async function read() {
      if (stopped || lock.current || document.hidden || !navigator.onLine) return;
      if (reading) { queued = true; return; }
      reading = true; const generation = epoch.current; clearTimeout(timer);
      try { const result = await dashboardApiJson<{ delivery: Delivery }>(endpoint, { signal: controller.signal, retries: 0, timeoutMs: 10_000 }); if (!result.delivery || !labels[result.delivery.state]) throw new Error("Invalid delivery state"); if (!stopped && generation === epoch.current && !lock.current) { setDelivery(result.delivery); setReadError(""); if (result.delivery.state === "delivered") setError(""); } }
      catch { if (!stopped && generation === epoch.current && !lock.current) setReadError("Стан доставки тимчасово недоступний."); }
      finally { reading = false; if (!stopped) { timer = setTimeout(read, queued ? 0 : 30_000); queued = false; } }
    }
    refresh.current = () => { void read(); }; void read(); document.addEventListener("visibilitychange", read); window.addEventListener("online", read);
    return () => { stopped = true; controller.abort(); clearTimeout(timer); document.removeEventListener("visibilitychange", read); window.removeEventListener("online", read); };
  }, [endpoint]);
  async function reconcile(event: React.SubmitEvent<HTMLFormElement>) {
    event.preventDefault(); if (lock.current) return; lock.current = true; epoch.current++; setBusy(true); setError("");
    try { const result = await dashboardApiJson<{ delivery: Delivery }>(endpoint, { method: "POST", json: messageUrl.trim() ? { messageUrl: messageUrl.trim() } : {}, retries: 0, timeoutMs: 55_000 }); if (!result.delivery || !labels[result.delivery.state]) throw new Error("Invalid delivery state"); setDelivery(result.delivery); if (result.delivery.state === "delivered") setMessageUrl(""); else if (messageUrl.trim()) setError("Посилання не підтверджено. Перевір канал і повідомлення цієї заявки."); }
    catch (error) { setError(error instanceof ApiHttpError && error.status >= 400 && error.status < 500 ? error.message : "Відповідь не отримано. Перевір стан доставки перед повторною дією."); }
    finally { lock.current = false; setBusy(false); refresh.current(); }
  }
  return <form className="application-delivery" onSubmit={reconcile} aria-label={`Доставка заявки #${number}`} aria-busy={busy}>
    <strong>Discord</strong><p role="status">{delivery ? labels[delivery.state] || "Стан невідомий" : "Перевіряємо доставку…"}</p>
    {delivery?.messageUrl && <a href={delivery.messageUrl} target="_blank" rel="noreferrer">Відкрити повідомлення ↗</a>}
    {delivery && !["delivered", "cancelled", "untracked"].includes(delivery.state) && <>
      {delivery.state === "uncertain" && <label>Посилання на вже створене повідомлення<input type="url" maxLength={500} value={messageUrl} onChange={event => setMessageUrl(event.target.value)} placeholder="https://discord.com/channels/…" disabled={busy}/></label>}
      <button className="btn subtle" type="submit" disabled={busy || delivery.state === "processing"}>{busy ? "Перевіряємо…" : delivery.state === "uncertain" ? "Звірити з Discord" : "Повторити доставку"}</button>
    </>}
    {(error || readError) && <p role="status">{error || readError} <button className="btn subtle" type="button" disabled={busy} onClick={() => refresh.current()}>Перевірити стан</button></p>}
  </form>;
}
