"use client";
import DropdownMenu from "@/components/ui/DropdownMenu";
import styles from "@/components/applications/applications-workspace.module.css";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { dashboardErrorMessage, dispatchDashboardToast } from "@/lib/clientToasts";
import { dashboardApiJson } from "@/lib/dashboardApiClient";
import { notifyDashboardDataChanged } from "@/lib/dashboardLiveRefresh";
import { ApplicationNextReview, useApplicationModerationQueue } from "@/components/ApplicationModerationQueue";
import type { ApplicationStatus } from "@/lib/applicationsStore";
import { useActionFocus } from "@/hooks/useActionFocus";


export default function ApplicationStatusActions({ issueNumber, initialStatus, issueState = "open", canModerate = true, canDelete = false }: {
  issueNumber: number; initialStatus: ApplicationStatus; issueState?: string; canModerate?: boolean; canDelete?: boolean;
}) {
  const router = useRouter();
  const queue = useApplicationModerationQueue();
  const row = queue.rows[issueNumber];
  const status = row?.status || initialStatus;
  const isClosed = (row?.state || issueState) === "closed";
  const busy = Boolean(row?.busy);
  const uncertain = row?.outcome === "uncertain";
  const locked = !canModerate || !queue.canModerate || isClosed || status !== "review" || uncertain;
  const [deleting, setDeleting] = useState(false);
  const [deleteMessage, setDeleteMessage] = useState("");
  const [deleteUncertain, setDeleteUncertain] = useState(false);
  const { scopeRef, beginActionFocus } = useActionFocus<HTMLDivElement>(busy || deleting);
  const { scopeRef: deleteScopeRef, beginActionFocus: beginDeleteFocus } = useActionFocus<HTMLDivElement>(deleting);

  async function deleteApplication(trigger: HTMLButtonElement) {
    if (!canDelete || deleting || deleteUncertain || busy) return;
    if (!window.confirm(`Видалити заявку #${issueNumber} із сервера та її Discord-повідомлення? Цю дію не можна скасувати.`)) return;
    if (!queue.lock(issueNumber)) return;
    beginDeleteFocus(trigger);
    setDeleting(true); setDeleteMessage("Видаляємо заявку та Discord-повідомлення…");
    try {
      const data = await dashboardApiJson<{ ok?: boolean; discord?: { deleted?: boolean } }>(`/api/applications/${issueNumber}`, {
        method: "DELETE", headers: { "X-Dashboard-Action": "delete-application" }, retries: 0, timeoutMs: 45_000,
      });
      if (!data?.ok) throw new Error("Сервер не підтвердив видалення.");
      setDeleteMessage("Заявку видалено. Оновлюємо список…");
      notifyDashboardDataChanged({ scope: "applications", resourceId: String(issueNumber), source: "application-delete", action: "delete" });
      dispatchDashboardToast({ tone: "success", title: "Заявку видалено", message: data.discord?.deleted ? "Запис і Discord-повідомлення видалено." : "Заявку видалено. Discord-повідомлення вже було відсутнє або не мало reference." });
      router.refresh();
    } catch (error) {
      setDeleteUncertain(true);
      setDeleteMessage("Видалення не підтверджено. Онови список і перевір результат перед повторною дією.");
      dispatchDashboardToast({ tone: "warning", title: "Перевір результат видалення", message: dashboardErrorMessage(error, "Відповідь не отримано.") });
    } finally { setDeleting(false); queue.release(issueNumber); }
  }
  const fallback = !canModerate ? "Доступний лише перегляд." : isClosed && status === "review" ? "Заявку закрито без остаточного рішення. Повторна модерація вимкнена." : isClosed || status !== "review" ? "Рішення збережено. Повторна модерація вимкнена." : "Обери остаточне рішення. Статус зміниться після підтвердження сервера.";
  return <div ref={scopeRef} id={`application-decision-${issueNumber}`} className={styles.stack} role="group" aria-label={`Рішення щодо заявки #${issueNumber}`} aria-busy={busy || deleting} data-status={status} data-busy={busy} data-closed={isClosed} data-locked={locked}>
    {!locked ? <div className={styles.actions} aria-label={`Рішення щодо заявки #${issueNumber}`}>
      <button className="btn primary" type="button" data-decision-primary disabled={busy || deleting} onClick={(event) => { beginActionFocus(event.currentTarget); void queue.moderate([issueNumber], "accepted"); }}>Прийняти</button>
      <button className="btn danger" type="button" disabled={busy || deleting} onClick={(event) => { beginActionFocus(event.currentTarget); void queue.moderate([issueNumber], "declined"); }}>Відхилити</button>
    </div> : null}
    <p id={`application-result-${issueNumber}`} className={styles.message} data-action-result tabIndex={-1} data-outcome={row?.outcome || "idle"} role="status" aria-live="polite" aria-atomic="true">{busy ? "Перевіряємо та зберігаємо результат…" : row?.message || fallback}</p>
    {canModerate && uncertain ? <button className="btn subtle" type="button" disabled={busy} onClick={(event) => { beginActionFocus(event.currentTarget); void queue.reconcile(issueNumber); }}>{busy ? "Перевіряємо стан…" : "Перевірити збережений стан"}</button> : null}
    {canModerate && (isClosed || status !== "review") ? <ApplicationNextReview issueNumber={issueNumber} /> : null}
    {canDelete ? <div ref={deleteScopeRef} className={styles.stack}><DropdownMenu label="Інші дії із заявкою" closeOnAction={false}>
      <button className="btn danger" type="button" onClick={(event) => void deleteApplication(event.currentTarget)} disabled={deleting || busy || deleteUncertain} aria-busy={deleting}>{deleting ? "Видаляємо…" : "Видалити заявку"}</button>
      </DropdownMenu>
      <small id={`application-delete-result-${issueNumber}`} data-action-result tabIndex={-1} role="status" aria-live="polite" aria-atomic="true">{deleteMessage}</small>
      {deleteUncertain ? <button className="btn subtle" type="button" onClick={() => router.refresh()}>Оновити список</button> : null}
    </div> : null}
  </div>;
}
