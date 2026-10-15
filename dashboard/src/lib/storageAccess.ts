import "server-only";

import { hasDocumentDbConfig } from "@/lib/documentDb";
import {
  clearRuntimeCircuit,
  getRuntimeCircuit,
  logThrottled,
  resilientRead,
  resilientWrite,
  runtimeCircuitOpen,
  safeErrorText,
} from "@/lib/runtimeResilience";
import { envFlag } from "@/lib/values";

export type StorageArea =
  | "settings"
  | "profile"
  | "raid"
  | "guild-roster"
  | "access-groups"
  | "audit"
  | "content"
  | "rules"
  | "generic";

export type StorageOperation = "read" | "write";

const AREA_LABELS: Record<StorageArea, string> = {
  settings: "налаштування",
  profile: "профілі",
  raid: "рейди",
  "guild-roster": "склад гільдії",
  "access-groups": "групи доступу",
  audit: "журнал дій",
  content: "контент",
  rules: "правила",
  generic: "Storage",
};

function cleanArea(area: StorageArea | string | undefined): StorageArea {
  const value = String(area || "generic") as StorageArea;
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
function storageReadsDisabled() {
  return envFlag(["STORAGE_READS_DISABLED", "STORAGE_READS_DISABLED"], false);
}

function storageWritesDisabled() {
  return envFlag([
    "STORAGE_WRITES_DISABLED",
    "STORAGE_WRITES_DISABLED",
    "STORAGE_READ_ONLY_MODE",
    "STORAGE_ECO_READ_ONLY",
  ], false);
}

export function storageCircuitKey(area: StorageArea | string, operation: StorageOperation) {
  return `storage-${cleanArea(area)}-${operation}`;
}

export function storageCapability(area: StorageArea | string, operation: StorageOperation) {
  const clean = cleanArea(area);
  if (!hasDocumentDbConfig()) {
    return {
      configured: false,
      available: false,
      mode: "unconfigured" as const,
      reason: "Storage не налаштований.",
      circuit: null,
      circuitKey: storageCircuitKey(clean, operation),
      label: AREA_LABELS[clean],
    };
  }

  const key = storageCircuitKey(clean, operation);
  const disabled = operation === "read" ? storageReadsDisabled() : storageWritesDisabled();
  if (disabled) {
    return {
      configured: true,
      available: false,
      mode: "disabled" as const,
      reason: operation === "read" ? "Storage reads disabled by env." : "Storage writes disabled by env.",
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

export function canAttemptStorageRead(area: StorageArea | string = "generic") {
  return storageCapability(area, "read").available;
}

export function canAttemptStorageWrite(area: StorageArea | string = "generic") {
  return storageCapability(area, "write").available;
}

export function storageReadOnlyMode(area: StorageArea | string = "generic") {
  return canAttemptStorageRead(area) && !canAttemptStorageWrite(area);
}

export function storageUnavailableMessage(area: StorageArea | string, operation: StorageOperation) {
  const capability = storageCapability(area, operation);
  const label = capability.label;
  if (!capability.configured) {
    return `Storage для розділу “${label}” не налаштований. Читання і запис вимкнені.`;
  }
  if (operation === "write") {
    return `Збереження для розділу “${label}” тимчасово недоступне. Дані можна переглядати, але зміни зараз не записуються.`;
  }
  return `Читання для розділу “${label}” тимчасово недоступне. Показуємо кеш або безпечний порожній стан.`;
}

export function assertStorageWriteAvailable(area: StorageArea | string = "generic") {
  const capability = storageCapability(area, "write");
  if (!capability.available) {
    throw new Error(storageUnavailableMessage(area, "write"));
  }
}

export function clearStorageOperationCircuit(area: StorageArea | string, operation: StorageOperation) {
  clearRuntimeCircuit(storageCircuitKey(area, operation));
}

export async function storageRead<T>(
  area: StorageArea | string,
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
    circuitKey: storageCircuitKey(area, "read"),
  });
}

export async function storageWrite<T>(
  area: StorageArea | string,
  key: string,
  writer: () => Promise<T>,
  options: {
    timeoutMs?: number;
    fallback?: () => T | Promise<T>;
    circuitTtlMs?: number;
    logEvent?: string;
    /** Retry a real user mutation even if a previous transient failure opened the circuit. */
    bypassCircuit?: boolean;
  } = {},
): Promise<T> {
  const capability = storageCapability(area, "write");
  const mayProbeOpenCircuit = options.bypassCircuit && capability.mode === "circuit-open";
  if (!capability.available && !mayProbeOpenCircuit) {
    logThrottled(
      "warn",
      "storage.write.skipped",
      { area: cleanArea(area), mode: capability.mode, reason: capability.reason || "unavailable" },
      60_000,
    );
    if (options.fallback) return options.fallback();
    throw new Error(storageUnavailableMessage(area, "write"));
  }

  return resilientWrite(key, writer, {
    circuitKey: storageCircuitKey(area, "write"),
    circuitTtlMs: options.circuitTtlMs || 120_000,
    timeoutMs: options.timeoutMs,
    logEvent: options.logEvent || `storage.${cleanArea(area)}.write_failed`,
    bypassCircuit: Boolean(options.bypassCircuit),
    fallback: async () => {
      const reason = storageCapability(area, "write").reason;
      logThrottled(
        "warn",
        "storage.write.fallback",
        { area: cleanArea(area), reason: reason || "unknown" },
        60_000,
      );
      if (options.fallback) return options.fallback();
      throw new Error(storageUnavailableMessage(area, "write"));
    },
  });
}

export function storageWriteFailureDetails(area: StorageArea | string, error: unknown) {
  const clean = cleanArea(area);
  return {
    area: clean,
    writeCircuitOpen: runtimeCircuitOpen(storageCircuitKey(clean, "write")),
    readStillAvailable: canAttemptStorageRead(clean),
    message: safeErrorText(error),
  };
}
