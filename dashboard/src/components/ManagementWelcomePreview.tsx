"use client";

import Image from "next/image";
import { useState } from "react";

export default function ManagementWelcomePreview({ url }: { url: string }) {
  const [requested, setRequested] = useState("");
  const [failed, setFailed] = useState(false);
  const [ready, setReady] = useState(false);
  const visible = requested === url;
  return <div className="management-welcome-preview">
    {visible && !failed ? <Image src={url} alt="Серверний preview welcome-картки" width={1280} height={720}
      unoptimized onLoad={() => setReady(true)} onError={() => setFailed(true)} /> : null}
    {!visible || failed ? <div className="management-preview-placeholder">
      <span className="eyebrow">Welcome · 1280 × 720</span>
      <strong>{failed ? "Не вдалося завантажити картку" : "Переглянь картку перед публікацією"}</strong>
      <p>Прев’ю створюється за запитом із поточними тестовими даними.</p>
      <button type="button" className="btn subtle" onClick={() => { setRequested(url); setFailed(false); setReady(false); }}>
        {failed ? "Спробувати ще раз" : "Створити прев’ю"}
      </button>
    </div> : !ready ? <p role="status">Готуємо картку…</p> : null}
  </div>;
}
