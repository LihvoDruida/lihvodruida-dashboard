"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { ApiHttpError } from "@/lib/apiHttp";
import { dashboardApiJson } from "@/lib/dashboardApiClient";
import { unknownPublicationStatus, type PublicationStatus } from "@/lib/publicationStatus";

type Reply = { ok: boolean; publication?: PublicationStatus | null; warning?: string | null };
export default function DiscordPublicationStatus({ endpoint, initialStatus, discordEnabled }: { endpoint: string; initialStatus: PublicationStatus; discordEnabled: boolean }) {
  const router = useRouter();
  const [status, setStatus] = useState(initialStatus);
  const [pending, setPending] = useState<"read" | "write" | null>(null);
  const [messageUrl, setMessageUrl] = useState("");
  const [notice, setNotice] = useState("");
  const lock = useRef(false);
  // A server refresh can arrive while the local POST is in flight. Its result
  // must not overwrite a newer status read at the end of this action.
  useEffect(() => { if (!lock.current) setStatus(initialStatus); }, [initialStatus]);
  async function read() {
    const data = await dashboardApiJson<Reply>(endpoint, { method: "GET", timeoutMs: 10_000, retries: 0 });
    if (!data.ok || !data.publication) throw new Error("Стан не підтверджено.");
    setStatus(data.publication);
    return data.publication;
  }
  async function run(write: boolean) {
    if (lock.current) return;
    if (write && (!status.canAct || !discordEnabled)) return;
    if (write && status.channelMove && !window.confirm("Перенести оголошення до збереженого каналу? Буде створено нове повідомлення, після чого сайт спробує прибрати старе.")) return;
    lock.current = true;
    setPending(write ? "write" : "read"); setNotice("");
    let actionWarning = "";
    try {
      if (write) {
        const data = await dashboardApiJson<Reply>(endpoint, { method: "POST", json: { publicationMessageUrl: status.manualAllowed ? messageUrl.trim() : "" }, timeoutMs: 45_000, retries: 0 });
        if (!data.ok) throw new Error("Результат дії не підтверджено.");
        actionWarning = data.warning || "";
        setMessageUrl("");
      }
      const fresh = await read();
      setNotice(write ? actionWarning || (fresh.message.pending || fresh.event?.pending ? "Операція ще потребує завершення. Перевір збережений стан нижче." : "Discord підтвердив виконання дії. Стан перечитано зі сховища.") : "Збережений стан оновлено. Discord цим читанням не опитувався.");
      if (write) router.refresh();
    } catch (error) {
      const detail = error instanceof ApiHttpError && [400, 403, 409].includes(error.status) ? ` ${error.message.slice(0, 500)}` : "";
      setNotice((write ? "Виконання не підтверджено повністю. Звір збережений стан перед наступною дією. Повторного автоматичного надсилання немає." : "Не вдалося оновити стан. Спробуй прочитати його ще раз.") + detail);
      // Even a lost response can follow a successful Discord write. Re-read
      // the durable receipt; never automatically replay this POST.
      if (write) { try { await read(); } catch { setStatus(unknownPublicationStatus()); } }
      else setStatus(unknownPublicationStatus());
    } finally { lock.current = false; setPending(null); }
  }
  return <section id="discord-publication" className="panel publication-workbench" aria-label="Стан публікації Discord" aria-busy={pending !== null}>
    <div><span className="eyebrow">Discord · збережений стан</span><h2>Публікація та відновлення</h2>
      <p className="muted">Дії використовують останні збережені дані. Зміни у формі спочатку збережи.</p></div>
    <dl className="publication-workbench__states">
      <div><dt>Оголошення · {status.message.label}</dt><dd>{status.message.description}</dd></div>
      {status.event ? <div><dt>Подія · {status.event.label}</dt><dd>{status.event.description}</dd></div> : null}
    </dl>
    {status.scheduled ? <p>Розклад збережено. Публікація доступна лише після настання запланованого часу.</p> : null}
    {status.manualAllowed ? <label className="publication-workbench__link">Посилання на вже створене оголошення (необовʼязково)
      <input type="url" aria-label="Посилання на вже створене оголошення" value={messageUrl} onChange={event => setMessageUrl(event.target.value)} placeholder="https://discord.com/channels/…" maxLength={300} disabled={pending !== null} />
      <span className="muted">Посилання перевіряється за каналом, автором, часом і записом. Воно не дозволяє примусове повторне надсилання.</span>
    </label> : null}
    {!discordEnabled ? <p>Discord-публікація зараз недоступна. Збережений стан можна перечитати.</p> : null}
    <div className="publication-workbench__actions">
      <button type="button" className="btn subtle" disabled={pending !== null} onClick={() => run(false)}>{pending === "read" ? "Читаємо стан…" : "Оновити стан"}</button>
      {status.canAct && discordEnabled ? <button type="button" className="btn primary" disabled={pending !== null} onClick={() => run(true)}>{pending === "write" ? "Виконуємо…" : status.actionLabel}</button> : null}
    </div>
    <p role="status" aria-live="polite">{notice}</p>
  </section>;
}
