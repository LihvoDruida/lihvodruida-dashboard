"use client";

import { useEffect, useState } from "react";

export default function GuildRulesAcceptForm({ token, revision }: { token: string; revision: string }) {
  const [checked, setChecked] = useState(false);
  const [pending, setPending] = useState(false);
  useEffect(() => {
    const restore = () => setPending(false);
    window.addEventListener("pageshow", restore);
    return () => window.removeEventListener("pageshow", restore);
  }, []);
  return <form className="guild-agreement-form" action="/api/rules/accept/complete" method="post" data-toast-managed="true" onSubmit={event => {
    if (pending) { event.preventDefault(); return; }
    setPending(true);
  }} aria-busy={pending}>
    <input type="hidden" name="rt" value={token} />
    <input type="hidden" name="revision" value={revision} />
    <label className="guild-agreement-check">
      <input type="checkbox" name="agree" value="yes" required checked={checked} onChange={event => setChecked(event.target.checked)} />
      <span>Я прочитав / прочитала правила та погоджуюся їх дотримуватися.</span>
    </label>
    <div className="guild-agreement-actions">
      <a className="guild-agreement-login" href="/login">Авторизація</a>
      <button className="guild-agreement-submit" type="submit" disabled={!checked || pending}>{pending ? "Приймаємо…" : "Прийняти правила"}</button>
    </div>
    <p className="guild-agreement-note">Вхід на сайт необовʼязковий. Роль отримає акаунт, для якого відкрито посилання з Discord.</p>
  </form>;
}
