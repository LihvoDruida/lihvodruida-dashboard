"use client";

import { useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { DASHBOARD_BACKGROUND_REFRESH_MIN_MS, useDashboardApiResource } from "@/lib/dashboardBackgroundApi";
import { dateMillis, formatStableUkCompactDate, stableTextCompare } from "@/lib/stableUiText";
import type { DashboardProfile, ProfileCharacter } from "@/lib/profiles";
import { wowRoleLabel } from "@/lib/wowRoles";
import { wowClassColorByName } from "@/lib/wowClassCatalog";
import { characterEdition, WOW_EDITION_LABEL } from "@/lib/wowEdition";
import styles from "@/components/account/account.module.css";

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
  /** "rows" = compact management list (settings); default = full cards (profile). */
  variant?: "cards" | "rows";
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
    return <img src={image} alt="" loading="lazy" referrerPolicy="no-referrer" decoding="async" />;
  }
  return <span aria-hidden="true">{character.name.charAt(0)}</span>;
}

type CharacterIconKind = "external" | "trash" | "crown" | "mainStar";

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
  }
}

function CharacterRow({ character, profileId, canManage, showMainBadge, returnTo = "" }: { character: ProfileCharacter; profileId: string; canManage: boolean; showMainBadge: boolean; returnTo?: string }) {
  const isMain = showMainBadge && Boolean(character.isMain);
  const edition = characterEdition(character);
  const classColor = wowClassColorByName(character.className);
  const place = edition === "forever" ? "WoW Forever" : character.realmName || character.realmSlug;
  return (
    <li className={styles.charRow} data-main={isMain || undefined} data-character-profile-id={profileId}
      style={classColor ? { "--guild-class-color": classColor } as CSSProperties : undefined}>
      <span className={styles.charDot} aria-hidden="true">{character.name.charAt(0)}</span>
      <span className={styles.charRowCopy}>
        <strong>{character.name}</strong>
        <small>{[character.activeSpecName, character.className].filter(Boolean).join(" ") || "Клас невідомий"} · {place}{typeof character.itemLevel === "number" ? ` · ilvl ${character.itemLevel}` : ""}</small>
      </span>
      <span className={styles.charTags}>
        <span className={styles.tag} data-tone={edition}>{WOW_EDITION_LABEL[edition]}</span>
        {isMain ? <span className={styles.tag} data-tone="main">Мейн</span> : null}
      </span>
      {canManage ? <span className={styles.charActions}>
        {!character.isMain ? (
          <form action="/api/profile/characters/main" method="post">
            <input type="hidden" name="characterKey" value={character.key} />
            {returnTo ? <input type="hidden" name="returnTo" value={returnTo} /> : null}
            <button className={`btn subtle ${styles.iconButton}`} data-tone="primary" type="submit" title="Зробити мейном" aria-label={`Зробити мейном: ${character.name}`}><CharacterInlineIcon kind="crown" /></button>
          </form>
        ) : null}
        <form action="/api/profile/characters/remove" method="post">
          <input type="hidden" name="characterKey" value={character.key} />
          {returnTo ? <input type="hidden" name="returnTo" value={returnTo} /> : null}
          <button className={`btn subtle ${styles.iconButton}`} data-tone="danger" type="submit" title="Видалити з профілю" aria-label={`Видалити з профілю: ${character.name}`}><CharacterInlineIcon kind="trash" /></button>
        </form>
      </span> : null}
    </li>
  );
}

