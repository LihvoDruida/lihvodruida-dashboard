const fs=require('node:fs');
const path=require('node:path');
const assert=require('node:assert/strict');
const dash=path.resolve(__dirname,'..');
const repo=path.resolve(dash,'..');
const read=(name)=>fs.readFileSync(path.join(repo,name),'utf8');
const content=read('dashboard/src/lib/content.ts');
const proxy=read('dashboard/src/proxy.ts');
const create=read('dashboard/src/app/api/content/create/route.ts');
const update=read('dashboard/src/app/api/content/update/route.ts');
const remove=read('dashboard/src/app/api/content/delete/route.ts');
const media=read('dashboard/src/app/api/site/media/[id]/route.ts');
const catalog=read('dashboard/src/app/api/site/content/route.ts');
const schema=read('dashboard/src/lib/db/schema.sql');
const compose=read('docker-compose.yml');
const checks=[
 [content.includes('collection(STORE)')&&content.includes('siteArticles'),'Articles live in the dashboard document store'],
 [!content.includes('deleteRepoFile')&&!content.includes('createRepoFile')&&!content.includes('updateRepoFile'),'No GitHub publishing in CMS'],
 [create.includes('getSession(')&&create.includes('verifyTrustedOrigin(')&&create.includes('canManageSiteContent'),'Create authorized'],
 [update.includes('getSession(')&&update.includes('verifyTrustedOrigin(')&&update.includes('canManageSiteContent'),'Update authorized'],
 [remove.includes('getSession(')&&remove.includes('verifyTrustedOrigin(')&&remove.includes('deleteSiteContent'),'Delete authorized'],
 [catalog.includes('publicSiteContent')&&!catalog.includes('getSession('),'Public catalog is read-only'],
 [media.includes('SELECT payload,mime_type FROM site_content_media')&&media.includes('immutable'),'Media served by content hash'],
 [schema.includes('CREATE TABLE IF NOT EXISTS site_content_media'),'Database supports CMS media'],
 [content.includes('MAX_IMAGE_SIZE')&&content.includes('imageMatches(bytes,file.type)'),'Media MIME and size verified'],
 [proxy.includes('pathname === "/api/site/content"')&&proxy.includes('/site\\/media\\/'),'Public routes explicitly allowlisted'],
 [proxy.includes('isInternalSiteRead')&&proxy.includes('request.method === "GET"')&&proxy.includes('PUBLIC_SITE_BRIDGE_TOKEN'),'Internal transport read only'],
 [compose.includes('PUBLIC_SITE_BRIDGE_TOKEN: ${PUBLIC_SITE_BRIDGE_TOKEN:-}'),'Internal bridge secret explicitly wired'],
 [fs.existsSync(path.join(repo,'import/legacy-site/migrate_site_articles.sql')),'SQL content import available'],
];
for(const [condition,message] of checks)assert.ok(condition,message);
console.log(`[check-public-content] OK — ${checks.length} CMS, transport and import invariants checked.`);
