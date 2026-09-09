import "server-only";

import type { PoolClient } from "pg";
import { pgQuery, pgTransaction } from "@/lib/db/pgPool";

/**
 * Сумісний із Firestore фасад над PostgreSQL.
 *
 * Мета — переїзд без переписування двадцяти девʼяти модулів. Реалізовано рівно
 * той зріз API, який проєкт справді використовує (перевірено пошуком по
 * джерелах): collection/doc, get/set/update/delete, where з `==` і `<=`,
 * orderBy, limit, startAfter, select, runTransaction, batch, а також
 * сентинели FieldValue і клас Timestamp.
 *
 * Свідомо НЕ реалізовано: підколекції (у проєкті їх немає), складені
 * оператори `in`/`array-contains`, курсори за кількома полями. Якщо колись
 * знадобляться — краще впасти з явною помилкою, ніж мовчки повернути не те.
 */

type DocData = Record<string, unknown>;
type WhereOp = "==" | "<=" | "<" | ">=" | ">";

export class PgUnsupportedOperation extends Error {
  constructor(what: string) {
    super(`Document store: ${what} не підтримується адаптером PostgreSQL.`);
    this.name = "PgUnsupportedOperation";
  }
}

/* ------------------------------------------------------------------ *
 * Сентинели FieldValue і Timestamp
 * ------------------------------------------------------------------ */

const SENTINEL = Symbol.for("mistblossom.pg.sentinel");

type SentinelKind = "delete" | "serverTimestamp" | "increment" | "arrayUnion";

type Sentinel = {
  [SENTINEL]: SentinelKind;
  value?: unknown;
  values?: unknown[];
};

function makeSentinel(kind: SentinelKind, payload: Partial<Sentinel> = {}): Sentinel {
  return { [SENTINEL]: kind, ...payload };
}

function asSentinel(value: unknown): Sentinel | null {
  if (!value || typeof value !== "object") return null;
  return SENTINEL in (value as Sentinel) ? (value as Sentinel) : null;
}

export const FieldValue = {
  delete: () => makeSentinel("delete"),
  serverTimestamp: () => makeSentinel("serverTimestamp"),
  increment: (value: number) => makeSentinel("increment", { value }),
  arrayUnion: (...values: unknown[]) => makeSentinel("arrayUnion", { values }),
};

/**
 * Мінімальний Timestamp. Всередині зберігаємо ISO-рядок: JSON у Postgres не
 * має власного типу дати, а ISO лишається сортованим як текст.
 */
export class Timestamp {
  readonly seconds: number;
  readonly nanoseconds: number;

  constructor(seconds: number, nanoseconds = 0) {
    this.seconds = Math.floor(seconds);
    this.nanoseconds = Math.floor(nanoseconds);
  }

  static now() {
    return Timestamp.fromDate(new Date());
  }

  static fromDate(date: Date) {
    const ms = date.getTime();
    return new Timestamp(Math.floor(ms / 1000), (ms % 1000) * 1e6);
  }

  static fromMillis(ms: number) {
    return Timestamp.fromDate(new Date(ms));
  }

  toDate() {
    return new Date(this.seconds * 1000 + Math.floor(this.nanoseconds / 1e6));
  }

  toMillis() {
    return this.seconds * 1000 + Math.floor(this.nanoseconds / 1e6);
  }

  toJSON() {
    return this.toDate().toISOString();
  }
}

/** Заглушка FieldPath: у проєкті використовується лише documentId(). */
export const FieldPath = {
  documentId: () => "__name__",
};

/* ------------------------------------------------------------------ *
 * Робота з JSON-документом
 * ------------------------------------------------------------------ */

function splitPath(path: string) {
  return path.split(".").filter(Boolean);
}

function getAtPath(doc: DocData, path: string[]): unknown {
  let cursor: unknown = doc;
  for (const key of path) {
    if (!cursor || typeof cursor !== "object") return undefined;
    cursor = (cursor as DocData)[key];
  }
  return cursor;
}

function setAtPath(doc: DocData, path: string[], value: unknown) {
  let cursor: DocData = doc;
  for (let i = 0; i < path.length - 1; i += 1) {
    const key = path[i];
    const next = cursor[key];
    if (!next || typeof next !== "object" || Array.isArray(next)) cursor[key] = {};
    cursor = cursor[key] as DocData;
  }
  cursor[path[path.length - 1]] = value;
}

