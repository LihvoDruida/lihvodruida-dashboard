"use client";
import { useEffect, useState } from "react";
import styles from "./static.module.css";
import { StaticMarkdown } from "./StaticMarkdown";

type Rules = { text: string; version: number; expiresAt: string; ready: boolean };
type Challenge = { code: string; verifier: string; expiresAt: string };

export default function StaticAcceptClient({ token, botId }: { token: string; botId: string }) {
  const [rules, setRules] = useState<Rules | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [agreed, setAgreed] = useState(false);
  const [challenge, setChallenge] = useState<Challenge | null>(null);
  const [status, setStatus] = useState("pending");
  const [working, setWorking] = useState(false);
  useEffect(() => {
    let active = true;
    fetch(`/api/static/accept?t=${encodeURIComponent(token)}`, { cache: "no-store" })
      .then(async (r) => { const json = await r.json(); if (!r.ok) throw new Error(json.error || "Не вдалося відкрити правила."); return json as Rules; })
      .then((data) => { if (active) setRules(data); })
      .catch((cause) => { if (active) setError(String(cause.message || cause)); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [token]);
  useEffect(() => {
    if (!challenge || status === "completed" || status === "expired") return;
    let active = true;
    const poll = async () => {
      try {
        const response = await fetch(`/api/static/status?code=${encodeURIComponent(challenge.code)}&v=${encodeURIComponent(challenge.verifier)}`, { cache: "no-store" });
        if (!response.ok || !active) return;
        const data = await response.json();
        if (active && data.status) setStatus(data.status);
      } catch { /* transient connection loss */ }
      if (Date.parse(challenge.expiresAt) <= Date.now() && active) setStatus("expired");
    };
    void poll();
    const interval = setInterval(() => { void poll(); }, 4000);
    return () => { active = false; clearInterval(interval); };
  }, [challenge, status]);
  async function begin() {
    setWorking(true); setError("");
    try {
      const response = await fetch("/api/static/accept", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ token, agree: true }) });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Не вдалося почати підтвердження.");
      setChallenge({ code: data.code, verifier: data.verifier, expiresAt: data.expiresAt });
      setStatus("pending");
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Невідома помилка."); }
    finally { setWorking(false); }
  }
  return (
    <main className={`container app-page ${styles.wrap}`}>
      <header className={`hero panel ${styles.hero}`}>
        <div className="eyebrow">Mistblossom Vanguard • рейдовий склад</div>
        <h1>Правила Статика</h1>
        <p className="lead">Ознайомся з правилами та підтвердь прийняття через приватне повідомлення Discord-боту. Реєструватися на сайті не потрібно.</p>
      </header>
      {loading ? <section className="panel"><p>Завантажуємо правила…</p></section> : null}
      {error ? <div role="alert" className="notice panel error-note">{error}</div> : null}
      {rules ? <section className={`panel ${styles.card}`}>
        <div className={styles.meta}><span>Версія правил: {rules.version}</span><span>Посилання активне до {new Date(rules.expiresAt).toLocaleString("uk-UA")}</span></div>
        <div className={styles.rules}><StaticMarkdown value={rules.text || "*Правила ще не опубліковано.*"} /></div>
        {!challenge ? <div className={styles.acceptArea}>
          <label className={styles.check}><input type="checkbox" checked={agreed} onChange={(event) => setAgreed(event.target.checked)} /> Я прочитав(-ла) правила Статика та погоджуюся з ними.</label>
          <button className="btn primary" type="button" disabled={!agreed || !rules.ready || working} onClick={() => void begin()}>{working ? "Готуємо код…" : "Погоджуюся з правилами Статика"}</button>
          {!rules.ready ? <p className={styles.muted}>Видача ролі поки не налаштована. Звернись до РЛ.</p> : null}
        </div> : <div className={styles.challenge} aria-live="polite">
          {status === "completed" ? <p className={styles.success}>Роль «Статик» видана. Ти успішно прийняв(-ла) правила!</p> : <>
            <h2>Підтверди свій Discord</h2>
            <p>Відкрий приватний чат із ботом гільдії та надішли повідомлення одним рядком:</p>
            {/^[0-9]{16,25}$/.test(botId) ? <a className="btn subtle" href={`https://discord.com/users/${botId}`} target="_blank" rel="noopener noreferrer">Знайти бота в Discord</a> : null}
            <div className={styles.code}><code>статик {challenge.code}</code><button className="btn subtle" onClick={() => void navigator.clipboard.writeText(`статик ${challenge.code}`)}>Копіювати</button></div>
            <p className={styles.muted}>Код діє до {new Date(challenge.expiresAt).toLocaleTimeString("uk-UA")}. Бот має бути на тому самому Discord-сервері. Не надсилай код у публічні канали.</p>
            {status === "expired" ? <p role="alert">Код прострочено. Перезавантаж сторінку та отримай новий, поки запрошення активне.</p> : status === "failed" ? <p role="alert">Не вдалося завершити видачу ролі. Повтори команду в Discord або звернись до РЛ.</p> : <p>Очікуємо підтвердження від бота…</p>}
          </>}
        </div>}
      </section> : null}
    </main>
  );
}
