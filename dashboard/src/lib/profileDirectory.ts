import "server-only";

import { createHash } from "node:crypto";
import type { DashboardSession } from "@/lib/auth";
import { listAccessGroups } from "@/lib/accessGroups";
import type { AccessGroup } from "@/lib/accessGroupSchema";
import { documentStoreMode, getFirebaseAdminDb } from "@/lib/firebaseAdmin";
import { pgQuery } from "@/lib/db/pgPool";
import { FieldPath } from "@/lib/db/firestoreCompat";
import { canViewAllProfiles, canViewProfilesInOwnGroupOrBelow, dashboardRoleRank } from "@/lib/permissions";
import {
  applyCurrentProfileGroup, canViewProfile, getProfileSiteName,
  hydrateProfilesFromCanonicalCharacterData, normalizeProfile,
  type DashboardProfile,
} from "@/lib/profiles";

export const PROFILE_DIRECTORY_PAGE_SIZE = 20;
export type ProfileLinkFilter = "all" | "linked" | "unlinked";
export type ProfileRoleFilter = "all" | "admin" | "moderator" | "mentor" | "member";
export type ProfileDirectorySort = "activity" | "name" | "characters";
type Key = { count: number; activity: number; name: string; id: string };
type Cursor = { v: 1; scope: string; direction: "after" | "before"; key: Key };
export type ProfileDirectoryPage = {
  profiles: DashboardProfile[];
  total: number;
  characterCount: number;
  linkedCount: number;
  start: number;
  end: number;
  previousCursor: string | null;
  nextCursor: string | null;
  cursorReset: boolean;
  unavailable: boolean;
};
export type ProfileDirectoryParams = {
  viewer: DashboardSession;
  query?: string;
  link?: string;
  role?: string;
  sort?: string;
  cursor?: string;
};

export function profileDirectoryFilters(params: Pick<ProfileDirectoryParams, "query" | "link" | "role" | "sort">) {
  return {
    query: String(params.query || "").normalize("NFC").replace(/[\u0000-\u001f\u007f]/g, " ").trim().slice(0, 120),
    link: (["linked", "unlinked"].includes(params.link || "") ? params.link : "all") as ProfileLinkFilter,
    role: (["admin", "moderator", "mentor", "member"].includes(params.role || "") ? params.role : "all") as ProfileRoleFilter,
    sort: (["name", "characters"].includes(params.sort || "") ? params.sort : "activity") as ProfileDirectorySort,
  };
}

function decodeCursor(value: string | undefined, scope: string): Cursor | null {
  if (!value || value.length > 1800 || !/^[\w-]+$/.test(value)) return null;
  try {
    const cursor = JSON.parse(Buffer.from(value, "base64url").toString("utf8")) as Cursor;
    const k = cursor.key;
    if (cursor.v !== 1 || cursor.scope !== scope || !["after", "before"].includes(cursor.direction)
      || !k || !Number.isSafeInteger(k.count) || k.count < 0 || !Number.isFinite(k.activity)
      || Math.abs(k.activity) > 8.64e15 || typeof k.name !== "string" || k.name.length > 128
      || typeof k.id !== "string" || !k.id || k.id.length > 256 || /[\u0000-\u001f]/.test(k.id + k.name)) return null;
    return cursor;
  } catch { return null; }
}

function encodeCursor(scope: string, direction: Cursor["direction"], key: Key) {
  return Buffer.from(JSON.stringify({ v: 1, scope, direction, key })).toString("base64url");
}

// Stable Unicode folding even on databases initialized with LC_CTYPE=C.
const foldSql = (value: string, collation?: string) => `translate(lower(normalize(${value}, NFC)${collation ? ` COLLATE ${collation}` : ""}), 'АБВГҐДЕЄЖЗИІЇЙКЛМНОПРСТУФХЦЧШЩЬЮЯЁЪЫЭ', 'абвгґдеєжзиіїйклмнопрстуфхцчшщьюяёъыэ')`;
const cleanTextSql = (value: string, max: number) => `left(btrim(regexp_replace(regexp_replace(normalize(coalesce(${value}, ''), NFC), '[[:cntrl:]]', ' ', 'g'), '[[:space:]]+', ' ', 'g')), ${max})`;
const cleanNameSql = (value: string) => `btrim(left(btrim(regexp_replace(translate(${cleanTextSql(value, 10000)}, $remove$<>@#\`*_~|{}[]\\$remove$, ''), '[[:space:]]+', ' ', 'g'), $trim$ .,;:!?'"ʼ’-$trim$), 32))`;
const lookupSql = (value: string, max: number, collation: string) => `regexp_replace(translate(${foldSql(cleanTextSql(value, max), collation)}, 'ʼ’', $$''$$), '[[:space:]]+', '-', 'g')`;
const digestSql = (value: string) => `encode(sha256(convert_to(${value}, 'UTF8')), 'hex')`;
const keySegmentSql = (value: string, prefix: string) => `CASE WHEN ${value} ~ '^[ur]_[a-f0-9]{12,64}$' THEN ${value} WHEN ${value} ~ '^[a-z0-9-]+$' THEN left(${value}, 120) ELSE '${prefix}_' || left(${digestSql(value)}, 24) END`;