function deleteAtPath(doc: DocData, path: string[]) {
  let cursor: DocData = doc;
  for (let i = 0; i < path.length - 1; i += 1) {
    const next = cursor[path[i]];
    if (!next || typeof next !== "object") return;
    cursor = next as DocData;
  }
  delete cursor[path[path.length - 1]];
}

/** Розгортає сентинели у звичайні значення відносно поточного документа. */
function resolveSentinel(sentinel: Sentinel, current: unknown, nowIso: string): unknown | typeof DELETE_MARK {
  switch (sentinel[SENTINEL]) {
    case "delete":
      return DELETE_MARK;
    case "serverTimestamp":
      return nowIso;
    case "increment": {
      const base = Number(current || 0);
      return (Number.isFinite(base) ? base : 0) + Number(sentinel.value || 0);
    }
    case "arrayUnion": {
      const base = Array.isArray(current) ? [...current] : [];
      for (const item of sentinel.values || []) {
        if (!base.some((existing) => JSON.stringify(existing) === JSON.stringify(item))) {
          base.push(item);
        }
      }
      return base;
    }
    default:
      return undefined;
  }
}

const DELETE_MARK = Symbol("delete");

/** Глибоке злиття для set({ merge: true }) — так само, як це робить Firestore. */
function mergeInto(target: DocData, patch: DocData, nowIso: string) {
  for (const [key, raw] of Object.entries(patch)) {
    const sentinel = asSentinel(raw);
    if (sentinel) {
      const resolved = resolveSentinel(sentinel, target[key], nowIso);
      if (resolved === DELETE_MARK) delete target[key];
      else target[key] = resolved;
      continue;
    }
    if (raw && typeof raw === "object" && !Array.isArray(raw) && !(raw instanceof Timestamp) && !(raw instanceof Date)) {
      const existing = target[key];
      const base: DocData = existing && typeof existing === "object" && !Array.isArray(existing)
        ? { ...(existing as DocData) }
        : {};
      mergeInto(base, raw as DocData, nowIso);
      target[key] = base;
      continue;
    }
    target[key] = normalizeValue(raw);
  }
}

/** update() приймає крапкові шляхи: `votesByDiscordId.123`. */
function applyUpdate(target: DocData, patch: DocData, nowIso: string) {
  for (const [key, raw] of Object.entries(patch)) {
    const path = splitPath(key);
    const sentinel = asSentinel(raw);
    if (sentinel) {
      const resolved = resolveSentinel(sentinel, getAtPath(target, path), nowIso);
      if (resolved === DELETE_MARK) deleteAtPath(target, path);
      else setAtPath(target, path, resolved);
      continue;
    }
    setAtPath(target, path, normalizeValue(raw));
  }
}

/** Прибирає типи, яких немає в JSON, і розгортає вкладені сентинели. */
function normalizeValue(value: unknown, nowIso = new Date().toISOString()): unknown {
  const sentinel = asSentinel(value);
  if (sentinel) {
    const resolved = resolveSentinel(sentinel, undefined, nowIso);
    return resolved === DELETE_MARK ? undefined : resolved;
  }
  if (value instanceof Timestamp) return value.toJSON();
  if (value instanceof Date) return value.toISOString();
  if (Array.isArray(value)) return value.map((item) => normalizeValue(item, nowIso));
  if (value && typeof value === "object") {
    const out: DocData = {};
    for (const [key, item] of Object.entries(value as DocData)) {
      const next = normalizeValue(item, nowIso);
      if (next !== undefined) out[key] = next;
    }
    return out;
  }
  return value === undefined ? undefined : value;
}

/* ------------------------------------------------------------------ *
 * Снапшоти
 * ------------------------------------------------------------------ */

export class PgDocumentSnapshot {
  readonly id: string;
  readonly ref: PgDocumentRef;
  readonly exists: boolean;
  private readonly payload: DocData | null;

  constructor(ref: PgDocumentRef, payload: DocData | null) {
    this.ref = ref;
    this.id = ref.id;
    this.payload = payload;
    this.exists = payload !== null;
  }

  data(): DocData | undefined {
    return this.payload ? { ...this.payload } : undefined;
  }

  get(path: string) {
    return this.payload ? getAtPath(this.payload, splitPath(path)) : undefined;
  }
}

export class PgQuerySnapshot {
  readonly docs: PgDocumentSnapshot[];

  constructor(docs: PgDocumentSnapshot[]) {
    this.docs = docs;
  }

  get empty() {
    return this.docs.length === 0;
  }

