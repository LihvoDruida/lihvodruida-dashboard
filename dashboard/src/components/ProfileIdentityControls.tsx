"use client";
import { useEffect, useId, useRef, useState, type FormEvent } from "react";
import { dashboardApiJson } from "@/lib/dashboardApiClient";
import { ApiHttpError } from "@/lib/apiHttp";
import { useDashboardRequests } from "@/lib/useDashboardRequests";
import { useActionFocus } from "@/lib/useActionFocus";
import type { ProfileIdentityState } from "@/lib/profileNicknameSync";
type Props = {
  profileId: string;
  preferredName: string;
  discordOwnerLocked: boolean;
  canSyncDiscord: boolean;
  discordName: string;
  currentServerNickname?: string | null;
  serverNicknameChecked: boolean;
  onState: (identity: ProfileIdentityState) => void;
};
type Recovery = {
  value: string;
  base: string | null;
  pending: { id: string; submitted: string } | null;
};
const active = (state: ProfileIdentityState | null) =>
  Boolean(
    state?.sync &&
    ["queued", "running", "retry", "uncertain"].includes(state.sync.state) &&
    state.sync.dueAtMs !== null,
  );
function statusText(identity: ProfileIdentityState | null, owner: boolean) {
  const job = identity?.sync;
  if (!job) return "Після збереження імʼя буде передано для синхронізації.";
  if (job.state === "synced")
    return job.truncated
      ? "Імʼя збережено. Нік синхронізовано; список персонажів скорочено до ліміту Discord."
      : "Імʼя збережено. Нік синхронізовано.";
  if (job.state === "owner" || owner)
    return "Імʼя збережено. Власник сервера змінює нік вручну — скопіюй готове значення.";
  if (job.state === "not_discord")
    return "Імʼя збережено. Для синхронізації потрібен профіль Discord.";
  if (job.state === "queued")
    return "Імʼя збережено. Синхронізація в черзі; сторінку можна закрити.";
  if (job.state === "running")
    return "Імʼя збережено. Звіряємо й синхронізуємо Discord-нік.";
  if (job.state === "retry")
    return "Імʼя збережено. Discord тимчасово недоступний; наступна спроба запланована.";
  if (job.state === "uncertain")
    return "Імʼя збережено. Відповідь Discord не підтверджена. Звірка перевірить нік без повторного запису.";
  const reasons: Record<string, string> = {
    hierarchy:
      "Боту бракує прав або його роль нижча. Звернись до адміністратора.",
    member_missing: "Учасника більше немає на Discord-сервері.",
    configuration: "Discord-інтеграцію потрібно налаштувати адміністратору.",
    profile_changed:
      "Профіль або персонажі змінились. Перевір дані перед новою синхронізацією.",
    profile_missing: "Профіль більше не існує.",
    invalid_nickname: "Discord відхилив формат ніку.",
  };
  return `Імʼя збережено. ${reasons[job.reason || ""] || "Синхронізація не завершилась. Можна повторити її явно."}`;
}
export default function ProfileIdentityControls({
  profileId,
  preferredName,
  discordOwnerLocked,
  canSyncDiscord,
  discordName,
  currentServerNickname,
  serverNicknameChecked,
  onState,
}: Props) {
  const id = useId(),
    requests = useDashboardRequests();
  const [identity, setIdentity] = useState<ProfileIdentityState | null>(null);
  const [draft, setDraft] = useState(preferredName),
    draftRef = useRef(preferredName);
  const baseRef = useRef<string | null>(null),
    pending = useRef<Recovery["pending"]>(null);
  const restored = useRef(false),
    [ready, setReady] = useState(false),
    [busy, setBusy] = useState(false);
  const [message, setMessage] = useState(""),
    [storageError, setStorageError] = useState(""),
    [conflict, setConflict] = useState(false),
    [unknown, setUnknown] = useState(false),
    [copied, setCopied] = useState(false);
  const { scopeRef, beginActionFocus } = useActionFocus<HTMLDivElement>(busy);
  const key = `mistblossom:profile-identity:${profileId}`;
  const writeDraft = (value: string) => {
    draftRef.current = value;
    setDraft(value);
  };
  function persist() {
    if (!restored.current) return;
    try {
      sessionStorage.setItem(
        key,
        JSON.stringify({
          value: draftRef.current,
          base: baseRef.current,
          pending: pending.current,
        }),
      );
    } catch {
      setStorageError(
        "Браузер не зберіг чернетку. Поля залишаються тут до закриття сторінки.",
      );
    }
  }
  function accept(next: ProfileIdentityState, initial = false) {
    const expected = baseRef.current,
      receipt = pending.current;
    setIdentity(next);
    onState(next);
    setReady(true);
    if (
      receipt &&
      next.sync?.operationId === receipt.id &&
      next.sync.profileRevision !== next.revision
    ) {
      pending.current = null;
      setUnknown(false);
      const changed = draftRef.current.trim() !== next.preferredName;
      setConflict(changed);
      if (!changed) baseRef.current = next.revision;
      setMessage(
        "Імʼя було збережено, але після цього його змінили. Чернетка залишилась у формі.",
      );
    } else if (receipt && next.sync?.operationId === receipt.id) {
      pending.current = null;
      setUnknown(false);
      setConflict(false);
      baseRef.current = next.revision;
      if (draftRef.current.trim() === receipt.submitted)
        writeDraft(next.preferredName);
      setMessage("Збереження підтверджено. Повторне надсилання не потрібне.");
    } else if (receipt) {
      setUnknown(true);
      setMessage(
        "Попереднє збереження не підтверджено. Перевір актуальне імʼя перед новою дією.",
      );
    } else if (
      expected &&
      expected !== next.revision &&
      draftRef.current.trim() !== next.preferredName
    ) {
      setConflict(true);
    } else {
      baseRef.current = next.revision;
      setConflict(false);
      if (initial && draftRef.current === preferredName)
        writeDraft(next.preferredName);
    }
    persist();
  }
  async function refresh(initial = false) {
    const lane = requests.begin("identity", 12_000);
    setBusy(true);
    try {
      const result = await dashboardApiJson<{ identity: ProfileIdentityState }>(
        "/api/profile/identity",
        { signal: lane.signal, timeoutMs: 12_000, retries: 0 },
      );
      if (lane.current()) {
        const recovering = Boolean(pending.current);
        accept(result.identity, initial);
        if (!recovering && !pending.current) setMessage("");
      }
    } catch {
      if (lane.current())
        setMessage("Не вдалося оновити стан. Введене імʼя залишилось у формі.");
    } finally {
      if (lane.current()) setBusy(false);
      lane.finish();
    }
  }
  useEffect(() => {
    setIdentity(null);
    setReady(false);
    setConflict(false);
    setMessage("");
    setStorageError("");
    setCopied(false);
    restored.current = false;
    baseRef.current = null;
    pending.current = null;
    draftRef.current = preferredName;
    try {
      const raw = sessionStorage.getItem(key);
      if (raw) {
        if (raw.length > 4096) throw Error();
        const data = JSON.parse(raw);
        if (
          !data ||
          typeof data.value !== "string" ||
          data.value.length > 128 ||
          (data.base !== null && !/^[a-f0-9]{64}$/.test(data.base)) ||
          (data.pending &&
            (typeof data.pending.submitted !== "string" ||
              data.pending.submitted.length > 128 ||
              !/^[a-f0-9-]{36}$/i.test(data.pending.id)))
        )
          throw Error();
        draftRef.current = data.value;
        baseRef.current = data.base;
        pending.current = data.pending || null;
      }
      restored.current = true;
    } catch {
      setStorageError(
        "Не вдалося відновити чернетку. Пошкоджену копію залишено в браузері.",
      );
    }
    setDraft(draftRef.current);
    setUnknown(Boolean(pending.current));
    void refresh(true);
    return () => {
      requests.cancel("identity");
    };
    // The profile defines the recovery scope; prop refresh must not reset newer typing.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [profileId]);
  useEffect(() => {
    if (!active(identity)) return;
    let count = 0;
    const timer = setInterval(() => {
      if (count >= 12) {
        clearInterval(timer);
        return;
      }
      if (!document.hidden && !requests.pending("identity") && count++ < 12)
        void refresh();
    }, 5_000);
    return () => clearInterval(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    identity?.sync?.operationId,
    identity?.sync?.state,
    identity?.sync?.dueAtMs,
  ]);
  async function save(event?: FormEvent) {
    event?.preventDefault();
    if (!identity || !baseRef.current || busy || conflict || unknown) return;
    if (
      identity.sync?.state === "uncertain" &&
      !window.confirm(
        "Результат попередньої зміни не підтверджений. Нова синхронізація може замінити поточний нік Discord. Продовжити?",
      )
    )
      return;
    const trigger = (event?.nativeEvent as SubmitEvent | undefined)?.submitter;
    if (trigger instanceof HTMLElement) beginActionFocus(trigger);
    const submitted = draftRef.current.trim(),
      operationId = crypto.randomUUID();
    pending.current = { id: operationId, submitted };
    persist();
    const lane = requests.begin("identity", 35_000);
    setBusy(true);
    setMessage("");
    try {
      const result = await dashboardApiJson<{ identity: ProfileIdentityState }>(
        "/api/profile/identity",
        {
          method: "POST",
          json: {
            action: "save",
            preferredName: submitted,
            expectedRevision: baseRef.current,
            operationId,
          },
          signal: lane.signal,
          timeoutMs: 20_000,
          retries: 0,
        },
      );
      if (lane.current()) accept(result.identity);
    } catch (error) {
      if (!lane.current()) return;
      const definitive =
        error instanceof ApiHttpError &&
        [400, 401, 403, 404, 409, 413, 415, 428, 429].includes(error.status);
      if (definitive) {
        pending.current = null;
        setUnknown(false);
        setMessage(error.message);
        persist();
      } else {
        setUnknown(true);
        setMessage("Відповідь втрачена. Перевіряємо збережену дію.");
      }
      try {
        const result = await dashboardApiJson<{
          identity: ProfileIdentityState;
        }>("/api/profile/identity", {
          signal: lane.signal,
          timeoutMs: 12_000,
          retries: 0,
        });
        if (lane.current()) accept(result.identity);
      } catch {
        if (lane.current())
          setMessage(
            "Не вдалося підтвердити збереження. Чернетка залишилась; скористайся перевіркою стану.",
          );
      }
    } finally {
      if (lane.current()) setBusy(false);
      lane.finish();
    }
  }
  async function reconcile() {
    if (!identity?.sync || busy) return;
    const lane = requests.begin("identity", 20_000);
    setBusy(true);
    try {
      const result = await dashboardApiJson<{ identity: ProfileIdentityState }>(
        "/api/profile/identity",
        {
          method: "POST",
          json: { action: "reconcile", operationId: identity.sync.operationId },
          signal: lane.signal,
          timeoutMs: 20_000,
          retries: 0,
        },
      );
      if (lane.current()) accept(result.identity);
    } catch {
      if (lane.current())
        setMessage(
          "Звірку не підтверджено. Онови стан; нік автоматично не перезаписується.",
        );
    } finally {
      if (lane.current()) setBusy(false);
      lane.finish();
    }
  }
  const dirty = draft.trim() !== (identity?.preferredName ?? preferredName),
    valid =
      Array.from(draft.trim()).length >= 2 &&
      Array.from(draft.trim()).length <= 32;
  const retryable =
    identity?.sync && ["blocked", "uncertain"].includes(identity.sync.state);
  const owner = discordOwnerLocked || identity?.sync?.state === "owner";
  const nickname = identity?.nicknamePreview || identity?.sync?.nickname;
  return (
    <div ref={scopeRef} className="profile-identity-workflow" aria-busy={busy}>
      <form
        action="/api/profile/identity"
        method="post"
        onSubmit={save}
        data-toast-managed="true"
        className="profile-identity-form"
      >
        <label htmlFor={id} className="sr-only">
          Імʼя в профілі
        </label>
        <input
          id={id}
          name="preferredName"
          value={draft}
          onChange={(event) => {
            writeDraft(event.target.value);
            persist();
          }}
          placeholder="Наприклад, Дмитро"
          minLength={2}
          maxLength={32}
          required
          autoComplete="given-name"
          aria-describedby={`${id}-status`}
        />
        <button
          type="submit"
          className="btn primary"
          disabled={
            !ready ||
            busy ||
            !valid ||
            conflict ||
            unknown ||
            Boolean(identity?.sync?.state === "running") ||
            (!dirty && (owner || !canSyncDiscord || active(identity)))
          }
        >
          {busy
            ? "Перевіряємо…"
            : !dirty && retryable
              ? "Повторити синхронізацію"
              : owner || !canSyncDiscord
                ? "Зберегти імʼя"
                : !dirty && identity?.sync
                  ? "Синхронізувати нік"
                  : "Зберегти й синхронізувати"}
        </button>
      </form>
      {dirty ? (
        <small className="profile-field-hint is-pending">
          Є незбережені зміни.
        </small>
      ) : null}
      {conflict || unknown ? (
        <div role="alert" className="profile-identity-conflict">
          <p>
            {conflict
              ? `На сервері імʼя «${identity?.preferredName}». Твоя чернетка «${draft}» залишилась.`
              : "Попередня дія не підтверджена. Нове збереження потребує перевірки."}
          </p>
          <button
            type="button"
            className="btn subtle btn-sm"
            disabled={busy || !identity}
            onClick={() => {
              if (
                !identity ||
                !window.confirm(
                  "Використати актуальний стан як основу для нового явного збереження?",
                )
              )
                return;
              pending.current = null;
              baseRef.current = identity.revision;
              setUnknown(false);
              setConflict(false);
              setMessage("");
              persist();
            }}
          >
            Залишити чернетку для нового збереження
          </button>
        </div>
      ) : null}
      <div
        className="profile-identity-sync"
        id={`${id}-status`}
        role="status"
        aria-live="polite"
      >
        <div className="profile-discord-standard__identity">
          <span className="profile-name-panel__label">Discord</span>
          <strong>{discordName || "Discord"}</strong>
        </div>
        {serverNicknameChecked ||
        currentServerNickname ||
        identity?.sync?.state === "synced" ? (
          <div className="profile-server-nickname">
            <span className="profile-server-nickname__body">
              <small>
                {identity?.sync?.state === "synced"
                  ? "Останній підтверджений нік"
                  : "Реальний серверний нік"}
              </small>
              <strong>
                {identity?.sync?.state === "synced"
                  ? identity.sync.nickname
                  : currentServerNickname || "Не встановлено"}
              </strong>
            </span>
          </div>
        ) : null}
        <p>{statusText(identity, owner)}</p>
        {identity?.sync?.state === "synced" &&
        identity.sync.nickname !== identity.nicknamePreview ? (
          <small className="profile-field-hint is-pending">
            Підготовлений нік змінився разом із профілем. Застосуй його явною
            синхронізацією.
          </small>
        ) : null}
        {nickname ? (
          <div className="profile-nickname-preview">
            <span>Підготовлений Discord-нік</span>
            <strong>{nickname}</strong>
            {owner ? (
              <button
                className="btn subtle btn-sm"
                type="button"
                onClick={async () => {
                  try {
                    await navigator.clipboard.writeText(nickname);
                    setCopied(true);
                  } catch {
                    setMessage(
                      "Не вдалося скопіювати. Скопіюй нік із цього рядка вручну.",
                    );
                  }
                }}
              >
                {copied ? "Скопійовано" : "Скопіювати"}
              </button>
            ) : null}
          </div>
        ) : null}
        {identity?.sync?.state === "retry" && identity.sync.dueAtMs ? (
          <small>
            Наступна спроба:{" "}
            {new Date(identity.sync.dueAtMs).toLocaleString("uk-UA")}
          </small>
        ) : null}
      </div>
      <div className="profile-identity-actions">
        <button
          type="button"
          className="btn subtle btn-sm"
          disabled={busy}
          onClick={(event) => { beginActionFocus(event.currentTarget); void refresh(); }}
        >
          Перевірити стан
        </button>
        {identity?.sync?.state === "uncertain" ? (
          <button
            type="button"
            className="btn subtle btn-sm"
            disabled={busy}
            onClick={(event) => { beginActionFocus(event.currentTarget); void reconcile(); }}
          >
            Звірити Discord
          </button>
        ) : null}
      </div>
      <p role="status" aria-live="polite" aria-atomic="true" data-action-result="" tabIndex={-1} className="profile-field-hint">
        {message}
      </p>
      {storageError ? (
        <p role="alert" className="profile-field-hint is-warning">
          {storageError}
        </p>
      ) : null}
    </div>
  );
}
