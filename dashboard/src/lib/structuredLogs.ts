import "server-only";

import { createHash, randomUUID } from "crypto";
import { hasPostgresConfig, pgQuery } from "@/lib/db/pgPool";
import { getStructuredLogSettings } from "@/lib/logSettings";
import { mirrorSecurityLogToDiscord } from "@/lib/securityLogDiscord";

export type StructuredLogLevel = "debug" | "info" | "success" | "warning" | "error";
export type StructuredLogCategory = "security" | "api" | "action" | "auth" | "discord" | "database" | "integration" | "system";
export type StructuredLogSource = "dashboard" | "bot" | "cron" | "system";

export type StructuredLogRecord = {
  id: string;
  createdAt: string;
  level: StructuredLogLevel;
  category: StructuredLogCategory;
  source: StructuredLogSource;
  event: string;
  message: string | null;
  actorId: string | null;
  actorName: string | null;
  actorGroupId: string | null;
  requestId: string | null;
  method: string | null;
  path: string | null;
  statusCode: number | null;
  durationMs: number | null;
  ip: string | null;
  resourceType: string | null;
  resourceId: string | null;
  details: Record<string, unknown>;
};

export type StructuredLogInput = Partial<Omit<StructuredLogRecord, "id" | "createdAt">> & {
  id?: string;
  createdAt?: string;
  event: string;
  level?: StructuredLogLevel | "warn";
  category?: StructuredLogCategory;
  source?: StructuredLogSource;
  details?: Record<string, unknown>;
};

const CATEGORY_VALUES = new Set<StructuredLogCategory>(["security", "api", "action", "auth", "discord", "database", "integration", "system"]);
const LEVEL_VALUES = new Set<StructuredLogLevel>(["debug", "info", "success", "warning", "error"]);

function cleanText(value: unknown, max = 500) {
  const text = String(value ?? "").trim();
  return text ? text.slice(0, max) : null;
}

function cleanInt(value: unknown, min = 0, max = Number.MAX_SAFE_INTEGER) {
  const n = Number(value);
  return Number.isFinite(n) ? Math.max(min, Math.min(max, Math.floor(n))) : null;
}

export function normalizeStructuredLogLevel(value: unknown): StructuredLogLevel {
  const text = String(value ?? "").toLowerCase();
  if (text === "warn") return "warning";
  return LEVEL_VALUES.has(text as StructuredLogLevel) ? text as StructuredLogLevel : "info";
}

export function inferStructuredLogCategory(eventInput: unknown, details: Record<string, unknown> = {}): StructuredLogCategory {
  const event = String(eventInput ?? "").toLowerCase();
  const explicit = String(details.category || "").toLowerCase();
  if (CATEGORY_VALUES.has(explicit as StructuredLogCategory)) return explicit as StructuredLogCategory;

  if (/security|forbidden|blocked|reject|signature|csrf|origin|rate.?limit|cloudflare|unauthori|ban(?:ned)?|permission_denied/.test(event)) return "security";
  if (/^auth\.|oauth|session|login|logout/.test(event)) return "auth";
  if (/^discord\.|discord_|\.discord|roster\.discord|raid_polls\.discord/.test(event)) return "discord";
  if (/postgres|database|\bdb\b|storage|firestore|document_store|pg\./.test(event)) return "database";
  if (/raiderio|battle.?net|github|recruitment|external/.test(event)) return "integration";
  if (details.method || details.path || /^api\.|\.api\.|request/.test(event)) return "api";
  return "system";
}

