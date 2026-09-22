const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const read = (relative) => fs.readFileSync(path.join(root, relative), "utf8");
const checks = [];
function check(name, condition) {
  if (!condition) throw new Error(`[check-live-refresh] FAIL — ${name}`);
  checks.push(name);
  console.log(`✓ ${name}`);
}

const layout = read("src/app/layout.tsx");
const pageSync = read("src/components/DashboardLivePageSync.tsx");
const apiRefresh = read("src/components/DashboardBackgroundApiRefresh.tsx");
const backgroundApi = read("src/lib/dashboardBackgroundApi.ts");
const lifecycle = read("src/app/api/raids/lifecycle/route.ts");
const polls = read("src/app/api/polls/close-due/route.ts");
const guild = read("src/app/api/guild/sync/route.ts");
const nicknames = read("src/lib/discordNicknameWarnings.ts");
const interactions = read("src/app/api/discord/interactions/route.ts");
const cron = read(path.join("..", "deploy/cron/run-cron.sh"));
const pkg = JSON.parse(read("package.json"));

check("global background API refresh is mounted", /<LiveDataRefresh\s*\/>/.test(layout));
check("global RSC live page sync is mounted", /<DashboardLivePageSync\s*\/>/.test(layout));
check("live page sync uses router.refresh without location.reload", /router\.refresh\(\)/.test(pageSync) && !/location\.reload/.test(pageSync));
check("live page sync pauses for dirty/submitting editors", /form\[data-dirty=/.test(pageSync) && /form\[data-submitting=/.test(pageSync));
check("background API refresh also pauses for dirty forms", /form\[data-dirty=/.test(apiRefresh));
check("background resource events report real payload changes", /changed,/.test(backgroundApi) && /fingerprint !== record\.fingerprint/.test(backgroundApi));
check("unchanged lifecycle ticks are demoted to debug", /lifecycleHasActivity/.test(lifecycle) && /\? \"info\" : \"debug\"/.test(lifecycle));
check("unchanged poll ticks are demoted to debug", /pollCloseHasActivity/.test(polls) && /\? \"info\" : \"debug\"/.test(polls));
check("idle guild sync ticks are demoted to debug", /guildSyncHasActivity/.test(guild) && /\? \"info\" : \"debug\"/.test(guild));
check("poll cron retains forced five-minute scheduling precision", /close-due\?force=1/.test(cron));
check("nickname retry uses capped exponential backoff", /backoffMultiplier/.test(nicknames) && /24 \* 60 \* 60_000/.test(nicknames) && /lastCheckErrorCount/.test(nicknames));
check("Discord owner autorole limitation is not logged as an internal error", /discord\.autorole\.owner_unsupported/.test(interactions) && /expectedOwnerLimitation \? "info" : "error"/.test(interactions));
check("Next.js is pinned to the current security release", pkg.dependencies?.next === "16.3.3" && pkg.devDependencies?.["eslint-config-next"] === "16.3.3");

console.log(`[check-live-refresh] OK — ${checks.length}/${checks.length} automation/live-refresh invariants checked.`);
