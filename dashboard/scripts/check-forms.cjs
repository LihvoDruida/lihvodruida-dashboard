const fs = require("node:fs");
const path = require("node:path");

const root = path.join(__dirname, "..", "src");

function walk(dir, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, out);
    else if (/\.(?:tsx|ts|jsx|js)$/.test(entry.name)) out.push(full);
  }
  return out;
}

function rel(file) {
  return path.relative(path.join(__dirname, ".."), file).replace(/\\/g, "/");
}


function extractJsxControls(source) {
  const out = [];
  const startRe = /<(input|textarea)\b/gi;
  let match;
  while ((match = startRe.exec(source))) {
    const start = match.index;
    let quote = null;
    let braceDepth = 0;
    let end = startRe.lastIndex;
    for (; end < source.length; end += 1) {
      const char = source[end];
      if (quote) {
        if (char === "\\") {
          end += 1;
          continue;
        }
        if (char === quote) quote = null;
        continue;
      }
      if (char === '"' || char === "'" || char === "`") {
        quote = char;
        continue;
      }
      if (char === "{") {
        braceDepth += 1;
        continue;
      }
      if (char === "}" && braceDepth > 0) {
        braceDepth -= 1;
        continue;
      }
      if (char === ">" && braceDepth === 0) {
        out.push({ kind: match[1].toLowerCase(), start, text: source.slice(start, end + 1) });
        startRe.lastIndex = end + 1;
        break;
      }
    }
  }
  return out;
}

function mustContain(file, needles) {
  const source = fs.readFileSync(path.join(__dirname, "..", file), "utf8");
  for (const needle of needles) {
    if (!source.includes(needle)) {
      throw new Error(`${file}: missing form invariant: ${needle}`);
    }
  }
}

const files = walk(root);
let formCount = 0;
let controlCount = 0;
let textControlCount = 0;
let liveSubmitCount = 0;