/** Full read-only card (profile page); management happens in CharacterRow on the settings page. */
function CharacterCard({ character, profileId, showMainBadge }: { character: ProfileCharacter; profileId: string; showMainBadge: boolean }) {
  const isMain = showMainBadge && Boolean(character.isMain);
  const edition = characterEdition(character);
  const forever = edition === "forever";
  const spec = [character.activeSpecName, character.className].filter(Boolean).join(" ") || "Клас невідомий";
  const rioScore = !forever && typeof character.raiderIo?.currentScore === "number" && character.raiderIo.currentScore > 0 ? Math.round(character.raiderIo.currentScore) : null;
  const rioUrl = forever ? null : character.raiderIo?.profileUrl || null;
  const armoryUrl = character.profileUrl && character.profileUrl !== "#" ? character.profileUrl : null;
  const place = forever ? "WoW Forever" : character.realmName || character.realmSlug || "Реалм невідомий";
  const guild = character.guildName ? `${character.guildName}${character.verifiedGuild && character.guildStatusLabel ? ` · ${character.guildStatusLabel}` : ""}` : "Без гільдії";
  const classColor = wowClassColorByName(character.className);
  return (
    <article className={styles.char} data-main={isMain || undefined} data-edition={edition} data-character-profile-id={profileId}
      style={classColor ? { "--guild-class-color": classColor } as CSSProperties : undefined}
      aria-label={`${isMain ? "Основний персонаж" : "Персонаж"}: ${character.name}, ${WOW_EDITION_LABEL[edition]}`}>
      <div className={styles.charHead}>
        <span className={styles.charArt}><CharacterArtwork character={character} /></span>
        <div className={styles.charCopy}>
          <h3 className={styles.charName}><span>{character.name}</span></h3>
          <div className={styles.charTags}>
            <span className={styles.tag} data-tone={edition}>{WOW_EDITION_LABEL[edition]}</span>
            {isMain ? <span className={styles.tag} data-tone="main"><CharacterInlineIcon kind="mainStar" />Мейн</span> : null}
            {character.verifiedGuild ? <span className={styles.tag} data-tone="guild">Гільдія</span> : null}
          </div>
          <p className={styles.charMeta}>{[character.raceName, spec, wowRoleLabel(character.activeSpecRole)].filter(Boolean).join(" · ")}</p>
          <p className={styles.charMeta}>{[place, guild, character.faction].filter(Boolean).join(" · ")}</p>
        </div>
      </div>
      <dl className={styles.charStats} aria-label="Ключові показники персонажа">
        <div><dt>ilvl</dt><dd>{typeof character.itemLevel === "number" ? character.itemLevel : "—"}</dd></div>
        <div><dt>{forever ? "Рейтинг" : "Raider.IO"}</dt><dd>{forever ? "—" : rioScore ?? "—"}</dd></div>
        <div><dt>Рівень</dt><dd>{typeof character.level === "number" ? character.level : "—"}</dd></div>
        <div><dt>Оновлено</dt><dd>{formatStableUkCompactDate(character.lastSeenAt)}</dd></div>
      </dl>
      <div className={styles.charFooter}>
        <div className={styles.charLinks}>
          {armoryUrl ? <a className={`btn subtle ${styles.linkButton}`} href={armoryUrl} target="_blank" rel="noreferrer">{forever ? "Armory Forever" : "Armory"}<CharacterInlineIcon kind="external" /></a> : null}
          {rioUrl ? <a className={`btn subtle ${styles.linkButton}`} href={rioUrl} target="_blank" rel="noreferrer">Raider.IO<CharacterInlineIcon kind="external" /></a> : null}
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
  variant = "cards",
}: Props) {
  const [characters, setCharacters] = useState(() => visibleCharacters(initialCharacters));
  const [updatedAt, setUpdatedAt] = useState<string | null>(initialUpdatedAt || null);
  const refreshMinMsRef = useRef(Math.max(DEFAULT_REFRESH_MIN_MS, refreshMinMs));

  const resource = useDashboardApiResource<ProfileRefreshPayload | null>({
    key: `profile:${profileId}:external-data`,
    scope: ["profile", "profiles", "guild", "raids"],
    initialData: null,
    minIntervalMs: refreshMinMsRef.current,
    refreshOnMount: false,
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
  const foreverCount = useMemo(() => characters.filter((item) => characterEdition(item) === "forever").length, [characters]);
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
      <p className={styles.charSummary} aria-label="Стан персонажів">
        <span><strong>{guildCount}</strong> у гільдії</span>
        <span><strong>{otherCount}</strong> інших</span>
        {foreverCount ? <span><strong>{foreverCount}</strong> Forever</span> : null}
        <span data-profile-candidate-summary="true"><strong data-profile-candidate-count="true">{candidateCount}</strong> можна додати</span>
        <span>оновлено <strong>{formatStableUkCompactDate(effectiveUpdatedAt)}</strong></span>
      </p>

      <span className="sr-only" role="status" aria-live="polite" data-profile-refresh-state={state}>{statusLabel}</span>

      {characters.length ? variant === "rows" ? (
        <ul className={styles.charRows}>
          {characters.map((character) => <CharacterRow key={character.key} character={character} profileId={profileId} canManage={canManage} showMainBadge={showMainBadge} returnTo={returnTo} />)}
        </ul>
      ) : (
        <div className={styles.charList}>
          {characters.map((character) => (
            <CharacterCard key={character.key} character={character} profileId={profileId} showMainBadge={showMainBadge} />
          ))}
        </div>
      ) : (
        <div className={styles.empty}>
          <strong>Персонажів ще немає</strong>
          <span>{emptyMessage}</span>
        </div>
      )}
    </>
  );
}