function redact(value: unknown, depth = 0): unknown {
  if (value === null || value === undefined) return value;
  if (depth > 4) return "[max-depth]";
  if (typeof value === "string") {
    return value
      .replace(/ghp_[A-Za-z0-9_]+/g, "[redacted]")
      .replace(/github_pat_[A-Za-z0-9_]+/g, "[redacted]")
      .replace(/Bot\s+[A-Za-z0-9._-]+/g, "Bot [redacted]")
      .replace(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g, "[email]")
      .replace(/-----BEGIN [^-]+-----[\s\S]*?-----END [^-]+-----/g, "[redacted-private-key]")
      .slice(0, depth === 0 ? 1500 : 700);
  }
  if (typeof value === "number" || typeof value === "boolean") return value;
  if (value instanceof Date) return value.toISOString();
  if (Array.isArray(value)) return value.slice(0, 24).map((item) => redact(item, depth + 1));
  if (typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [key, child] of Object.entries(value as Record<string, unknown>).slice(0, 48)) {
      if (/token|secret|password|authorization|cookie|signature|private.?key|raw.?body|html|stack/i.test(key)) {
        out[key] = "[redacted]";
      } else {
        out[key] = redact(child, depth + 1);
      }
    }
    return out;
  }
  return String(value).slice(0, 500);
}

function normalizedDetails(value: Record<string, unknown> | undefined) {
  const result = redact(value || {}) as Record<string, unknown>;
  return result && typeof result === "object" && !Array.isArray(result) ? result : {};
}

function fingerprint(input: StructuredLogInput, category: StructuredLogCategory, level: StructuredLogLevel) {
  const stable = JSON.stringify({
    category,
    level,
    event: input.event,
    actorId: input.actorId || null,
    method: input.method || null,
    path: input.path || null,
    resourceType: input.resourceType || null,
    resourceId: input.resourceId || null,
    message: input.message || null,
  });
  return createHash("sha256").update(stable).digest("hex");
}

function toRecord(input: StructuredLogInput): StructuredLogRecord & { fingerprint: string } {
  const details = normalizedDetails(input.details);
  const level = normalizeStructuredLogLevel(input.level);
  const category = input.category || inferStructuredLogCategory(input.event, {
    ...details,
    method: input.method,
    path: input.path,
  });
  const created = input.createdAt ? new Date(input.createdAt) : new Date();
  const createdAt = Number.isFinite(created.getTime()) ? created.toISOString() : new Date().toISOString();
  return {
    id: cleanText(input.id, 120) || randomUUID(),
    createdAt,
    level,
    category,
    source: input.source || "dashboard",
    event: cleanText(input.event, 180) || "system.event",
    message: cleanText(input.message, 1500),
    actorId: cleanText(input.actorId, 120),
    actorName: cleanText(input.actorName, 160),
    actorGroupId: cleanText(input.actorGroupId, 120),
    requestId: cleanText(input.requestId, 120),
    method: cleanText(input.method, 12)?.toUpperCase() || null,
    path: cleanText(input.path, 500),
    statusCode: cleanInt(input.statusCode, 100, 599),
    durationMs: cleanInt(input.durationMs, 0, 24 * 60 * 60_000),
    ip: cleanText(input.ip, 80),
    resourceType: cleanText(input.resourceType, 100),
    resourceId: cleanText(input.resourceId, 160),
    details,
    fingerprint: fingerprint(input, category, level),
  };
}

export async function recordStructuredLog(input: StructuredLogInput): Promise<boolean> {
  if (!hasPostgresConfig()) return false;
  const log = toRecord(input);
  try {
    await pgQuery(
      `INSERT INTO system_logs (
        id, created_at, level, category, source, event, message,
        actor_id, actor_name, actor_group_id, request_id, method, path,
        status_code, duration_ms, ip, resource_type, resource_id, fingerprint, details
      ) VALUES (
        $1, $2::timestamptz, $3, $4, $5, $6, $7,
        $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20::jsonb
      )`,
      [
        log.id, log.createdAt, log.level, log.category, log.source, log.event, log.message,
        log.actorId, log.actorName, log.actorGroupId, log.requestId, log.method, log.path,
        log.statusCode, log.durationMs, log.ip, log.resourceType, log.resourceId, log.fingerprint,
        JSON.stringify(log.details),
      ],
    );

    if (log.category === "security") {
      // Security is the only category allowed to leave the VPS.  Await the
      // mirror inside this background logging task so Node does not abandon
      // the Discord request between the PostgreSQL insert and promise cleanup.
      await mirrorSecurityLogToDiscord(log).catch((error) => {
        console.warn("[structured-logs] security mirror error", error instanceof Error ? error.message : String(error));
        return false;
      });
    }
    return true;
  } catch (error) {
    console.error("[structured-logs] write failed", error instanceof Error ? error.message : String(error));
    return false;
  }
}