  get size() {
    return this.docs.length;
  }

  forEach(handler: (doc: PgDocumentSnapshot) => void) {
    this.docs.forEach(handler);
  }
}

/* ------------------------------------------------------------------ *
 * Посилання на документ
 * ------------------------------------------------------------------ */

export class PgDocumentRef {
  readonly collectionName: string;
  readonly id: string;
  private readonly client?: PoolClient;

  constructor(collectionName: string, id: string, client?: PoolClient) {
    this.collectionName = collectionName;
    this.id = id;
    this.client = client;
  }

  get path() {
    return `${this.collectionName}/${this.id}`;
  }

  async get(): Promise<PgDocumentSnapshot> {
    const result = await pgQuery<{ data: DocData }>(
      "SELECT data FROM documents WHERE collection = $1 AND doc_id = $2",
      [this.collectionName, this.id],
      this.client,
    );
    return new PgDocumentSnapshot(this, result.rows[0]?.data ?? null);
  }

  async set(data: DocData, options?: { merge?: boolean }) {
    const nowIso = new Date().toISOString();
    if (options?.merge) {
      const current = (await this.get()).data() || {};
      mergeInto(current, data, nowIso);
      await this.write(current);
      return;
    }
    const fresh: DocData = {};
    mergeInto(fresh, data, nowIso);
    await this.write(fresh);
  }

  async update(data: DocData) {
    const snapshot = await this.get();
    if (!snapshot.exists) {
      // Firestore теж кидає помилку на update неіснуючого документа —
      // повторюємо поведінку, щоб не ховати логічні баги виклику.
      throw new Error(`No document to update: ${this.path}`);
    }
    const current = snapshot.data() || {};
    applyUpdate(current, data, new Date().toISOString());
    await this.write(current);
  }

  async delete() {
    await pgQuery(
      "DELETE FROM documents WHERE collection = $1 AND doc_id = $2",
      [this.collectionName, this.id],
      this.client,
    );
  }

  private async write(data: DocData) {
    await pgQuery(
      `INSERT INTO documents (collection, doc_id, data)
       VALUES ($1, $2, $3::jsonb)
       ON CONFLICT (collection, doc_id)
       DO UPDATE SET data = EXCLUDED.data, updated_at = now()`,
      [this.collectionName, this.id, JSON.stringify(data)],
      this.client,
    );
  }

  /**
   * Підколекція. У Firestore це вкладений шлях; у нас — просто інша
   * «колекція» з повним шляхом у назві: `guildRecords/abc/chunks`.
   * Індекс по (collection) працює для неї так само, як для кореневих.
   */
  collection(name: string) {
    return new PgCollectionRef(`${this.collectionName}/${this.id}/${name}`, undefined, this.client);
  }

  withClient(client?: PoolClient) {
    return new PgDocumentRef(this.collectionName, this.id, client);
  }
}

/* ------------------------------------------------------------------ *
 * Запити
 * ------------------------------------------------------------------ */

type QueryState = {
  wheres: Array<{ field: string; op: WhereOp; value: unknown }>;
  orders: Array<{ field: string; direction: "asc" | "desc" }>;
  limit: number | null;
  startAfter: unknown[] | null;
};

export class PgQuery {
  protected readonly collectionName: string;
  protected readonly state: QueryState;
  protected readonly client?: PoolClient;

  constructor(collectionName: string, state?: Partial<QueryState>, client?: PoolClient) {
    this.collectionName = collectionName;
    this.client = client;
    this.state = {
      wheres: state?.wheres ? [...state.wheres] : [],
      orders: state?.orders ? [...state.orders] : [],
      limit: state?.limit ?? null,
      startAfter: state?.startAfter ?? null,
    };
  }

  protected derive(patch: Partial<QueryState>) {
    return new PgQuery(this.collectionName, { ...this.state, ...patch }, this.client);
  }

  where(field: string, op: WhereOp, value: unknown) {
    return this.derive({ wheres: [...this.state.wheres, { field, op, value }] });
  }

  orderBy(field: string, direction: "asc" | "desc" = "asc") {
    return this.derive({ orders: [...this.state.orders, { field, direction }] });
  }

  limit(count: number) {
    return this.derive({ limit: Math.max(0, Math.floor(count)) });
  }

  startAfter(...values: unknown[]) {
    return this.derive({ startAfter: values });
  }