let collationPromise: Promise<string> | undefined;
async function nameCollation() {
  // Official PostgreSQL builds include ICU. A deterministic fallback keeps
  // existing minimal installations working without a schema migration.
  collationPromise ||= pgQuery<{ available: boolean }>("SELECT EXISTS (SELECT 1 FROM pg_collation WHERE collname = 'uk-x-icu') AS available")
    .then(result => result.rows[0]?.available ? '"uk-x-icu"' : '"C"')
    .catch(error => { collationPromise = undefined; throw error; });
  return collationPromise;
}

function rank(value: unknown, role: DashboardSession["role"]) {
  return Number.isFinite(Number(value)) ? Math.floor(Number(value)) : dashboardRoleRank(role);
}

// One statement gives the page and aggregates the same MVCC snapshot. Only
// 20 full documents leave PostgreSQL; permissions precede search and LIMIT.
async function readPostgres(params: ProfileDirectoryParams, groups: AccessGroup[], filters: ReturnType<typeof profileDirectoryFilters>, scope: string, cursor: Cursor | null, collation: string) {
  const viewer = params.viewer;
  const values: unknown[] = [];
  const bind = (value: unknown) => { values.push(value); return "$" + values.length; };
  const groupParam = bind(JSON.stringify(groups.map(g => ({ id: g.id, role: g.role, rank: g.rank }))));
  const visibility = canViewAllProfiles(viewer) ? "TRUE" : `(doc_id = ${bind(viewer.profileId || "")} OR (provider = ${bind(viewer.provider)} AND provider_user_id = ${bind(viewer.id)})${canViewProfilesInOwnGroupOrBelow(viewer) ? ` OR effective_rank <= ${bind(rank(viewer.groupRank, viewer.role))}` : ""})`;
  const roleFilter = filters.role === "all" ? "TRUE" : `effective_role = ${bind(filters.role)}`;
  const linkFilter = filters.link === "all" ? "TRUE" : filters.link === "linked" ? "linked" : "NOT linked";
  const q = bind(filters.query.toLocaleLowerCase("uk"));
  const name = `${foldSql("site_name", collation)} COLLATE ${collation}`;
  const tuple = filters.sort === "name" ? `(${name}, doc_id COLLATE "C")`
    : filters.sort === "characters" ? `(-character_count, -activity, doc_id COLLATE "C")` : `(-activity, doc_id COLLATE "C")`;
  const order = filters.sort === "name" ? `${name}, doc_id COLLATE "C"`
    : filters.sort === "characters" ? "character_count DESC, activity DESC, doc_id COLLATE \"C\"" : "activity DESC, doc_id COLLATE \"C\"";
  const reverseOrder = filters.sort === "name" ? `${name} DESC, doc_id COLLATE "C" DESC`
    : filters.sort === "characters" ? "character_count, activity, doc_id COLLATE \"C\" DESC" : "activity, doc_id COLLATE \"C\" DESC";
  let boundary = "TRUE";
  if (cursor) {
    const k = cursor.key;
    const anchor = filters.sort === "name" ? `(${bind(k.name)}::text COLLATE ${collation}, ${bind(k.id)}::text COLLATE "C")`
      : filters.sort === "characters" ? `(${bind(-k.count)}::bigint, ${bind(-k.activity)}::numeric, ${bind(k.id)}::text COLLATE "C")`
        : `(${bind(-k.activity)}::numeric, ${bind(k.id)}::text COLLATE "C")`;
    boundary = `${tuple} ${cursor.direction === "before" ? "<" : ">"} ${anchor}`;
  }
  const rawKeys = `regexp_split_to_array(${foldSql(cleanTextSql("c->>'key'", 260), collation)}, ':')`;
  const characterKey = `region_part || ':' || ${keySegmentSql("realm_part", "r")} || ':' || ${keySegmentSql("name_part", "u")}`;
  const canonicalJoin = filters.query ? `LEFT JOIN documents guild ON guild.collection = 'guildCharacterData' AND guild.doc_id = ${digestSql("key")}
    AND coalesce(guild.data->>'key', '') <> '' AND coalesce(guild.data->>'name', '') <> '' AND coalesce(guild.data->>'realmSlug', '') <> ''
    LEFT JOIN documents external ON external.collection = 'externalCharacterData' AND external.doc_id = ${digestSql("key")}
    AND guild.doc_id IS NULL AND coalesce(external.data->>'key', '') <> '' AND coalesce(external.data->>'name', '') <> '' AND coalesce(external.data->>'realmSlug', '') <> ''` : "";
  const characterSearch = filters.query ? `string_agg(left(coalesce(nullif(guild.data->>'name', ''), nullif(external.data->>'name', ''), c->>'name'), 80), ' ') AS names,
    string_agg(coalesce(nullif(guild.data->>'realmName', ''), nullif(external.data->>'realmName', ''), nullif(c->>'realmName', ''), c->>'realmSlug'), ' ') AS realms` : "''::text AS names, ''::text AS realms";
  const sql = `WITH raw AS (
    SELECT doc_id, data,
      CASE WHEN data->>'role' IN ('admin','moderator','mentor','member') THEN data->>'role' ELSE 'member' END AS role,
      CASE WHEN data->>'provider' IN ('github','token') THEN data->>'provider' ELSE 'discord' END AS provider,
      coalesce(data->>'providerUserId', '') AS provider_user_id,
      left(regexp_replace(coalesce(data->>'groupId', ''), '[^a-zA-Z0-9_-]', '', 'g'), 32) AS group_id
    FROM documents WHERE collection = 'dashboardProfiles'
  ), resolved AS (
    SELECT raw.*, coalesce(g->>'role', role) AS effective_role,
      CASE WHEN g IS NOT NULL THEN (g->>'rank')::numeric
        WHEN NOT data ? 'groupRank' THEN CASE role WHEN 'admin' THEN 100 WHEN 'moderator' THEN 50 WHEN 'mentor' THEN 20 ELSE 10 END
        WHEN data->>'groupRank' IS NULL THEN 0
        WHEN data->'groupRank' = 'false'::jsonb THEN 0
        WHEN data->'groupRank' = 'true'::jsonb THEN 1
        WHEN btrim(data->>'groupRank') = '' THEN 0
        WHEN lower(data->>'groupRank') NOT IN ('nan', 'infinity', '-infinity') AND pg_input_is_valid(data->>'groupRank', 'numeric') THEN floor((data->>'groupRank')::numeric)
        ELSE CASE role WHEN 'admin' THEN 100 WHEN 'moderator' THEN 50 WHEN 'mentor' THEN 20 ELSE 10 END END AS effective_rank,
      coalesce(data#>'{battlenet,linked}', 'null'::jsonb) NOT IN ('null'::jsonb, 'false'::jsonb, '0'::jsonb, '\"\"'::jsonb) AS linked
    FROM raw LEFT JOIN LATERAL (
      SELECT value AS g FROM jsonb_array_elements(${groupParam}::jsonb) WITH ORDINALITY
      WHERE value->>'id' = group_id OR value->>'role' = role
      ORDER BY (value->>'id' = group_id) DESC, ordinality LIMIT 1
    ) groups ON TRUE
  ), authorized AS MATERIALIZED (
    SELECT * FROM resolved WHERE ${visibility} AND ${roleFilter} AND ${linkFilter}
  ), searchable AS (
    SELECT doc_id, linked, effective_role, chars.character_count,
      coalesce(nullif(${cleanNameSql("data->>'preferredName'")}, ''), nullif(${cleanNameSql("coalesce(nullif(data->>'displayName', ''), data->>'login', 'Guild member')")}, ''), 'Учасник') AS site_name,
      CASE WHEN lower(coalesce(nullif(data->>'lastLoginAt', ''), nullif(data->>'updatedAt', ''), data->>'createdAt')) NOT IN ('infinity', '-infinity') AND pg_input_is_valid(coalesce(nullif(data->>'lastLoginAt', ''), nullif(data->>'updatedAt', ''), data->>'createdAt'), 'timestamp with time zone')
        THEN floor(extract(epoch FROM coalesce(nullif(data->>'lastLoginAt', ''), nullif(data->>'updatedAt', ''), data->>'createdAt')::timestamptz) * 1000) ELSE 0 END AS activity,
      ${filters.query ? `concat_ws(' ', data->>'displayName', data->>'preferredName', data->>'login', effective_role, provider, provider_user_id, chars.names, chars.realms)` : "''::text"} AS search_text
    FROM authorized LEFT JOIN LATERAL (
      WITH candidates AS MATERIALIZED (
        SELECT c, ord, ARRAY(SELECT btrim(part) FROM unnest(${rawKeys}) part WHERE btrim(part) <> '') AS parts
        FROM jsonb_array_elements(CASE WHEN jsonb_typeof(data->'characters') = 'array' THEN data->'characters' ELSE '[]'::jsonb END) WITH ORDINALITY AS list(c, ord)
        WHERE jsonb_typeof(c) = 'object' AND jsonb_typeof(c->'name') = 'string' AND btrim(c->>'name') <> '' AND jsonb_typeof(c->'realmSlug') = 'string' AND btrim(c->>'realmSlug') <> ''
      ), segments AS MATERIALIZED (
        SELECT CASE WHEN left(parts[1], 12) ~ '^[a-z]{2}$' THEN parts[1] ELSE 'eu' END AS region_part,
          ${lookupSql("parts[2]", 160, collation)} AS realm_part, ${lookupSql("parts[3]", 160, collation)} AS name_part, c, ord
        FROM candidates WHERE cardinality(parts) >= 3
      ), unique_chars AS (
        SELECT DISTINCT ON (key) key, c, ord FROM (SELECT ${characterKey} AS key, c, ord FROM segments) keys ORDER BY key, ord
      ) SELECT count(*)::integer AS character_count, ${characterSearch}
        FROM unique_chars ${canonicalJoin}
    ) chars ON TRUE
  ), filtered AS MATERIALIZED (
    SELECT * FROM searchable WHERE ${q} = '' OR position(${q} IN ${foldSql("search_text", collation)}) > 0 OR position(${q} IN ${foldSql("site_name", collation)}) > 0
  ), selected AS (
    SELECT * FROM filtered WHERE ${boundary} ORDER BY ${cursor?.direction === "before" ? reverseOrder : order} LIMIT ${PROFILE_DIRECTORY_PAGE_SIZE}
  ), page AS (
    SELECT selected.*, documents.data FROM selected JOIN documents ON collection = 'dashboardProfiles' AND documents.doc_id = selected.doc_id
  ) SELECT (SELECT count(*) FROM filtered)::integer AS total,
    (SELECT coalesce(sum(character_count), 0) FROM filtered)::bigint AS character_count,
    (SELECT count(*) FROM filtered WHERE linked)::integer AS linked_count,
    (SELECT count(*) FROM filtered WHERE ${tuple} < (SELECT ${tuple.slice(1, -1)} FROM selected ORDER BY ${order} LIMIT 1))::integer AS before_count,
    coalesce((SELECT jsonb_agg(to_jsonb(page) ORDER BY ${order}) FROM page), '[]'::jsonb) AS rows`;
  const result = await pgQuery<{ total: number; character_count: string; linked_count: number; before_count: number; rows: { doc_id: string; data: Record<string, unknown>; character_count: number; activity: number; site_name: string }[] }>(sql, values);
  const row = result.rows[0];
  const profiles = await hydrateProfilesFromCanonicalCharacterData(row.rows.map(r => applyCurrentProfileGroup(normalizeProfile(r.doc_id, r.data), groups)));
  const keys = row.rows.map(r => ({ id: r.doc_id, count: r.character_count, activity: Number(r.activity), name: r.site_name.toLocaleLowerCase("uk") }));
  return finishPage(profiles, keys, row.total, Number(row.character_count), row.linked_count, row.before_count, scope, Boolean(params.cursor && !cursor));
}

