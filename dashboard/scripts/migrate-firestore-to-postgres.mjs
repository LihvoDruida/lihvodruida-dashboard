#!/usr/bin/env node
/**
 * Перенесення даних Firestore → PostgreSQL.
 *
 *   node scripts/migrate-firestore-to-postgres.mjs [--dry-run] [--only=colA,colB]
 *
 * Скрипт ідемпотентний: повторний запуск перезаписує документи за тим самим
 * ключем (collection, doc_id). Тобто його можна ганяти скільки завгодно разів,
 * зокрема зробити «чорновий» прогін заздалегідь, а потім фінальний — у вікні
 * простою, коли записи вже зупинені.
 *
 * Потрібні змінні оточення:
 *   FIREBASE_PROJECT_ID / FIREBASE_CLIENT_EMAIL / FIREBASE_PRIVATE_KEY — джерело
 *   DATABASE_URL — приймач
 */

import { getApps, initializeApp, cert } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import pg from "pg";

const DRY_RUN = process.argv.includes("--dry-run");
const ONLY = (process.argv.find((arg) => arg.startsWith("--only=")) || "")
  .replace("--only=", "")
  .split(",")
  .map((item) => item.trim())
  .filter(Boolean);

/** Скільки документів пишемо однією транзакцією. */
const BATCH_SIZE = Number(process.env.MIGRATION_BATCH_SIZE || 500);

function fail(message) {
  console.error(`\n✖ ${message}\n`);
  process.exit(1);
}

if (!process.env.DATABASE_URL) fail("Не задано DATABASE_URL.");
if (!process.env.FIREBASE_PROJECT_ID || !process.env.FIREBASE_CLIENT_EMAIL || !process.env.FIREBASE_PRIVATE_KEY) {
  fail("Не задані ключі Firebase (FIREBASE_PROJECT_ID / FIREBASE_CLIENT_EMAIL / FIREBASE_PRIVATE_KEY).");
}

const app = getApps()[0] || initializeApp({
  credential: cert({
    projectId: process.env.FIREBASE_PROJECT_ID,
    clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
    privateKey: String(process.env.FIREBASE_PRIVATE_KEY).replace(/\\n/g, "\n").trim(),
  }),
});
const firestore = getFirestore(app);

const pool = new pg.Pool({
  connectionString: process.env.DATABASE_URL,
  max: 4,
  ssl: process.env.DATABASE_SSL === "require" ? { rejectUnauthorized: false } : undefined,
});

/**
 * Firestore віддає Timestamp, DocumentReference і GeoPoint як обʼєкти з
 * методами. У JSON вони мають стати чимось, що застосунок уміє читати назад:
 * дати — ISO-рядками (саме так їх нормалізує `timestampToIso`), посилання —
 * рядком шляху.
 */
function toPlainJson(value) {
  if (value === null || value === undefined) return null;
  if (typeof value !== "object") return value;

  if (typeof value.toDate === "function" && typeof value.seconds === "number") {
    return value.toDate().toISOString();
  }
  if (value instanceof Date) return value.toISOString();
  if (typeof value.path === "string" && typeof value.id === "string") return value.path;
  if (Buffer.isBuffer(value)) return value.toString("base64");
  if (Array.isArray(value)) return value.map(toPlainJson);

  const out = {};
  for (const [key, item] of Object.entries(value)) {
    const next = toPlainJson(item);
    if (next !== undefined) out[key] = next;
  }
  return out;
}

async function writeChunk(rows) {
  if (DRY_RUN || !rows.length) return;
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    // UNNEST замість тисяч окремих INSERT: один round-trip на пачку.
    await client.query(
      `INSERT INTO documents (collection, doc_id, data)
       SELECT UNNEST($1::text[]), UNNEST($2::text[]), UNNEST($3::jsonb[])
       ON CONFLICT (collection, doc_id)
       DO UPDATE SET data = EXCLUDED.data, updated_at = now()`,
      [
        rows.map((row) => row.collection),
        rows.map((row) => row.id),
        rows.map((row) => JSON.stringify(row.data)),
      ],
    );
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK").catch(() => null);
    throw error;
  } finally {
    client.release();
  }
}

/** Рекурсивно обходить колекцію разом з усіма підколекціями. */
async function migrateCollection(ref, pathPrefix) {
  const collectionPath = pathPrefix ? `${pathPrefix}/${ref.id}` : ref.id;
  let documents = 0;
  let buffer = [];

  const snapshot = await ref.get();
  for (const doc of snapshot.docs) {
    buffer.push({ collection: collectionPath, id: doc.id, data: toPlainJson(doc.data()) || {} });
    documents += 1;
    if (buffer.length >= BATCH_SIZE) {
      await writeChunk(buffer);
      buffer = [];
      process.stdout.write(`\r  ${collectionPath}: ${documents}`);
    }

    // Підколекції зберігаються як колекція з повним шляхом у назві —
    // рівно так, як їх читає адаптер у src/lib/db/documentStore.ts.
    const subcollections = await doc.ref.listCollections();
    for (const sub of subcollections) {
      const nested = await migrateCollection(sub, `${collectionPath}/${doc.id}`);
      documents += nested;
    }
  }

  await writeChunk(buffer);
  process.stdout.write(`\r  ${collectionPath}: ${documents} документів\n`);
  return documents;
}

async function main() {
  console.log(DRY_RUN ? "\n== ПРОБНИЙ ПРОГІН (нічого не пишемо) ==\n" : "\n== ПЕРЕНЕСЕННЯ Firestore → PostgreSQL ==\n");

  if (!DRY_RUN) {
    const check = await pool.query("SELECT to_regclass('public.documents') AS table_name");
    if (!check.rows[0]?.table_name) {
      fail("Таблиці documents немає. Спершу застосуйте src/lib/db/schema.sql.");
    }
  }

  const collections = await firestore.listCollections();
  const selected = ONLY.length
    ? collections.filter((item) => ONLY.includes(item.id))
    : collections;

  if (!selected.length) fail("Жодної колекції не знайдено.");

  console.log(`Колекцій до перенесення: ${selected.length}\n`);
  let total = 0;
  const started = Date.now();
  for (const collection of selected) {
    total += await migrateCollection(collection, "");
  }

  const seconds = ((Date.now() - started) / 1000).toFixed(1);
  console.log(`\nГотово: ${total} документів за ${seconds} с.`);

  if (!DRY_RUN) {
    const verify = await pool.query("SELECT collection, count(*)::int AS total FROM documents GROUP BY collection ORDER BY collection");
    console.log("\nУ PostgreSQL зараз:");
    for (const row of verify.rows) console.log(`  ${row.collection}: ${row.total}`);
    console.log("\nЗвірте числа з Firestore перед тим, як перемикати DATABASE_URL у проді.");
  }
}

main()
  .catch((error) => {
    console.error("\n✖ Помилка перенесення:", error);
    process.exitCode = 1;
  })
  .finally(() => pool.end().catch(() => null));
