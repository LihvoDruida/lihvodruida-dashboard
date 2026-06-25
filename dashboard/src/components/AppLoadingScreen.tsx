"use client";

import { usePathname } from "next/navigation";
import { resolveLoadingState } from "@/lib/pageState";

export default function AppLoadingScreen() {
  const pathname = usePathname();
  const copy = resolveLoadingState(pathname);

  return (
    <main className="app-state-page app-loading-page" aria-busy="true" aria-live="polite">
      <section className="app-state-shell app-loading-shell" role="status" aria-label={copy.title}>
        <article className="panel app-loading-card">
          <span className="app-loading-mark" aria-hidden="true" />
          <div className="app-loading-copy">
            <span className="app-state-eyebrow app-loading-eyebrow">{copy.eyebrow}</span>
            <h1>{copy.title}</h1>
            <p>{copy.message}</p>
            <strong className="app-loading-current">{copy.activeLabel}</strong>
          </div>
        </article>

        <div className="app-loading-progress" aria-hidden="true" />

        <ol className="app-loading-steps" aria-label="Етапи завантаження">
          {copy.steps.map((step) => (
            <li key={`${step.label}:${step.detail}`} className={`is-${step.state}`}>
              <strong>{step.label}</strong>
              <span>{step.detail}</span>
            </li>
          ))}
        </ol>
      </section>
    </main>
  );
}
