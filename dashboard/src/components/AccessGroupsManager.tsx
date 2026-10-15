"use client";
import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import type { DashboardRole } from "@/lib/auth";
import {
  DASHBOARD_PERMISSION_KEYS,
  DEFAULT_ADMIN_GROUP_ID,
  DEFAULT_MEMBER_GROUP_ID,
  DEFAULT_MODERATOR_GROUP_ID,
  FIXED_GROUP_IDS,
  PERMISSION_META,
  type AccessGroup,
} from "@/lib/accessGroupSchema";
import {
  draftDirty,
  groupDraftKey,
  groupValues,
  makeGroupDraft,
  NEW_GROUP_DRAFT,
  parseGroupDrafts,
  reconcileGroupDrafts,
  sameGroupValues,
  updateGroupDraft,
  type GroupDraft,
  type GroupValues,
} from "@/lib/accessGroupDrafts";
import { claimGroupDraftBucket } from "@/lib/accessGroupDraftStorage";
import { dashboardApiJson } from "@/lib/dashboardApiClient";
import { ApiHttpError } from "@/lib/apiHttp";
import { useDashboardRequests } from "@/lib/useDashboardRequests";
import { useActionFocus } from "@/lib/useActionFocus";

const ROLE_OPTIONS: Array<{ value: DashboardRole; label: string }> = [
  { value: "member", label: "Учасник" },
  { value: "mentor", label: "Наставник" },
  { value: "moderator", label: "Модератор" },
  { value: "admin", label: "Адмін" },
];
type Props = {
  groups: AccessGroup[];
  draftScope: string;
  isServerOwner: boolean;
  currentGroupId?: string;
  saveGroupAction: (formData: FormData) => Promise<void>;
  deleteGroupAction: (formData: FormData) => Promise<void>;
  impersonateAction: (formData: FormData) => Promise<void>;
};
const roleLabel = (role: DashboardRole) =>
  ROLE_OPTIONS.find((item) => item.value === role)?.label || "Група";
const groupIcon = (group: AccessGroup) =>
  group.icon ||
  (group.role === "admin"
    ? "👑"
    : group.role === "moderator"
      ? "🛡️"
      : group.role === "mentor"
        ? "🌿"
        : "🍃");
