export default function ImpersonationToast({ groupName }: { groupName: string }) {
  return (
    <aside className="global-toast-stack global-toast-stack--persistent" aria-live="polite" aria-atomic="false">
      <article className="global-toast global-toast--warning global-toast--persistent" role="status">
        <span className="global-toast__icon" aria-hidden="true">◉</span>
        <span className="global-toast__body">
          <strong>Перегляд як: {groupName}</strong>
          <small>Тестовий режим власника сервера. Реальні права акаунта не змінені.</small>
        </span>
        <form action="/api/dashboard/impersonation/end" method="post" data-dashboard-action-form="true" data-dashboard-action="access-groups-impersonation-end">
          <button className="btn subtle global-toast__action" type="submit" data-dashboard-action="access-groups-impersonation-end" data-loading-label="Завершуємо...">Завершити</button>
        </form>
      </article>
    </aside>
  );
}