for (const file of files) {
  const source = fs.readFileSync(file, "utf8");
  const tokens = source.match(/<\/?form\b[^>]*>|<(?:input|textarea|select)\b[\s\S]*?>/g) || [];
  let formDepth = 0;
  for (const token of tokens) {
    if (/^<form\b/i.test(token)) {
      formCount += 1;
      if (formDepth > 0) throw new Error(`${rel(file)}: nested <form> detected`);
      formDepth += 1;
      if (token.includes('data-dashboard-live-submit="true"')) {
        liveSubmitCount += 1;
        if (!/method="post"/i.test(token)) throw new Error(`${rel(file)}: live-submit form must use POST`);
        if (!/action="\/api\//i.test(token)) throw new Error(`${rel(file)}: live-submit form must target /api/`);
      }
      continue;
    }
    if (/^<\/form/i.test(token)) {
      formDepth -= 1;
      if (formDepth < 0) throw new Error(`${rel(file)}: closing </form> without opening form`);
      continue;
    }

    controlCount += 1;
    const kindMatch = token.match(/^<(input|textarea|select)\b/i);
    const kind = kindMatch ? kindMatch[1].toLowerCase() : "";
    const typeMatch = token.match(/\btype=["']([^"']+)/i);
    const type = typeMatch ? typeMatch[1].toLowerCase() : (kind === "textarea" ? "textarea" : kind === "select" ? "select" : "text");
    if (["text", "search", "email", "password", "tel", "url", "textarea"].includes(type)) textControlCount += 1;
  }
  if (formDepth !== 0) throw new Error(`${rel(file)}: unbalanced <form> markup`);

  for (const control of extractJsxControls(source)) {
    const dynamicInputType = control.kind === "input" && /\btype\s*=\s*\{/.test(control.text);
    const typeMatch = control.text.match(/\btype\s*=\s*["']([^"']+)/i);
    const type = control.kind === "textarea" ? "textarea" : typeMatch ? typeMatch[1].toLowerCase() : "text";
    if (dynamicInputType || !["text", "search", "email", "password", "tel", "url", "textarea"].includes(type)) continue;
    if (/\breadOnly(?:\s|=|\/|>)/i.test(control.text)) continue;
    if (!/\bmaxLength\s*=/.test(control.text)) {
      const line = source.slice(0, control.start).split("\n").length;
      throw new Error(`${rel(file)}:${line}: editable ${type} control must define maxLength`);
    }
  }
}

// The global submit enhancer must never destroy icon/span markup while showing loading state.
mustContain("src/components/DashboardFormEnhancer.tsx", [
  'button.dataset.preserveLabel !== "true" && button.childElementCount === 0',
  'submitter.dataset.loadingTextApplied = "true"',
  'if (button.dataset.loadingTextApplied === "true")',
]);

// Welcome text settings: persisted greetings already normalize, de-duplicate and cap entries.
mustContain("src/lib/discordWelcomeCardSettings.ts", [
  "return result.length ? result : [...DEFAULT_GREETINGS];",
]);
mustContain("src/app/dashboard/welcome/page.tsx", [
  'name="messageTemplate" rows={4} maxLength={600}',
  'name="greetings" rows={8} maxLength={2000}',
  'name="testUserId" defaultValue={testInput.userId} inputMode="numeric" pattern="[0-9]{16,25}" maxLength={25}',
  'name="testMessageTemplate" rows={4} maxLength={600}',
]);

// Client fields must mirror server-side limits for the custom raid-poll editor.
mustContain("src/components/RaidPollCreateClientForm.tsx", [
  "if (normalizedTitle.length > 160)",
  'maxLength={160}',
  'pattern="\\d{16,25}"',
  'maxLength={25}',
  'maxLength={900}',
]);

// Content editor must have explicit upper bounds on both UI and server validation.
mustContain("src/lib/content.ts", [
  "export const CONTENT_TEXT_LIMITS = {",
  "if (title.length > CONTENT_TEXT_LIMITS.title)",
  "if (description.length > CONTENT_TEXT_LIMITS.description)",
  "if (body.length > CONTENT_TEXT_LIMITS.body)",
]);
mustContain("src/app/content/page.tsx", [
  "maxLength={CONTENT_TEXT_LIMITS.title}",
  "maxLength={CONTENT_TEXT_LIMITS.description}",
  "maxLength={CONTENT_TEXT_LIMITS.body}",
  "maxLength={CONTENT_TEXT_LIMITS.slug}",
]);

// Snowflakes and URL fields should be bounded before submission.
mustContain("src/components/AccessGroupsManager.tsx", [
  'maxLength={32} pattern="[A-Za-z0-9_-]{1,32}"',
  'maxLength={25} inputMode="numeric" pattern="[0-9]{16,25}"',
]);
mustContain("src/components/RaidViews.tsx", [
  'pattern="[0-9]{16,25}"',
  'maxLength={25}',
  'name="thumbnailUrl"',
  'type="url"',
  'maxLength={2048}',
]);
mustContain("src/components/DiscordEmbedEditor.tsx", [
  "url: 2048,",
  'name="thumbnailUrl" type="url" inputMode="url" maxLength={DISCORD_LIMITS.url}',
  'name="authorUrl" type="url" inputMode="url" maxLength={DISCORD_LIMITS.url}',
  'id="discord-message-link"',
  'maxLength={2048}',
  'name="titleUrl" type="url" inputMode="url" maxLength={DISCORD_LIMITS.url}',
]);
mustContain("src/components/StructuredLogSettingsPanel.tsx", [
  'name="securityDiscordChannelId"',
  'pattern="[0-9]{16,25}"',
  'maxLength={25}',
]);
mustContain("src/components/RaidImagePicker.tsx", [
  'name="imageUrl"',
  'type="url"',
  'maxLength={2048}',
]);
mustContain("src/app/dashboard/page.tsx", [
  'name="requiredRoleIdsText"',
  'maxLength={1024}',
  'name="blockedCountries"',
  'maxLength={512}',
]);
mustContain("src/app/login/page.tsx", [
  'name="token"',
  'maxLength={512}',
]);

console.log(`[check-forms] OK — ${formCount} forms, ${controlCount} controls, ${textControlCount} text-entry controls, ${liveSubmitCount} live-submit forms checked.`);