function finishPage(profiles: DashboardProfile[], keys: Key[], total: number, characterCount: number, linkedCount: number, before: number, scope: string, cursorReset: boolean): ProfileDirectoryPage {
  return {
    profiles, total, characterCount, linkedCount, start: profiles.length ? before + 1 : 0, end: profiles.length ? before + profiles.length : 0,
    previousCursor: keys.length && before > 0 ? encodeCursor(scope, "before", keys[0]) : null,
    nextCursor: keys.length && before + profiles.length < total ? encodeCursor(scope, "after", keys[keys.length - 1]) : null,
    cursorReset, unavailable: false,
  };
}

async function readFirestore(params: ProfileDirectoryParams, groups: AccessGroup[], filters: ReturnType<typeof profileDirectoryFilters>, scope: string, cursor: Cursor | null) {
  const collator = new Intl.Collator("uk", { sensitivity: "base" });
  const compare = (a: Key, b: Key) => (filters.sort === "name" ? collator.compare(a.name, b.name)
    : filters.sort === "characters" ? b.count - a.count || b.activity - a.activity : b.activity - a.activity) || Buffer.compare(Buffer.from(a.id), Buffer.from(b.id));
  let candidates: { profile: DashboardProfile; key: Key }[] = [];
  let total = 0, characterCount = 0, linkedCount = 0, eligibleCount = 0;
  let after = "";
  const db = getFirebaseAdminDb();
  const q = filters.query.toLocaleLowerCase("uk");
  // Migration compatibility: complete scan in bounded batches, bounded page
  // memory, no truncation/cache pretending to be the full search result.
  for (;;) {
    let request = db.collection("dashboardProfiles").orderBy(FieldPath.documentId()).limit(100);
    if (after) request = request.startAfter(after);
    const snapshot = await request.get();
    if (!snapshot.docs.length) break;
    const permitted = snapshot.docs.map(doc => applyCurrentProfileGroup(normalizeProfile(doc.id, doc.data() || {}), groups))
      .filter(profile => canViewProfile(params.viewer, profile.profileId, profile));
    const profiles = await hydrateProfilesFromCanonicalCharacterData(permitted);
    for (const profile of profiles) {
      if (filters.role !== "all" && profile.role !== filters.role) continue;
      if (filters.link === "linked" && !profile.battlenet?.linked || filters.link === "unlinked" && profile.battlenet?.linked) continue;
      const text = [profile.displayName, profile.preferredName, profile.login, profile.role, profile.provider, profile.providerUserId, getProfileSiteName(profile),
        profile.characters.map(c => c.name).join(" "), profile.characters.map(c => c.realmName || c.realmSlug).join(" ")].join(" ").normalize("NFC").toLocaleLowerCase("uk");
      if (q && !text.includes(q)) continue;
      total++; characterCount += profile.characters.length; if (profile.battlenet?.linked) linkedCount++;
      const key = { id: profile.profileId, count: profile.characters.length, activity: Date.parse(profile.lastLoginAt || profile.updatedAt || profile.createdAt || "") || 0, name: getProfileSiteName(profile).toLocaleLowerCase("uk") };
      if (cursor && (cursor.direction === "before" ? compare(key, cursor.key) >= 0 : compare(key, cursor.key) <= 0)) continue;
      eligibleCount++;
      candidates.push({ profile, key });
    }
    candidates.sort((a, b) => compare(a.key, b.key) * (cursor?.direction === "before" ? -1 : 1));
    candidates = candidates.slice(0, PROFILE_DIRECTORY_PAGE_SIZE);
    after = snapshot.docs[snapshot.docs.length - 1].id;
  }
  candidates.sort((a, b) => compare(a.key, b.key));
  const before = cursor?.direction === "before" ? eligibleCount - candidates.length : total - eligibleCount;
  return finishPage(candidates.map(c => c.profile), candidates.map(c => c.key), total, characterCount, linkedCount, before, scope, Boolean(params.cursor && !cursor));
}

