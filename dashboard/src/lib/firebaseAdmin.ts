import { hasPostgresConfig } from "@/lib/db/pgPool";
import { getPgDocumentStore } from "@/lib/db/documentStore";

/**
 * Вибір сховища документів.
 *
 * Історична назва файлу і функції збережена навмисно: на `getFirebaseAdminDb()`
 * посилаються двадцять девʼять модулів, і перейменування перетворило б переїзд
 * бази на переписування половини проєкту. Тепер це просто «дай сховище».
 *
 * Порядок вибору:
 *   1. DATABASE_URL задано → власний PostgreSQL (цільовий режим);
 *   2. інакше задані ключі Firebase → Firestore (режим сумісності на час
 *      переносу даних, щоб можна було відкотитись однією змінною оточення);
 *   3. інакше — помилка з людським текстом.
 */

function normalizePrivateKey(value?: string) {
  return String(value || "").replace(/\\n/g, "\n").trim();
}

export function hasFirebaseCredentials() {
  return Boolean(
    process.env.FIREBASE_PROJECT_ID
      && process.env.FIREBASE_CLIENT_EMAIL
      && process.env.FIREBASE_PRIVATE_KEY,
  );
}

/**
 * Стара назва: «чи налаштоване сховище профілів». Її перевіряють у
 * `firebaseAccess.ts` та на сторінці стану інтеграцій, тому лишаємо, але
 * тепер відповідь дає будь-яке налаштоване сховище.
 */
export function hasFirebaseProfileConfig() {
  return hasPostgresConfig() || hasFirebaseCredentials();
}

export function documentStoreMode(): "postgres" | "firestore" | "unconfigured" {
  if (hasPostgresConfig()) return "postgres";
  return hasFirebaseCredentials() ? "firestore" : "unconfigured";
}

export function getLegacyFirestoreAdminDb() {
  // Динамічний require: коли працюємо на PostgreSQL, firebase-admin взагалі
  // не має завантажуватись — це десятки мегабайт залежностей на холодний старт.
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const appModule = require("firebase-admin/app") as typeof import("firebase-admin/app");
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const firestoreModule = require("firebase-admin/firestore") as typeof import("firebase-admin/firestore");

  const app = appModule.getApps()[0] || appModule.initializeApp({
    credential: appModule.cert({
      projectId: process.env.FIREBASE_PROJECT_ID,
      clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
      privateKey: normalizePrivateKey(process.env.FIREBASE_PRIVATE_KEY),
    }),
  });

  return firestoreModule.getFirestore(app);
}

export function getFirebaseAdminDb() {
  if (hasPostgresConfig()) return getPgDocumentStore();
  if (hasFirebaseCredentials()) return getLegacyFirestoreAdminDb() as unknown as ReturnType<typeof getPgDocumentStore>;
  throw new Error("Сховище не налаштоване: задайте DATABASE_URL (PostgreSQL) або ключі Firebase.");
}
