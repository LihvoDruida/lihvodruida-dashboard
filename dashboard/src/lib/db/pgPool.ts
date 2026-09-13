import "server-only";

import { Pool, type PoolClient, type QueryResultRow } from "pg";

/**
 * Пул зʼєднань до власного PostgreSQL.
 *
 * Next.js у dev-режимі перезавантажує модулі на кожну зміну, тому пул
 * тримаємо на globalThis: інакше кожен hot reload відкривав би новий набір
 * зʼєднань і база впиралась би в max_connections за кілька хвилин роботи.
 */

declare global {
  var __mistblossomPgPool: Pool | undefined;
}

export function hasPostgresConfig() {
  return Boolean(process.env.DATABASE_URL || process.env.POSTGRES_URL);
}

function connectionString() {
  return String(process.env.DATABASE_URL || process.env.POSTGRES_URL || "").trim();
}

function poolSize() {
  const raw = Number(process.env.DATABASE_POOL_SIZE || 8);
  return Number.isFinite(raw) && raw > 0 ? Math.min(50, Math.floor(raw)) : 8;
}


function boundedMs(name: string, fallback: number, min: number, max: number) {
  const raw = Number(process.env[name] || fallback);
  return Number.isFinite(raw) ? Math.max(min, Math.min(max, Math.floor(raw))) : fallback;
}

function databaseSessionOptions() {
  const statementTimeout = boundedMs("DATABASE_STATEMENT_TIMEOUT_MS", 20_000, 2_000, 120_000);
  const lockTimeout = boundedMs("DATABASE_LOCK_TIMEOUT_MS", 5_000, 500, 30_000);
  const idleTxTimeout = boundedMs("DATABASE_IDLE_TX_TIMEOUT_MS", 30_000, 5_000, 120_000);
  return `-c statement_timeout=${statementTimeout} -c lock_timeout=${lockTimeout} -c idle_in_transaction_session_timeout=${idleTxTimeout}`;
}
/**
 * TLS вмикається лише коли це справді потрібно. Для локального Postgres на
 * тому ж хості (найчастіший випадок self-hosting) сертифіката немає, і
 * увімкнений за замовчуванням SSL просто не дав би підключитись.
 */
function sslOptions() {
  const mode = String(process.env.DATABASE_SSL || "").trim().toLowerCase();
  if (mode === "require" || mode === "1" || mode === "true") {
    return { rejectUnauthorized: process.env.DATABASE_SSL_REJECT_UNAUTHORIZED !== "0" };
  }
  return undefined;
}

export function getPgPool(): Pool {
  if (!hasPostgresConfig()) {
    throw new Error("PostgreSQL is not configured: set DATABASE_URL.");
  }

  if (!globalThis.__mistblossomPgPool) {
    const pool = new Pool({
      connectionString: connectionString(),
      max: poolSize(),
      idleTimeoutMillis: 30_000,
      connectionTimeoutMillis: 8_000,
      keepAlive: true,
      keepAliveInitialDelayMillis: 10_000,
      options: databaseSessionOptions(),
      ssl: sslOptions(),
    });

    // Без цього обробника нежива сесія (рестарт бази, обрив мережі) валить
    // увесь процес Node незловленою подією 'error' на idle-клієнті.
    pool.on("error", (error) => {
      console.error("[pg] idle client error:", error instanceof Error ? error.message : error);
    });

    globalThis.__mistblossomPgPool = pool;
  }

  return globalThis.__mistblossomPgPool;
}

export async function pgQuery<T extends QueryResultRow = QueryResultRow>(
  text: string,
  values: unknown[] = [],
  client?: PoolClient,
) {
  const runner = client || getPgPool();
  return runner.query<T>(text, values as never[]);
}

/**
 * Транзакція з повторами на serialization failure.
 *
 * Ізоляція REPEATABLE READ обрана свідомо: код, написаний під
 * Firestore-транзакції, розраховує, що прочитане всередині транзакції не
 * зміниться під ним. PostgreSQL у такому разі може відхилити транзакцію з
 * кодом 40001, і єдина правильна реакція — перезапустити її цілком, як це
 * робить і сам Firestore.
 */
export async function pgTransaction<T>(
  handler: (client: PoolClient) => Promise<T>,
  options: { retries?: number } = {},
): Promise<T> {
  const retries = Math.max(0, Math.min(10, options.retries ?? 5));
  let lastError: unknown = null;

  for (let attempt = 0; attempt <= retries; attempt += 1) {
    const client = await getPgPool().connect();
    try {
      await client.query("BEGIN ISOLATION LEVEL REPEATABLE READ");
      const result = await handler(client);
      await client.query("COMMIT");
      return result;
    } catch (error) {
      await client.query("ROLLBACK").catch(() => null);
      lastError = error;
      const code = (error as { code?: string })?.code;
      // 40001 — serialization_failure, 40P01 — deadlock_detected.
      if (code !== "40001" && code !== "40P01") throw error;
      const backoff = 25 * Math.pow(2, attempt) + Math.floor(Math.random() * 25);
      await new Promise((resolve) => setTimeout(resolve, backoff));
    } finally {
      client.release();
    }
  }

  throw lastError instanceof Error
    ? lastError
    : new Error("Transaction failed after retries.");
}

export async function closePgPool() {
  const pool = globalThis.__mistblossomPgPool;
  globalThis.__mistblossomPgPool = undefined;
  if (pool) await pool.end().catch(() => null);
}