export async function listDashboardProfilePage(params: ProfileDirectoryParams): Promise<ProfileDirectoryPage> {
  const mode = documentStoreMode();
  if (mode === "unconfigured") return { ...finishPage([], [], 0, 0, 0, 0, "", false), unavailable: true };
  const filters = profileDirectoryFilters(params);
  // Do not fall back to stale stored groups on a catalog permission failure.
  const groups = await listAccessGroups();
  const collation = mode === "postgres" ? await nameCollation() : "uk";
  const scope = createHash("sha256").update(JSON.stringify([mode, collation, filters, params.viewer.profileId, params.viewer.id, params.viewer.provider,
    params.viewer.role, params.viewer.groupRank, params.viewer.groupId, params.viewer.permissions, params.viewer.isServerOwner,
    groups.map(g => [g.id, g.role, g.rank])])).digest("hex");
  const cursor = decodeCursor(params.cursor, scope);
  const page = await (mode === "postgres" ? readPostgres(params, groups, filters, scope, cursor, collation) : readFirestore(params, groups, filters, scope, cursor));
  // A deleted last row or changed sort key can leave a valid URL empty. Return
  // the first live page with an explicit notice, not a false "not found".
  if (cursor && !page.profiles.length && page.total) return { ...await (mode === "postgres" ? readPostgres(params, groups, filters, scope, null, collation) : readFirestore(params, groups, filters, scope, null)), cursorReset: true };
  return page;
}
