const UK_SHORT_MONTHS = ["січ.", "лют.", "бер.", "квіт.", "трав.", "черв.", "лип.", "серп.", "вер.", "жовт.", "лист.", "груд."] as const;

function pad2(value: number) {
  return String(value).padStart(2, "0");
}

export function dateMillis(value?: string | null) {
  if (!value) return null;
  const time = new Date(value).getTime();
  return Number.isFinite(time) ? time : null;
}

export function formatStableUkCompactDate(value?: string | null) {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";

  const day = pad2(date.getUTCDate());
  const month = UK_SHORT_MONTHS[date.getUTCMonth()] || "—";
  return `${day} ${month}`;
}

export function formatStableUtcTime(value?: string | null) {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return `${pad2(date.getUTCHours())}:${pad2(date.getUTCMinutes())}`;
}

export function formatStableNumber(value: number, digits = 0) {
  if (!Number.isFinite(value)) return "0";
  const factor = 10 ** Math.max(0, Math.floor(digits));
  const fixed = String(Math.round(value * factor) / factor);
  const [integer, fraction = ""] = fixed.split(".");
  const grouped = integer.replace(/\B(?=(\d{3})+(?!\d))/g, " ");
  if (digits <= 0) return grouped;
  return `${grouped},${fraction.padEnd(digits, "0").slice(0, digits)}`;
}

export function stableTextKey(value?: string | null) {
  return String(value || "")
    .normalize("NFC")
    .trim()
    .toLocaleLowerCase("uk");
}

export function stableTextCompare(a?: string | null, b?: string | null) {
  const left = stableTextKey(a);
  const right = stableTextKey(b);
  if (left < right) return -1;
  if (left > right) return 1;
  return 0;
}