  /**
   * select() у Firestore зменшує обсяг переданих даних. У нас документ і так
   * лежить одним рядком JSON, тож обрізати нічого — просто повертаємо себе.
   */
  select(..._fields: string[]) {
    void _fields;
    return this;
  }

  async get(): Promise<PgQuerySnapshot> {
    const values: unknown[] = [this.collectionName];
    const conditions: string[] = ["collection = $1"];

    for (const clause of this.state.wheres) {
      if (clause.field === "__name__") {
        values.push(String(clause.value));
        conditions.push(`doc_id = $${values.length}`);
        continue;
      }
      const jsonPath = jsonAccessor(clause.field);
      if (clause.op === "==") {
        values.push(JSON.stringify(buildContainment(clause.field, clause.value)));
        conditions.push(`data @> $${values.length}::jsonb`);
        continue;
      }
      values.push(Number(clause.value));
      conditions.push(`(${jsonPath})::numeric ${clause.op} $${values.length}`);
    }

    const orderParts = this.state.orders.map(
      (order) => `(${jsonAccessor(order.field)}) ${order.direction === "desc" ? "DESC" : "ASC"}`,
    );
    // Стабільний хвіст сортування: без нього рядки з однаковим значенням
    // поля можуть приходити в різному порядку, і startAfter почне
    // пропускати або дублювати записи між сторінками.
    orderParts.push("doc_id ASC");

    if (this.state.startAfter && this.state.orders.length) {
      const order = this.state.orders[0];
      values.push(String(this.state.startAfter[0] ?? ""));
      const comparison = order.direction === "desc" ? "<" : ">";
      conditions.push(`(${jsonAccessor(order.field)}) ${comparison} $${values.length}`);
    }

    let sql = `SELECT doc_id, data FROM documents WHERE ${conditions.join(" AND ")} ORDER BY ${orderParts.join(", ")}`;
    if (this.state.limit !== null) {
      values.push(this.state.limit);
      sql += ` LIMIT $${values.length}`;
    }

    const result = await pgQuery<{ doc_id: string; data: DocData }>(sql, values, this.client);
    return new PgQuerySnapshot(
      result.rows.map((row) => new PgDocumentSnapshot(
        new PgDocumentRef(this.collectionName, row.doc_id, this.client),
        row.data,
      )),
    );
  }
}

/** `data -> 'a' ->> 'b'` для крапкового шляху. */
function jsonAccessor(field: string) {
  const path = splitPath(field);
  if (!path.length) return "data";
  const head = path.slice(0, -1).map((key) => `->'${key.replace(/'/g, "''")}'`).join("");
  const tail = `->>'${path[path.length - 1].replace(/'/g, "''")}'`;
  return `data${head}${tail}`;
}

/** Обʼєкт для оператора @>, який вміє користуватись GIN-індексом. */
function buildContainment(field: string, value: unknown) {
  const path = splitPath(field);
  const result: DocData = {};
  let cursor = result;
  for (let i = 0; i < path.length - 1; i += 1) {
    cursor[path[i]] = {};
    cursor = cursor[path[i]] as DocData;
  }
  cursor[path[path.length - 1]] = value;
  return result;
}

export class PgCollectionRef extends PgQuery {
  doc(id?: string) {
    return new PgDocumentRef(this.collectionName, id || randomDocId(), this.client);
  }

  async add(data: DocData) {
    const ref = this.doc();
    await ref.set(data);
    return ref;
  }

  async listDocuments() {
    const result = await pgQuery<{ doc_id: string }>(
      "SELECT doc_id FROM documents WHERE collection = $1 ORDER BY doc_id",
      [this.collectionName],
      this.client,
    );
    return result.rows.map((row) => new PgDocumentRef(this.collectionName, row.doc_id, this.client));
  }
}

function randomDocId() {
  // 20 символів у тому ж алфавіті, що й авто-ідентифікатори Firestore, —
  // старі й нові документи виглядають однаково.
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  let id = "";
  for (let i = 0; i < 20; i += 1) {
    id += alphabet[Math.floor(Math.random() * alphabet.length)];
  }
  return id;
}

/* ------------------------------------------------------------------ *
 * Транзакції та батчі
 * ------------------------------------------------------------------ */

export class PgTransaction {
  private readonly client: PoolClient;

  constructor(client: PoolClient) {
    this.client = client;
  }

  async get(target: PgDocumentRef | PgQuery) {
    if (target instanceof PgDocumentRef) return target.withClient(this.client).get();
    throw new PgUnsupportedOperation("читання запиту всередині транзакції");
  }