export type StructuredLogQuery = {
  limit?: number;
  category?: string | null;
  level?: string | null;
  search?: string | null;
  sinceHours?: number;
  before?: string | null;
};

export async function listStructuredLogs(query: StructuredLogQuery = {}): Promise<StructuredLogRecord[]> {
  if (!hasPostgresConfig()) return [];
  const settings = await getStructuredLogSettings();
  const limit = Math.max(20, Math.min(settings.queryLimit, Math.floor(Number(query.limit) || 100)));
  const sinceHours = Math.max(1, Math.min(72, Math.floor(Number(query.sinceHours) || 24)));
  const params: unknown[] = [sinceHours];
  const where = [`created_at >= now() - ($1::text || ' hours')::interval`];

  const category = String(query.category || "").trim().toLowerCase();
  if (CATEGORY_VALUES.has(category as StructuredLogCategory)) {
    params.push(category); where.push(`category = $${params.length}`);
  }
  const level = String(query.level || "").trim().toLowerCase();
  if (LEVEL_VALUES.has(level as StructuredLogLevel)) {
    params.push(level); where.push(`level = $${params.length}`);
  }
  const search = String(query.search || "").trim().slice(0, 120);
  if (search) {
    params.push(`%${search.replace(/[%_]/g, "\\$&")}%`);
    where.push(`(event ILIKE $${params.length} ESCAPE '\\' OR COALESCE(message,'') ILIKE $${params.length} ESCAPE '\\' OR COALESCE(path,'') ILIKE $${params.length} ESCAPE '\\' OR COALESCE(actor_name,'') ILIKE $${params.length} ESCAPE '\\')`);
  }
  const before = String(query.before || "").trim();
  if (before && Number.isFinite(Date.parse(before))) {
    params.push(new Date(before).toISOString()); where.push(`created_at < $${params.length}::timestamptz`);
  }
  params.push(limit);

  const result = await pgQuery<{
    id: string; created_at: Date | string; level: StructuredLogLevel; category: StructuredLogCategory; source: StructuredLogSource;
    event: string; message: string | null; actor_id: string | null; actor_name: string | null; actor_group_id: string | null;
    request_id: string | null; method: string | null; path: string | null; status_code: number | null; duration_ms: number | null;
    ip: string | null; resource_type: string | null; resource_id: string | null; details: Record<string, unknown>;
  }>(
    `SELECT id, created_at, level, category, source, event, message, actor_id, actor_name, actor_group_id,
            request_id, method, path, status_code, duration_ms, ip, resource_type, resource_id, details
       FROM system_logs
      WHERE ${where.join(" AND ")}
      ORDER BY created_at DESC
      LIMIT $${params.length}`,
    params,
  );

  return result.rows.map((row) => ({
    id: row.id,
    createdAt: new Date(row.created_at).toISOString(),
    level: row.level,
    category: row.category,
    source: row.source,
    event: row.event,
    message: row.message,
    actorId: row.actor_id,
    actorName: row.actor_name,
    actorGroupId: row.actor_group_id,
    requestId: row.request_id,
    method: row.method,
    path: row.path,
    statusCode: row.status_code,
    durationMs: row.duration_ms,
    ip: row.ip,
    resourceType: row.resource_type,
    resourceId: row.resource_id,
    details: row.details || {},
  }));
}


export type StructuredLogExportCursor = {
  createdAt: string;
  id: string;
};

