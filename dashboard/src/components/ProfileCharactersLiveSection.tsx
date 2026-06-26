"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { DASHBOARD_BACKGROUND_REFRESH_MIN_MS, useDashboardApiResource } from "@/lib/dashboardBackgroundApi";
import { dateMillis, formatStableUkCompactDate, stableTextCompare } from "@/lib/stableUiText";
import type { DashboardProfile, ProfileCharacter } from "@/lib/profiles";
import { wowRoleLabel } from "@/lib/wowRoles";

const DEFAULT_REFRESH_MIN_MS = DASHBOARD_BACKGROUND_REFRESH_MIN_MS;

type RefreshState = "idle" | "checking" | "updated" | "skipped" | "offline" | "error";

type ProfileRefreshPayload = {
  ok?: boolean;
  profileId?: string;
  refreshed?: number;
  failed?: number;
  skipped?: number;
  locked?: boolean;
  throttled?: boolean;
  checkedAt?: string;
  profile?: {
    updatedAt?: string | null;
    battlenet?: DashboardProfile["battlenet"];
    characters?: ProfileCharacter[];
  } | null;
};

type Props = {
  profileId: string;
  initialCharacters: ProfileCharacter[];
  initialUpdatedAt?: string | null;
  canManage: boolean;
  showMainBadge: boolean;
  returnTo?: string;
  candidateCount: number;
  emptyMessage: string;
  refreshMinMs?: number;
};

function newestMillis(...values: Array<string | null | undefined>) {
  return values.reduce<number | null>((latest, value) => {
    const time = dateMillis(value);
    if (time === null) return latest;
    return latest === null ? time : Math.max(latest, time);
  }, null);
}

function pickImageUrl(...values: Array<string | null | undefined>) {
  for (const value of values) {
    const text = String(value || "").trim();
    if (!text) continue;
    try {
      const url = new URL(text);
      if (url.protocol !== "https:" && url.protocol !== "http:") continue;
      const path = url.pathname;
      const avatarPath = path.replace(/-(?:main-raw|main)\.png$/i, "-avatar.jpg");
      if (avatarPath !== path) {
        url.pathname = avatarPath;
        return url.toString();
      }
      if (/\.(?:png|jpe?g|webp)$/i.test(path)) return url.toString();
    } catch {
      // Ignore malformed media URL.
    }
  }
  return null;
}

function characterVisualUrl(character?: Pick<ProfileCharacter, "renderUrl" | "avatarUrl" | "mediaUrl"> | null) {
  if (!character) return null;
  return character.renderUrl || pickImageUrl(character.avatarUrl, character.mediaUrl);
}

function visibleCharacters(characters: ProfileCharacter[]) {
  return [...characters].sort((a, b) => {
    if (a.isMain !== b.isMain) return a.isMain ? -1 : 1;
    if (a.verifiedGuild !== b.verifiedGuild) return a.verifiedGuild ? -1 : 1;
    return stableTextCompare(a.name, b.name);
  });
}

function CharacterArtwork({ character }: { character: ProfileCharacter }) {
  const image = characterVisualUrl(character);
  if (image) {
    return <img src={image} alt="" loading="lazy" referrerPolicy="no-referrer" />;
  }
  return <span className="profile-character-artwork__fallback" aria-hidden="true">{character.name.charAt(0)}</span>;
}

