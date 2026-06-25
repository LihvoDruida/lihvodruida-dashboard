export const STATUS = {
  review: { key: "review", label: "На розгляді", labelName: "status:review", color: "#D4A63A" },
  accepted: { key: "accepted", label: "Прийнято", labelName: "status:accepted", color: "#3BA55D" },
  declined: { key: "declined", label: "Відхилено", labelName: "status:declined", color: "#ED4245" }
} as const;

export type StatusKey = keyof typeof STATUS;

export const STATUS_LABELS = [
  "status:review",
  "status:accepted",
  "status:declined",
  "status:approved",
  "status:rejected"
];

export function normalizeStatus(value: string | null | undefined): StatusKey {
  const raw = String(value || "").trim().toLowerCase();
  if (raw === "accepted" || raw === "approved" || raw === "status:accepted") return "accepted";
  if (raw === "declined" || raw === "rejected" || raw === "status:declined") return "declined";
  return "review";
}

export function statusFromLabels(labels: string[]): StatusKey {
  const normalized = labels.map((label) => label.toLowerCase());
  if (normalized.includes("status:accepted") || normalized.includes("status:approved")) return "accepted";
  if (normalized.includes("status:declined") || normalized.includes("status:rejected")) return "declined";
  return "review";
}
