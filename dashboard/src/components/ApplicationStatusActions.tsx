"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { dashboardErrorMessage, dispatchDashboardToast } from "@/lib/clientToasts";
import { notifyDashboardDataChanged } from "@/lib/dashboardLiveRefresh";

type StatusKey = "review" | "accepted" | "declined";

type Props = {
  issueNumber: number;
  initialStatus: StatusKey;
  issueState?: string;
  canModerate?: boolean;
  canDelete?: boolean;
};

const LABELS: Record<StatusKey, string> = {
  review: "На розгляді",
  accepted: "Прийнято",
  declined: "Відхилено",
};

const FINAL_STATUSES: Exclude<StatusKey, "review">[] = ["accepted", "declined"];

export default function ApplicationStatusActions({
  issueNumber,
  initialStatus,
  issueState = "open",
  canModerate = true,
  canDelete = false,
}: Props) {
  const router = useRouter();
  const [status, setStatus] = useState<StatusKey>(initialStatus);
  const [selectedStatus, setSelectedStatus] = useState<Exclude<StatusKey, "review">>(
    initialStatus === "declined" ? "declined" : "accepted"
  );
  const [pendingStatus, setPendingStatus] = useState<Exclude<StatusKey, "review"> | null>(null);
  const [message, setMessage] = useState<string>("");
  const [deleting, setDeleting] = useState(false);

  const isClosed = issueState === "closed";
  const isFinalStatus = status === "accepted" || status === "declined";
  const locked = !canModerate || isClosed || isFinalStatus;
  const busy = pendingStatus !== null;

  const statusText = useMemo(() => {
    if (busy) return "Синхронізація...";
    return LABELS[status] || LABELS.review;
  }, [busy, status]);

  const canApply = canModerate && !locked && !busy && status === "review";

  const lockedMessage = !canModerate
    ? "Недостатньо ролі для модерації. Перегляд доступний, рішення вимкнені."
    : isClosed
      ? "Заявку вже закрито. Повторне рішення вимкнене."
      : isFinalStatus
        ? `Модерація завершена: ${LABELS[status]}.`
        : "";

  async function moderate(nextStatus: Exclude<StatusKey, "review">) {
    if (!canApply) return;

    const previousStatus = status;
    setStatus(nextStatus);
    setPendingStatus(nextStatus);
    setMessage("Оновлюємо заявку і Discord-повідомлення...");
    dispatchDashboardToast({
      tone: "info",
      title: nextStatus === "accepted" ? "Приймаємо заявку" : "Відхиляємо заявку",
      message: "Синхронізуємо статус заявки й Discord-повідомлення.",
      ttl: 3800,
    });

    try {
      const response = await fetch(`/api/applications/${issueNumber}/status`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json",
          "X-Dashboard-Action": "moderate-application",
        },
        credentials: "same-origin",
        cache: "no-store",
        body: JSON.stringify({ status: nextStatus }),
      });

      const data = await response.json().catch(() => ({ error: "Сервер повернув неочікувану відповідь. Спробуй ще раз." }));

      if (!response.ok || data?.error) {
        throw new Error(data?.error || "Не вдалося змінити статус заявки.");
      }

      const confirmedStatus = FINAL_STATUSES.includes(data?.status) ? data.status : nextStatus;
      setStatus(confirmedStatus);
      notifyDashboardDataChanged({
        scope: "applications",
        resourceId: String(issueNumber),
        source: "application-status",
        action: confirmedStatus,
      });

      if (data?.discord?.edited?.ok) {
        setMessage("Готово: заявку й Discord-повідомлення оновлено.");
        dispatchDashboardToast({ tone: "success", title: "Заявку оновлено", message: "Заявку й Discord-повідомлення синхронізовано." });
      } else if (data?.discord?.notified?.ok) {
        setMessage("Готово: заявку оновлено, Discord отримав повідомлення.");
        dispatchDashboardToast({ tone: "success", title: "Заявку оновлено", message: "Заявку оновлено, Discord отримав повідомлення." });
      } else {
        setMessage("Заявку оновлено. Discord-повідомлення не підтвердило редагування.");
        dispatchDashboardToast({ tone: "warning", title: "Заявку оновлено частково", message: "Заявку змінено, але Discord-повідомлення не підтвердило редагування." });
      }
    } catch (error) {
      console.error("[dashboard:applications.status]", error);
      const errorMessage = dashboardErrorMessage(error, "Помилка синхронізації.");
      setStatus(previousStatus);
      setMessage(errorMessage);
      dispatchDashboardToast({ tone: "error", title: "Статус не змінено", message: errorMessage });
    } finally {
      setPendingStatus(null);
    }
  }


  async function deleteApplication() {
    if (!canDelete || deleting) return;
    if (!window.confirm(`Видалити заявку #${issueNumber} із сервера та її Discord-повідомлення? Цю дію не можна скасувати.`)) return;

    setDeleting(true);
    setMessage("Видаляємо заявку та Discord-повідомлення...");
    dispatchDashboardToast({ tone: "warning", title: "Видаляємо заявку", message: `Заявка #${issueNumber}: синхронно видаляємо серверний запис і Discord-повідомлення.`, ttl: 4200 });

    try {
      const response = await fetch(`/api/applications/${issueNumber}`, {
        method: "DELETE",
        headers: { Accept: "application/json", "X-Dashboard-Action": "delete-application" },
        credentials: "same-origin",
        cache: "no-store",
      });
      const data = await response.json().catch(() => ({ error: "Сервер повернув неочікувану відповідь." }));
      if (!response.ok || !data?.ok) throw new Error(data?.error || "Не вдалося видалити заявку.");

      notifyDashboardDataChanged({ scope: "applications", resourceId: String(issueNumber), source: "application-delete", action: "delete" });
      dispatchDashboardToast({
        tone: "success",
        title: "Заявку видалено",
        message: data?.discord?.deleted ? "Запис на сервері та Discord-повідомлення видалено." : "Запис на сервері видалено; Discord-повідомлення вже було відсутнє або не мало reference.",
      });
      router.refresh();
    } catch (error) {
      const errorMessage = dashboardErrorMessage(error, "Не вдалося видалити заявку.");
      setMessage(errorMessage);
      dispatchDashboardToast({ tone: "error", title: "Заявку не видалено", message: errorMessage });
    } finally {
      setDeleting(false);
    }
  }

  return (
    <div
      className="action-panel"
      data-status={status}
      data-busy={busy ? "true" : "false"}
      data-closed={isClosed ? "true" : "false"}
      data-locked={locked ? "true" : "false"}
    >
      <div className={`status-pill status-pill--${status}`}>
        <span className="status-dot" />
        {statusText}
      </div>

      {!locked ? (
        <div className="action-row" aria-label="Зміна статусу заявки">
          <select
            id={`application-status-action-${issueNumber}`}
            className="select status-select"
            value={selectedStatus}
            disabled={!canApply}
            aria-label="Новий статус заявки"
            onChange={(event) => setSelectedStatus(event.target.value as Exclude<StatusKey, "review">)}
          >
            <option value="accepted">Прийняти заявку</option>
            <option value="declined">Відхилити заявку</option>
          </select>

          <button
            type="button"
            className="btn primary"
            disabled={!canApply}
            aria-disabled={!canApply}
            aria-busy={busy}
            onClick={() => moderate(selectedStatus)}
          >
            {pendingStatus ? "Застосовуємо..." : "Застосувати"}
          </button>
        </div>
      ) : null}

      {canDelete ? (
        <div className="application-delete-row">
          <button className="btn danger" type="button" onClick={deleteApplication} disabled={deleting || busy} aria-busy={deleting ? "true" : "false"}>
            {deleting ? "Видаляємо..." : "Видалити заявку"}
          </button>
          <small>Тільки власник сервера · видаляє запис і Discord-повідомлення.</small>
        </div>
      ) : null}

      <small className={`sync-message ${message.includes("Помилка") || message.includes("не підтвердив") ? "sync-message--warning" : ""}`}>
        {locked ? lockedMessage : message || "Обери рішення і натисни “Застосувати”."}
      </small>
    </div>
  );
}
