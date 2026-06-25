"use client";

import Link from "next/link";
import { useEffect, useMemo } from "react";
import {
  isTransientClientStreamError,
  sendClientErrorReport,
} from "@/components/ClientErrorReporter";
import {
  PROBLEM_STATES,
  TRANSIENT_STREAM_PROBLEM,
  type ProblemKind,
} from "@/lib/pageState";

type ErrorReportSource = "manual" | "window-error" | "unhandled-rejection" | "react-error-boundary";

type Props = {
  kind?: ProblemKind;
  title?: string;
  eyebrow?: string;
  message?: string;
  digest?: string;
  error?: Error & { digest?: string };
  reset?: () => void;
  primaryHref?: string;
  primaryLabel?: string;
  secondaryHref?: string;
  secondaryLabel?: string;
  reportContext?: ErrorReportSource;
  details?: string[];
};

function reloadPage() {
  if (typeof window !== "undefined") window.location.reload();
}

function shortDigest(value?: string) {
  const digest = String(value || "").trim();
  if (!digest) return "";
  return digest.length > 18 ? digest.slice(0, 18) : digest;
}

export default function AppProblemScreen({
  kind = "technical",
  title,
  eyebrow,
  message,
  digest,
  error,
  reset,
  primaryHref,
  primaryLabel,
  secondaryHref = "/",
  secondaryLabel,
  reportContext,
  details,
}: Props) {
  const transient = isTransientClientStreamError(error?.message || "");
  const state = transient ? TRANSIENT_STREAM_PROBLEM : PROBLEM_STATES[kind];
  const finalDigest = shortDigest(digest || error?.digest);
  const finalEyebrow = eyebrow || state.eyebrow;
  const finalTitle = title || state.title;
  const finalMessage = message || state.message;
  const primaryButtonLabel = primaryLabel || state.primaryLabel;
  const secondaryButtonLabel = secondaryLabel || state.secondaryLabel || "До панелі";
  const primaryAction = reset || reloadPage;
  const safeDetails = useMemo(
    () => (details || []).map((item) => item.trim()).filter(Boolean).slice(0, 4),
    [details],
  );

  useEffect(() => {
    if (error) sendClientErrorReport(error, reportContext || "react-error-boundary");
  }, [error, reportContext]);

  return (
    <main className={`app-state-page app-problem-page app-problem-page--${transient ? "technical" : kind}`}>
      <section className="app-state-shell app-problem-shell" aria-labelledby="app-problem-title">
        <article className="panel app-problem-card">
          <div className="app-problem-card__header">
            <span className="app-state-eyebrow">{finalEyebrow}</span>
            {finalDigest ? <code>Код: {finalDigest}</code> : null}
          </div>

          <div className="app-problem-card__body">
            <h1 id="app-problem-title">{finalTitle}</h1>
            <p>{finalMessage}</p>
          </div>

          {safeDetails.length > 0 ? (
            <ul className="app-problem-details" aria-label="Що перевірити">
              {safeDetails.map((item) => (
                <li key={item}>{item}</li>
              ))}
            </ul>
          ) : null}

          <div className="app-problem-actions">
            {primaryHref ? (
              <Link className="btn primary" href={primaryHref}>{primaryButtonLabel}</Link>
            ) : (
              <button className="btn primary" type="button" onClick={primaryAction}>{primaryButtonLabel}</button>
            )}
            {secondaryHref ? (
              <Link className="btn subtle" href={secondaryHref}>{secondaryButtonLabel}</Link>
            ) : (
              <button className="btn subtle" type="button" onClick={reloadPage}>Оновити сторінку</button>
            )}
          </div>
        </article>
      </section>
    </main>
  );
}
