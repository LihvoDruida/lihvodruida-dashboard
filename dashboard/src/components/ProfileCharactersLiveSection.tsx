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

type CharacterIconKind = "guild" | "other" | "ilvl" | "level" | "rio" | "updated" | "external" | "trash" | "crown" | "mainStar";

function CharacterInlineIcon({ kind }: { kind: CharacterIconKind }) {
  const common = {
    viewBox: "0 0 24 24",
    width: 18,
    height: 18,
    fill: "none",
    stroke: "currentColor",
    strokeWidth: 1.9,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
    focusable: false,
    "aria-hidden": true,
  };

  switch (kind) {
    case "crown":
      return <svg {...common}><path d="M3 8l4 4 5-7 5 7 4-4v9a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1Z" /></svg>;
    case "mainStar":
      return <svg {...common}><path d="m12 3 2.7 5.5 6.1.9-4.4 4.3 1 6.1-5.4-2.9-5.4 2.9 1-6.1-4.4-4.3 6.1-.9Z" /></svg>;
    case "external":
      return <svg {...common}><path d="M14 5h5v5" /><path d="m19 5-8 8" /><path d="M19 13v5a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1h5" /></svg>;
    case "trash":
      return <svg {...common}><path d="M4 7h16" /><path d="M9 7V4h6v3" /><path d="m7 7 1 13h8l1-13" /><path d="M10 11v5M14 11v5" /></svg>;
    case "guild":
      return <svg {...common}><path d="M12 3 19 6v6c0 4.4-3 8.3-7 9-4-.7-7-4.6-7-9V6Z" /><path d="m9 12 2 2 4-4" /></svg>;
    case "other":
      return <svg {...common}><circle cx="12" cy="8" r="3.5" /><path d="M5 20a7 7 0 0 1 14 0" /></svg>;
    case "ilvl":
      return <svg {...common}><path d="M12 3v18M7 8l5-5 5 5M7 16l5 5 5-5" /></svg>;
    case "level":
      return <svg {...common}><path d="M5 18h14" /><path d="M7 15 12 5l5 10" /></svg>;
    case "rio":
      return <svg {...common}><path d="M4 19V9M10 19V5M16 19v-7M22 19H2" /></svg>;
    case "updated":
      return <svg {...common}><circle cx="12" cy="12" r="8" /><path d="M12 8v5l3 2" /></svg>;
  }
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
    ? { label: "Гільдійний", icon: "guild" as const, modifier: "guild" as const, state: "is-guild" as const }
    : { label: "Поза гільдією", icon: "other" as const, modifier: "external" as const, state: "is-other" as const };
  const updatedLabel = formatStableUkCompactDate(character.lastSeenAt);

  return (
    <article className={`profile-character-card${showMainBadge && character.isMain ? " is-main" : ""} ${guildBadge.state}`} aria-label={`${showMainBadge && character.isMain ? "Основний персонаж" : "Персонаж"}: ${character.name}`} data-character-profile-id={profileId}>
      <div className="profile-character-artwork">
        <CharacterArtwork character={character} />
        {showMainBadge && character.isMain ? (
          <span className="profile-character-main-corner" aria-label="Мейн">
            <CharacterInlineIcon kind="mainStar" />
          </span>
        ) : null}
        <div className="profile-character-badges profile-character-badges--art" aria-label="Статус гільдії персонажа">
          <span className={`profile-character-badge profile-character-badge--${guildBadge.modifier}`}>
            <CharacterInlineIcon kind={guildBadge.icon} />
            <span>{guildBadge.label}</span>
          </span>
        </div>
      </div>
      <div className="profile-character-body">
        <div className="profile-character-title-row profile-character-title-row--stacked">
          <div className="profile-character-title-copy">
            <h3>{character.name}</h3>
            <p>{realmLabel}</p>
          </div>
        </div>

        <div className="profile-character-meta" aria-label="Характеристики персонажа">
          <span>{specLabel}</span>
          <span>{roleLabel}</span>
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
              <button className="btn primary profile-character-action" type="submit">
                <span className="btn__icon"><CharacterInlineIcon kind="crown" /></span>
                <span>Зробити мейном</span>
              </button>
            </form>
          ) : null}

          <div className={`profile-character-actions__row${canManage ? "" : " is-single"}`}>
            {rioUrl ? (
              <a className="btn subtle profile-character-action" href={rioUrl} target="_blank" rel="noreferrer">
                <span>Raider.IO</span>
                <span className="btn__icon"><CharacterInlineIcon kind="external" /></span>
              </a>
            ) : (
              <span className="btn subtle profile-character-action is-disabled" aria-disabled="true">
                <span>Raider.IO</span>
                <span className="btn__icon"><CharacterInlineIcon kind="external" /></span>
              </span>
            )}
            {canManage ? (
              <form action="/api/profile/characters/remove" method="post">
                <input type="hidden" name="characterKey" value={character.key} />
                {returnTo ? <input type="hidden" name="returnTo" value={returnTo} /> : null}
                <button className="btn danger profile-character-action" type="submit">
                  <span className="btn__icon"><CharacterInlineIcon kind="trash" /></span>
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
