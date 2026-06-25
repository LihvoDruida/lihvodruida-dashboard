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

function characterAuxMeta(character: Pick<ProfileCharacter, "level" | "raceName" | "faction">) {
  return [
    typeof character.level === "number" ? `Lvl ${character.level}` : null,
    character.raceName || null,
    character.faction || null,
  ].filter(Boolean) as string[];
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

function CharacterCard({ character, profileId, canManage, showMainBadge, returnTo = "" }: { character: ProfileCharacter; profileId: string; canManage: boolean; showMainBadge: boolean; returnTo?: string }) {
  const classLabel = character.className || "Клас невідомий";
  const specLabel = character.activeSpecName ? `${character.activeSpecName} • ${classLabel}` : classLabel;
  const roleLabel = wowRoleLabel(character.activeSpecRole);
  const itemLevel = typeof character.itemLevel === "number" ? character.itemLevel : null;
  const rioScore = typeof character.raiderIo?.currentScore === "number" ? Math.round(character.raiderIo.currentScore) : null;
  const rioUrl = character.raiderIo?.profileUrl || null;
  const realmLabel = character.realmName || character.realmSlug || "Реалм —";
  const extraMeta = characterAuxMeta(character);
  const guildBadge = character.verifiedGuild
    ? { label: "Гільдійний", icon: "🌿", className: "is-guild" }
    : { label: "Інший", icon: "🤝", className: "is-other" };

  return (
    <article className={`profile-character-card${showMainBadge && character.isMain ? " is-main" : ""} ${guildBadge.className}`} aria-label={`${showMainBadge && character.isMain ? "Основний персонаж" : "Персонаж"}: ${character.name}`}>
      <div className="profile-character-artwork">
        <CharacterArtwork character={character} />
        {showMainBadge && character.isMain ? <span className="profile-main-badge profile-main-badge--art">Мейн</span> : null}
      </div>
      <div className="profile-character-body">
        <div className="profile-character-title-row profile-character-title-row--stacked">
          <div>
            <h3>{character.name}</h3>
            <p>{realmLabel}</p>
          </div>
          <span className={`profile-character-kind profile-character-kind--${guildBadge.className}`}>{guildBadge.icon} {guildBadge.label}</span>
        </div>

        <div className="profile-character-meta">
          <span>{specLabel}</span>
          <span>{roleLabel}</span>
          <span>{realmLabel}</span>
          {extraMeta.map((value) => <span key={value}>{value}</span>)}
        </div>

        <div className="profile-character-showcase">
          <div className="profile-character-showcase__stat">
            <small>ilvl</small>
            <strong>{itemLevel ?? "—"}</strong>
          </div>
          <div className="profile-character-showcase__stat profile-character-showcase__stat--secondary">
            <small>Рівень</small>
            <strong>{typeof character.level === "number" ? character.level : "—"}</strong>
          </div>
          <div className="profile-character-showcase__stat profile-character-showcase__stat--secondary">
            <small>RIO</small>
            <strong>{rioScore ?? "—"}</strong>
          </div>
          <div className="profile-character-showcase__stat profile-character-showcase__stat--secondary">
            <small>Оновлено</small>
            <strong>{formatStableUkCompactDate(character.lastSeenAt)}</strong>
          </div>
        </div>

        <div className="profile-character-actions">
          {rioUrl ? <a className="btn btn-ghost btn-sm" href={rioUrl} target="_blank" rel="noreferrer">Raider.IO</a> : null}
          {canManage && !character.isMain ? (
            <form action="/api/profile/characters/main" method="post">
              <input type="hidden" name="characterKey" value={character.key} />
              {returnTo ? <input type="hidden" name="returnTo" value={returnTo} /> : null}
              <button className="btn btn-ghost btn-sm" type="submit">Зробити мейном</button>
            </form>
          ) : null}
          {canManage ? (
            <form action="/api/profile/characters/remove" method="post">
              <input type="hidden" name="characterKey" value={character.key} />
              {returnTo ? <input type="hidden" name="returnTo" value={returnTo} /> : null}
              <button className="btn btn-danger btn-sm" type="submit">Видалити</button>
            </form>
          ) : null}
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