function cannotEditReason(
  group: AccessGroup,
  currentGroupId: string | undefined,
  owner: boolean,
) {
  if (owner) return "";
  if (group.id === currentGroupId)
    return "Це твоя поточна група. Самому собі права не змінюємо.";
  return group.id === DEFAULT_ADMIN_GROUP_ID ||
    group.role === "admin" ||
    group.rank >= 100 ||
    group.permissions.includes("groups.manage")
    ? "Адмінські групи та право керування групами змінює тільки власник Discord-сервера."
    : "";
}
function diffRows(server: GroupValues, draft: GroupValues) {
  const labels = {
    id: "ID",
    name: "Назва",
    role: "Роль",
    rank: "Ранг",
    icon: "Іконка",
    discordRoleId: "Discord role ID",
  };
  const rows = Object.entries(labels)
    .filter(
      ([key]) =>
        server[key as keyof typeof labels] !==
        draft[key as keyof typeof labels],
    )
    .map(([key, label]) => [
      label,
      String(server[key as keyof typeof labels]) || "—",
      String(draft[key as keyof typeof labels]) || "—",
    ]);
  for (const key of DASHBOARD_PERMISSION_KEYS)
    if (server.permissions.includes(key) !== draft.permissions.includes(key))
      rows.push([
        PERMISSION_META[key].title,
        server.permissions.includes(key) ? "Є право" : "Немає права",
        draft.permissions.includes(key) ? "Є право" : "Немає права",
      ]);
  return rows;
}
function migrationSummary(group?: AccessGroup) {
  const migration = group?.assignmentMigration;
  return migration ? ` Призначення профілів перенесено: ${migration.profiles}. ID ${migration.fromId} → ${migration.toId}. Старий ID зарезервовано.` : "";
}
export default function AccessGroupsManager({
  groups: initialGroups,
  draftScope,
  isServerOwner,
  currentGroupId,
  saveGroupAction,
  deleteGroupAction,
  impersonateAction,
}: Props) {
  const [groups, setGroups] = useState(initialGroups);
  const [drafts, setDrafts] = useState(new Map<string, GroupDraft>());
  const draftsRef = useRef(drafts);
  const [expanded, setExpanded] = useState(
    initialGroups[0] ? groupDraftKey(initialGroups[0].id) : NEW_GROUP_DRAFT,
  );
  const expandedRef = useRef(expanded);
  const [ready, setReady] = useState(false),
    [query, setQuery] = useState(""),
    [visibleCount, setVisibleCount] = useState(10);
  const [notice, setNotice] = useState(""),
    [storageWarning, setStorageWarning] = useState("");
  const [busy, setBusy] = useState(false),
    [refreshing, setRefreshing] = useState(false);
  const [externalDrafts, setExternalDrafts] = useState(
    new Map<string, GroupDraft>(),
  );
  const storageKey = useRef<string | null>(null);
  const requests = useDashboardRequests();
  const { scopeRef, beginActionFocus } = useActionFocus<HTMLDivElement>(busy || refreshing);
  const categories = useMemo(
    () => [
      ...new Set(
        DASHBOARD_PERMISSION_KEYS.map((key) => PERMISSION_META[key].category),
      ),
    ],
    [],
  );
  const group = groups.find((item) => groupDraftKey(item.id) === expanded),
    draft = drafts.get(expanded);
  const values = draft?.values || groupValues(group),
    dirty = Boolean(draft && draftDirty(draft));
  const reason = group
    ? cannotEditReason(group, currentGroupId, isServerOwner)
    : "";
  const orphan = expanded !== NEW_GROUP_DRAFT && !group;
  const conflict = Boolean(
    draft &&
    expanded !== NEW_GROUP_DRAFT &&
    (!group || draft.baseRevision !== group.revision),
  );
  const blocked = !ready || busy || Boolean(reason) || orphan;
  const canDelete = Boolean(
    group && !group.protectedGroup && !FIXED_GROUP_IDS.has(group.id) && !reason,
  );
  const fixedRole = Boolean(group && FIXED_GROUP_IDS.has(group.id));
  const fixedRank = Boolean(
    group &&
    [
      DEFAULT_ADMIN_GROUP_ID,
      DEFAULT_MODERATOR_GROUP_ID,
      DEFAULT_MEMBER_GROUP_ID,
    ].includes(group.id),
  );
  const searchIndex = useMemo(() => groups.map(item => ({
    item,
    text: `${item.name} ${item.id} ${roleLabel(item.role)} ${item.discordRoleIds.join(" ")}`.toLocaleLowerCase("uk-UA"),
  })), [groups]);
  const normalizedQuery = query.trim().toLocaleLowerCase("uk-UA");
  const filteredGroups = useMemo(() => searchIndex.filter(entry => entry.text.includes(normalizedQuery)).map(entry => entry.item), [searchIndex, normalizedQuery]);
  function persist(next = draftsRef.current) {
    if (!storageKey.current) return;
    try {
      const raw = JSON.stringify({
        version: 1,
        expanded: expandedRef.current,
        drafts: [...next.values()],
      });
      if (raw.length > 131072 || next.size > 100)
        throw new Error("Забагато чернеток");
      localStorage.setItem(storageKey.current, raw);
    } catch {
      setStorageWarning(
        "Браузер не зберіг чернетки. Вони доступні до закриття сторінки; збережи потрібні зміни явно.",
      );
    }
  }
  function replaceDrafts(next: Map<string, GroupDraft>) {
    draftsRef.current = next;
    setDrafts(next);
    persist(next);
  }
  function select(key: string) {
    expandedRef.current = key;
    setExpanded(key);
    persist();
  }
  function edit(patch: Partial<GroupValues>) {
    if (blocked) return;
    const changed = updateGroupDraft(
        draftsRef.current.get(expanded) || makeGroupDraft(group),
        patch,
      ),
      next = new Map(draftsRef.current);
    if (draftDirty(changed) || changed.pending) next.set(expanded, changed);
    else next.delete(expanded);
    replaceDrafts(next);
  }
  function resetDraft() {
    if (dirty && !window.confirm("Скинути незбережені зміни цієї групи?"))
      return;
    const next = new Map(draftsRef.current);
    next.delete(expanded);
    replaceDrafts(next);
    if (orphan)
      select(groups[0] ? groupDraftKey(groups[0].id) : NEW_GROUP_DRAFT);
    setNotice("Чернетку скинуто. Показано актуальні дані.");
  }
  function applyCatalog(fresh: AccessGroup[]) {
    const old = draftsRef.current.get(expandedRef.current),
      next = reconcileGroupDrafts(draftsRef.current, fresh);
    replaceDrafts(next);
    setGroups(fresh);
    const confirmed =
      old?.pending &&
      fresh.find(
        (item) =>
          item.id === old.pending!.targetId &&
          item.lastMutationId === old.pending!.mutationId,
      );
    if (confirmed) {
      select(groupDraftKey(confirmed.id));
      setNotice(
        "Збереження підтверджено. Подальші зміни залишаються в чернетці." + migrationSummary(confirmed),
      );
    }
    return confirmed || null;
  }
  useEffect(() => {
    let active = true,
      closeBucket: (() => void) | undefined;
    requests.cancel("catalog");
    requests.cancel("mutation");
    setBusy(false);
    setRefreshing(false);
    storageKey.current = null;
    draftsRef.current = new Map();
    setDrafts(new Map());
    setExternalDrafts(new Map());
    setGroups(initialGroups);
    setReady(false);
    setStorageWarning("");
    const firstKey = initialGroups[0]
      ? groupDraftKey(initialGroups[0].id)
      : NEW_GROUP_DRAFT;
    expandedRef.current = firstKey;
    setExpanded(firstKey);
    const prefix = `mistblossom:group-drafts:v1:${draftScope}:`,
      buckets = new Map<string, Map<string, GroupDraft>>();
    const mergedExternal = () => {
      const merged = new Map<string, GroupDraft>();
      for (const bucket of buckets.values())
        for (const [id, candidate] of bucket)
          if (
            !merged.has(id) ||
            merged.get(id)!.updatedAt < candidate.updatedAt
          )
            merged.set(id, candidate);
      return merged;
    };
    const load = async () => {
      try {
        const bucket = await claimGroupDraftBucket(prefix);
        closeBucket = bucket.close;
        if (!active) {
          bucket.close();
          return;
        }
        storageKey.current = bucket.key;
        const ownRaw = localStorage.getItem(bucket.restoreKey),
          own = parseGroupDrafts(ownRaw);
        for (let index = 0; index < localStorage.length; index++) {
          const key = localStorage.key(index);
          if (!key?.startsWith(prefix) || key === bucket.key) continue;
          buckets.set(key, parseGroupDrafts(localStorage.getItem(key)).drafts);
        }
        const all = mergedExternal(),
          restored = reconcileGroupDrafts(
            ownRaw !== null ? own.drafts : all,
            initialGroups,
          );
        draftsRef.current = restored;
        setDrafts(restored);
        setExternalDrafts(all);
        if (restored.size)
          setNotice(
            `Відновлено чернетки: ${restored.size}. Права ще не змінено.`,
          );
        else if (own.drafts.size) {
          const recovered = [...own.drafts.values()].map(item => item.pending && initialGroups.find(candidate => candidate.id === item.pending!.targetId && candidate.lastMutationId === item.pending!.mutationId)).find(Boolean);
          setNotice("Попереднє збереження підтверджено; чернетку очищено." + migrationSummary(recovered || undefined));
        }
        const selected = own.expanded;
        if (
          selected &&
          (selected === NEW_GROUP_DRAFT ||
            initialGroups.some((item) => groupDraftKey(item.id) === selected) ||
            restored.has(selected))
        ) {
          expandedRef.current = selected;
          setExpanded(selected);
        }
        persist(restored);
      } catch {
        if (!active) return;
        setStorageWarning(
          "Не вдалося відновити чернетки. Дані браузера не видалено; нові зміни залишаться в пам’яті сторінки.",
        );
        storageKey.current = null;
      }
      if (active) setReady(true);
    };
    void load();
    const onStorage = (event: StorageEvent) => {
      if (!event.key?.startsWith(prefix) || event.key === storageKey.current)
        return;
      try {
        buckets.set(event.key, parseGroupDrafts(event.newValue).drafts);
        setExternalDrafts(mergedExternal());
      } catch {
        setStorageWarning(
          "Чернетка іншої вкладки має невідомий формат. Поточні зміни збережено окремо.",
        );
      }
    };
    const onPageHide = () => persist();
    window.addEventListener("storage", onStorage);
    window.addEventListener("pagehide", onPageHide);
    return () => {
      active = false;
      closeBucket?.();
      window.removeEventListener("storage", onStorage);
      window.removeEventListener("pagehide", onPageHide);
    };
    // Account scope comes from the server. Typing never triggers an API write.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draftScope]);
  useEffect(() => {
    if (ready) applyCatalog(initialGroups);
  }, [initialGroups]);
  async function refresh(trigger?: HTMLElement) {
    if (trigger) beginActionFocus(trigger);
    const request = requests.begin("catalog", 13_000);
    setRefreshing(true);
    try {
      const result = await dashboardApiJson<{ groups: AccessGroup[] }>(
        "/api/dashboard/access-groups",
        { signal: request.signal, timeoutMs: 12_000, retries: 0 },
      );
      if (request.current()) {
        const confirmed = applyCatalog(result.groups);
        if (!confirmed) setNotice(
          "Список оновлено. Незбережені зміни залишаються в чернетках.",
        );
      }
    } catch (error) {
      if (request.current())
        setNotice(
          error instanceof ApiHttpError
            ? error.message
            : "Не вдалося оновити список. Чернетки збережено; спробуй ще раз.",
        );
    } finally {
      if (request.current()) setRefreshing(false);
      request.finish();
    }
  }
  async function submit(event: FormEvent<HTMLFormElement>) {
    const button = (event.nativeEvent as SubmitEvent)
      .submitter as HTMLButtonElement | null;
    if (button?.dataset.dashboardAction === "access-groups-impersonate") {
      persist();
      return;
    }
    event.preventDefault();
    const deleting = button?.dataset.dashboardAction === "access-groups-delete";
    if (blocked || conflict || (!deleting && !dirty)) return;
    if (
      !deleting &&
      group &&
      values.id !== group.id &&
      !window.confirm(
        "Змінити ID групи? Призначення профілів перейдуть разом із групою. Старий ID залишиться зарезервованим для записів зі старих сесій.",
      )
    )
      return;
    if (
      deleting &&
      (!canDelete ||
        !window.confirm(
          "Видалити цю групу доступу? Незбережені зміни цієї групи також буде скинуто.",
        ))
    )
      return;
    // React may reuse this same Delete button for the next selected group.
    if (button) beginActionFocus(button, { preferResult: deleting });
    requests.cancel("catalog");
    setRefreshing(false);
    const key = expanded,
      submitted = draftsRef.current.get(key) || makeGroupDraft(group),
      mutationId = crypto.randomUUID();
    if (!deleting) {
      const next = new Map(draftsRef.current);
      next.set(key, {
        ...submitted,
        pending: { mutationId, targetId: values.id, values },
      });
      replaceDrafts(next);
    }
    const request = requests.begin("mutation", 35_000);
    setBusy(true);
    setNotice(deleting ? "Видаляємо групу…" : "Зберігаємо групу…");
    try {
      const result = await dashboardApiJson<{
        group?: AccessGroup;
        deletedId?: string;
      }>("/api/dashboard/access-groups", {
        method: "POST",
        json: {
          action: deleting ? "delete" : "save",
          ...values,
          currentId: group?.id || "",
          expectedRevision: submitted.baseRevision,
          mutationId,
        },
        signal: request.signal,
        timeoutMs: 20_000,
        retries: 0,
      });
      if (!request.current()) return;
      if (deleting) {
        const fresh = groups.filter((item) => item.id !== group!.id),
          next = new Map(draftsRef.current);
        next.delete(key);
        replaceDrafts(next);
        setGroups(fresh);
        if (expandedRef.current === key)
          select(fresh[0] ? groupDraftKey(fresh[0].id) : NEW_GROUP_DRAFT);
        setNotice("Групу видалено.");
      } else if (result.group) {
        const fresh = [
          ...groups.filter(
            (item) => item.id !== group?.id && item.id !== result.group!.id,
          ),
          result.group,
        ].sort((a, b) => b.rank - a.rank);
        applyCatalog(fresh);
        if (expandedRef.current === key) select(groupDraftKey(result.group.id));
        setNotice(
          "Групу збережено. Нові права застосуються після оновлення сесії." + migrationSummary(result.group),
        );
      }
    } catch (error) {
      if (!request.current()) return;
      const definiteFailure =
        error instanceof ApiHttpError &&
        error.status >= 400 &&
        error.status < 500;
      if (definiteFailure && !deleting) {
        const next = new Map(draftsRef.current),
          latest = next.get(key);
        if (latest) next.set(key, { ...latest, pending: undefined });
        replaceDrafts(next);
      }
      setNotice(
        definiteFailure
          ? error.message
          : "Відповідь не підтверджено. Перевіряємо збережений стан без повторного запису…",
      );
      if (
        !definiteFailure ||
        (error instanceof ApiHttpError && error.status === 409)
      ) {
        try {
          const fresh = await dashboardApiJson<{ groups: AccessGroup[] }>(
            "/api/dashboard/access-groups",
            { signal: request.signal, timeoutMs: 12_000, retries: 0 },
          );
          if (!request.current()) return;
          applyCatalog(fresh.groups);
          if (deleting && !fresh.groups.some((item) => item.id === group?.id)) {
            const next = new Map(draftsRef.current);
            next.delete(key);
            replaceDrafts(next);
            if (expandedRef.current === key) select(NEW_GROUP_DRAFT);
            setNotice(
              "Група відсутня у свіжому списку. Повторне видалення не потрібне.",
            );
          } else if (
            !deleting &&
            fresh.groups.some(
              (item) =>
                item.lastMutationId === mutationId && item.id === values.id,
            )
          )
            setNotice("Збереження підтверджено. Повторний запис не потрібен." + migrationSummary(fresh.groups.find(item => item.lastMutationId === mutationId && item.id === values.id)));
          else
            setNotice(
              definiteFailure
                ? error.message
                : "Збереження ще не підтверджено. Чернетка залишилась; онови список перед повторною дією.",
            );
        } catch {
          if (request.current())
            setNotice(
              "Не вдалося підтвердити результат. Чернетка збережена; онови список перед повторною дією.",
            );
        }
      }
    } finally {
      if (request.current()) setBusy(false);
      request.finish();
    }
  }
  const otherDraft = externalDrafts.get(expanded),
    otherDiffers = otherDraft && !sameGroupValues(otherDraft.values, values);
  return (
    <div ref={scopeRef} className="access-groups-layout" aria-busy={busy || refreshing}>
      <aside
        className="access-groups-list panel"
        aria-label="Список груп доступу"
      >
        <div className="access-groups-list__header">
          <span className="section-title">Групи</span>
          <small>
            {groups.length} груп · {drafts.size} чернеток
          </small>
        </div>
        <label className="access-groups-search">
          Знайти групу
          <input
            className="input"
            type="search"
            maxLength={120}
            value={query}
            onChange={(event) => {
              setQuery(event.target.value);
              setVisibleCount(10);
            }}
            placeholder="Назва, ID або Discord-роль"
          />
        </label>
        {filteredGroups.slice(0, visibleCount).map((item) => (
          <button
            key={item.id}
            type="button"
            className={`btn subtle access-group-tab${expanded === groupDraftKey(item.id) ? " is-active" : ""}`}
            aria-pressed={expanded === groupDraftKey(item.id)}
            onClick={() => select(groupDraftKey(item.id))}
          >
            <strong>
              <span className="access-group-tab__icon" aria-hidden="true">
                {groupIcon(item)}
              </span>
              {item.name}
            </strong>
            <span>
              ID {item.id} · {roleLabel(item.role)} · {item.permissions.length}{" "}
              прав
            </span>
            {drafts.has(groupDraftKey(item.id)) ? (
              <small className="access-draft-badge">Незбережені зміни</small>
            ) : null}
          </button>
        ))}
        {!filteredGroups.length ? <p role="status">Груп не знайдено.</p> : null}
        {filteredGroups.length > visibleCount ? (
          <button
            type="button"
            className="btn subtle"
            onClick={() => setVisibleCount((count) => count + 10)}
          >
            Показати ще 10 · {filteredGroups.length - visibleCount} залишилось
          </button>
        ) : null}
        {[...drafts.keys()]
          .filter(
            (key) =>
              key !== NEW_GROUP_DRAFT &&
              !groups.some((item) => groupDraftKey(item.id) === key),
          )
          .map((key) => (
            <button
              className="btn subtle access-group-tab"
              type="button"
              key={key}
              onClick={() => select(key)}
            >
              Чернетка видаленої групи · {drafts.get(key)!.values.name}
            </button>
          ))}
        <button
          type="button"
          className={`btn subtle access-group-tab${expanded === NEW_GROUP_DRAFT ? " is-active" : ""}`}
          onClick={() => select(NEW_GROUP_DRAFT)}
        >
          <strong>＋ Нова група</strong>
          <span>
            {drafts.has(NEW_GROUP_DRAFT)
              ? "Є чернетка"
              : "ID, назва, роль і права"}
          </span>
        </button>
        <button
          className="btn subtle"
          type="button"
          disabled={busy || refreshing}
          onClick={(event) => void refresh(event.currentTarget)}
        >
          {refreshing ? "Оновлюємо…" : "Оновити список"}
        </button>
      </aside>
      <div className="access-groups-editor">
        <p className="access-draft-notice" role="status" aria-live="polite" aria-atomic="true" data-action-result="" tabIndex={-1}>
          {notice}
        </p>
        {storageWarning ? (
          <p className="access-warning" role="alert">
            {storageWarning}
          </p>
        ) : null}
        {otherDiffers ? (
          <div className="access-warning">
            <p>
              В іншій вкладці є окрема чернетка цієї групи. Поточні зміни
              залишаються тут.
            </p>
            <button
              className="btn subtle"
              type="button"
              disabled={busy}
              onClick={() => {
                if (
                  dirty &&
                  !window.confirm(
                    "Замінити поточну чернетку версією з іншої вкладки?",
                  )
                )
                  return;
                const next = new Map(draftsRef.current);
                next.set(expanded, updateGroupDraft(otherDraft, {}));
                replaceDrafts(next);
              }}
            >
              Відновити чернетку іншої вкладки
            </button>
          </div>
        ) : null}
        {conflict && draft ? (
          <section
            className="access-warning access-draft-conflict"
            role="alert"
          >
            <h3>Група змінилась на сервері</h3>
            <p>
              Збереження заблоковано до перегляду актуальних даних. Ваша
              чернетка залишилась.
            </p>
            {group ? (
              <>
                <div className="access-draft-comparison">
                  <table>
                    <caption>Відмінності чернетки від актуальної групи</caption>
                    <thead>
                      <tr>
                        <th>Поле</th>
                        <th>На сервері</th>
                        <th>У чернетці</th>
                      </tr>
                    </thead>
                    <tbody>
                      {diffRows(groupValues(group), values).map(
                        ([label, server, local]) => (
                          <tr key={label}>
                            <th>{label}</th>
                            <td>{server}</td>
                            <td>{local}</td>
                          </tr>
                        ),
                      )}
                    </tbody>
                  </table>
                </div>
                <div className="form-actions">
                  <button
                    className="btn subtle"
                    type="button"
                    disabled={busy}
                    onClick={resetDraft}
                  >
                    Взяти актуальні дані
                  </button>
                  <button
                    className="btn subtle"
                    type="button"
                    disabled={busy || Boolean(reason)}
                    onClick={() => {
                      const next = new Map(draftsRef.current);
                      next.set(expanded, {
                        ...draft,
                        base: groupValues(group),
                        baseRevision: group.revision || null,
                        pending: undefined,
                      });
                      replaceDrafts(next);
                      setNotice(
                        "Чернетку підготовлено. Перевір поля й натисни «Зберегти зміни», щоб застосувати їх.",
                      );
                    }}
                  >
                    Залишити чернетку для нового збереження
                  </button>
                </div>
              </>
            ) : (
              <>
                <p>
                  Групу видалено. Її можна створити заново тільки окремим явним
                  збереженням.
                </p>
                <button
                  className="btn subtle"
                  type="button"
                  onClick={() => {
                    if (
                      draftsRef.current.has(NEW_GROUP_DRAFT) &&
                      !window.confirm("Замінити наявну чернетку нової групи?")
                    )
                      return;
                    const next = new Map(draftsRef.current);
                    next.delete(expanded);
                    next.set(NEW_GROUP_DRAFT, { ...makeGroupDraft(), values });
                    replaceDrafts(next);
                    select(NEW_GROUP_DRAFT);
                  }}
                >
                  Підготувати створення заново
                </button>
                <button
                  className="btn subtle"
                  type="button"
                  onClick={resetDraft}
                >
                  Скинути чернетку
                </button>
              </>
            )}
          </section>
        ) : null}
        <form
          className="panel access-group-card"
          action={saveGroupAction}
          onSubmit={submit}
          data-dashboard-action-form="true"
          data-toast-managed="true"
          data-dashboard-action={
            group ? "access-groups-save" : "access-groups-create"
          }
          aria-busy={busy}
        >
          <input type="hidden" name="groupId" value={group?.id || ""} />
          <input type="hidden" name="currentId" value={group?.id || ""} />
          <input
            type="hidden"
            name="expectedRevision"
            value={draft?.baseRevision || group?.revision || ""}
          />
          <div className="access-group-card__head">
            <div>
              <span className="eyebrow">
                {group
                  ? FIXED_GROUP_IDS.has(group.id)
                    ? `Системна група · ID ${group.id}`
                    : "Користувацька група"
                  : "Нова група"}
              </span>
              <h2>
                {group ? (
                  <>
                    <span
                      className="access-group-title-icon"
                      aria-hidden="true"
                    >
                      {groupIcon(group)}
                    </span>
                    {group.name}
                  </>
                ) : (
                  "Додати групу доступу"
                )}
              </h2>
              <p>
                {reason ||
                  "Чернетки відновлюються у цьому браузері. Назва, роль і права змінюються лише після явного збереження."}
              </p>
              <span className="access-draft-badge">
                {dirty ? "Незбережені зміни" : "Без незбережених змін"}
              </span>
            </div>
            {group && isServerOwner ? (
              <button
                className="btn subtle"
                formAction={impersonateAction}
                type="submit"
                formNoValidate
                disabled={busy}
                data-dashboard-action="access-groups-impersonate"
                data-loading-label="Вмикаємо перегляд..."
              >
                Переглянути як
              </button>
            ) : null}
          </div>
          {group ? (
            <div
              className="access-group-summary"
              aria-label="Коротко про групу"
            >
              <span>
                <strong>{roleLabel(group.role)}</strong>
                <small>Поточна системна роль</small>
              </span>
              <span>
                <strong>Ранг {group.rank}</strong>
                <small>Вищий ранг має пріоритет</small>
              </span>
              <span>
                <strong>
                  {group.discordRoleIds[0] || "Discord role ID не заданий"}
                </strong>
                <small>Одна Discord-роль на групу</small>
              </span>
            </div>
          ) : (
            <p>Системні ID 1, 2, 3 і 99 зайняті.</p>
          )}
          <div className="form-grid compact-form-grid access-form-grid">
            <label>
              <span>ID групи</span>
              <input
                className="input"
                name="id"
                value={values.id}
                onChange={(event) => edit({ id: event.target.value })}
                required
                maxLength={32}
                pattern="[A-Za-z0-9_-]{1,32}"
                readOnly={blocked || group?.lockedId}
                autoComplete="off"
              />
              <small>
                {group?.lockedId
                  ? "Системний ID не змінюється."
                  : "Латиниця, цифри, _ або -. При зміні ID призначення профілів переносяться разом із групою; старий ID залишається зарезервованим."}
              </small>
            </label>
            <label>
              <span>Назва групи</span>
              <input
                className="input"
                name="name"
                value={values.name}
                onChange={(event) => edit({ name: event.target.value })}
                required
                maxLength={80}
                readOnly={blocked}
                autoComplete="off"
              />
            </label>
            <label>
              <span>Роль у системі</span>
              <select
                className="select"
                name="role"
                value={values.role}
                onChange={(event) =>
                  edit({ role: event.target.value as DashboardRole })
                }
                disabled={blocked || fixedRole}
              >
                {ROLE_OPTIONS.map((role) => (
                  <option
                    key={role.value}
                    value={role.value}
                    disabled={role.value === "admin" && !isServerOwner}
                  >
                    {role.label}
                  </option>
                ))}
              </select>
              <small>
                {fixedRole
                  ? "Для системної групи роль зафіксована."
                  : "Права адміністратора видає лише власник сервера."}
              </small>
            </label>
            <label>
              <span>Ранг</span>
              <input
                className="input"
                name="rank"
                type="number"
                min="1"
                max="100"
                value={values.rank}
                onChange={(event) => edit({ rank: event.target.value })}
                readOnly={blocked || fixedRank}
              />
              <small>Вищий ранг має пріоритет, якщо ролей кілька.</small>
            </label>
            <label>
              <span>
                Іконка групи <em>необов’язково</em>
              </span>
              <input
                className="input"
                name="icon"
                value={values.icon}
                onChange={(event) => edit({ icon: event.target.value })}
                maxLength={24}
                readOnly={blocked}
                autoComplete="off"
              />
            </label>
            <label>
              <span>Discord role ID</span>
              <input
                className="input"
                name="discordRoleId"
                value={values.discordRoleId}
                onChange={(event) =>
                  edit({ discordRoleId: event.target.value })
                }
                maxLength={25}
                inputMode="numeric"
                pattern="[0-9]{16,25}"
                readOnly={blocked}
                autoComplete="off"
              />
              <small>
                Одна група = одна Discord-роль. Поле може бути порожнім.
              </small>
            </label>
          </div>
          {reason ? (
            <p className="access-warning" role="status">
              {reason}
            </p>
          ) : null}
          <div className="permissions-grid">
            {categories.map((category, index) => (
              <details
                className="permissions-category"
                key={`${expanded}:${category}`}
                open={index === 0}
              >
                <summary>
                  {category}
                  <small>
                    {
                      DASHBOARD_PERMISSION_KEYS.filter(
                        (key) => PERMISSION_META[key].category === category,
                      ).length
                    }{" "}
                    прав
                  </small>
                </summary>
                {DASHBOARD_PERMISSION_KEYS.filter(
                  (key) => PERMISSION_META[key].category === category,
                ).map((key) => (
                  <label className="permission-check" key={key}>
                    <input
                      type="checkbox"
                      name="permissions"
                      value={key}
                      checked={values.permissions.includes(key)}
                      disabled={
                        blocked ||
                        key === "dashboard.view" ||
                        (key === "groups.manage" && !isServerOwner)
                      }
                      onChange={(event) =>
                        edit({
                          permissions: event.target.checked
                            ? [...values.permissions, key]
                            : values.permissions.filter((item) => item !== key),
                        })
                      }
                    />
                    <span>
                      <strong>{PERMISSION_META[key].title}</strong>
                      <small>{PERMISSION_META[key].description}</small>
                    </span>
                  </label>
                ))}
              </details>
            ))}
          </div>
          <div className="form-actions access-form-actions">
            <button
              className="btn primary"
              type="submit"
              disabled={blocked || conflict || !dirty}
              data-dashboard-action={
                group ? "access-groups-save" : "access-groups-create"
              }
              data-loading-label="Зберігаємо..."
            >
              {busy
                ? "Виконуємо…"
                : group
                  ? "Зберегти зміни"
                  : "Створити групу"}
            </button>
            <button
              className="btn subtle"
              type="button"
              onClick={resetDraft}
              disabled={busy || !draft}
            >
              Скинути чернетку
            </button>
            {canDelete ? (
              <button
                className="btn danger"
                formAction={deleteGroupAction}
                type="submit"
                formNoValidate
                disabled={blocked || conflict}
                data-dashboard-action="access-groups-delete"
                data-loading-label="Видаляємо..."
              >
                Видалити групу
              </button>
            ) : null}
          </div>
        </form>
      </div>
    </div>
  );
}