export async function listStructuredLogsExportPage(query: {
  pageSize?: number;
  sinceHours?: number;
  category?: string | null;
  level?: string | null;
  search?: string | null;
  cursor?: StructuredLogExportCursor | null;
} = {}): Promise<{ items: StructuredLogRecord[]; nextCursor: StructuredLogExportCursor | null }> {
  if (!hasPostgresConfig()) return { items: [], nextCursor: null };
  const pageSize = Math.max(100, Math.min(2000, Math.floor(Number(query.pageSize) || 1000)));
  const sinceHours = Math.max(1, Math.min(72, Math.floor(Number(query.sinceHours) || 72)));
  const params: unknown[] = [sinceHours];
  const where = [`created_at >= now() - ($1::text || ' hours')::interval`];

  const category = String(query.category || "").trim().toLowerCase();
  if (CATEGORY_VALUES.has(category as StructuredLogCategory)) {
    params.push(category);
    where.push(`category = $${params.length}`);
  }
  const level = String(query.level || "").trim().toLowerCase();
  if (LEVEL_VALUES.has(level as StructuredLogLevel)) {
    params.push(level);
    where.push(`level = $${params.length}`);
  }
  const search = String(query.search || "").trim().slice(0, 120);
  if (search) {
    params.push(`%${search.replace(/[%_]/g, "\\$&")}%`);
    where.push(`(event ILIKE $${params.length} ESCAPE '\\' OR COALESCE(message,'') ILIKE $${params.length} ESCAPE '\\' OR COALESCE(path,'') ILIKE $${params.length} ESCAPE '\\' OR COALESCE(actor_name,'') ILIKE $${params.length} ESCAPE '\\')`);
  }
  if (query.cursor?.createdAt && query.cursor.id && Number.isFinite(Date.parse(query.cursor.createdAt))) {
    params.push(new Date(query.cursor.createdAt).toISOString());
    const atParam = params.length;
    params.push(query.cursor.id);
    const idParam = params.length;
    where.push(`(created_at, id) < ($${atParam}::timestamptz, $${idParam})`);
  }
  params.push(pageSize);

  const result = await pgQuery<{
    id: string; created_at: Date | string; level: StructuredLogLevel; category: StructuredLogCategory; source: StructuredLogSource;
    event: string; message: string | null; actor_id: string | null; actor_name: string | null; actor_group_id: string | null;
    request_id: string | null; method: string | null; path: string | null; status_code: number | null; duration_ms: number | null;
    ip: string | null; resource_type: string | null; resource_id: string | null; details: Record<string, unknown>;
  }>(
    `SELECT id, created_at, level, category, source, event, message, actor_id, actor_name, actor_group_id,
            request_id, method, path, status_code, duration_ms, ip, resource_type, resource_id, details
       FROM system_logs
      WHERE ${where.join(" AND ")}
      ORDER BY created_at DESC, id DESC
      LIMIT $${params.length}`,
    params,
  );

  const items = result.rows.map((row) => ({
    id: row.id,
    createdAt: new Date(row.created_at).toISOString(),
    level: row.level,
    category: row.category,
    source: row.source,
    event: row.event,
    message: row.message,
    actorId: row.actor_id,
    actorName: row.actor_name,
    actorGroupId: row.actor_group_id,
    requestId: row.request_id,
    method: row.method,
    path: row.path,
    statusCode: row.status_code,
    durationMs: row.duration_ms,
    ip: row.ip,
    resourceType: row.resource_type,
    resourceId: row.resource_id,
    details: row.details || {},
  }));
  const last = items.length ? items[items.length - 1] : undefined;
  return {
    items,
    nextCursor: items.length === pageSize && last ? { createdAt: last.createdAt, id: last.id } : null,
  };
}

