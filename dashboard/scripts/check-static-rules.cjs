const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '../src');
const read = p => fs.readFileSync(path.join(root, p), 'utf8');
const verify = (filename, required, banned = []) => {
  const src = read(filename);
  for (const part of required) if (!src.includes(part)) throw new Error(`${filename} missing: ${part}`);
  for (const part of banned) if (src.includes(part)) throw new Error(`${filename} forbidden: ${part}`);
};
verify('lib/staticRules.ts', [
  '24 * 60 * 60 * 1000',
  '10 * 60 * 1000',
  'createHash("sha256")',
  'inviteActive(inviteDoc',
  'previous?.blocked',
  'fetchDiscordGuildMemberSnapshot(userId)',
  'assertDiscordRolesManageable([settings.memberRoleId])',
  'await db().runTransaction',
  'await removeGuildMemberRoles(',
  'staticPermission(',
]);
verify('app/api/static/accept/route.ts', [ 'verifyTrustedOrigin(', 'checkRateLimit(', 'assertRequestBodySize(', 'createStaticChallenge(' ], [ 'addGuildMemberRoles(' ]);
verify('app/api/static/manage/route.ts', [ 'getSession({ live: true })', 'staticPermission(session)', 'if (!access.edit' ]);
verify('app/api/dashboard/static-roles/route.ts', [ 'getSession({ live: true })', 'staticPermission(session)', 'access.admin', 'saveStaticSettings(' ]);
verify('app/api/static/rules/route.ts', [ 'getSession({ live: true })', 'staticPermission(session)', 'permissions.edit' ]);
verify('app/api/static/events/route.ts', [ 'listStaticAudit(', 'staticPermission(session)' ]);
verify('app/api/internal/discord/static-confirm/route.ts', [ 'verifyInternalBearerToken(', 'INTERNAL_API_TOKEN', 'confirmStaticChallenge(' ]);
verify('app/api/static/status/route.ts', [ 'staticChallengeStatus(', 'checkRateLimit(' ]);
verify('proxy.ts', [ 'pathname === "/api/static/accept"', 'pathname === "/api/static/status"', 'pathname === "/api/internal/discord/static-confirm"' ]);
console.log('[check-static-rules] OK — public token boundary, 24h expiry, guild membership, role RBAC and internal DM transport present.');
