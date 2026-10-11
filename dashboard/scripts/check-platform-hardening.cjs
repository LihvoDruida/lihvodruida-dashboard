const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const read = (p) => fs.readFileSync(path.join(root, p), "utf8");
const documentStore = read("src/lib/db/documentStore.ts");
const schema = read("src/lib/db/schema.sql");
const interactions = read("src/app/api/discord/interactions/route.ts");
const discordAdmin = read("src/lib/discordAdmin.ts");
const picker = read("src/components/DiscordEmbedEditor.tsx");
const shared = fs.readFileSync(path.join(root, "..", "shared", "index.mjs"), "utf8");
const cron = fs.readFileSync(path.join(root, "..", "deploy", "cron", "run-cron.sh"), "utf8") + fs.readFileSync(path.join(root, "..", "deploy", "cron", "run-job.sh"), "utf8");
// Check the builder inputs even when this audit runs from a full local checkout.
// Otherwise local cron files can conceal a missing COPY in the Docker image.
const dockerfile = read("Dockerfile");
const builder = dockerfile.split(/^FROM .+ AS builder\s*$/im)[1]?.split(/^FROM /im)[0] || "";
const builderCopies = builder.split(/\r?\n/).map((line) => line.trim().split(/\s+/));
const copiesCronScript = (name) => builderCopies.some((parts) =>
  parts[0]?.toUpperCase() === "COPY" && parts[1] === `deploy/cron/${name}` && parts[2] === `/repo/deploy/cron/${name}`
);

const checks = [
  [copiesCronScript("run-cron.sh"), "Docker builder includes the cron dispatcher used by CI"],
  [copiesCronScript("run-job.sh"), "Docker builder includes the cron worker executed by CI"],
  [documentStore.includes('field === "__name__") return "doc_id"'), "documentId ordering maps to doc_id"],
  [documentStore.includes('rawCursor instanceof PgDocumentSnapshot'), "Postgres startAfter understands document snapshots"],
  [documentStore.includes('NULLIF(${accessor}, \'\')::numeric'), "numeric JSON ordering is explicit"],
  [schema.includes('documents_date_idx'), "date range index exists"],
  [interactions.includes('verifyInternalBearerToken(request, ["INTERNAL_API_TOKEN"]'), "Discord interaction bridge requires service bearer"],
  [interactions.includes('assertRequestBodySize(request, 256 * 1024)'), "Discord interaction bridge caps request body"],
  [discordAdmin.includes('timestampSkewSeconds > 300'), "dashboard rejects replayed Discord timestamps"],
  [shared.includes('components.length > 5'), "Discord row component limit is validated"],
  [shared.includes('(hasSelect && components.length !== 1)'), "Discord select row exclusivity is validated"],
  [picker.includes('discord-role-picker-list" role="group"'), "role picker uses checkbox group semantics"],
  [!picker.includes('aria-selected={active}'), "role picker no longer mixes listbox ARIA with checkboxes"],
  [cron.includes(': > "$body_file"'), "cron clears stale response body before each request"],
  [cron.includes('[ "$curl_status" -eq 0 ] || code="000"'), "cron normalizes transport failures to HTTP 000"],
];

let failed = 0;
for (const [ok, label] of checks) {
  if (ok) console.log(`✓ ${label}`);
  else { failed += 1; console.error(`✗ ${label}`); }
}
if (failed) {
  console.error(`[check-platform-hardening] FAILED — ${failed}/${checks.length}`);
  process.exit(1);
}
console.log(`[check-platform-hardening] OK — ${checks.length}/${checks.length}`);
