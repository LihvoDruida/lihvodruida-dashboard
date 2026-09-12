const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
function read(rel) {
  return fs.readFileSync(path.join(root, rel), "utf8");
}
function expect(source, pattern, label) {
  if (!pattern.test(source)) throw new Error(`[check-profile-avatars] ${label}`);
}

const avatarLib = read("src/lib/discordAvatar.ts");
const callback = read("src/app/api/auth/discord/callback/route.ts");
const discordAdmin = read("src/lib/discordAdmin.ts");
const auth = read("src/lib/auth.ts");
const avatarComponent = read("src/components/ProfileAvatar.tsx");
const profilePage = read("src/app/profile/[profileId]/page.tsx");
const settingsPage = read("src/app/profile/[profileId]/settings/page.tsx");
const profilesPage = read("src/app/profiles/page.tsx");
const css = read("src/app/styles/profile.css");

const checks = [
  [avatarLib, /guildAvatarHash[\s\S]*userAvatarHash[\s\S]*discordDefaultAvatarUrl/, "Discord avatar fallback order missing"],
  [avatarLib, /BigInt\(userId\)[\s\S]*% 6n/, "modern Discord default avatar index missing"],
  [callback, /guildAvatarHash:\s*member\?\.avatar/, "OAuth does not prefer guild member avatar"],
  [callback, /userAvatarHash:\s*user\.avatar/, "OAuth global avatar fallback missing"],
  [discordAdmin, /avatarUrl:\s*resolveDiscordAvatarUrl/, "live guild member snapshot has no avatar URL"],
  [auth, /avatar:\s*member\.avatarUrl[\s\S]*avatar_url:\s*member\.avatarUrl/, "live Discord session does not refresh avatar"],
  [avatarComponent, /onError=\{\(\) => setFailed\(true\)\}/, "broken CDN image does not switch to placeholder"],
  [avatarComponent, /data-avatar-placeholder="true"/, "local avatar placeholder missing"],
  [profilePage, /liveDiscordAvatarUrl[\s\S]*<ProfileAvatar/, "profile page does not use live Discord avatar"],
  [settingsPage, /liveDiscordMember\?\.avatarUrl \|\| profile\.avatarUrl/, "settings page live avatar fallback missing"],
  [profilesPage, /fetchDiscordGuildMembersCachedForUi\(\)/, "directory does not refresh Discord avatars through the UI cache"],
  [profilesPage, /<ProfileAvatar/, "directory does not use robust avatar component"],
  [css, /grid-template-columns:\s*repeat\(auto-fill,\s*minmax\(min\(300px, 100%\), 360px\)\)/, "character cards still stretch freely"],
  [css, /max-width:\s*360px/, "character card max width missing"],
];

for (const [source, pattern, label] of checks) expect(source, pattern, label);
console.log(`[check-profile-avatars] OK — ${checks.length}/${checks.length} avatar/card invariants checked.`);
