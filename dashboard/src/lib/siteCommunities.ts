import "server-only";

import { getDocumentDb, hasDocumentDbConfig } from "@/lib/documentDb";
import { FieldValue } from "@/lib/db/documentValues";
import { timestampToIso } from "@/lib/values";
import { DEFAULT_SITE_COMMUNITIES, SITE_COMMUNITIES_SCHEMA, normalizeCommunities, CommunityValidationError, type SiteCommunity } from "@/lib/siteCommunityModel";

/** Own collection so the site's content sync revision covers it (lib/siteSync.ts). */
export const SITE_COMMUNITIES_COLLECTION = "siteCommunities";
const DOC_ID = "catalog";

export type SiteCommunitiesState = { items: SiteCommunity[]; revision: number; updatedAt: string | null; updatedBy: string | null; customized: boolean };

export class SiteCommunitiesConflictError extends Error {
  constructor() { super("Спільноти вже змінено в іншій вкладці. Онови сторінку й повтори зміни."); }
}

function stateOf(data: Record<string, unknown> | undefined | null): SiteCommunitiesState {
  const revision = Number(data?.revision);
  let items = DEFAULT_SITE_COMMUNITIES;
  let customized = false;
  if (Array.isArray(data?.items)) {
    try { items = normalizeCommunities(data.items); customized = true; } catch { /* corrupt row: keep defaults */ }
  }
  return {
    items,
    revision: Number.isSafeInteger(revision) && revision >= 0 ? revision : 0,
    updatedAt: timestampToIso(data?.updatedAt) || null,
    updatedBy: typeof data?.updatedBy === "string" ? data.updatedBy : null,
    customized,
  };
}

/** Current block; before the first save it is the site's previous static content. */
export async function getSiteCommunities(): Promise<SiteCommunitiesState> {
  if (!hasDocumentDbConfig()) throw new Error("Сховище не налаштоване.");
  const snapshot = await getDocumentDb().collection(SITE_COMMUNITIES_COLLECTION).doc(DOC_ID).get();
  return stateOf(snapshot.exists ? snapshot.data() : null);
}

/** Saves the whole block if `expectedRevision` is still current. */
export async function saveSiteCommunities(input: unknown, expectedRevision: number, updatedBy: string): Promise<SiteCommunitiesState> {
  if (!hasDocumentDbConfig()) throw new Error("Сховище не налаштоване.");
  const items = normalizeCommunities(input);
  const ref = getDocumentDb().collection(SITE_COMMUNITIES_COLLECTION).doc(DOC_ID);
  return getDocumentDb().runTransaction(async (tx: any) => {
    const current = stateOf((await tx.get(ref)).data());
    if (current.revision !== expectedRevision) throw new SiteCommunitiesConflictError();
    const revision = current.revision + 1;
    tx.set(ref, { items, revision, updatedAt: FieldValue.serverTimestamp(), updatedBy: updatedBy.slice(0, 120) });
    return { items, revision, updatedAt: new Date().toISOString(), updatedBy, customized: true };
  });
}

/** Public payload for the site bridge. */
export async function publicSiteCommunities() {
  const state = await getSiteCommunities();
  return { schema: SITE_COMMUNITIES_SCHEMA, revision: state.revision, updated_at: state.updatedAt, items: state.items };
}

export { CommunityValidationError };