function CharacterInlineIcon({ kind }: { kind: "guild" | "other" | "ilvl" | "level" | "rio" | "updated" | "external" | "trash" | "crown" }) {
  if (kind === "guild") {
    return (
      <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
        <path d="M18.9 4.3c-5 .1-8.4 2.5-10 7.2-1.1 3.1-.7 6 .1 8.2.1.4-.3.8-.7.6-2.2-1.1-4.8-4.5-5-8.8-.2-5.5 3.5-9.3 9.4-9.5 2.4-.1 4.4.4 6 1.4.5.3.3.9-.2.9-.2 0-.4 0-.6 0Zm-3.6 2.9c1.8 4.4 1 8.6-2.5 12.2-.3.3 0 .8.4.8 5.4-.2 8.9-4.2 8.8-9.1-.1-2.7-1.3-5-3.4-6.6-.4-.3-.9.1-.7.6.3.7.6 1.4.8 2.1.1.3-.1.6-.4.7-.6.1-1.6.2-2.4-.7-.2-.2-.4-.2-.6 0Z" fill="currentColor"/>
      </svg>
    );
  }
  if (kind === "other") {
    return (
      <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
        <path d="M9.1 12a3.9 3.9 0 1 0 0-7.8 3.9 3.9 0 0 0 0 7.8Zm5.8-.9a3.1 3.1 0 1 0 0-6.2 3.1 3.1 0 0 0 0 6.2ZM2.8 18.6c0-2.8 3.4-4.9 6.8-4.9s6.8 2.1 6.8 4.9c0 .7-.5 1.2-1.2 1.2H4c-.7 0-1.2-.5-1.2-1.2Zm12 .4c.4-1.6 2.4-2.8 4.5-2.8 1.1 0 2.2.3 3 .9.6.4.8 1.3.4 2-.2.5-.7.8-1.3.8h-6.6c-.1-.3-.1-.6 0-.9Z" fill="currentColor"/>
      </svg>
    );
  }
  if (kind === "ilvl") {
    return (
      <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
        <path d="M12 2.5 19.5 6v6.1c0 4.6-3.1 8.8-7.5 9.9-4.4-1.1-7.5-5.3-7.5-9.9V6L12 2.5Zm0 4-4 1.8v3.8c0 2.9 1.8 5.5 4 6.5 2.2-1 4-3.6 4-6.5V8.3L12 6.5Zm-.9 2.1h1.8v3h3v1.8h-3v3h-1.8v-3h-3v-1.8h3v-3Z" fill="currentColor"/>
      </svg>
    );
  }
  if (kind === "level") {
    return (
      <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
        <path d="M12 2.2 20.2 6v6c0 5.2-3.5 9.1-8.2 10.8C7.3 21.1 3.8 17.2 3.8 12V6L12 2.2Zm0 4.1L7.7 8.2V12c0 3.2 1.9 5.9 4.3 7 2.4-1.1 4.3-3.8 4.3-7V8.2L12 6.3Zm0 2.1a2.8 2.8 0 1 1 0 5.7 2.8 2.8 0 0 1 0-5.7Zm0 7.2c1.5 0 2.8.8 3.4 2.1.2.3-.1.7-.5.7H9.1c-.4 0-.7-.4-.5-.7.6-1.3 1.9-2.1 3.4-2.1Z" fill="currentColor"/>
      </svg>
    );
  }
  if (kind === "rio") {
    return (
      <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
        <path d="M4.8 18.8a1 1 0 0 1-1-1V6.2a1 1 0 1 1 2 0v10.6h11.4a1 1 0 1 1 0 2H4.8Zm3.7-2.8a1 1 0 0 1-.7-1.7l2.8-2.8 2.1 2.1 4.2-4.2h-1.7a1 1 0 1 1 0-2h4.1c.6 0 1 .4 1 1v4.1a1 1 0 1 1-2 0V10l-4.9 4.9-2.1-2.1-2.1 2.1a1 1 0 0 1-.7.3Z" fill="currentColor"/>
      </svg>
    );
  }
  if (kind === "updated") {
    return (
      <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
        <path d="M12 3.2a8.8 8.8 0 1 1 0 17.6 8.8 8.8 0 0 1 0-17.6Zm0 2a6.8 6.8 0 1 0 0 13.6 6.8 6.8 0 0 0 0-13.6Zm1 2.6v3.8l2.9 1.7a1 1 0 1 1-1 1.7l-3.4-2a1 1 0 0 1-.5-.9V7.8a1 1 0 1 1 2 0Z" fill="currentColor"/>
      </svg>
    );
  }
  if (kind === "external") {
    return (
      <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
        <path d="M14.2 4.5a1 1 0 1 0 0 2h2.9l-6.8 6.8a1 1 0 1 0 1.4 1.4l6.8-6.8v2.9a1 1 0 1 0 2 0V5.5c0-.6-.4-1-1-1h-5.3Zm-7.7 2.3c-1.1 0-2 .9-2 2v8.7c0 1.1.9 2 2 2h8.7c1.1 0 2-.9 2-2v-3a1 1 0 1 0-2 0v3H6.5V8.8h3a1 1 0 1 0 0-2h-3Z" fill="currentColor"/>
      </svg>
    );
  }
  if (kind === "trash") {
    return (
      <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
        <path d="M9.1 4.5c.2-1.2 1.2-2.1 2.4-2.1h1c1.2 0 2.2.9 2.4 2.1h3.2a1 1 0 1 1 0 2h-1l-.8 12c-.1 1.7-1.5 3.1-3.2 3.1h-2.1c-1.7 0-3.1-1.4-3.2-3.1l-.8-12h-1a1 1 0 1 1 0-2h3.1Zm2 .1h1.8c-.1-.2-.3-.3-.5-.3h-.8c-.2 0-.4.1-.5.3Zm-.1 4.1a1 1 0 0 1 1 1v7a1 1 0 1 1-2 0v-7a1 1 0 0 1 1-1Zm4 0a1 1 0 0 1 1 1v7a1 1 0 1 1-2 0v-7a1 1 0 0 1 1-1Z" fill="currentColor"/>
      </svg>
    );
  }
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <path d="M12 2.5 9.6 7.4l-5.4.8 3.9 3.8-.9 5.3 4.8-2.5 4.8 2.5-.9-5.3 3.9-3.8-5.4-.8L12 2.5Z" fill="currentColor"/>
    </svg>
  );
}

