#!/usr/bin/env node
/**
 * Застосовує схему бази. Ідемпотентно: усе через IF NOT EXISTS / OR REPLACE,
 * тому це безпечно запускати на кожному деплої.
 *
 *   node scripts/db-init.mjs
 */
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import pg from "pg";

if (!process.env.DATABASE_URL) {
  console.error("\n✖ Не задано DATABASE_URL.\n");
  process.exit(1);
}

const here = dirname(fileURLToPath(import.meta.url));
const schemaPath = join(here, "..", "src", "lib", "db", "schema.sql");
const sql = await readFile(schemaPath, "utf8");

const pool = new pg.Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_SSL === "require" ? { rejectUnauthorized: false } : undefined,
});

try {
  await pool.query(sql);
  const check = await pool.query(
    "SELECT count(*)::int AS total FROM pg_indexes WHERE tablename = 'documents'",
  );
  console.log(`✓ Схему застосовано. Індексів на documents: ${check.rows[0].total}`);
} catch (error) {
  console.error("\n✖ Не вдалося застосувати схему:", error.message);
  process.exitCode = 1;
} finally {
  await pool.end().catch(() => null);
}