  set(ref: PgDocumentRef, data: DocData, options?: { merge?: boolean }) {
    this.queue.push(() => ref.withClient(this.client).set(data, options));
  }

  /**
   * create() у Firestore падає, якщо документ уже існує. Ця гарантія тут
   * важлива: на ній тримається захист від повторного створення записів,
   * тому перевірку робимо явно, а не зводимо create до set.
   */
  create(ref: PgDocumentRef, data: DocData) {
    this.queue.push(async () => {
      const scoped = ref.withClient(this.client);
      const existing = await scoped.get();
      if (existing.exists) throw new Error(`Document already exists: ${ref.path}`);
      await scoped.set(data);
    });
  }

  update(ref: PgDocumentRef, data: DocData) {
    this.queue.push(() => ref.withClient(this.client).update(data));
  }

  delete(ref: PgDocumentRef) {
    this.queue.push(() => ref.withClient(this.client).delete());
  }

  /**
   * Firestore відкладає записи до кінця транзакції, і код на це розраховує:
   * прочитати, порахувати, записати. Виконуємо їх у тому ж порядку вже після
   * того, як тіло транзакції відпрацювало.
   */
  private readonly queue: Array<() => Promise<void>> = [];

  async flush() {
    for (const task of this.queue) await task();
    this.queue.length = 0;
  }
}

export class PgWriteBatch {
  private readonly tasks: Array<(client: PoolClient) => Promise<void>> = [];

  set(ref: PgDocumentRef, data: DocData, options?: { merge?: boolean }) {
    this.tasks.push((client) => ref.withClient(client).set(data, options));
    return this;
  }

  update(ref: PgDocumentRef, data: DocData) {
    this.tasks.push((client) => ref.withClient(client).update(data));
    return this;
  }

  delete(ref: PgDocumentRef) {
    this.tasks.push((client) => ref.withClient(client).delete());
    return this;
  }

  async commit() {
    if (!this.tasks.length) return;
    await pgTransaction(async (client) => {
      for (const task of this.tasks) await task(client);
    });
    this.tasks.length = 0;
  }
}

/* ------------------------------------------------------------------ *
 * Точка входу
 * ------------------------------------------------------------------ */

export class PgFirestore {
  collection(name: string) {
    return new PgCollectionRef(name);
  }

  doc(path: string) {
    const parts = path.split("/").filter(Boolean);
    if (parts.length < 2 || parts.length % 2 !== 0) {
      throw new PgUnsupportedOperation(`шлях "${path}"`);
    }
    const id = parts[parts.length - 1];
    return new PgDocumentRef(parts.slice(0, -1).join("/"), id);
  }

  /**
   * Пакетне читання документів одним запитом.
   *
   * Firestore-версія економить кругові поїздки до мережі; тут та сама
   * мотивація: склад гільдії читається чанками по 1100 записів, і окремий
   * SELECT на кожен чанк перетворив би одне читання на десятки.
   * Порядок результатів зберігаємо той самий, у якому передані посилання, —
   * виклики покладаються на відповідність за індексом.
   */
  async getAll(...refs: PgDocumentRef[]): Promise<PgDocumentSnapshot[]> {
    if (!refs.length) return [];
    const collections = refs.map((ref) => ref.collectionName);
    const ids = refs.map((ref) => ref.id);
    const result = await pgQuery<{ collection: string; doc_id: string; data: DocData }>(
      `SELECT collection, doc_id, data FROM documents
       WHERE (collection, doc_id) IN (
         SELECT UNNEST($1::text[]), UNNEST($2::text[])
       )`,
      [collections, ids],
    );
    const found = new Map(result.rows.map((row) => [`${row.collection}\u0000${row.doc_id}`, row.data]));
    return refs.map((ref) => new PgDocumentSnapshot(
      ref,
      found.get(`${ref.collectionName}\u0000${ref.id}`) ?? null,
    ));
  }

  batch() {
    return new PgWriteBatch();
  }

  async runTransaction<T>(handler: (tx: PgTransaction) => Promise<T>): Promise<T> {
    return pgTransaction(async (client) => {
      const tx = new PgTransaction(client);
      const result = await handler(tx);
      await tx.flush();
      return result;
    });
  }
}

let cachedStore: PgFirestore | null = null;

export function getPgDocumentStore() {
  if (!cachedStore) cachedStore = new PgFirestore();
  return cachedStore;
}
