"use client";
import { useEffect, useId, useMemo, useRef, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { dashboardApiJson } from "@/lib/dashboardApiClient";
import { ApiHttpError } from "@/lib/apiHttp";
import { useDashboardRequests } from "@/lib/useDashboardRequests";
import { useActionFocus } from "@/lib/useActionFocus";
import { wowRoleLabel } from "@/lib/wowRoles";
import type {
  CharacterSetupRequest,
  CharacterSetupState,
} from "@/lib/profileCharacterSetupSchema";

type Draft = Pick<
  CharacterSetupRequest,
  "characterKeys" | "mainCharacterKey" | "raidRole"
>;
type Recovery = {
  draft: Draft;
  base: string | null;
  pending: CharacterSetupRequest | null;
};
const fromState = (state: CharacterSetupState): Draft => ({
  characterKeys: [],
  mainCharacterKey: state.mainCharacterKey,
  raidRole: state.raidRole,
});
const validDraft = (input: unknown): input is Draft => {
  if (!input || typeof input !== "object") return false;
  const value = input as Draft;
  return (
    Array.isArray(value.characterKeys) &&
    value.characterKeys.length <= 200 &&
    value.characterKeys.every(
      (key) => typeof key === "string" && key.length <= 160,
    ) &&
    typeof value.mainCharacterKey === "string" &&
    value.mainCharacterKey.length <= 160 &&
    ["auto", "tank", "healer", "dps"].includes(value.raidRole)
  );
};
export default function ProfileCharacterSetup({
  profileId,
}: {
  profileId: string;
}) {
  const router = useRouter(),
    requests = useDashboardRequests(),
    id = useId();
  const [state, setState] = useState<CharacterSetupState | null>(null);
  const [draft, setDraft] = useState<Draft>({
    characterKeys: [],
    mainCharacterKey: "",
    raidRole: "auto",
  });
  const draftRef = useRef(draft),
    base = useRef<string | null>(null),
    pending = useRef<CharacterSetupRequest | null>(null),
    restored = useRef(false);
  const [busy, setBusy] = useState(false),
    [unknown, setUnknown] = useState(false),
    [conflict, setConflict] = useState(false);
  const [message, setMessage] = useState(""),
    [storageWarning, setStorageWarning] = useState(""),
    [visible, setVisible] = useState(8);
  const { scopeRef, beginActionFocus } = useActionFocus<HTMLElement>(busy);
  const storageKey = `mistblossom:character-setup:${profileId}`;
  const storageBroken = useRef(false);
  function persist() {
    if (storageBroken.current) return;
    try {
      sessionStorage.setItem(
        storageKey,
        JSON.stringify({
          draft: draftRef.current,
          base: base.current,
          pending: pending.current,
        }),
      );
    } catch {
      setStorageWarning(
        "Браузер не зберіг чернетку. Вибір залишається тут до закриття сторінки.",
      );
    }
  }
  function edit(next: Draft) {
    draftRef.current = next;
    setDraft(next);
    persist();
  }
  function accept(next: CharacterSetupState) {
    setState(next);
    const operation = pending.current;
    if (operation && next.receipt?.operationId === operation.operationId) {
      pending.current = null;
      setUnknown(false);
      if (next.receipt.revision === next.revision) {
        base.current = next.revision;
        setConflict(false);
        edit(fromState(next));
        const added = next.receipt.addedKeys.length,
          duplicates = next.receipt.duplicateKeys.length;
        setMessage(
          `Збережено. Додано персонажів: ${added}. Мейн і рейдова роль збережені.${duplicates ? ` Уже додані: ${duplicates}; повторно не додавались.` : ""}`,
        );
        router.refresh();
      } else {
        setConflict(true);
        persist();
        setMessage(
          "Збереження підтверджено, але профіль уже змінили після нього. Перевір актуальний вибір перед новою дією.",
        );
      }
    } else if (operation) {
      setUnknown(true);
      persist();
      setMessage(
        "Збереження ще не підтверджено. Перевір результат або повтори ту саму операцію.",
      );
    } else if (base.current && base.current !== next.revision) {
      setConflict(true);
      setMessage(
        "Профіль або список Battle.net змінився. Чернетка залишилась у формі — перевір вибір.",
      );
    } else {
      if (!base.current) edit(fromState(next));
      base.current = next.revision;
      setConflict(false);
      persist();
    }
  }
  async function refresh(trigger?: HTMLElement) {
    if (trigger) beginActionFocus(trigger);
    const lane = requests.begin("character-setup-read", 12_000);
    setBusy(true);
    try {
      const result = await dashboardApiJson<{ setup: CharacterSetupState }>(
        "/api/profile/characters/setup",
        { signal: lane.signal, timeoutMs: 12_000, retries: 0 },
      );
      if (lane.current()) accept(result.setup);
    } catch {
      if (lane.current())
        setMessage(
          "Не вдалося перевірити профіль. Вибір збережено у формі; спробуй оновити стан.",
        );
    } finally {
      if (lane.current()) setBusy(false);
      lane.finish();
    }
  }
  useEffect(() => {
    if (restored.current) return;
    restored.current = true;
    try {
      const raw = sessionStorage.getItem(storageKey);
      if (raw) {
        const saved = JSON.parse(raw) as Recovery;
        if (
          !validDraft(saved.draft) ||
          typeof saved.base !== "string" ||
          !/^[a-f0-9]{64}$/.test(saved.base)
        )
          throw Error();
        if (
          saved.pending &&
          (!validDraft(saved.pending) ||
            typeof saved.pending.operationId !== "string" ||
            !/^[a-f0-9-]{36}$/i.test(saved.pending.operationId) ||
            saved.pending.expectedRevision !== saved.base)
        )
          throw Error();
        draftRef.current = saved.draft;
        setDraft(saved.draft);
        base.current = saved.base;
        pending.current = saved.pending || null;
        setUnknown(Boolean(saved.pending));
      }
    } catch {
      storageBroken.current = true;
      setStorageWarning(
        "Чернетку не вдалося відновити. Пошкоджену копію залишено в браузері; завантажено актуальний профіль.",
      );
    }
    void refresh();
    // This is a mount-only restore; request lanes cancel reads on unmount.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [profileId]);
  async function send(operation: CharacterSetupRequest, trigger?: HTMLElement | null) {
    // An uncertain result may reuse the Save element as a recovery button.
    if (trigger) beginActionFocus(trigger, { preferResult: true });
    const lane = requests.begin("character-setup-save", 30_000);
    setBusy(true);
    setMessage("");
    pending.current = operation;
    persist();
    try {
      const result = await dashboardApiJson<{ setup: CharacterSetupState }>(
        "/api/profile/characters/setup",
        {
          method: "POST",
          json: operation,
          signal: lane.signal,
          timeoutMs: 30_000,
          retries: 0,
        },
      );
      if (lane.current()) accept(result.setup);
    } catch (error) {
      if (!lane.current()) return;
      if (
        error instanceof ApiHttpError &&
        [400, 401, 403, 409, 410, 413, 415, 428, 429].includes(error.status)
      ) {
        pending.current = null;
        setUnknown(false);
        persist();
        setMessage(error.message);
        if ([409, 410, 428].includes(error.status)) {
          setConflict(true);
          await refresh();
        }
      } else {
        setUnknown(true);
        persist();
        setMessage(
          "Відповідь не отримано. Збереження могло завершитись — перевіримо результат за номером операції.",
        );
        await refresh();
      }
    } finally {
      if (lane.current()) setBusy(false);
      lane.finish();
    }
  }
  function submit(event: FormEvent) {
    event.preventDefault();
    if (!state || busy || conflict || unknown || !base.current) return;
    void send({
      ...draftRef.current,
      operationId: crypto.randomUUID(),
      expectedRevision: base.current,
    }, (event.nativeEvent as SubmitEvent).submitter);
  }
  const candidates = useMemo(() => [...(state?.candidates || [])].sort(
    (a, b) => Number(b.guild) - Number(a.guild),
  ), [state?.candidates]);
  const selectedKeys = useMemo(() => new Set(draft.characterKeys), [draft.characterKeys]);
  const eligible = useMemo(() => [
    ...(state?.characters || []),
    ...candidates.filter((c) => selectedKeys.has(c.key)),
  ], [state?.characters, candidates, selectedKeys]);
  const eligibleKeys = useMemo(() => new Set(eligible.map(c => c.key)), [eligible]);
  const main = eligible.find((c) => c.key === draft.mainCharacterKey);
  const unavailable = draft.characterKeys.filter(key => !eligibleKeys.has(key));
  const locked = busy || unknown;
  const selectionLimit = 200;
  const selectable = candidates.slice(0, selectionLimit);
  const allSelected =
    selectable.length > 0 &&
    selectable.every((character) =>
      selectedKeys.has(character.key),
    );
  const dirty = Boolean(
    state &&
    (draft.characterKeys.length ||
      draft.mainCharacterKey !== state.mainCharacterKey ||
      draft.raidRole !== state.raidRole),
  );
  return (
    <section
      ref={scopeRef}
      id="profile-candidates"
      className="profile-character-setup"
      aria-labelledby={`${id}-title`}
      aria-busy={busy}
    >
      <div className="profile-card-head">
        <span className="eyebrow">Персонажі та рейди</span>
        <h3 id={`${id}-title`}>Персонажі, мейн і роль</h3>
        <p className="profile-card-note">
          Познач персонажів, вибери мейна й роль. Увесь вибір зберігається
          однією дією.
        </p>
      </div>
      {!state ? (
        <p role="status">
          {busy
            ? "Завантажуємо актуальний профіль…"
            : "Профіль поки недоступний."}
        </p>
      ) : (
        <form onSubmit={submit} data-toast-managed="true">
          <fieldset
            disabled={locked}
            className="profile-character-setup__choices"
          >
            <legend>1. Додати персонажів</legend>
            {candidates.length ? (
              <>
                <div className="profile-character-setup__selection">
                  <span>
                    Вибрано: <strong>{draft.characterKeys.length}</strong> /{" "}
                    {candidates.length}
                  </span>
                  <button
                    className="btn subtle btn-sm"
                    type="button"
                    onClick={() =>
                      edit({
                        ...draft,
                        characterKeys: allSelected
                          ? []
                          : selectable.map((c) => c.key),
                      })
                    }
                  >
                    {allSelected
                      ? "Зняти всі"
                      : candidates.length > selectionLimit
                        ? "Позначити перші 200"
                        : "Позначити всі"}
                  </button>
                </div>
                {candidates.length > selectionLimit ? (
                  <p className="profile-card-note">
                    За раз можна додати до 200 персонажів. Решта залишаться у
                    списку для наступного збереження.
                  </p>
                ) : null}
                <ul className="profile-character-setup__list">
                  {candidates.slice(0, visible).map((character) => (
                    <li key={character.key}>
                      <label className="profile-character-setup__candidate">
                        <input
                          type="checkbox"
                          disabled={
                            draft.characterKeys.length >= selectionLimit &&
                            !selectedKeys.has(character.key)
                          }
                          checked={selectedKeys.has(character.key)}
                          onChange={(event) =>
                            edit({
                              ...draft,
                              characterKeys: event.target.checked
                                ? [...draft.characterKeys, character.key]
                                : draft.characterKeys.filter(
                                    (key) => key !== character.key,
                                  ),
                            })
                          }
                        />
                        <span>
                          <strong>{character.name}</strong>
                          <small>
                            {character.realm} ·{" "}
                            {character.spec || character.className} ·{" "}
                            {wowRoleLabel(character.role)}
                          </small>
                        </span>
                        <span className="profile-character-setup__badge">
                          {character.guild ? "Гільдійний" : "Інший"}
                        </span>
                      </label>
                    </li>
                  ))}
                </ul>
                {visible < candidates.length ? (
                  <button
                    className="btn ghost btn-sm"
                    type="button"
                    onClick={() => setVisible((value) => value + 8)}
                  >
                    Показати ще ({candidates.length - visible})
                  </button>
                ) : null}
              </>
            ) : (
              <p className="profile-card-note">
                Нових підтверджених персонажів немає. Мейна й роль можна змінити
                серед уже доданих.
              </p>
            )}
          </fieldset>
          <fieldset
            disabled={locked}
            className="profile-character-setup__choices"
          >
            <legend>2. Мейн і рейдова роль</legend>
            <label
              className="profile-character-setup__main"
              htmlFor={`${id}-main`}
            >
              Основний персонаж
              <select
                id={`${id}-main`}
                value={draft.mainCharacterKey}
                required
                onChange={(event) =>
                  edit({ ...draft, mainCharacterKey: event.target.value })
                }
              >
                <option value="">Вибери мейна</option>
                {draft.mainCharacterKey && !main ? (
                  <option value={draft.mainCharacterKey}>
                    Попередній вибір більше недоступний
                  </option>
                ) : null}
                {eligible.map((character) => (
                  <option key={character.key} value={character.key}>
                    {character.name} — {character.realm}
                  </option>
                ))}
              </select>
            </label>
            <div
              className="profile-character-setup__roles"
              role="group"
              aria-label="Рейдова роль"
            >
              {(["auto", "tank", "healer", "dps"] as const).map((role) => (
                <label key={role}>
                  <input
                    type="radio"
                    name={`${id}-role`}
                    value={role}
                    checked={draft.raidRole === role}
                    onChange={() => edit({ ...draft, raidRole: role })}
                  />
                  <span>
                    {role === "auto" ? "За спеціалізацією" : wowRoleLabel(role)}
                  </span>
                </label>
              ))}
            </div>
          </fieldset>
          <div
            className="profile-character-setup__summary"
            aria-label="Підсумок вибору"
          >
            <span>
              Додати: <strong>{draft.characterKeys.length}</strong>
            </span>
            <span>
              Мейн: <strong>{main?.name || "ще не вибрано"}</strong>
            </span>
            <span>
              Роль:{" "}
              <strong>
                {draft.raidRole === "auto"
                  ? main
                    ? `${wowRoleLabel(main.role)} · за спеціалізацією`
                    : "за спеціалізацією"
                  : wowRoleLabel(draft.raidRole)}
              </strong>
            </span>
          </div>
          {unavailable.length ? (
            <p role="alert">
              Недоступні персонажі у чернетці: {unavailable.length}. Онови
              Battle.net або зніми недоступний вибір.
              <button
                className="btn ghost btn-sm"
                type="button"
                disabled={locked}
                onClick={() =>
                  edit({
                    ...draft,
                    characterKeys: draft.characterKeys.filter(
                      (key) => !unavailable.includes(key),
                    ),
                  })
                }
              >
                Зняти недоступні
              </button>
            </p>
          ) : null}
          {conflict ? (
            <p className="profile-card-note">
              Зараз збережено: мейн —{" "}
              {state.characters.find(
                (character) => character.key === state.mainCharacterKey,
              )?.name || "не вибрано"}
              ; роль —{" "}
              {state.raidRole === "auto"
                ? "за спеціалізацією"
                : wowRoleLabel(state.raidRole)}
              .
            </p>
          ) : null}
          {conflict && !unknown ? (
            <button
              className="btn subtle"
              type="button"
              disabled={busy}
              onClick={() => {
                base.current = state.revision;
                setConflict(false);
                persist();
                setMessage(
                  "Актуальний стан враховано. Перевір підсумок і натисни збереження.",
                );
              }}
            >
              Вибір перевірено — врахувати актуальний стан
            </button>
          ) : null}
          {unknown ? (
            <div className="profile-character-setup__actions">
              <button
                className="btn primary"
                type="button"
                disabled={busy}
                onClick={(event) => void refresh(event.currentTarget)}
              >
                Перевірити результат
              </button>
              {pending.current &&
              state.revision === pending.current.expectedRevision ? (
                <button
                  className="btn subtle"
                  type="button"
                  disabled={busy}
                  onClick={(event) => pending.current && void send(pending.current, event.currentTarget)}
                >
                  Повторити ту саму операцію
                </button>
              ) : null}
              {pending.current &&
              state.revision !== pending.current.expectedRevision ? (
                <button
                  className="btn subtle"
                  type="button"
                  disabled={busy}
                  onClick={() => {
                    pending.current = null;
                    setUnknown(false);
                    setConflict(true);
                    persist();
                    setMessage(
                      "Стан змінився. Перевір вибір перед новою операцією.",
                    );
                  }}
                >
                  Перейти до перевірки актуального вибору
                </button>
              ) : null}
            </div>
          ) : (
            <div className="profile-character-setup__actions">
              <button
                className="btn primary"
                type="submit"
                disabled={
                  busy ||
                  conflict ||
                  !main ||
                  Boolean(unavailable.length) ||
                  !dirty
                }
              >
                {busy ? "Зберігаємо…" : "Зберегти персонажів, мейна й роль"}
              </button>
              <button
                className="btn ghost btn-sm"
                type="button"
                disabled={busy}
                onClick={(event) => void refresh(event.currentTarget)}
              >
                Оновити стан
              </button>
            </div>
          )}
        </form>
      )}
      <p
        className="profile-character-setup__status"
        role="status"
        aria-live="polite"
        aria-atomic="true"
        data-action-result=""
        tabIndex={-1}
      >
        {message}
      </p>
      {storageWarning ? (
        <p className="profile-card-note" role="status">
          {storageWarning}
        </p>
      ) : null}
      {!state && !busy ? (
        <button
          className="btn subtle"
          type="button"
          onClick={(event) => void refresh(event.currentTarget)}
        >
          Оновити стан
        </button>
      ) : null}
    </section>
  );
}