export async function getStructuredLogOverview(sinceHours = 24) {
  if (!hasPostgresConfig()) {
    return { total: 0, warnings: 0, errors: 0, security: 0, categories: {}, timeline: [], storageBytes: 0, oldestAt: null, newestAt: null };
  }
  const hours = Math.max(1, Math.min(72, Math.floor(Number(sinceHours) || 24)));
  const [stats, categories, timeline, storage] = await Promise.all([
    pgQuery<{ total: string; warnings: string; errors: string; security: string; oldest_at: Date | null; newest_at: Date | null }>(
      `SELECT count(*)::text AS total,
              count(*) FILTER (WHERE level = 'warning')::text AS warnings,
              count(*) FILTER (WHERE level = 'error')::text AS errors,
              count(*) FILTER (WHERE category = 'security')::text AS security,
              min(created_at) AS oldest_at,
              max(created_at) AS newest_at
         FROM system_logs
        WHERE created_at >= now() - ($1::text || ' hours')::interval`, [hours]),
    pgQuery<{ category: StructuredLogCategory; total: string }>(
      `SELECT category, count(*)::text AS total FROM system_logs
        WHERE created_at >= now() - ($1::text || ' hours')::interval
        GROUP BY category ORDER BY count(*) DESC`, [hours]),
    pgQuery<{ bucket: Date | string; total: string; warnings: string; errors: string }>(
      `SELECT date_bin('15 minutes'::interval, created_at, '2000-01-01'::timestamptz) AS bucket,
              count(*)::text AS total,
              count(*) FILTER (WHERE level = 'warning')::text AS warnings,
              count(*) FILTER (WHERE level = 'error')::text AS errors
         FROM system_logs
        WHERE created_at >= now() - ($1::text || ' hours')::interval
        GROUP BY bucket ORDER BY bucket ASC`, [hours]),
    pgQuery<{ bytes: string }>(`SELECT pg_total_relation_size('system_logs')::text AS bytes`),
  ]);

  const row = stats.rows[0];
  return {
    total: Number(row?.total || 0),
    warnings: Number(row?.warnings || 0),
    errors: Number(row?.errors || 0),
    security: Number(row?.security || 0),
    categories: Object.fromEntries(categories.rows.map((item) => [item.category, Number(item.total || 0)])),
    timeline: timeline.rows.map((item) => ({
      at: new Date(item.bucket).toISOString(),
      total: Number(item.total || 0),
      warnings: Number(item.warnings || 0),
      errors: Number(item.errors || 0),
    })),
    storageBytes: Number(storage.rows[0]?.bytes || 0),
    oldestAt: row?.oldest_at ? new Date(row.oldest_at).toISOString() : null,
    newestAt: row?.newest_at ? new Date(row.newest_at).toISOString() : null,
  };
}

export async function maintainStructuredLogs() {
  if (!hasPostgresConfig()) return { ok: false, deleted: 0, reason: "postgres_not_configured" };
  const settings = await getStructuredLogSettings();
  let deleted = 0;

  const expired = await pgQuery<{ id: string }>(
    `DELETE FROM system_logs WHERE created_at < now() - interval '3 days' RETURNING id`,
  );
  deleted += expired.rowCount || 0;

  const overRows = await pgQuery<{ id: string }>(
    `WITH ranked AS (
       SELECT id FROM system_logs ORDER BY created_at DESC OFFSET $1
     )
     DELETE FROM system_logs l USING ranked r WHERE l.id = r.id RETURNING l.id`,
    [settings.maxRows],
  );
  deleted += overRows.rowCount || 0;

  const sizeResult = await pgQuery<{ bytes: string; rows: string }>(
    `SELECT pg_total_relation_size('system_logs')::text AS bytes, (SELECT count(*) FROM system_logs)::text AS rows`,
  );
  const bytes = Number(sizeResult.rows[0]?.bytes || 0);
  const rows = Number(sizeResult.rows[0]?.rows || 0);
  const maxBytes = settings.maxStorageMb * 1024 * 1024;

  if (bytes > maxBytes && rows > 1000) {
    const ratio = Math.min(0.75, Math.max(0.10, (bytes - maxBytes) / Math.max(1, bytes) + 0.08));
    const trim = Math.max(500, Math.ceil(rows * ratio));
    const budgetTrim = await pgQuery<{ id: string }>(
      `WITH oldest AS (
         SELECT id FROM system_logs ORDER BY created_at ASC LIMIT $1
       )
       DELETE FROM system_logs l USING oldest o WHERE l.id = o.id RETURNING l.id`,
      [trim],
    );
    deleted += budgetTrim.rowCount || 0;
  }

  if (deleted >= 1000) {
    await pgQuery(`VACUUM (ANALYZE) system_logs`).catch(() => null);
  }

  return {
    ok: true,
    deleted,
    retentionDays: 3,
    maxStorageMb: settings.maxStorageMb,
    maxRows: settings.maxRows,
  };
}
