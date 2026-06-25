"use client";

import { useMemo, useState } from "react";

export type RaidBenchPriorityRosterMember = {
  key: string;
  sourceKey?: string | null;
  name: string;
  region?: string | null;
  realmName?: string | null;
  realmSlug?: string | null;
  className?: string | null;
  specName?: string | null;
  itemLevel?: number | null;
  avatarUrl?: string | null;
  ownerDisplayName?: string | null;
};

type RaidBenchPriorityManagerProps = {
  enabled: boolean;
  rosterMembers: RaidBenchPriorityRosterMember[];
  selectedKeys: string[];
  missingSelectedKeys: string[];
  manualNames: string[];
  rosterError?: string | null;
};

function normalizeSearch(value: unknown) {
  return String(value || "")
    .normalize("NFC")
    .toLocaleLowerCase("uk")
    .replace(/[ʼ’`]/g, "'")
    .replace(/[^\p{L}\p{N}' -]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function memberLabel(member: RaidBenchPriorityRosterMember) {
  return [
    member.name,
    member.realmName || member.realmSlug || null,
    member.className || null,
    member.specName || null,
    member.itemLevel ? `${member.itemLevel} ilvl` : null,
  ]
    .filter(Boolean)
    .join(" • ");
}

function memberSearchText(member: RaidBenchPriorityRosterMember) {
  return normalizeSearch([
    member.name,
    member.region,
    member.realmName,
    member.realmSlug,
    member.sourceKey,
    member.className,
    member.specName,
    member.ownerDisplayName,
    member.itemLevel,
  ].filter(Boolean).join(" "));
}

function parseManualPreview(value: string) {
  const seen = new Set<string>();
  return value
    .split(/[\n,;]+/g)
    .map((item) => item.normalize("NFC").replace(/\s+/g, " ").trim())
    .filter((item) => item.length >= 2)
    .filter((item) => {
      const key = normalizeSearch(item).replace(/[^\p{L}\p{N}]+/gu, "");
      if (!key || seen.has(key)) return false;
      seen.add(key);
      return true;
    });
}

function selectedLabel(
  key: string,
  byKey: Map<string, RaidBenchPriorityRosterMember>,
) {
  const member = byKey.get(key);
  return member ? memberLabel(member) : key;
}

export default function RaidBenchPriorityManager({
  enabled,
  rosterMembers,
  selectedKeys,
  missingSelectedKeys,
  manualNames,
  rosterError,
}: RaidBenchPriorityManagerProps) {
  const [isEnabled, setIsEnabled] = useState(enabled);
  const [query, setQuery] = useState("");
  const [manualText, setManualText] = useState(manualNames.join("\n"));
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(
    () => new Set([...selectedKeys, ...missingSelectedKeys].filter(Boolean)),
  );

  const byKey = useMemo(
    () => new Map(rosterMembers.map((member) => [member.key, member])),
    [rosterMembers],
  );

  const searchableMembers = useMemo(
    () => rosterMembers.map((member) => ({
      member,
      search: memberSearchText(member),
    })),
    [rosterMembers],
  );

  const normalizedQuery = normalizeSearch(query);
  const filteredMembers = useMemo(() => {
    if (!normalizedQuery) return searchableMembers.map((item) => item.member);
    const tokens = normalizedQuery.split(" ").filter(Boolean);
    return searchableMembers
      .filter((item) => tokens.every((token) => item.search.includes(token)))
      .map((item) => item.member);
  }, [normalizedQuery, searchableMembers]);

  const selectedKeysSorted = useMemo(
    () => Array.from(selected).sort((a, b) => selectedLabel(a, byKey).localeCompare(selectedLabel(b, byKey), "uk", { numeric: true })),
    [byKey, selected],
  );

  const selectedKnownMembers = useMemo(
    () => rosterMembers.filter((member) => selected.has(member.key)),
    [rosterMembers, selected],
  );

  const selectedMissingKeys = useMemo(
    () => selectedKeysSorted.filter((key) => !byKey.has(key)),
    [byKey, selectedKeysSorted],
  );

  const manualPreview = useMemo(
    () => parseManualPreview(manualText),
    [manualText],
  );

  function toggleKey(key: string, checked: boolean) {
    setSelected((current) => {
      const next = new Set(current);
      if (checked) next.add(key);
      else next.delete(key);
      return next;
    });
  }

  function selectVisible() {
    setSelected((current) => {
      const next = new Set(current);
      for (const member of filteredMembers) next.add(member.key);
      return next;
    });
  }

  function unselectVisible() {
    setSelected((current) => {
      const next = new Set(current);
      for (const member of filteredMembers) next.delete(member.key);
      return next;
    });
  }

  function clearAll() {
    setSelected(new Set());
    setManualText("");
  }

  const selectedVisibleCount = filteredMembers.filter((member) => selected.has(member.key)).length;
  const selectedFromRosterCount = selectedKnownMembers.length;

  return (
    <form
      className="raid-greylist-form"
      action="/api/raids/bench-priority"
      method="post"
      onSubmit={() => setIsSubmitting(true)}
    >
      <input type="hidden" name="enabled" value={isEnabled ? "1" : "0"} />
      {selectedKeysSorted.map((key) => (
        <input key={`selected-hidden-${key}`} type="hidden" name="characterKeys" value={key} />
      ))}

      <label className="raid-checkbox-line raid-greylist-enabled">
        <input
          type="checkbox"
          checked={isEnabled}
          onChange={(event) => setIsEnabled(event.currentTarget.checked)}
        />
        <span>
          Увімкнути глобальний сірий список для автоматичного складу рейдів
        </span>
      </label>

      <div className="raid-greylist-layout">
        <section className="raid-greylist-box">
          <div className="raid-greylist-box-head raid-greylist-toolbar-head">
            <div>
              <strong>Вибір зі складу гільдії</strong>
              <small>
                {selectedFromRosterCount} вибрано • {filteredMembers.length} показано з {rosterMembers.length}
              </small>
            </div>
            <div className="raid-greylist-mini-actions">
              <button className="btn subtle" type="button" onClick={selectVisible}>
                Вибрати видимих
              </button>
              <button className="btn subtle" type="button" onClick={unselectVisible}>
                Зняти видимих
              </button>
            </div>
          </div>

          <label className="raid-greylist-search" htmlFor="raid-greylist-search-input">
            <span>Пошук персонажа</span>
            <input
              id="raid-greylist-search-input"
              className="input"
              type="search"
              value={query}
              onChange={(event) => setQuery(event.currentTarget.value)}
              placeholder="Імʼя, реалм, клас, спек, власник..."
              autoComplete="off"
            />
          </label>

          <div className="raid-greylist-state-row">
            <span>Видимих вибрано: {selectedVisibleCount}</span>
            {query ? (
              <button className="link-button" type="button" onClick={() => setQuery("")}>
                очистити пошук
              </button>
            ) : null}
          </div>

          {rosterError ? (
            <div className="notice warning-note raid-notice">
              Склад гільдії прочитано з попередженням: {rosterError}
            </div>
          ) : null}

          <div className="raid-greylist-roster">
            {filteredMembers.length ? (
              filteredMembers.map((member) => (
                <label
                  className={`raid-greylist-member${selected.has(member.key) ? " is-selected" : ""}`}
                  key={member.key}
                >
                  <input
                    type="checkbox"
                    checked={selected.has(member.key)}
                    onChange={(event) => toggleKey(member.key, event.currentTarget.checked)}
                  />
                  {member.avatarUrl ? (
                    <img
                      src={member.avatarUrl}
                      alt=""
                      width={34}
                      height={34}
                      loading="lazy"
                      referrerPolicy="no-referrer"
                    />
                  ) : (
                    <span className="raid-greylist-avatar" aria-hidden="true">
                      {member.name.charAt(0)}
                    </span>
                  )}
                  <span>
                    <strong>{member.name}</strong>
                    <small>{memberLabel(member)}</small>
                  </span>
                </label>
              ))
            ) : rosterMembers.length ? (
              <p className="raid-empty">
                Нічого не знайдено. Зміни пошук або очисти фільтр.
              </p>
            ) : (
              <p className="raid-empty">
                Немає збереженого складу гільдії. Запусти синхронізацію складу
                або додай ніки вручну праворуч.
              </p>
            )}
          </div>
        </section>

        <section className="raid-greylist-box">
          <div className="raid-greylist-box-head">
            <div>
              <strong>Ручні ніки</strong>
              <small>{manualPreview.length} підготовлено до збереження</small>
            </div>
            <button className="btn subtle" type="button" onClick={clearAll}>
              Очистити все
            </button>
          </div>
          <textarea
            className="input textarea raid-greylist-manual"
            name="manualNames"
            rows={14}
            placeholder={"Forchun\nKhayen-Terokkar\nІмʼя персонажа"}
            value={manualText}
            onChange={(event) => setManualText(event.currentTarget.value)}
            spellCheck={false}
          />
          <p className="raid-form-hint">
            Ручний запис матчиться за ніком персонажа, <code>Name-Realm</code> або
            <code>Name Realm</code>. Можна писати по одному ніку на рядок, через
            кому або крапку з комою.
          </p>

          <div className="raid-greylist-selected">
            <strong>Зараз у формі</strong>
            {selectedKnownMembers.length || selectedMissingKeys.length || manualPreview.length ? (
              <ul>
                {selectedKnownMembers.map((member) => (
                  <li key={`selected-${member.key}`}>{memberLabel(member)}</li>
                ))}
                {selectedMissingKeys.map((key) => (
                  <li key={`missing-${key}`}>
                    <span>Ключ поза поточним складом: {key}</span>
                    <button
                      className="link-button danger"
                      type="button"
                      onClick={() => toggleKey(key, false)}
                    >
                      прибрати
                    </button>
                  </li>
                ))}
                {manualPreview.map((name) => (
                  <li key={`manual-${name}`}>Вручну: {name}</li>
                ))}
              </ul>
            ) : (
              <p>Список порожній.</p>
            )}
          </div>
        </section>
      </div>

      <div className="raid-form-actions raid-greylist-actions">
        <button className="btn primary" type="submit" disabled={isSubmitting}>
          {isSubmitting ? "Зберігаю..." : "Зберегти сірий список"}
        </button>
        <a className="btn subtle" href="/raids">
          Скасувати
        </a>
      </div>
    </form>
  );
}