function CharacterStat({ icon, label, value }: { icon: "ilvl" | "level" | "rio" | "updated"; label: string; value: string | number }) {
  return (
    <div className="profile-character-stat">
      <span className={`profile-character-stat__icon profile-character-stat__icon--${icon}`}>
        <CharacterInlineIcon kind={icon} />
      </span>
      <span className="profile-character-stat__copy">
        <small>{label}</small>
        <strong>{value}</strong>
      </span>
    </div>
  );
}

function CharacterCard({ character, profileId, canManage, showMainBadge, returnTo = "" }: { character: ProfileCharacter; profileId: string; canManage: boolean; showMainBadge: boolean; returnTo?: string }) {
  const classLabel = character.className || "Клас невідомий";
  const specLabel = character.activeSpecName ? `${character.activeSpecName} • ${classLabel}` : classLabel;
  const roleLabel = wowRoleLabel(character.activeSpecRole);
  const itemLevel = typeof character.itemLevel === "number" ? character.itemLevel : "—";
  const rioScore = typeof character.raiderIo?.currentScore === "number" ? Math.round(character.raiderIo.currentScore) : "—";
  const rioUrl = character.raiderIo?.profileUrl || null;
  const realmLabel = character.realmName || character.realmSlug || "Реалм —";
  const guildBadge = character.verifiedGuild
    ? { label: "Гільдійний", icon: "guild", className: "is-guild" as const }
    : { label: "Інший", icon: "other", className: "is-other" as const };
  const updatedLabel = formatStableUkCompactDate(character.lastSeenAt);

  return (
    <article className={`profile-character-card${showMainBadge && character.isMain ? " is-main" : ""} ${guildBadge.className}`} aria-label={`${showMainBadge && character.isMain ? "Основний персонаж" : "Персонаж"}: ${character.name}`} data-character-profile-id={profileId}>
      <div className="profile-character-artwork">
        <CharacterArtwork character={character} />
        {showMainBadge && character.isMain ? <span className="profile-main-badge profile-main-badge--art">Мейн</span> : null}
      </div>
      <div className="profile-character-body">
        <div className="profile-character-title-row profile-character-title-row--stacked">
          <div className="profile-character-title-copy">
            <h3>{character.name}</h3>
            <p>{realmLabel}</p>
          </div>
          <span className={`profile-character-kind profile-character-kind--${guildBadge.className}`}>
            <CharacterInlineIcon kind={guildBadge.icon} />
            <span>{guildBadge.label}</span>
          </span>
        </div>

        <div className="profile-character-meta" aria-label="Характеристики персонажа">
          <span>{specLabel}</span>
          <span>{roleLabel}</span>
          <span>{realmLabel}</span>
        </div>

        <div className="profile-character-stats-grid" aria-label="Ключові показники персонажа">
          <div className="profile-character-stats-row">
            <CharacterStat icon="ilvl" label="ILVL" value={itemLevel} />
            <span className="profile-character-stats-divider" aria-hidden="true" />
            <CharacterStat icon="level" label="Рівень" value={typeof character.level === "number" ? character.level : "—"} />
          </div>
          <div className="profile-character-stats-row">
            <CharacterStat icon="rio" label="RIO" value={rioScore} />
            <span className="profile-character-stats-divider" aria-hidden="true" />
            <CharacterStat icon="updated" label="Оновлено" value={updatedLabel} />
          </div>
        </div>

        <div className="profile-character-actions">
          {canManage && !character.isMain ? (
            <form className="profile-character-actions__full" action="/api/profile/characters/main" method="post">
              <input type="hidden" name="characterKey" value={character.key} />
              {returnTo ? <input type="hidden" name="returnTo" value={returnTo} /> : null}
              <button className="profile-character-btn profile-character-btn--accent" type="submit">
                <span className="profile-character-btn__icon"><CharacterInlineIcon kind="crown" /></span>
                <span>Зробити мейном</span>
              </button>
            </form>
          ) : null}

          <div className={`profile-character-actions__row${canManage ? "" : " is-single"}`}>
            {rioUrl ? (
              <a className="profile-character-btn profile-character-btn--ghost" href={rioUrl} target="_blank" rel="noreferrer">
                <span>Raider.IO</span>
                <span className="profile-character-btn__icon"><CharacterInlineIcon kind="external" /></span>
              </a>
            ) : (
              <span className="profile-character-btn profile-character-btn--ghost is-disabled" aria-disabled="true">
                <span>Raider.IO</span>
                <span className="profile-character-btn__icon"><CharacterInlineIcon kind="external" /></span>
              </span>
            )}
            {canManage ? (
              <form action="/api/profile/characters/remove" method="post">
                <input type="hidden" name="characterKey" value={character.key} />
                {returnTo ? <input type="hidden" name="returnTo" value={returnTo} /> : null}
                <button className="profile-character-btn profile-character-btn--danger" type="submit">
                  <span className="profile-character-btn__icon"><CharacterInlineIcon kind="trash" /></span>
                  <span>Видалити</span>
                </button>
              </form>
            ) : null}
          </div>
        </div>
      </div>
    </article>
  );
}


