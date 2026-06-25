import "server-only";

import { hasFirebaseProfileConfig } from "@/lib/firebaseAdmin";
import {
  clearRuntimeCircuit,
  getRuntimeCircuit,
  logThrottled,
  resilientRead,
  resilientWrite,
  runtimeCircuitOpen,
  safeErrorText,
} from "@/lib/runtimeResilience";

export type FirebaseArea =
  | "settings"
  | "profile"
  | "raid"
  | "guild-roster"
  | "access-groups"
  | "audit"
  | "content"
  | "rules"
  | "generic";

export type FirebaseOperation = "read" | "write";

const AREA_LABELS: Record<FirebaseArea, string> = {
  settings: "налаштування",
  profile: "профілі",
  raid: "рейди",
  "guild-roster": "склад гільдії",
  "access-groups": "групи доступу",
  audit: "журнал дій",
  content: "контент",
  rules: "правила",
  generic: "Firebase",
};

function cleanArea(area: FirebaseArea | string | undefined): FirebaseArea {
  const value = String(area || "generic") as FirebaseArea;
  return [
    "settings",
    "profile",
    "raid",
    "guild-roster",
    "access-groups",
    "audit",
    "content",
    "rules",
    "generic",
  ].includes(value)
    ? value
    : "generic";
}

function envFlag(names: string[], fallback = false) {
  for (const name of names) {
    const raw = process.env[name];
    if (raw === undefined || raw === null || raw === "") continue;
    return ["1", "true", "yes", "on"].includes(String(raw).trim().toLowerCase());
  }
  return fallback;
}

function firebaseReadsDisabled() {
  return envFlag(["FIREBASE_READS_DISABLED", "FIRESTORE_READS_DISABLED"], false);
}

function firebaseWritesDisabled() {
  return envFlag([
    "FIREBASE_WRITES_DISABLED",
    "FIRESTORE_WRITES_DISABLED",
    "FIREBASE_READ_ONLY_MODE",
    "FIREBASE_ECO_READ_ONLY",
  ], false);
}

export function firebaseCircuitKey(area: FirebaseArea | string, operation: FirebaseOperation) {
  return `firebase-${cleanArea(area)}-${operation}`;
}

export function firebaseCapability(area: FirebaseArea | string, operation: FirebaseOperation) {
  const clean = cleanArea(area);
  if (!hasFirebaseProfileConfig()) {
    return {
      configured: false,
      available: false,
      mode: "unconfigured" as const,
      reason: "Firebase не налаштований.",
      circuit: null,
      circuitKey: firebaseCircuitKey(clean, operation),
      label: AREA_LABELS[clean],
    };
  }

  const key = firebaseCircuitKey(clean, operation);
  const disabled = operation === "read" ? firebaseReadsDisabled() : firebaseWritesDisabled();
  if (disabled) {
    return {
      configured: true,
      available: false,
      mode: "disabled" as const,
      reason: operation === "read" ? "Firebase reads disabled by env." : "Firebase writes disabled by env.",
      circuit: null,
      circuitKey: key,
      label: AREA_LABELS[clean],
    };
  }

  const circuit = getRuntimeCircuit(key);
  return {
    configured: true,
    available: !circuit,
    mode: circuit ? "circuit-open" as const : "available" as const,
    reason: circuit?.reason || null,
    circuit,
    circuitKey: key,
    label: AREA_LABELS[clean],
  };
}

export function canAttemptFirebaseRead(area: FirebaseArea | string = "generic") {
  return firebaseCapability(area, "read").available;
}

export function canAttemptFirebaseWrite(area: FirebaseArea | string = "generic") {
  return firebaseCapability(area, "write").available;
}

export function firebaseReadOnlyMode(area: FirebaseArea | string = "generic") {
  return canAttemptFirebaseRead(area) && !canAttemptFirebaseWrite(area);
}

export function firebaseUnavailableMessage(area: FirebaseArea | string, operation: FirebaseOperation) {
  const capability = firebaseCapability(area, operation);
  const label = capability.label;
  if (!capability.configured) {
    return `Firebase для розділу “${label}” не налаштований. Читання і запис вимкнені.`;
  }
  if (operation === "write") {
    return `Збереження для розділу “${label}” тимчасово недоступне. Дані можна переглядати, але зміни зараз не записуються.`;
  }
  return `Читання для розділу “${label}” тимчасово недоступне. Показуємо кеш або безпечний порожній стан.`;
}

export function assertFirebaseWriteAvailable(area: FirebaseArea | string = "generic") {
  const capability = firebaseCapability(area, "write");
  if (!capability.available) {
    throw new Error(firebaseUnavailableMessage(area, "write"));
  }
}

export function clearFirebaseOperationCircuit(area: FirebaseArea | string, operation: FirebaseOperation) {
  clearRuntimeCircuit(firebaseCircuitKey(area, operation));
}

export async function firebaseRead<T>(
  area: FirebaseArea | string,
  key: string,
  loader: () => Promise<T>,
  options: {
    ttlMs: number;
    timeoutMs?: number;
    fallback: () => T;
    circuitTtlMs?: number;
    logEvent?: string;
    bypassCache?: boolean;
  },
): Promise<T> {
  return resilientRead(key, loader, {
    ...options,
    circuitKey: firebaseCircuitKey(area, "read"),
  });
}

export async function firebaseWrite<T>(
  area: FirebaseArea | string,
  key: string,
  writer: () => Promise<T>,
  options: {
    timeoutMs?: number;
    fallback?: () => T | Promise<T>;
    circuitTtlMs?: number;
    logEvent?: string;
  } = {},
): Promise<T> {
  const capability = firebaseCapability(area, "write");
  if (!capability.available) {
    logThrottled(
      "warn",
      "firebase.write.skipped",
      { area: cleanArea(area), mode: capability.mode, reason: capability.reason || "unavailable" },
      60_000,
    );
    if (options.fallback) return options.fallback();
    throw new Error(firebaseUnavailableMessage(area, "write"));
  }

  return resilientWrite(key, writer, {
    circuitKey: firebaseCircuitKey(area, "write"),
    circuitTtlMs: options.circuitTtlMs || 120_000,
    timeoutMs: options.timeoutMs,
    logEvent: options.logEvent || `firebase.${cleanArea(area)}.write_failed`,
    fallback: async () => {
      const reason = firebaseCapability(area, "write").reason;
      logThrottled(
        "warn",
        "firebase.write.fallback",
        { area: cleanArea(area), reason: reason || "unknown" },
        60_000,
      );
      if (options.fallback) return options.fallback();
      throw new Error(firebaseUnavailableMessage(area, "write"));
    },
  });
}

export function firebaseWriteFailureDetails(area: FirebaseArea | string, error: unknown) {
  const clean = cleanArea(area);
  return {
    area: clean,
    writeCircuitOpen: runtimeCircuitOpen(firebaseCircuitKey(clean, "write")),
    readStillAvailable: canAttemptFirebaseRead(clean),
    message: safeErrorText(error),
  };
}
