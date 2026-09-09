import "server-only";

import { hasPostgresConfig } from "@/lib/db/pgPool";
import {
  FieldPath as PgFieldPath,
  FieldValue as PgFieldValue,
  Timestamp as PgTimestamp,
  type PgDocumentSnapshot,
  type PgTransaction,
} from "@/lib/db/documentStore";

/**
 * Єдина точка, звідки код бере FieldValue / Timestamp / FieldPath.
 *
 * Раніше двадцять девʼять модулів імпортували їх напряму з
 * `firebase-admin/firestore`. Тепер вони імпортують звідси, а вибір
 * реалізації робиться один раз тут — за наявністю DATABASE_URL.
 *
 * Firebase лишається робочим запасним варіантом на час переїзду: поки дані
 * не перенесені, достатньо не задавати DATABASE_URL, і все працює як раніше.
 */

type FirestoreModule = {
  FieldValue: typeof PgFieldValue;
  Timestamp: typeof PgTimestamp;
  FieldPath: typeof PgFieldPath;
};

function loadFirebaseModule(): FirestoreModule | null {
  try {
    // require, а не import: модуль не має бути в бандлі, якщо Firebase не
    // використовується. eslint-disable-next-line @typescript-eslint/no-require-imports
    const mod = require("firebase-admin/firestore") as Record<string, unknown>;
    return {
      FieldValue: mod.FieldValue as typeof PgFieldValue,
      Timestamp: mod.Timestamp as typeof PgTimestamp,
      FieldPath: mod.FieldPath as typeof PgFieldPath,
    };
  } catch {
    return null;
  }
}

const firebaseModule = hasPostgresConfig() ? null : loadFirebaseModule();

export const FieldValue = firebaseModule?.FieldValue || PgFieldValue;
export const Timestamp = firebaseModule?.Timestamp || PgTimestamp;
export const FieldPath = firebaseModule?.FieldPath || PgFieldPath;

export type Transaction = PgTransaction;
export type QueryDocumentSnapshot = PgDocumentSnapshot;

/** Яке сховище зараз активне — показуємо на сторінці стану інтеграцій. */
export function documentStoreKind(): "postgres" | "firestore" | "unconfigured" {
  if (hasPostgresConfig()) return "postgres";
  return firebaseModule ? "firestore" : "unconfigured";
}