export default function ProfileCharactersLiveSection({
  profileId,
  initialCharacters,
  initialUpdatedAt = null,
  canManage,
  showMainBadge,
  returnTo = "",
  candidateCount,
  emptyMessage,
  refreshMinMs = DEFAULT_REFRESH_MIN_MS,
}: Props) {
  const [characters, setCharacters] = useState(() => visibleCharacters(initialCharacters));
  const [updatedAt, setUpdatedAt] = useState<string | null>(initialUpdatedAt || null);
  const refreshMinMsRef = useRef(Math.max(DEFAULT_REFRESH_MIN_MS, refreshMinMs));

  const resource = useDashboardApiResource<ProfileRefreshPayload | null>({
    key: `profile:${profileId}:external-data`,
    scope: ["profile", "profiles", "guild", "raids"],
    initialData: null,
    minIntervalMs: refreshMinMsRef.current,
    refreshOnMount: true,
    request: () => ({
      url: "/api/background/refresh",
      method: "POST",
      headers: { "X-Dashboard-Action": "background-profile-external-refresh" },
      json: {
        resources: [{
          key: `profile:${profileId}:external-data`,
          kind: "profile-external",
          profileId,
          minSpacingSeconds: Math.ceil(refreshMinMsRef.current / 1000),
        }],
      },
      select: (payload) => {
        const first = payload && typeof payload === "object" && "resources" in payload
          ? (payload as { resources?: Array<{ ok?: boolean; data?: ProfileRefreshPayload; error?: string }> }).resources?.[0]
          : null;
        if (!first?.ok || !first.data?.ok) throw new Error(first?.error || "profile_refresh_failed");
        return first.data;
      },
    }),
  });

  useEffect(() => {
    setCharacters(visibleCharacters(initialCharacters));
    setUpdatedAt(initialUpdatedAt || null);
  }, [initialCharacters, initialUpdatedAt]);

  useEffect(() => {
    const data = resource.data;
    if (!data?.profile) return;

    const refreshedCharacters = Array.isArray(data.profile.characters) ? data.profile.characters : [];
    if (refreshedCharacters.length) setCharacters(visibleCharacters(refreshedCharacters));

    const nextUpdatedAt = data.profile.battlenet?.lastProfileViewRefreshAt
      || data.profile.battlenet?.lastCharacterRefreshAt
      || data.profile.battlenet?.lastSyncAt
      || data.profile.updatedAt
      || data.checkedAt
      || new Date().toISOString();
    setUpdatedAt(nextUpdatedAt);
  }, [resource.data]);

  const state: RefreshState = resource.status === "checking"
    ? "checking"
    : resource.status === "updated" && resource.data?.throttled
      ? "skipped"
      : resource.status;

  const guildCount = useMemo(() => characters.filter((item) => item.verifiedGuild).length, [characters]);
  const otherCount = Math.max(0, characters.length - guildCount);
  const effectiveUpdatedAt = useMemo(() => {
    const characterLastSeen = characters.reduce<number | null>((latest, character) => {
      const time = newestMillis(character.lastSeenAt, character.raiderIo?.updatedAt);
      if (time === null) return latest;
      return latest === null ? time : Math.max(latest, time);
    }, null);
    const toolbarTime = Math.max(dateMillis(updatedAt) || 0, characterLastSeen || 0);
    return toolbarTime > 0 ? new Date(toolbarTime).toISOString() : null;
  }, [characters, updatedAt]);

  const statusLabel = state === "checking"
    ? "Персонажі оновлюються у фоні"
    : state === "updated"
      ? "Дані персонажів оновлено без перезавантаження"
      : state === "offline"
        ? "Фонове оновлення призупинено без мережі"
        : state === "error"
          ? "Фонове оновлення не вдалося"
          : "Фонове оновлення активне";

  return (
    <>
      <div className="profile-card-toolbar profile-card-toolbar--compact" aria-label="Стан персонажів">
        <span><strong>{guildCount}</strong><small>Гільдійні</small></span>
        <span><strong>{otherCount}</strong><small>Інші</small></span>
        <span data-profile-candidate-summary="true"><strong data-profile-candidate-count="true">{candidateCount}</strong><small>Можна додати</small></span>
        <span><strong>{formatStableUkCompactDate(effectiveUpdatedAt)}</strong><small>Оновлено</small></span>
      </div>

      <span className="sr-only" role="status" aria-live="polite" data-profile-refresh-state={state}>{statusLabel}</span>

      {characters.length ? (
        <div className="profile-character-list profile-character-list--single-flow">
          {characters.map((character) => (
            <CharacterCard
              key={character.key}
              character={character}
              profileId={profileId}
              canManage={canManage}
              showMainBadge={showMainBadge}
              returnTo={returnTo}
            />
          ))}
        </div>
      ) : (
        <div className="profile-empty-characters">
          <strong>Персонажів ще немає</strong>
          <span>{emptyMessage}</span>
        </div>
      )}
    </>
  );
}
